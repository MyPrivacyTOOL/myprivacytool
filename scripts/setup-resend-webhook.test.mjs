// MPC-8751: the Resend setup script, against a stubbed Resend and Worker. Run: node scripts/setup-resend-webhook.test.mjs
import assert from 'node:assert/strict';
import { run, EVENTS } from './setup-resend-webhook.mjs';
import { verifyReceipt } from '../workers/scan-report/lib/receipts.js';

const SECRET = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;
const mk = ({ hooks = [], domains = [{ id: 'd1', name: 'myprivacytool.io', click_tracking: false, open_tracking: true }], hooksStatus = 200 } = {}) => {
  const calls = []; let created = 0;
  const f = async (url, init = {}) => {
    const m = init.method || 'GET'; calls.push(`${m} ${url.replace('https://api.resend.com', '')}`);
    const json = (s, b) => ({ status: s, json: async () => b });
    if (url.endsWith('/webhooks') && m === 'GET') return json(hooksStatus, { data: hooks });
    if (url.endsWith('/webhooks') && m === 'POST') { created++; assert.deepEqual(JSON.parse(init.body).events, EVENTS); return json(201, { id: 'w1', signing_secret: SECRET }); }
    if (url.endsWith('/webhooks/w1') || url.includes('/webhooks/w0')) return json(200, { id: 'w1', signing_secret: SECRET });
    if (url.endsWith('/domains') && m === 'GET') return json(200, { data: domains });
    if (url.includes('/domains/d1') && m === 'PATCH') { assert.deepEqual(JSON.parse(init.body), { click_tracking: true, open_tracking: false }); return json(200, {}); }
    if (url.includes('/api/resend-webhook')) {
      const ok = await verifyReceipt(SECRET, new Headers(init.headers), init.body);
      return { status: ok ? 200 : 401, json: async () => ({}) };
    }
    return json(404, {});
  };
  return { f, calls, created: () => created };
};
const quiet = () => {};
const E = (o) => ({ RESEND_API_KEY: 'k', ...o });

{ const s = mk(); const r = await run(E({ MODE: 'inspect' }), { fetchImpl: s.f, log: quiet });
  assert.ok(r.ok && s.calls.every((c) => c.startsWith('GET')), 'inspect changes nothing'); }
{ const s = mk(); let wrote = null; const r = await run(E({ MODE: 'apply', SECRET_OUT: '/x' }), { fetchImpl: s.f, log: quiet, writeFile: (p, d, o) => { wrote = { p, d, o }; } });
  assert.ok(r.ok && s.created() === 1 && wrote.d === SECRET && wrote.o.mode === 0o600, 'apply creates the webhook once and writes the secret to a 0600 file'); }
{ const s = mk({ hooks: [{ id: 'w1', endpoint: 'https://mpt-scan-report.myprivacytool.workers.dev/api/resend-webhook', events: EVENTS }] });
  const r = await run(E({ MODE: 'apply' }), { fetchImpl: s.f, log: quiet, writeFile: quiet });
  assert.ok(r.ok && s.created() === 0, 'an existing webhook is reused, never duplicated'); }
{ const s = mk({ hooksStatus: 401 }); const r = await run(E({ MODE: 'apply' }), { fetchImpl: s.f, log: quiet, writeFile: quiet });
  assert.ok(!r.ok && /full-access/.test(r.problems[0]) && s.created() === 0, 'a sending-only key fails clearly and changes nothing'); }
{ const s = mk({ domains: [{ id: 'd9', name: 'other.example' }] }); const r = await run(E({ MODE: 'apply' }), { fetchImpl: s.f, log: quiet, writeFile: quiet });
  assert.ok(!r.ok && s.created() === 0, 'wrong domain: nothing is created'); }
{ const s = mk(); const lines = []; const r = await run({ MODE: 'verify', RESEND_WEBHOOK_SECRET: SECRET }, { fetchImpl: s.f, log: (l) => lines.push(l) });
  assert.ok(r.ok && lines.filter((l) => l.startsWith('PASS')).length === 2, 'verify: unsigned 401 and signed 200'); }
{ const s = mk(); const r = await run({ MODE: 'verify', RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from('another-secret-another-secret-12').toString('base64')}` }, { fetchImpl: s.f, log: quiet });
  assert.ok(!r.ok, 'verify fails when the Worker holds a different secret'); }
{ const r = await run({ MODE: 'apply' }, { fetchImpl: async () => { throw new Error('no network'); }, log: quiet });
  assert.ok(!r.ok, 'no API key: fails without calling anything'); }
console.log('setup-resend-webhook.test.mjs ok');
