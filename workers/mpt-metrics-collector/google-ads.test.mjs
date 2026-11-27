import collector, { campaignQuery, conversionActionQuery } from './collectors/google-ads-daily.js';
import { adsEfficiency, weeklyProperties } from './publishers/notion.js';
import { buildDigest } from './lib/digest.js';
import { COLLECTORS, COLLECTOR_GROUPS } from './worker.js';
import { listConversionActions, accessToken, DEFAULT_API_VERSION, DEFAULT_CUSTOMER_ID } from './collectors/google-ads.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

const env = { GOOGLE_ADS_OAUTH_CLIENT_ID: 'cid', GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'csec', GOOGLE_ADS_REFRESH_TOKEN: 'rtok' };
let calls = [], apiStatus = 200, tokenStatus = 200;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  if (url === 'https://oauth2.googleapis.com/token') {
    if (tokenStatus !== 200) return { ok: false, status: tokenStatus, json: async () => ({ error: 'invalid_grant' }) };
    return { ok: true, status: 200, json: async () => ({ access_token: 'at-1' }) };
  }
  if (url.includes('googleads.googleapis.com')) {
    if (apiStatus !== 200) return { ok: false, status: apiStatus, json: async () => ({ secret_detail: 'rtok' }) };
    return { ok: true, status: 200, json: async () => [{ results: [{ conversionAction: { id: '1', name: 'a', status: 'ENABLED' } }] }, { results: [{ conversionAction: { id: '2', name: 'b', status: 'HIDDEN' } }] }] };
  }
  return { ok: false, status: 404 };
};

let r = await listConversionActions({});
check(r.configured === false && r.missing.length === 3, 'unconfigured env returns configured=false and lists the 3 missing secret names, no network call');
check(calls.length === 0, 'no fetch when unconfigured');

r = await listConversionActions(env);
check(r.configured && r.count === 2 && r.actions[1].status === 'HIDDEN', 'streamed batches are flattened into one actions list');
const tok = calls[0], api = calls[1];
check(tok.opts.body.get('grant_type') === 'refresh_token' && tok.opts.body.get('refresh_token') === 'rtok', 'token exchange uses the refresh_token grant');
check(api.url === `https://googleads.googleapis.com/${DEFAULT_API_VERSION}/customers/${DEFAULT_CUSTOMER_ID}/googleAds:searchStream`, 'calls searchStream on the default version and customer');
check(api.opts.headers.authorization === 'Bearer at-1' && !('developer-token' in api.opts.headers), 'bearer auth, no developer-token header');
check(api.opts.method === 'POST' && !api.url.includes('mutate'), 'read-only: only searchStream is ever called');

calls = []; await listConversionActions({ ...env, GOOGLE_ADS_API_VERSION: 'v99', GOOGLE_ADS_CUSTOMER_ID: '627-131-2111' });
check(calls[1].url === 'https://googleads.googleapis.com/v99/customers/6271312111/googleAds:searchStream', 'version and customer id overrides apply (dashes stripped)');

apiStatus = 400;
try { await listConversionActions(env); check(false, 'API error should throw'); } catch (e) { check(e.message === 'google ads searchStream v26: HTTP 400' && !e.message.includes('rtok'), 'API error is status only, body not echoed'); }
apiStatus = 200; tokenStatus = 401;
try { await accessToken(env); check(false, 'token error should throw'); } catch (e) { check(e.message === 'google ads oauth token: HTTP 401', 'token error is status only'); }


// ---- MPC-9972: daily account collector -------------------------------------------------------------------------------------------
const NOW = new Date('2026-11-10T00:30:00Z'); // previous account (UK) day = 2026-11-09
apiStatus = 200; tokenStatus = 200; calls = [];
let queries = [];
const campaignResults = [{ campaign: { name: 'Brand', status: 'ENABLED' }, metrics: { impressions: '1000', clicks: '40', costMicros: '12500000', conversions: 5, conversionsValue: 0 } }, { campaign: { name: 'Generic', status: 'PAUSED' }, metrics: { impressions: '500', clicks: '10', costMicros: '2500000', conversions: 1, conversionsValue: 0 } }];
const actionResults = [{ customer: { currencyCode: 'GBP' }, segments: { conversionActionName: 'scan_started' }, metrics: { conversions: 6, conversionsValue: 0 } }, { customer: { currencyCode: 'GBP' }, segments: { conversionActionName: 'purchase' }, metrics: { conversions: 1, conversionsValue: 9 } }];
let empty = false;
const baseFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('googleads.googleapis.com')) {
    calls.push({ url, opts }); const q = JSON.parse(opts.body).query; queries.push(q);
    if (apiStatus !== 200) return { ok: false, status: apiStatus, json: async () => ({ secret_detail: 'rtok' }) };
    const results = empty ? [] : q.includes('FROM campaign') ? campaignResults : actionResults;
    return { ok: true, status: 200, json: async () => (empty ? [{}] : [{ results }]) };
  }
  return baseFetch(url, opts);
};
let out = await collector.collect(env, NOW);
const sm = out.payload.summary;
check(out.payload.day === '2026-11-09' && out.period_start === '2026-11-09T00:00:00.000Z' && out.period_end === '2026-11-10T00:00:00.000Z' && out.payload.account_time_zone === 'GMT+00:00', 'previous full day in the account time zone (UK), not Hong Kong');
check(collector.source === 'google-ads' && collector.report === 'account_daily', 'collector is google-ads / account_daily');
check(sm.campaigns === 2 && sm.impressions === 1500 && sm.clicks === 50 && sm.cost === 15 && sm.conversions === 6, 'campaign totals summed, cost_micros converted to currency units');
check(sm.scan_started === 6 && sm.paid_conversions === 1 && out.payload.currency === 'GBP' && out.payload.conversion_actions.length === 2, 'conversion-action breakdown gives scan_started and paid counts');
check(out.payload.campaigns[1].status === 'PAUSED' && out.payload.campaigns[0].name === 'Brand', 'per-campaign name and status kept');
const adCalls = calls.filter((c) => c.url.includes('googleads.googleapis.com'));
check(adCalls.length === 2 && calls.length === 3 && queries.every((q) => /^SELECT .* FROM (campaign|customer) WHERE segments\.date = '2026-11-09'$/.test(q)), 'exactly two GAQL queries for the day (plus one token call)');
check(adCalls.every((c) => c.opts.method === 'POST' && c.url.endsWith(':searchStream') && !/mutate/i.test(c.url)), 'READ-ONLY: every Google Ads call is searchStream, no mutate endpoint can be hit');
check(![campaignQuery('d'), conversionActionQuery('d')].some((q) => /mutate|INSERT|UPDATE|REMOVE|search_term|click_view|user_/i.test(q)), 'queries are aggregate reads only (no click, user or search-term level view)');
check(!JSON.stringify(out).includes('rtok') && !JSON.stringify(out).includes('at-1'), 'no secret or token in the stored payload');

empty = true; out = await collector.collect(env, NOW);
check(out.payload.configured && out.payload.summary.campaigns === 0 && out.payload.summary.cost === 0 && out.payload.summary.scan_started === 0 && out.payload.currency === null, 'no campaigns yet => zeros, not an error');
empty = false; calls = [];
out = await collector.collect({}, NOW);
check(out.payload.configured === false && out.payload.missing.length === 3 && calls.length === 0, 'secrets missing => ok row configured=false, no call');
apiStatus = 403;
try { await collector.collect(env, NOW); check(false, 'API failure should throw'); } catch (e) { check(/HTTP 403$/.test(e.message) && !e.message.includes('rtok'), 'error is endpoint + HTTP status, body never echoed'); }
apiStatus = 200;
check(COLLECTORS.includes(collector) && COLLECTOR_GROUPS.collect_core.includes(collector), 'registered in COLLECTORS and COLLECT_CORE');

// ---- weekly efficiency -----------------------------------------------------------------------------------------------------------
const day = (d, cost, scans, paid) => ({ period_start: d, payload: { configured: true, day: d, summary: { cost, scan_started: scans, paid_conversions: paid } } });
let eff = adsEfficiency([day('2026-11-09', 15, 6, 1), day('2026-11-10', 15, 4, 0), day('2026-11-10', 15, 4, 0)]); // duplicate day counted once
check(eff.cost === 30 && eff.scan_started === 10 && eff.cost_per_scan === 3 && eff.cac === 30 && eff.days === 2, 'weekly cost per scan and CAC, one row per day');
eff = adsEfficiency([day('2026-11-09', 0, 0, 0)]);
check(eff.cost_per_scan === null && eff.cac === null && adsEfficiency([]).cost_per_scan === null, 'zero spend / no rows => null, never estimated');
const wp = (e) => weeklyProperties('2026-11-09', {}, 'now', null, e)['Agent Insights'].rich_text[0].text.content;
check(/Ad cost per scan: 3 /.test(wp(adsEfficiency([day('2026-11-09', 30, 10, 1)]))) && /CAC: 30 /.test(wp(adsEfficiency([day('2026-11-09', 30, 10, 1)]))), 'tracker row carries both fields when > 0');
check(!/Ad cost per scan|CAC/.test(wp(adsEfficiency([]))) && !/Ad cost per scan|CAC/.test(wp(null)), 'tracker row omits them when 0 / null');
const dg = (c) => buildDigest({ weekOf: '2026-11-09', current: { cumulativeScans: 5, ...c }, previous: null }).text;
check(/Google Ads: ad cost per scan 3, CAC 30/.test(dg({ adCostPerScan: 3, cac: 30 })) && !/Google Ads/.test(dg({ adCostPerScan: null, cac: null })), 'Monday digest shows them only when > 0');

process.exit(ok ? 0 : 1);
