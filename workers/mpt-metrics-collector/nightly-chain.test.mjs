// MPC-7557: the collector that turns the nightly chain test's result row into the usual alert, and the KPI exclusion of test records. Stubbed fetch, no network.
// Run: node workers/mpt-metrics-collector/nightly-chain.test.mjs
import nightlyChain, { judge, EXPECTED_FROM } from './collectors/nightly-chain.js';
import supabaseCounts from './collectors/supabase-counts.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const ENV = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const NOW = new Date('2026-11-05T16:15:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const real = globalThis.fetch;
const stub = (rows) => { globalThis.fetch = async (u) => { const report = /report=eq\.(\w+)/.exec(String(u))?.[1]; return { ok: true, status: 200, json: async () => (rows[report] ? [rows[report]] : []) }; }; };

const okRow = (h) => ({ captured_at: hoursAgo(h), status: 'ok', error: null, payload: { ok: true, day: '20261105' } });
const failRow = (h, step) => ({ captured_at: hoursAgo(h), status: 'error', error: `step ${step} failed`, payload: { ok: false, failed_step: step, day: '20261105' } });

stub({ nightly: okRow(0.75), weekly: okRow(24) });
let out = await nightlyChain.collect(ENV, NOW);
check(out.payload.nightly.state === 'ok' && out.payload.weekly.state === 'ok' && out.payload.alert === false, 'healthy: ok, no alert');
check(nightlyChain.alertText({ status: 'ok', payload: out.payload }) === null, 'healthy: no alert text');

stub({ nightly: failRow(0.75, 'report_sent'), weekly: okRow(24) });
out = await nightlyChain.collect(ENV, NOW);
let text = nightlyChain.alertText({ status: 'ok', payload: out.payload });
check(out.payload.nightly.state === 'failed' && out.payload.alert === true && /FAILED at step "report_sent"/.test(text), 'a failed night alerts and names the step');
check(!/@|[0-9a-f]{8}-[0-9a-f]{4}/.test(text), 'alert text carries no address or id');

stub({ nightly: okRow(40), weekly: okRow(24) });
out = await nightlyChain.collect(ENV, NOW);
check(out.payload.nightly.state === 'missed' && /has not reported for 40 hours/.test(nightlyChain.alertText({ status: 'ok', payload: out.payload })), 'no nightly result for 30+ hours = missed-run alert');

stub({ nightly: { captured_at: hoursAgo(1), status: 'error', error: 'not configured: missing X', payload: { not_configured: 'missing SUPABASE_SERVICE_ROLE_KEY' } }, weekly: okRow(24) });
out = await nightlyChain.collect(ENV, NOW);
check(out.payload.nightly.state === 'not_configured' && /NOT CONFIGURED/.test(nightlyChain.alertText({ status: 'ok', payload: out.payload })), 'a run that was not configured alerts (never reads as a pass)');

stub({ nightly: okRow(1), weekly: okRow(10 * 24) });
out = await nightlyChain.collect(ENV, NOW);
check(out.payload.weekly.state === 'missed', 'weekly result older than 9 days = missed');

stub({});
out = await nightlyChain.collect(ENV, NOW);
check(out.payload.nightly.state === 'missed' && out.payload.alert === true, `never ran after ${EXPECTED_FROM}: missed-run alert`);
out = await nightlyChain.collect(ENV, new Date('2026-10-29T16:15:00Z'));
check(out.payload.nightly.state === 'not_started' && out.payload.alert === false, `never ran before ${EXPECTED_FROM}: not started, no alert yet`);

check(nightlyChain.alertText({ status: 'error', error: 'HTTP 500', payload: {} }).includes('could NOT be read'), 'a collector that cannot read the status alerts too');
check(judge(okRow(5), 30, NOW, true).state === 'ok' && judge(null, 30, NOW, false).state === 'not_started', 'judge: ok and not_started');

// KPI exclusion: counts are asked with the test-record filter, test rows are counted separately.
const urls = [];
globalThis.fetch = async (u, o) => { urls.push(String(u)); return { ok: true, status: 200, headers: new Headers({ 'content-range': '0-0/7' }) }; };
const counted = await supabaseCounts.collect(ENV);
globalThis.fetch = real;
check(urls.some((u) => /scans\?select=\*&email_scanned=not\.ilike\.testingnt69/.test(u)) && urls.some((u) => /users\?select=\*&email=not\.ilike\.testingnt69/.test(u)), 'KPI counts of scans and users exclude test addresses');
check(urls.some((u) => /leads\?select=\*&email=not\.ilike/.test(u)) && urls.some((u) => /subscribers\?select=\*&email=not\.ilike/.test(u)), 'KPI counts of leads and subscribers exclude test addresses');
check(urls.some((u) => /scans\?select=\*&email_scanned=ilike\.testingnt69/.test(u)) && counted.payload.test_counts.scans === 7 && counted.payload.excludes_test_records === true, 'test records are counted separately (test_counts), so the gap is visible');
check(urls.filter((u) => /mpt_user_engagement|interaction_log/.test(u)).every((u) => !/ilike/.test(u)), 'tables without an address column are counted as before');

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
