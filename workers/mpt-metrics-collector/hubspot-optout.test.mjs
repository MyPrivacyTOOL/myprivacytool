// MPC-7555: HubSpot opt-outs are recorded in email_suppressions (hash only). Stubbed fetch. Run: node workers/mpt-metrics-collector/hubspot-optout.test.mjs
import { createHash } from 'node:crypto';
import collector, { hashEmail } from './collectors/hubspot-optout.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const ENV = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k', HUBSPOT_READONLY_TOKEN: 'h', HUBSPOT_PAUSE_MS: '0' };
const real = globalThis.fetch;
const sha = (e) => createHash('sha256').update(e).digest('hex');
check(await hashEmail('  Mixed.Case@Example.com ') === sha('mixed.case@example.com'), 'hash is SHA-256 of the trimmed, lower-cased address (same as email_suppressions)');

function stub({ pages, existing = [], writeStatus = 200 }) {
  const calls = { hubspot: [], writes: [] };
  globalThis.fetch = async (u, o = {}) => {
    u = String(u);
    if (u.startsWith('https://api.hubapi.com')) { calls.hubspot.push({ u, method: o.method, body: o.body }); const i = calls.hubspot.length - 1; return { ok: true, status: 200, json: async () => pages[i] }; }
    if (u.startsWith('https://db.invalid/rest/v1/email_suppressions')) { const rows = JSON.parse(o.body); calls.writes.push(rows); return { ok: writeStatus === 200, status: writeStatus, json: async () => rows.filter((r) => !existing.includes(r.email_hash)) }; }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  return calls;
}

let c = stub({ pages: [{ results: [{ properties: { email: 'a@example.com' } }, { properties: { email: 'B@example.com' } }], paging: { next: { after: '2' } } }, { results: [{ properties: { email: 'c@example.com' } }] }], existing: [sha('a@example.com')] });
let out = await collector.collect(ENV);
check(out.payload.hubspot_opted_out === 3 && out.payload.newly_recorded === 2, 'pages through HubSpot; 3 opted out, 2 newly recorded (1 already there)');
check(c.hubspot.length === 2 && c.hubspot.every((h) => h.method === 'POST' && h.u.endsWith('/contacts/search') && /hs_email_optout/.test(h.body)), 'HubSpot is only searched (read), never written');
check(c.writes[0].every((r) => /^[0-9a-f]{64}$/.test(r.email_hash) && r.source === 'hubspot_optout') && !JSON.stringify(c.writes).includes('@') && !JSON.stringify(out).includes('@'), 'only hashes are written; no address in the write or the payload');
c = stub({ pages: [{ results: [] }] });
out = await collector.collect(ENV);
check(out.payload.hubspot_opted_out === 0 && c.writes.length === 0, 'nobody opted out: no database write at all');
stub({ pages: [{ results: [{ properties: { email: 'a@example.com' } }] }], writeStatus: 500 });
let err = ''; try { await collector.collect(ENV); } catch (e) { err = e.message; }
check(/HTTP 500/.test(err) && !err.includes('@'), 'a failed write is an error row (no address in the text), not a silent success');
globalThis.fetch = real;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
