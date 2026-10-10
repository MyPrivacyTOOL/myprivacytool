import { runAll } from './worker.js';
import hubspot, { HUBSPOT_PORTAL_ID, hubspotRead } from './collectors/hubspot.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', HUBSPOT_READONLY_TOKEN: 'hs-ro-tok', HUBSPOT_PAUSE_MS: '0' };
const NOW = new Date('2026-10-09T16:15:00Z'); // 00:15 HKT 2026-10-10 => collects HK day 2026-10-09
const PERSON = { email: 'jane@example.com', firstname: 'Jane', phone: '+85255501234' }; // must never reach a stored row

let inserts = [], calls = [], portalId = 246502821, portalHttp = null, failPath = null, status429Once = false;
const json = (b) => ({ ok: true, status: 200, json: async () => b });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.endsWith('/rest/v1/mpt_raw_metrics')) { inserts.push(JSON.parse(opts.body)); return { ok: true, status: 201 }; }
  if (!url.startsWith('https://api.hubapi.com')) return { ok: false, status: 404 };
  const path = url.slice('https://api.hubapi.com'.length);
  const method = opts.method || 'GET';
  calls.push({ method, path, auth: opts.headers.Authorization, body: opts.body ? JSON.parse(opts.body) : null });
  if (status429Once) { status429Once = false; return { ok: false, status: 429 }; }
  if (failPath && path.startsWith(failPath)) return { ok: false, status: 500, json: async () => ({ message: `leak hs-ro-tok ${PERSON.email}` }) };
  if (path === '/account-info/v3/details') return portalHttp ? { ok: false, status: portalHttp } : json({ portalId, timeZone: 'Asia/Hong_Kong' });
  if (path === '/crm/v3/properties/contacts/lifecyclestage') return json({ options: [{ value: 'subscriber' }, { value: 'lead' }, { value: 'customer' }] });
  if (path === '/crm/v3/pipelines/deals') return json({ results: [{ id: 'default', label: 'Sales', stages: [{ id: 'qual', label: 'Qualified' }, { id: 'won', label: 'Closed won' }] }] });
  if (path.startsWith('/crm/v3/objects/contacts/search')) {
    const f = calls.at(-1).body.filterGroups[0].filters;
    let total = 42; // all contacts
    if (f.some((x) => x.propertyName === 'createdate')) total = 3;
    else if (f.some((x) => x.operator === 'NOT_HAS_PROPERTY')) total = 4;
    else if (f.some((x) => x.operator === 'EQ')) total = { subscriber: 20, lead: 15, customer: 3 }[f[0].value];
    return json({ total, results: [{ id: '1', properties: PERSON }] }); // a real search returns a person; we must keep only `total`
  }
  if (path.startsWith('/crm/v3/objects/deals')) {
    const after = new URL(url).searchParams.get('after');
    return after
      ? json({ results: [{ id: 'd3', properties: { dealstage: 'won', pipeline: 'default', amount: '500.5', dealname: 'Jane Co' } }] })
      : json({ results: [
        { id: 'd1', properties: { dealstage: 'qual', pipeline: 'default', amount: '1000' } },
        { id: 'd2', properties: { dealstage: 'qual', pipeline: 'default', amount: null } }], paging: { next: { after: 'p2' } } });
  }
  return { ok: false, status: 404 };
};

const run = async (e = env) => { inserts = []; calls = []; await runAll(e, [hubspot], NOW); return inserts[0]; };

let row = await run();
check(HUBSPOT_PORTAL_ID === 246502821, 'portal ID constant is 246502821');
check(row.source === 'hubspot' && row.report === 'portal_daily' && row.status === 'ok' && row.error === null, 'hubspot row ok');
check(row.period_start === '2026-10-08T16:00:00.000Z' && row.period_end === '2026-10-09T16:00:00.000Z' && row.payload.day === '2026-10-09', 'period is the previous full Hong Kong day');
check(calls[0].path === '/account-info/v3/details' && calls[0].method === 'GET', 'portal ID is read before anything else');
const c = row.payload.contacts;
check(c.total === 42 && c.created_on_day === 3, 'total contacts and contacts created that day');
check(JSON.stringify(c.by_lifecycle_stage) === JSON.stringify({ subscriber: 20, lead: 15, customer: 3, '(none)': 4 }), 'contacts by lifecycle stage (incl. none)');
const createdCall = calls.find((x) => x.body?.filterGroups?.[0]?.filters?.some((f) => f.propertyName === 'createdate'));
const flt = createdCall.body.filterGroups[0].filters;
check(flt.find((f) => f.operator === 'GTE').value === String(Date.parse('2026-10-08T16:00:00Z')) && flt.find((f) => f.operator === 'LT').value === String(Date.parse('2026-10-09T16:00:00Z')), 'created filter is the exact HKT day window');
const d = row.payload.deals;
check(d.total === 3 && d.amount_sum === 1500.5 && d.by_stage.length === 2, 'deals counted across pages, amounts summed');
const q = d.by_stage.find((s) => s.stage_id === 'qual');
check(q.count === 2 && q.with_amount === 1 && q.amount_sum === 1000 && q.stage === 'Qualified' && q.pipeline === 'Sales', 'deals by stage with count, amount and labels');
const stored = JSON.stringify(row);
check(!/jane|example\.com|5550|firstname|email|phone|dealname|Jane Co/i.test(stored), 'no personal data in the stored row');
check(!stored.includes('hs-ro-tok'), 'token not in stored row');
check(calls.every((x) => x.auth === 'Bearer hs-ro-tok'), 'read-only token used for every call');
check(calls.every((x) => x.method === 'GET' || (x.method === 'POST' && /^\/crm\/v3\/objects\/(contacts|deals)\/search$/.test(x.path))), 'only GET and search calls were made');
check(calls.every((x) => x.body === null || x.body.limit === 1), 'search asks for one record, only hs_object_id');

// Portal guard
portalId = 245999072; row = await run(); portalId = 246502821;
check(row.status === 'error' && /portal guard/.test(row.error) && /245999072/.test(row.error), 'portal mismatch => status=error');
check(calls.length === 1 && calls[0].path === '/account-info/v3/details', 'portal mismatch => nothing else read');
check(row.payload.contacts === null && row.payload.deals === null && row.payload.guard.ok === false && row.payload.guard.portal_id_seen === 245999072, 'portal mismatch => blank payload, guard recorded');
portalHttp = 403; row = await run(); portalHttp = null;
check(row.status === 'error' && /could not be read/.test(row.error) && calls.length === 1 && row.payload.contacts === null, 'portal ID unreadable => status=error, nothing else read');
portalId = undefined; row = await run(); portalId = 246502821;
check(row.status === 'error' && calls.length === 1, 'portal ID missing from response => status=error, nothing else read');

// Failures, secrets, redaction
row = await run({ ...env, HUBSPOT_READONLY_TOKEN: undefined });
check(row.status === 'error' && /HUBSPOT_READONLY_TOKEN not set/.test(row.error) && calls.length === 0, 'missing token => error row, no API call');
failPath = '/crm/v3/pipelines/deals'; row = await run(); failPath = null;
check(row.status === 'error' && /deal pipelines: HTTP 500/.test(row.error) && row.payload.deals === null && row.payload.contacts.total === 42, 'deals failure => error, contacts kept');
check(!row.error.includes('hs-ro-tok') && !/example\.com/.test(JSON.stringify(row)), 'API error body (token, personal data) never reaches the row');
failPath = '/crm/v3/objects/contacts/search'; row = await run(); failPath = null;
check(row.status === 'error' && /contacts total: HTTP 500/.test(row.error) && row.payload.contacts === null && row.payload.deals.total === 3, 'contacts failure => error, deals kept');
status429Once = true; row = await run();
check(row.status === 'ok', 'one 429 is retried');
let threw = '';
for (const [m, p] of [['POST', '/crm/v3/objects/contacts'], ['PATCH', '/crm/v3/objects/contacts/1'], ['DELETE', '/crm/v3/objects/deals/1'], ['PUT', '/crm/v3/objects/deals/1'], ['POST', '/crm/v3/objects/contacts/batch/update']]) {
  try { await hubspotRead(env, m, p, 'x'); threw += 'N'; } catch (e) { threw += /refused non-read/.test(e.message) ? 'Y' : 'N'; }
}
check(threw === 'YYYYY', 'hubspotRead refuses create/update/delete/batch calls');
const e2 = { ...env }; inserts = [];
await runAll({ ...e2, HUBSPOT_READONLY_TOKEN: 'hs-ro-tok' }, [{ source: 'hubspot', report: 'r', collect: async () => { throw new Error('boom hs-ro-tok'); } }], NOW);
check(!inserts[0].error.includes('hs-ro-tok') && inserts[0].error.includes('[redacted]'), 'HUBSPOT_READONLY_TOKEN redacted from error text');

process.exit(ok ? 0 : 1);
