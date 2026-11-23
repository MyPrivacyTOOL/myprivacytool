// MPC-11111: the two scan-report GA4 flow events (email_confirmed, report_delivered) are wired to the right moments, send nothing in the shipped state,
// and carry no identifier. Stubbed backend and a stubbed global fetch: no network, no secrets, synthetic data only.
// Run: node workers/scan-report/ga4-flow-events.test.mjs
import { handleConfirm } from './lib/confirmGate.js';
import { handleResendWebhook, signReceipt } from './lib/receipts.js';
import { makeLiveLink } from './lib/live.js';
import recipientsData from '../../shared/recipients/recipients.json' with { type: 'json' };
import { parseRegistry } from '../../shared/recipients/registry.ts';
import { setBundledRegistryForTests } from '../../shared/recipients/outbound.ts';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const SCAN = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const WH_SECRET = 'whsec_' + Buffer.from('ga4-flow-events-test-secret').toString('base64');
const baseEnv = { UNSUBSCRIBE_SECRET: 'test-secret', EMAIL_CONFIRM_GATE_ENABLED: 'true', RESEND_WEBHOOK_SECRET: WH_SECRET, SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_URL: 'https://db.supabase.co', RECIPIENT_ALLOWLIST: '' };
const ON = { GA4_SERVER_EVENTS_ENABLED: 'true', GA4_API_SECRET: 'test-secret-not-real' };
const quiet = async (fn) => { const k = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = k; } };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const enableGa4Registry = () => { const reg = structuredClone(recipientsData); const r = reg.recipients.find((x) => x.key === 'ga4-measurement-protocol'); r.enabled = true; delete r.reason; return setBundledRegistryForTests(parseRegistry(reg)); };

let ga4 = [];
globalThis.fetch = async (url, init = {}) => { url = String(url); if (url.includes('google-analytics.com')) { ga4.push({ url, body: JSON.parse(String(init.body)) }); return new Response(null, { status: 204 }); } return json([], 404); };

// ---- email_confirmed
const confirm = async (env, scanRow) => {
  const sb = { select: async () => [scanRow], patch: async () => [{ id: SCAN }], insert: async () => [], rpc: async () => 0 };
  const token = (await makeLiveLink(env, SCAN)).split('#v=')[1];
  const req = new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: 'https://myprivacytool.io', Authorization: `Bearer ${token}` } });
  const pending = [];
  const res = await quiet(() => handleConfirm(env, { waitUntil: (p) => pending.push(p) }, req, 'https://myprivacytool.io', json, { allowedOrigins: ['https://myprivacytool.io'], rateLimited: async () => false, sb }));
  await Promise.all(pending);
  return res;
};
const unconfirmed = { id: SCAN, email_scanned: 'zelda.quillfeather@example.test', email_confirm_required: true, email_confirmed_at: null };

ga4 = [];
let res = await confirm({ ...baseEnv, ...ON }, unconfirmed);
check(res.status === 200 && ga4.length === 0, 'shipped state (registry entry disabled), env switch and secret set: the click is confirmed and NO GA4 call is made');

let restore = enableGa4Registry();
ga4 = []; res = await confirm({ ...baseEnv }, unconfirmed);
check(res.status === 200 && ga4.length === 0, 'registry on but env switch and secret missing: nothing sent');
ga4 = []; res = await confirm({ ...baseEnv, ...ON }, unconfirmed);
check(res.status === 200 && ga4.length === 1 && ga4[0].body.events[0].name === 'email_confirmed', 'every gate open: the first click sends exactly one email_confirmed');
const wire = JSON.stringify(ga4[0] ?? {});
check(!wire.includes(SCAN) && !wire.includes('zelda') && !wire.includes('example.test') && /"client_id":"[0-9a-f]{32}"/.test(wire), 'the event carries no scan id and no address, only a hashed anonymous id');
ga4 = []; res = await confirm({ ...baseEnv, ...ON }, { ...unconfirmed, email_confirmed_at: '2026-11-23T00:00:00Z' });
check(res.status === 200 && ga4.length === 0, 'a repeat click on an already confirmed scan sends nothing again');
ga4 = []; res = await confirm({ ...baseEnv, ...ON, GA4_API_SECRET: undefined }, unconfirmed);
check(res.status === 200 && ga4.length === 0, 'confirm works the same with the secret missing');
restore();

// ---- report_delivered
const deliver = async (env, { onScan, type = 'email.delivered' } = {}) => {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: 'em_test_1', to: ['person@example.test'] } });
  const id = 'msg_1', ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': await signReceipt(WH_SECRET, id, ts, body) };
  const sb = { rpc: async (name) => (name === 'mpt_record_email_receipt' ? onScan : 1), select: async () => [{ id: SCAN }] };
  return quiet(() => handleResendWebhook(env, new Request('https://x.test/api/resend-webhook', { method: 'POST', headers, body }), json, { sb, optOut: async () => {}, pushHubspot: async () => {} }));
};

ga4 = [];
res = await deliver({ ...baseEnv, ...ON }, { onScan: 1 });
check(res.status === 200 && ga4.length === 0, 'shipped state: a delivery receipt is stored and NO GA4 call is made');
restore = enableGa4Registry();
ga4 = []; res = await deliver({ ...baseEnv, ...ON }, { onScan: 1 });
check(res.status === 200 && ga4.length === 1 && ga4[0].body.events[0].name === 'report_delivered', 'every gate open: a delivery that moved the report row sends one report_delivered');
const wire2 = JSON.stringify(ga4[0] ?? {});
check(!wire2.includes(SCAN) && !wire2.includes('person@') && !wire2.includes('em_test_1'), 'the event carries no scan id, address or provider message id');
ga4 = []; await deliver({ ...baseEnv, ...ON }, { onScan: 0 });
check(ga4.length === 0, 'a retried or repeated receipt (the row did not change) sends nothing again');
ga4 = []; await deliver({ ...baseEnv, ...ON }, { onScan: 1, type: 'email.bounced' });
check(ga4.length === 0, 'a bounce is not a delivery: nothing sent');
ga4 = []; await deliver({ ...baseEnv, ...ON }, { onScan: 1, type: 'email.clicked' });
check(ga4.length === 0, 'a click is not a delivery: nothing sent');
globalThis.fetch = async (url) => { if (String(url).includes('google-analytics.com')) throw new Error('GA4 down'); return json([], 404); };
res = await deliver({ ...baseEnv, ...ON }, { onScan: 1 });
check(res.status === 200, 'GA4 being down never changes the answer to the mail provider');
restore();

process.exit(ok ? 0 : 1);
