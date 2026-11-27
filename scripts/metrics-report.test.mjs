// MPC-11547: tests for scripts/metrics-report.mjs and the pins between the scorecard SQL and the code it copies from.
//   node --test scripts/metrics-report.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReport, hkWeekOf, hkMonthOf, run, VIEWS } from './metrics-report.mjs';
import { HEXAGONS } from '../shared/hexagon-registry/registry.js';

const MIGRATION = readFileSync(new URL('../supabase/migrations/20261127070000_mpc_11547_hexagon_scorecard_views.sql', import.meta.url), 'utf8');
const t = (s) => Date.parse(s);

// ---------- weeks and months are Hong Kong Mondays / first-of-month ----------
test('Hong Kong Monday: Sunday 17:00 UTC is already Monday in Hong Kong', () => {
  assert.equal(hkWeekOf(t('2026-03-08T17:00:00Z')), '2026-03-09');
  assert.equal(hkWeekOf(t('2026-03-08T15:59:59Z')), '2026-03-02');   // Sunday 23:59:59 in Hong Kong
  assert.equal(hkWeekOf(t('2026-11-27T05:00:00Z')), '2026-11-23');   // today (a Friday)
  assert.equal(hkWeekOf(t('2026-11-22T16:00:00Z')), '2026-11-23');   // Monday 00:00 in Hong Kong
});
test('Hong Kong month boundary', () => {
  assert.equal(hkMonthOf(t('2026-11-30T16:00:00Z')), '2026-12-01');
  assert.equal(hkMonthOf(t('2026-11-30T15:59:59Z')), '2026-11-01');
});

// ---------- the report, from rows shaped exactly like the views ----------
const NOW = t('2026-03-18T05:00:00Z');     // a Wednesday: current week 2026-03-16, last complete 2026-03-09
const rows = {
  m1: [
    { week_of: '2026-03-02', completed_scans: 4, activated_scans: 3, test_scans_excluded: 1 },
    { week_of: '2026-03-09', completed_scans: 2, activated_scans: 1, test_scans_excluded: 0 },
    { week_of: '2026-03-16', completed_scans: 3, activated_scans: 3, test_scans_excluded: 0 },
  ],
  m2: [
    { week_of: '2026-03-02', completed_scans: 4, median_verified_facts: '1.50' },
    { week_of: '2026-03-09', completed_scans: 2, median_verified_facts: '1.50' },
    { week_of: '2026-03-16', completed_scans: 3, median_verified_facts: '2.00' },
  ],
  m3: [],
  g: [
    { week_of: '2026-03-02', high_confidence_shown: 60, high_confidence_disputed: 4, high_confidence_kept: 11, answers_all_tiles: 30, dispute_rate: '0.0667', answered_dispute_rate: '0.2667' },
    { week_of: '2026-03-09', high_confidence_shown: 10, high_confidence_disputed: 0, high_confidence_kept: 0, answers_all_tiles: 0, dispute_rate: null, answered_dispute_rate: null },
  ],
  deleted: [{ week_of_deletion: '2026-03-09', deleted_scans: 2 }, { week_of_deletion: '2026-03-02', deleted_scans: 3 }],
  configVersionsAbove0: 0,
};

test('M1: current and last complete week come out as the view rows say', () => {
  const r = buildReport(rows, NOW).m1_activated_scans_per_week;
  assert.deepEqual([r.current_week.week_of, r.current_week.value, r.current_week.week_complete], ['2026-03-16', 3, false]);
  assert.deepEqual([r.last_complete_week.week_of, r.last_complete_week.value, r.last_complete_week.completed_scans], ['2026-03-09', 1, 2]);
  assert.equal(r.trailing.at(-1).week_of, '2026-03-16');
  assert.equal(r.trailing.at(-1).week_complete, false);
  assert.ok(r.caveats.length >= 2, 'the lower-bound caveat travels with the number');
});
test('M1: a week with no stored scans is 0 but flagged as a lower bound with a reason, never a clean zero', () => {
  const r = buildReport({ ...rows, m1: [rows.m1[0]] }, NOW).m1_activated_scans_per_week;
  assert.equal(r.current_week.value, 0);
  assert.equal(r.current_week.status, 'no_stored_scans');
  assert.match(r.current_week.reason, /lower bound/);
  assert.equal(buildReport(rows, NOW).m1_activated_scans_per_week.current_week.status, 'lower_bound');
  assert.equal(buildReport(rows, NOW).m1_activated_scans_per_week.current_week.reason, undefined);
});
test('M2: the median is passed through as a number; a week with no scans is null with a reason, never 0', () => {
  const ok = buildReport(rows, NOW).m2_verified_facts_per_completed_scan;
  assert.equal(ok.current_week.value, 2);
  assert.equal(ok.last_complete_week.value, 1.5);
  const none = buildReport({ ...rows, m2: [rows.m2[0]] }, NOW).m2_verified_facts_per_completed_scan;
  assert.equal(none.current_week.value, null);
  assert.equal(none.current_week.status, 'no_scans');
  assert.match(none.current_week.reason, /not 0/);
});
test('M3: no rows and no bumped config version is 0, dormant, with the reason stated', () => {
  const r = buildReport(rows, NOW).m3_calibrated_tiles_per_month;
  assert.equal(r.current_month.value, 0);
  assert.equal(r.status, 'dormant');
  assert.match(r.reason, /version 0/);
});
test('M3: the "no answers" note only appears when no answer was ever recorded', () => {
  const noAnswers = buildReport({ ...rows, g: [rows.g[1]] }, NOW).m3_calibrated_tiles_per_month;
  assert.match(noAnswers.note, /No tile answer/);
  const withAnswers = buildReport(rows, NOW).m3_calibrated_tiles_per_month;
  assert.equal(withAnswers.note, undefined);
});
test('M3: calibrated tiles are reported in their month, and the status is ok', () => {
  const r = buildReport({ ...rows, m3: [{ month_of: '2026-03-01', calibrated_tiles: 2 }, { month_of: '2026-02-01', calibrated_tiles: 1 }], configVersionsAbove0: 1 }, NOW).m3_calibrated_tiles_per_month;
  assert.equal(r.current_month.value, 2);
  assert.equal(r.previous_month.value, 1);
  assert.equal(r.status, 'ok');
  assert.equal(r.reason, undefined);
});
test('G: a null rate is "not_computable", never 0, and says why', () => {
  const r = buildReport(rows, NOW).g_dispute_rate_on_high_confidence;
  assert.equal(r.last_complete_week.value, null);
  assert.equal(r.last_complete_week.status, 'not_computable');
  assert.match(r.last_complete_week.reason, /not 0%/);
  assert.equal(r.current_week.value, null);   // no row for the current week at all
  assert.equal(r.current_week.status, 'not_computable');
});
test('G: a real rate is passed through with its response rate beside it', () => {
  const r = buildReport(rows, t('2026-03-04T05:00:00Z')).g_dispute_rate_on_high_confidence;   // current week 2026-03-02
  assert.equal(r.current_week.value, 0.0667);
  assert.equal(r.current_week.status, 'ok');
  assert.equal(r.current_week.response_rate, 0.25);        // 15 answered of 60 shown
  assert.equal(r.current_week.answered_dispute_rate, 0.2667);
});
test('G: answers only on other tiles gives its own reason', () => {
  const g = [{ week_of: '2026-03-16', high_confidence_shown: 0, high_confidence_disputed: 0, high_confidence_kept: 0, answers_all_tiles: 7, dispute_rate: null, answered_dispute_rate: null }];
  assert.match(buildReport({ ...rows, g }, NOW).g_dispute_rate_on_high_confidence.current_week.reason, /none on a high-confidence tile/);
});
test('the report names the locked KPI as the headline and lists deleted scans by week of deletion', () => {
  const r = buildReport(rows, NOW);
  assert.match(r.headline_note, /locked KPI/);
  assert.deepEqual(r.coverage.deleted_scans_by_week_of_deletion.map((x) => x.week_of_deletion), ['2026-03-02', '2026-03-09']);
  assert.deepEqual(Object.keys(r).filter((k) => /^(m1|m2|m3|g)_/.test(k)).length, 4);
});

// ---------- run(): reads only, never leaks a body, bad input is a usage error ----------
const ENV = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-test' };
const stubFetch = (calls, fail) => async (url, init) => {
  calls.push({ url, init });
  if (fail) return { ok: false, status: 503, json: async () => ({ secret: 'row data that must never be printed' }) };
  const name = url.split('/rest/v1/')[1].split('?')[0];
  const body = name === VIEWS.m1 ? rows.m1 : name === VIEWS.m2 ? rows.m2 : name === VIEWS.m3 ? rows.m3 : name === VIEWS.g ? rows.g : name === VIEWS.deleted ? rows.deleted : [];
  return { ok: true, status: 200, json: async () => body };
};
test('run: only GET requests, on the five views and the config versions, with the service key', async () => {
  const calls = [];
  const { code, out } = await run(['--now', '2026-03-18T05:00:00Z'], ENV, stubFetch(calls), 0);
  assert.equal(code, 0);
  assert.ok(calls.length === 6 && calls.every((c) => c.init.method === 'GET'));
  assert.deepEqual(calls.map((c) => c.url.split('/rest/v1/')[1].split('?')[0]).sort(), [...Object.values(VIEWS), 'confidence_config'].sort());
  assert.ok(calls.every((c) => c.init.headers.apikey === ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(JSON.parse(out[0]).period.current_week_of, '2026-03-16');
});
test('run: a failed read prints no body and exits 1; missing credentials and bad flags exit 2', async () => {
  const bad = await run([], ENV, stubFetch([], true));
  assert.equal(bad.code, 1);
  assert.ok(!bad.out.join('').includes('row data'));
  assert.equal((await run([], {}, stubFetch([]))).code, 2);
  assert.equal((await run(['--nope'], ENV, stubFetch([]))).code, 2);
  assert.equal((await run(['--now', 'not-a-date'], ENV, stubFetch([]))).code, 2);
});

// ---------- pins: the SQL copies must equal the code they copy ----------
test('pin: mpt_scorecard_registry() equals shared/hexagon-registry/registry.js (ids, confidence, clear allowed, cannot be checked)', () => {
  const block = MIGRATION.slice(MIGRATION.indexOf('select * from (values'), MIGRATION.indexOf(') as r (id, confidence'));
  const sql = [...block.matchAll(/\('([a-z0-9-]+)', (null|\d+), (true|false), (true|false)\)/g)].map((m) => ({ id: m[1], confidence: m[2] === 'null' ? null : Number(m[2]), clear: m[3] === 'true', cannot: m[4] === 'true' }));
  const code = HEXAGONS.map((h) => ({ id: h.id, confidence: h.truth.confidence.number ?? null, clear: !!h.status?.allowed?.includes('CHECKED_AND_CLEAR'), cannot: h.truth?.level === 'cannot_be_checked' }));
  assert.equal(sql.length, code.length);
  assert.deepEqual(sql, code);
});
test('pin: the Wilson z, the 30-responder minimum and the 0.8 high-confidence line equal the TypeScript they copy', () => {
  const agg = readFileSync(new URL('../src/lib/learning/aggregate.ts', import.meta.url), 'utf8');
  const fc = readFileSync(new URL('../src/lib/findingConfirmation.ts', import.meta.url), 'utf8');
  const z = Number(/export const Z_95 = ([\d.]+)/.exec(agg)[1]);
  const min = Number(/export const MIN_RESPONDERS = (\d+)/.exec(agg)[1]);
  const high = Number(/export const HIGH_CONFIDENCE = ([\d.]+)/.exec(fc)[1]);
  assert.equal(z, 1.96);
  assert.equal(min, 30);
  assert.equal(high, 0.8);
  assert.ok(MIGRATION.includes('1.96 * 1.96'), 'SQL uses z = 1.96');
  assert.ok(MIGRATION.includes('running >= 30'), 'SQL uses 30 responders');
  const uses = MIGRATION.match(/c\.confidence [<>=]+ [\d.]+/g) ?? [];
  assert.ok(uses.length > 0 && uses.every((u) => u === 'c.confidence > 0.8'), 'SQL classifies a tile as high only when confidence is above 0.8');
});
test('the migration only adds views and functions: no table is created, altered or written', () => {
  const code = MIGRATION.replace(/--[^\n]*/g, '');
  assert.ok(!/\b(create table|alter table|insert into|update |delete from|truncate|drop table)\b/i.test(code));
});
