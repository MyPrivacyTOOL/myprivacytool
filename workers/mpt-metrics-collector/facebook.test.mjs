// Facebook Page collector (read-only). Stubbed fetch. Run: node workers/mpt-metrics-collector/facebook.test.mjs
import collector, { facebookRead, PAGE_METRICS, summariseInsights } from './collectors/facebook.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const TOKEN = 'fbPAGEtokenSECRET123';
const PAGE = '1234567890123';
const ENV = { FACEBOOK_PAGE_ID: PAGE, FACEBOOK_PAGE_TOKEN: TOKEN, META_ADS_KEY: 'flag-on' }; // META_ADS_KEY only switches the shared recipient on
const NOW = new Date('2026-11-10T00:30:00+08:00'); // previous HK day = 2026-11-09
const real = globalThis.fetch;
const realLog = console.log;
let calls = [];
let logs = [];
let handler;
globalThis.fetch = async (u, o = {}) => {
  calls.push({ u: String(u), headers: o.headers ?? {}, method: o.method ?? 'GET' });
  const r = handler(String(u));
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};
const good = (u) => {
  if (u.includes('/me?')) return { status: 200, body: { id: PAGE } };
  if (u.includes('/insights')) return { status: 200, body: { data: PAGE_METRICS.map((m, i) => ({ name: m, period: 'day', values: [{ value: 10 * (i + 1), end_time: '2026-11-10T08:00:00+0000' }] })) } };
  if (u.includes('/posts')) return { status: 200, body: { data: [{ id: `${PAGE}_1`, created_time: '2026-11-09T03:00:00+0000', insights: { data: [] } }] } };
  return { status: 200, body: { id: PAGE, name: 'MyPrivacyTOOL', followers_count: 42, fan_count: 40 } };
};
handler = good;

let out = await collector.collect(ENV, NOW);
check(!out.error && out.payload.configured === true && out.payload.day === '2026-11-09', 'happy path: ok row for the previous full Hong Kong day');
check(out.payload.summary.followers_count === 42 && out.payload.summary.fan_count === 40 && out.payload.summary.posts_published_on_day === 1, 'followers, fans, post count parsed');
check(out.payload.summary.insights.page_media_view === 10 && out.payload.summary.insights.page_views_total === 60, 'insight values parsed');
check(out.payload.raw.page && out.payload.raw.insights && out.payload.raw.posts, 'untouched responses stored in payload.raw');
check(calls.length === 4 && calls.every((c) => c.method === 'GET') && calls[0].u.includes('/me?'), 'four GETs, guard first');
check(calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}` && !c.u.includes(TOKEN)), 'token sent as header, never in the URL');
check(calls.every((c) => /\/me\?|\/1234567890123(\?|\/)/.test(c.u)), 'every call is /me or the configured Page');
check(!JSON.stringify(out).includes(TOKEN), 'token not in the stored row');

// missing secret(s): skip cleanly, no network, no throw, logs "not configured"
for (const env of [{}, { FACEBOOK_PAGE_ID: PAGE }, { FACEBOOK_PAGE_TOKEN: TOKEN }]) {
  calls = []; logs = [];
  console.log = (...a) => logs.push(a.join(' '));
  out = await collector.collect(env, NOW);
  console.log = realLog;
  check(!out.error && out.payload.configured === false && out.payload.missing.length >= 1 && calls.length === 0 && logs.some((l) => l.includes('not configured')) && !logs.join().includes(TOKEN), `missing ${Object.keys(env).join('+') || 'both'}: skipped, "not configured" logged, no call, no error`);
}

// expired token
calls = [];
handler = () => ({ status: 400, body: { error: { code: 190, message: `Error validating access token ${TOKEN}` } } });
out = await collector.collect(ENV, NOW);
check(out.error && /expired or invalid/.test(out.error) && /190/.test(out.error) && !out.error.includes(TOKEN) && out.payload.guard.token_expired_or_invalid === true && calls.length === 1, 'expired token: error row naming the renewal, one call, no body or token echoed');

// wrong Page ID: token belongs to another object
calls = [];
handler = (u) => (u.includes('/me?') ? { status: 200, body: { id: '9999999999999' } } : good(u));
out = await collector.collect(ENV, NOW);
check(out.error && /expected Page 1234567890123/.test(out.error) && out.payload.guard.ok === false && calls.length === 1 && out.payload.summary === undefined, 'wrong Page: error row, nothing else read');

// empty data
calls = [];
handler = (u) => (u.includes('/me?') ? good(u) : u.includes('/insights') ? { status: 200, body: { data: [] } } : u.includes('/posts') ? { status: 200, body: { data: [] } } : { status: 200, body: { id: PAGE } });
out = await collector.collect(ENV, NOW);
check(!out.error && out.payload.summary.insights.page_media_view === null && out.payload.summary.posts_published_on_day === 0 && out.payload.summary.followers_count === null, 'empty data: ok row, nulls not zeros (except zero posts)');

// batch rejected (metric removed) => per-metric retry, failures reported, row keeps what worked
calls = [];
handler = (u) => {
  if (u.includes('/insights') && u.includes('%2C')) return { status: 400, body: { error: { code: 100, message: 'invalid metric' } } };
  if (u.includes('/insights') && u.includes('page_views_total')) return { status: 400, body: { error: { code: 100 } } };
  if (u.includes('/insights')) { const m = new URL(u).searchParams.get('metric'); return { status: 200, body: { data: [{ name: m, values: [{ value: 7 }] }] } }; }
  return good(u);
};
out = await collector.collect(ENV, NOW);
check(out.error && /page_views_total|insight/.test(out.error) && out.payload.summary.insights.page_media_view === 7 && out.payload.summary.insights.page_views_total === null && calls.length === 10, 'invalid metric: per-metric retry, error row names the failure, other metrics kept');

// the door refuses writes and other objects
let err = null; try { await facebookRead(ENV, PAGE, TOKEN, '/999999999/feed', 'x'); } catch (e) { err = e; }
check(err && /refused path/.test(err.message), 'read door refuses a path outside the configured Page');
err = null; try { await facebookRead(ENV, PAGE, TOKEN, `/${PAGE}12/insights`, 'x'); } catch (e) { err = e; }
check(err && /refused path/.test(err.message), 'read door refuses a Page id that merely starts with the configured one');
check(summariseInsights({}).page_follows === null, 'summary of nothing is all null');

globalThis.fetch = real;
if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('all passed');
