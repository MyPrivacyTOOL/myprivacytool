import worker, { runAll, COLLECTORS } from './worker.js';
import supabaseCounts, { TABLES } from './collectors/supabase-counts.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok' };
let inserts = [], failTable = null, failInsertFor = null;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (opts.method === 'HEAD') {
    const t = /rest\/v1\/([a-z_]+)\?/.exec(url)[1];
    if (t === failTable) return { ok: false, status: 500, headers: new Headers() };
    return { ok: true, status: 200, headers: new Headers({ 'content-range': `0-0/${TABLES.indexOf(t) + 10}` }) };
  }
  if (url.endsWith('/rest/v1/mpt_raw_metrics') && opts.method === 'POST') {
    const row = JSON.parse(opts.body);
    if (row.source === failInsertFor) return { ok: false, status: 500 };
    inserts.push({ row, headers: opts.headers }); return { ok: true, status: 201 };
  }
  return { ok: false, status: 404 };
};

let r = await runAll(env);
check(r.length === 1 && r[0].stored && inserts.length === 1, 'one supabase row appended');
let row = inserts[0].row;
check(row.source === 'supabase' && row.status === 'ok' && row.error === null, 'source=supabase status=ok');
check(TABLES.every((t) => typeof row.payload.counts[t] === 'number') && TABLES.length === 6, 'counts for all six tables');
check(['id', 'email'].every((k) => !JSON.stringify(row).includes(`"${k}"`)), 'no row-level/personal data in payload');
check(!JSON.stringify(row).includes('sekret'), 'secret value not in row');
check(inserts[0].headers.apikey === 'sekret', 'service role key used for insert');

inserts = []; failTable = 'leads'; r = await runAll(env); row = inserts[0].row; failTable = null;
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
check(ran.status === 200 && inserts.length === 1, 'authorised POST /run collects');
check((await call('/nope')).status === 404, 'unknown path 404');

// scheduled
inserts = []; const waits = [];
await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(inserts.length === 1, 'scheduled run appends a row');
check(COLLECTORS.includes(supabaseCounts), 'supabase collector registered');
process.exit(ok ? 0 : 1);
