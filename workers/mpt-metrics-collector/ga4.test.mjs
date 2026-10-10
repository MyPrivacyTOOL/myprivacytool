import { runAll } from './worker.js';
import ga4Reports, { GA4_PROPERTY_ID, yesterday, lastWeek } from './collectors/ga4.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

// A real throwaway RSA key so the JWT signing path runs for real. No production credential is used here.
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const saJson = JSON.stringify({ client_email: 'collector@test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` });
const mkEnv = () => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', GA4_SERVICE_ACCOUNT_JSON: saJson });

let inserts = [], gaCalls = [], tokenCalls = 0, gaFail = false, tokenFail = false;
let apiTz = 'Asia/Hong_Kong';
const API = (name) => ({ metadata: { timeZone: apiTz }, metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }], rows: [{ dimensionValues: [{ value: name }], metricValues: [{ value: '12' }, { value: '9' }] }], rowCount: 1 });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') {
    tokenCalls++; if (tokenFail) return { ok: false, status: 401 };
    const a = opts.body.get('assertion').split('.');
    const claims = JSON.parse(Buffer.from(a[1], 'base64url'));
    if (claims.scope !== 'https://www.googleapis.com/auth/analytics.readonly' || claims.iss !== 'collector@test.iam.gserviceaccount.com') return { ok: false, status: 400 };
    return { ok: true, status: 200, json: async () => ({ access_token: 'tok-abc' }) };
  }
  if (url.startsWith('https://analyticsdata.googleapis.com/')) {
    if (gaFail) return { ok: false, status: 403 };
    gaCalls.push({ url, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => API('r') };
  }
  if (url.endsWith('/rest/v1/mpt_raw_metrics')) { inserts.push(JSON.parse(opts.body)); return { ok: true, status: 201 }; }
  return { ok: false, status: 404 };
};

const wed = new Date('2026-10-13T16:15:00Z'); // 00:15 HKT Wednesday 2026-10-14
let r = await runAll(mkEnv(), ga4Reports, wed);
check(r.every((x) => x.stored) && inserts.length === 5, 'Wednesday: five daily reports stored (no weekly)');
check(['daily_overview', 'daily_events', 'daily_source_medium', 'daily_country', 'daily_landing_page'].every((n) => inserts.some((i) => i.source === 'ga4' && i.report === n)), 'overview, events, source/medium, country, landing page present');
check(gaCalls.every((c) => c.url.includes(`/properties/${GA4_PROPERTY_ID}:runReport`) && c.auth === 'Bearer tok-abc'), 'only property 515216281 queried, bearer token used');
check(tokenCalls === 1, 'one access token shared by all reports');
check(gaCalls.every((c) => c.body.dateRanges[0].startDate === '2026-10-13' && c.body.dateRanges[0].endDate === '2026-10-13'), 'reports cover the last complete Hong Kong day');
const ov = inserts.find((i) => i.report === 'daily_overview');
check(['sessions', 'activeUsers', 'screenPageViews', 'eventCount'].every((m) => gaCalls[0].body.metrics.some((x) => x.name === m)) && gaCalls[0].body.dimensions[0].name === 'date', 'overview asks sessions, activeUsers, screenPageViews, eventCount by date');
check(gaCalls.some((c) => c.body.dimensions?.[0]?.name === 'eventName'), 'events by eventName requested');
check(ov.status === 'ok' && ov.period_start === '2026-10-12T16:00:00.000Z' && ov.payload.metricHeaders[1].name === 'activeUsers' && ov.payload.rows[0].metricValues[1].value === '9', 'payload is the untouched API response, period_start = reported day');
check(!JSON.stringify(inserts).includes('PRIVATE KEY') && !JSON.stringify(inserts).includes('tok-abc'), 'no key or token in stored rows');

inserts = []; gaCalls = []; tokenCalls = 0;
const mon = new Date('2026-10-11T16:15:00Z'); // 00:15 HKT Monday 2026-10-12
await runAll(mkEnv(), ga4Reports, mon);
const wk = inserts.find((i) => i.report === 'weekly_overview');
check(inserts.length === 6 && wk && wk.period_start === '2026-10-04T16:00:00.000Z' && wk.period_end === '2026-10-11T15:59:59.999Z', 'Monday: weekly_overview covers previous Mon..Sun');
check(lastWeek(mon).startDate === '2026-10-05' && lastWeek(mon).endDate === '2026-10-11' && yesterday(mon).startDate === '2026-10-11', 'date helpers (HKT)');
// 23:59 UTC Sunday is already Monday in Hong Kong; 15:59 UTC Sunday is still Sunday there
inserts = []; await runAll(mkEnv(), ga4Reports, new Date('2026-10-11T15:59:00Z'));
check(!inserts.some((i) => i.report === 'weekly_overview') && inserts.length === 5, 'Sunday 23:59 HKT: no weekly report yet');
// property timezone guard
inserts = []; apiTz = 'America/Los_Angeles'; await runAll(mkEnv(), ga4Reports, wed); apiTz = 'Asia/Hong_Kong';
check(inserts.length === 5 && inserts.every((i) => i.status === 'error' && /timezone is America\/Los_Angeles, expected Asia\/Hong_Kong/.test(i.error) && Object.keys(i.payload).length === 0), 'GA4 property not on Hong Kong time => error rows, nothing stored');

// failure: no estimates, status=error, empty payload
for (const [label, mutate, re] of [
  ['GA4 API 403', () => { gaFail = true; }, /HTTP 403/],
  ['token 401', () => { tokenFail = true; }, /token request failed: HTTP 401/],
]) {
  inserts = []; gaFail = false; tokenFail = false; mutate();
  await runAll(mkEnv(), ga4Reports, wed);
  check(inserts.length === 5 && inserts.every((i) => i.status === 'error' && re.test(i.error) && Object.keys(i.payload).length === 0), `${label}: status=error, empty payload, nothing estimated`);
}
gaFail = false; tokenFail = false; inserts = [];
await runAll({ ...mkEnv(), GA4_SERVICE_ACCOUNT_JSON: undefined }, ga4Reports, wed);
check(inserts.length === 5 && inserts.every((i) => i.status === 'error' && /not set/.test(i.error)), 'missing secret => error rows');
inserts = [];
await runAll({ ...mkEnv(), GA4_SERVICE_ACCOUNT_JSON: 'not json' }, ga4Reports, wed);
check(inserts.every((i) => i.status === 'error' && !i.error.includes('not json')) && inserts[0].error.includes('not valid JSON'), 'invalid JSON secret => clear error, value not echoed');
process.exit(ok ? 0 : 1);
