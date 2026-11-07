// Meta ads collector (read-only). Stubbed fetch. Run: node workers/mpt-metrics-collector/meta-ads.test.mjs
import collector, { accountPath, DEFAULT_GRAPH_VERSION, DEFAULT_AD_ACCOUNT_ID } from './collectors/meta-ads.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const KEY = 'metaadsSECRETvalue';
const ENV = { META_ADS_READ_KEY: KEY, META_AD_ACCOUNT_ID: '1234567890' };
const ONLY_KEY = { META_ADS_READ_KEY: KEY };
const NOW = new Date('2026-11-10T00:30:00+08:00'); // previous HK day = 2026-11-09
const real = globalThis.fetch;
let calls = [];
let reply = { ok: true, status: 200, body: { data: [{ impressions: '1200', reach: '900', clicks: '30', spend: '12.5', ctr: '2.5', cpc: '0.4167', account_currency: 'HKD' }] } };
globalThis.fetch = async (u, o = {}) => { calls.push({ u: String(u), headers: o.headers ?? {}, method: o.method ?? 'GET' }); return { ok: reply.ok, status: reply.status, json: async () => reply.body }; };

check(accountPath('123') === 'act_123' && accountPath('act_123') === 'act_123' && accountPath(' act_9 ') === 'act_9', 'account path accepts digits or act_ prefix');

let out = await collector.collect(ENV, NOW);
check(out.payload.configured === true && out.payload.day === '2026-11-09', 'previous full Hong Kong day');
check(out.payload.summary.impressions === 1200 && out.payload.summary.spend === 12.5 && out.payload.summary.currency === 'HKD', 'numbers parsed');
check(calls.length === 1 && calls[0].method === 'GET' && calls[0].u.includes(`/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights?`), 'one GET to the account insights edge (read-only)');
check(calls[0].headers.Authorization === `Bearer ${KEY}` && !calls[0].u.includes(KEY), 'token sent as header, never in the URL');
check(!JSON.stringify(out).includes(KEY), 'token not in the stored payload');

reply = { ok: true, status: 200, body: { data: [] } };
out = await collector.collect(ENV, NOW);
check(out.payload.summary.impressions === 0 && out.payload.summary.spend === 0 && out.payload.summary.ctr === null, 'no spend that day => zeros, not an error');

calls = [];
out = await collector.collect({ META_AD_ACCOUNT_ID: '1234567890' }, NOW);
check(out.payload.configured === false && out.payload.missing.join() === 'META_ADS_READ_KEY' && calls.length === 0, 'key missing => ok row, configured=false, no network call');
reply = { ok: true, status: 200, body: { data: [] } };
out = await collector.collect(ONLY_KEY, NOW);
check(out.payload.configured === true && calls.length === 1 && calls[0].u.includes(`/${DEFAULT_AD_ACCOUNT_ID}/insights?`) && DEFAULT_AD_ACCOUNT_ID === 'act_266295748910383', 'account id unset => the built-in MyPrivacyTOOL FB Ads account is used');

reply = { ok: false, status: 190, body: { error: { message: `bad token ${KEY}` } } };
let err = null; try { await collector.collect(ENV, NOW); } catch (e) { err = e; }
check(err && /HTTP 190/.test(err.message) && !err.message.includes(KEY), 'API failure throws without echoing the body or the token');
err = null; try { await collector.collect({ ...ENV, META_AD_ACCOUNT_ID: 'abc' }, NOW); } catch (e) { err = e; }
check(err && /numeric ad account id/.test(err.message), 'bad account id rejected before any call');

globalThis.fetch = real;
if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('all passed');
