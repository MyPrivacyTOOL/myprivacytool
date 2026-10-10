import worker, { runAll, COLLECTORS } from './worker.js';
import supabaseCounts, { TABLES } from './collectors/supabase-counts.js';
import cloudflareZone from './collectors/cloudflare-zone.js';
import cloudflareWorkers from './collectors/cloudflare-workers.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok', CLOUDFLARE_ANALYTICS_TOKEN: 'cftok', CLOUDFLARE_ZONE_ID: 'zone123' };
const NOW = new Date('2026-10-10T00:15:00Z');
const ZONE_DATA = { viewer: { zones: [{ httpRequests1dGroups: [{ dimensions: { date: '2026-10-09' }, sum: { requests: 500 }, uniq: { uniques: 42 } }] }] } };
const WORKERS_DATA = { viewer: { accounts: [{ workersInvocationsAdaptive: [{ dimensions: { scriptName: 'mpt-leads' }, sum: { requests: 30, errors: 1 } }] }] } };
let gqlCalls = [], gqlFail = null;
let inserts = [], failTable = null, failInsertFor = null;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (opts.method === 'HEAD') {
    const t = /rest\/v1\/([a-z_]+)\?/.exec(url)[1];
    if (t === failTable) return { ok: false, status: 500, headers: new Headers() };
    return { ok: true, status: 200, headers: new Headers({ 'content-range': `0-0/${TABLES.indexOf(t) + 10}` }) };
  }
  if (url === 'https://api.cloudflare.com/client/v4/graphql') {
    const b = JSON.parse(opts.body); gqlCalls.push({ b, auth: opts.headers.Authorization });
    if (gqlFail === 'http') return { ok: false, status: 403, json: async () => ({}) };
    if (gqlFail === 'gql') return { ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: 'not authorized for cftok' }] }) };
    return { ok: true, status: 200, json: async () => ({ data: b.query.includes('httpRequests1dGroups') ? ZONE_DATA : WORKERS_DATA, errors: null }) };
  }
  if (url.endsWith('/rest/v1/mpt_raw_metrics') && opts.method === 'POST') {
    const row = JSON.parse(opts.body);
    if (row.source === failInsertFor) return { ok: false, status: 500 };
    inserts.push({ row, headers: opts.headers }); return { ok: true, status: 201 };
  }
  return { ok: false, status: 404 };
};

let r = await runAll(env, [supabaseCounts]);
check(r.length === 1 && r[0].stored && inserts.length === 1, 'one supabase row appended');
let row = inserts[0].row;
check(row.source === 'supabase' && row.status === 'ok' && row.error === null, 'source=supabase status=ok');
check(TABLES.every((t) => typeof row.payload.counts[t] === 'number') && TABLES.length === 6, 'counts for all six tables');
check(['id', 'email'].every((k) => !JSON.stringify(row).includes(`"${k}"`)), 'no row-level/personal data in payload');
check(!JSON.stringify(row).includes('sekret'), 'secret value not in row');
check(inserts[0].headers.apikey === 'sekret', 'service role key used for insert');

inserts = []; failTable = 'leads'; r = await runAll(env, [supabaseCounts]); row = inserts[0].row; failTable = null;
check(row.status === 'error' && /leads: HTTP 500/.test(row.error) && row.payload.counts.leads === null && row.payload.counts.scans === 10, 'one failed table => status=error, other counts kept');

// pluggable + isolation: a throwing collector does not stop the next one
inserts = [];
const boom = { source: 'boom', report: 'r', collect: async () => { throw new Error('bad sekret here'); } };
const fine = { source: 'fine', report: 'r', collect: async () => ({ payload: { n: 1 } }) };
r = await runAll(env, [boom, fine]);
check(inserts.length === 2 && inserts[0].row.status === 'error' && inserts[1].row.status === 'ok', 'failed source writes error row, next source still runs');
check(!inserts[0].row.error.includes('sekret') && inserts[0].row.error.includes('[redacted]'), 'secret redacted from error text');
inserts = []; failInsertFor = 'boom'; r = await runAll(env, [boom, fine]); failInsertFor = null;
check(r[0].stored === false && r[1].stored === true, 'failed insert does not stop other sources');

// HTTP surface
const call = (path, method = 'GET', headers = {}, e = env) => worker.fetch(new Request('https://w' + path, { method, headers }), e);
check((await call('/health')).status === 200, 'GET /health 200');
check((await call('/run', 'POST')).status === 401, 'POST /run without token => 401');
check((await call('/run', 'POST', { authorization: 'Bearer wrong' })).status === 401, 'wrong token => 401');
check((await call('/run', 'POST', {}, { ...env, COLLECTOR_TRIGGER_TOKEN: undefined })).status === 401, 'no token configured => 401');
inserts = []; const ran = await call('/run', 'POST', { authorization: 'Bearer tok' });
check(ran.status === 200 && inserts.length === 3, 'authorised POST /run collects');
check((await call('/nope')).status === 404, 'unknown path 404');

// scheduled
inserts = []; const waits = [];
await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(inserts.length === 3 && inserts.map((i) => i.row.source + '/' + i.row.report).join() === 'supabase/table_counts,cloudflare/zone_daily,cloudflare/workers_daily', 'scheduled run appends supabase + both cloudflare rows');
check(COLLECTORS.includes(supabaseCounts), 'supabase collector registered');

// Cloudflare collectors (MPC-7381)
check(COLLECTORS.includes(cloudflareZone) && COLLECTORS.includes(cloudflareWorkers), 'cloudflare collectors registered');
inserts = []; gqlCalls = [];
r = await runAll(env, [cloudflareZone, cloudflareWorkers], NOW);
const [z, w] = inserts.map((i) => i.row);
check(z.source === 'cloudflare' && z.report === 'zone_daily' && z.status === 'ok' && JSON.stringify(z.payload) === JSON.stringify(ZONE_DATA), 'zone row stores the untouched API data');
check(w.report === 'workers_daily' && w.status === 'ok' && JSON.stringify(w.payload) === JSON.stringify(WORKERS_DATA), 'workers row stores the untouched API data');
check(z.period_start === '2026-10-09T00:00:00.000Z' && z.period_end === '2026-10-10T00:00:00.000Z' && w.period_start === z.period_start, 'period = last complete UTC day');
check(gqlCalls[0].b.variables.zoneTag === 'zone123' && gqlCalls[0].b.variables.date === '2026-10-09', 'zone query uses zone id and yesterday');
check(JSON.stringify(gqlCalls[1].b.variables.scripts) === JSON.stringify(['mpt-leads', 'core-brain', 'social-listeners']), 'workers query covers the three Workers');
check(gqlCalls.every((c) => c.auth === 'Bearer cftok'), 'read-only analytics token used for Cloudflare calls');
check(!inserts.some((i) => JSON.stringify(i.headers).includes('cftok') || JSON.stringify(i.row).includes('cftok')), 'analytics token not stored or sent to Supabase');
inserts = []; gqlFail = 'http'; await runAll(env, [cloudflareZone, cloudflareWorkers], NOW);
check(inserts.length === 2 && inserts.every((i) => i.row.status === 'error' && JSON.stringify(i.row.payload) === '{}' && /HTTP 403/.test(i.row.error)), 'HTTP failure => status=error, payload blank');
inserts = []; gqlFail = 'gql'; await runAll(env, [cloudflareZone], NOW); gqlFail = null;
check(inserts[0].row.status === 'error' && inserts[0].row.payload && !inserts[0].row.error.includes('cftok') && inserts[0].row.error.includes('[redacted]'), 'GraphQL errors => status=error, token redacted');
inserts = []; await runAll({ ...env, CLOUDFLARE_ANALYTICS_TOKEN: undefined, CLOUDFLARE_ZONE_ID: undefined }, [cloudflareZone, cloudflareWorkers], NOW);
check(inserts.every((i) => i.row.status === 'error') && gqlCalls.length === 2 + 2 + 1, 'missing token/zone => error rows, no API call made');
inserts = []; gqlFail = 'http'; await runAll(env, [cloudflareZone, supabaseCounts], NOW); gqlFail = null;
check(inserts.length === 2 && inserts[1].row.status === 'ok', 'cloudflare failure does not stop supabase collector');
process.exit(ok ? 0 : 1);
