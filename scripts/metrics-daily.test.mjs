// MPC-11567: tests for scripts/metrics-daily.mjs (the daily scorecard job).
//   node --test scripts/metrics-daily.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowsFromReport, failedRows, chainNote, pageBlocks, runJob, finish, KPI_HEADLINE, MEASURES } from './metrics-daily.mjs';
import { buildReport } from './metrics-report.mjs';

const MIGRATION = readFileSync(new URL('../supabase/migrations/20261127112742_mpc_11567_metrics_daily.sql', import.meta.url), 'utf8');
const WORKFLOW = readFileSync(new URL('../.github/workflows/metrics-daily.yml', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-27T06:00:00Z');
const ASOF = '2026-11-27';

// The first readings of 2026-11-27: M1 0 with no stored scan, M2 no median, M3 0 dormant, G not computable.
const firstData = {
  m1: [{ week_of: '2026-11-23', completed_scans: 0, activated_scans: 0, test_scans_excluded: 6 }],
  m2: [{ week_of: '2026-11-23', completed_scans: 0, median_verified_facts: null }],
  m3: [], g: [{ week_of: '2026-11-23', high_confidence_shown: 40, high_confidence_disputed: 0, high_confidence_kept: 0, answers_all_tiles: 0, dispute_rate: null, answered_dispute_rate: null }],
  deleted: [], configVersionsAbove0: 0,
};
const firstReport = buildReport(firstData, NOW);

test('first readings: M1 0 no_stored_scans, M2 no median, M3 0 dormant, G not computable, one row each', () => {
  const rows = rowsFromReport(firstReport, ASOF);
  assert.deepEqual(rows.map((r) => r.measure), MEASURES);
  const by = Object.fromEntries(rows.map((r) => [r.measure, r]));
  assert.deepEqual([by.M1.value, by.M1.status], [0, 'no_stored_scans']);
  assert.deepEqual([by.M2.value, by.M2.status], [null, 'no_scans']);
  assert.deepEqual([by.M3.value, by.M3.status], [0, 'dormant']);
  assert.deepEqual([by.G.value, by.G.status], [null, 'not_computable']);
  for (const r of rows) assert.equal(r.as_of, ASOF);
});

test('no row is ever a bare number: every row has a note, and a missing value is NULL, never 0', () => {
  for (const r of rowsFromReport(firstReport, ASOF)) {
    assert.ok(r.note.trim().length > 20, `${r.measure} note`);
    if (['no_scans', 'not_computable', 'failed'].includes(r.status)) assert.equal(r.value, null);
  }
  const by = Object.fromEntries(rowsFromReport(firstReport, ASOF).map((r) => [r.measure, r]));
  assert.match(by.M1.note, /lower bound/i);
  assert.match(by.M2.note, /no median/i);
  assert.match(by.M3.note, /dormant/i);
  assert.match(by.G.note, /not 0%/);
});

test('real values come through as measured: nothing is estimated or carried forward from another week', () => {
  const data = {
    m1: [{ week_of: '2026-11-16', completed_scans: 5, activated_scans: 4, test_scans_excluded: 0 }],   // last week had scans, this week has none
    m2: [{ week_of: '2026-11-16', completed_scans: 5, median_verified_facts: 7 }],
    m3: [], g: [], deleted: [], configVersionsAbove0: 0,
  };
  const by = Object.fromEntries(rowsFromReport(buildReport(data, NOW), ASOF).map((r) => [r.measure, r]));
  assert.equal(by.M1.value, 0);                       // this week: nothing stored; last week's 4 is NOT copied into the value
  assert.equal(by.M1.status, 'no_stored_scans');
  assert.match(by.M1.note, /Last complete week 2026-11-16: 4 \(lower_bound\)/);   // shown, labelled with its own week, in the note only
  assert.equal(by.M2.value, null);
});

test('failed rows: four, value NULL, status failed, the reason in the note', () => {
  const rows = failedRows(ASOF, 'database read x failed with HTTP 500', '2026-11-27T06:00:03Z');
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.equal(r.status, 'failed'); assert.equal(r.value, null);
    assert.match(r.note, /FAILED/); assert.match(r.note, /HTTP 500/);
  }
});

test('finish refuses what the table would refuse: a value on a no-value status, a number missing on a value status, an empty note, an unknown status', () => {
  assert.throws(() => finish(ASOF, { measure: 'G', value: 0, status: 'not_computable', note: 'x' }), /no value/);
  assert.throws(() => finish(ASOF, { measure: 'M1', value: null, status: 'ok', note: 'x' }), /needs a number/);
  assert.throws(() => finish(ASOF, { measure: 'M1', value: 1, status: 'ok', note: '  ' }), /note is empty/);
  assert.throws(() => finish(ASOF, { measure: 'M1', value: 1, status: 'maybe', note: 'x' }), /unknown status/);
  assert.throws(() => finish(ASOF, { measure: 'Z', value: 1, status: 'ok', note: 'x' }), /unknown measure/);
});

test('a second run the same day replaces the first but keeps what it said', () => {
  const failed = failedRows(ASOF, 'boom', '2026-11-27T06:00:00Z')[0];
  const good = rowsFromReport(firstReport, ASOF)[0];
  const rec = chainNote(failed, good).note;
  assert.match(rec, /^Recovered after a failed run at 2026-11-27T06:00:00Z: boom\. Week of /);
  assert.ok(rec.length < good.note.length + 90, 'the recovery prefix stays short');
  assert.match(chainNote(good, failed).note, /earlier run today had recorded 0 \(no_stored_scans\)/);
  assert.equal(chainNote(good, failed).value, null);
  assert.deepEqual(chainNote(undefined, good), good);
});

test('page: locked KPI is the first block; a failed row shows red; a good run shows green', () => {
  const good = rowsFromReport(firstReport, ASOF);
  const ok = pageBlocks({ asOf: ASOF, todayRows: good, history: good, outcome: { failures: [] }, atIso: '2026-11-27T06:00:00Z' });
  assert.match(ok[0].callout.rich_text[0].text.content, new RegExp(KPI_HEADLINE.replace(/[$]/g, '\\$')));
  assert.equal(ok[1].callout.color, 'green_background');
  const bad = pageBlocks({ asOf: ASOF, todayRows: failedRows(ASOF, 'boom', 'x'), history: null, outcome: { failures: ['The report could not be produced: boom.'] }, atIso: '2026-11-27T06:00:00Z' });
  assert.equal(bad[1].callout.color, 'red_background');
  assert.match(bad[1].callout.rich_text[0].text.content, /LAST RUN FAILED/);
  assert.ok(JSON.stringify(bad).includes('failed'));
});

// ---------- the whole job, with fake Supabase and Notion ----------
function fakeWorld({ failView = false, failNotion = false, failStore = false } = {}) {
  const w = { table: new Map(), page: ['old-1', 'old-2'], appended: [], calls: [] };
  const viewRows = { mpt_scorecard_m1_weekly: firstData.m1, mpt_scorecard_m2_weekly: firstData.m2, mpt_scorecard_m3_monthly: [], mpt_scorecard_g_weekly: firstData.g, mpt_scorecard_deleted_scans_weekly: [], confidence_config: [] };
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  w.fetch = async (url, init = {}) => {
    const u = new URL(url); const m = init.method ?? 'GET'; w.calls.push(`${m} ${u.host}${u.pathname}`);
    if (u.host === 'api.notion.com') {
      if (failNotion) return json(403, {});
      if (m === 'GET') return json(200, { results: w.page.map((id) => ({ id })), has_more: false });
      if (m === 'PATCH') { w.appended = JSON.parse(init.body).children; return json(200, {}); }
      if (m === 'DELETE') { w.page = w.page.filter((id) => !u.pathname.endsWith(id)); return json(200, {}); }
    }
    const name = u.pathname.split('/').pop();
    if (name === 'metrics_daily') {
      if (failStore) return json(500, {});
      if (m === 'POST') { for (const r of JSON.parse(init.body)) w.table.set(`${r.as_of}|${r.measure}`, r); return json(201, null); }
      const asOf = u.searchParams.get('as_of');
      return json(200, [...w.table.values()].filter((r) => !asOf || `eq.${r.as_of}` === asOf));
    }
    if (failView && name === 'mpt_scorecard_m1_weekly') return json(500, {});
    if (!(name in viewRows)) return json(404, {});
    return json(200, viewRows[name]);
  };
  return w;
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', NOTION_TOKEN: 't', NOTION_SCORECARD_PAGE_ID: 'abcabcabcabcabcabcabcabcabcabcab' };

test('job, good day: four rows, page replaced, exit 0', async () => {
  const w = fakeWorld();
  const r = await runJob([], ENV, w.fetch, NOW);
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.equal(w.table.size, 4);
  assert.deepEqual(w.page, []);                      // old blocks removed after the new ones were appended
  assert.ok(w.appended.length >= 5);
  assert.ok(w.calls.indexOf('PATCH api.notion.com/v1/blocks/' + ENV.NOTION_SCORECARD_PAGE_ID + '/children') < w.calls.findIndex((c) => c.startsWith('DELETE')));
});

test('job, report read fails: failed rows are stored AND on the page, and the exit code is 1', async () => {
  const w = fakeWorld({ failView: true });
  const r = await runJob([], ENV, w.fetch, NOW);
  assert.equal(r.code, 1);
  assert.equal(w.table.size, 4);
  for (const row of w.table.values()) { assert.equal(row.status, 'failed'); assert.equal(row.value, null); assert.match(row.note, /HTTP 500/); }
  assert.match(JSON.stringify(w.appended), /LAST RUN FAILED/);
  assert.match(r.out.join('\n'), /metrics-daily: FAILED/);
});

test('job --drill: the real failure path runs (HTTP 404 on a view that does not exist)', async () => {
  const w = fakeWorld();
  const r = await runJob(['--drill'], ENV, w.fetch, NOW);
  assert.equal(r.code, 1);
  assert.match([...w.table.values()][0].note, /failure drill: .*HTTP 404/);
  assert.match(JSON.stringify(w.appended), /LAST RUN FAILED/);
});

test('job, a good run after a failed one the same day: recovered, and the failure stays in the note', async () => {
  const w = fakeWorld();
  await runJob(['--drill'], ENV, w.fetch, NOW);
  const r = await runJob([], ENV, w.fetch, NOW + 60_000);
  assert.equal(r.code, 0);
  assert.equal(w.table.size, 4);
  assert.match(w.table.get(`${ASOF}|M1`).note, /^Recovered after a failed run at 2026-11-27T06:00:\d\dZ: failure drill: .*HTTP 404\. Week of /);
  assert.doesNotMatch(w.table.get(`${ASOF}|M1`).note, /replaced by this failure/);   // the failed note's own history is not quoted back
  assert.equal(w.table.get(`${ASOF}|M1`).status, 'no_stored_scans');
});

test('job, store fails: the page still says so, exit 1', async () => {
  const w = fakeWorld({ failStore: true });
  const r = await runJob([], ENV, w.fetch, NOW);
  assert.equal(r.code, 1);
  assert.match(JSON.stringify(w.appended), /could not be stored in metrics_daily/);
});

test('job, Notion fails: rows are still stored and the job is red, never silent', async () => {
  const w = fakeWorld({ failNotion: true });
  const r = await runJob([], ENV, w.fetch, NOW);
  assert.equal(r.code, 1);
  assert.equal(w.table.size, 4);
  assert.match(r.out.join('\n'), /notion failed: Notion GET blocks\/<id>\/children failed with HTTP 403/);
});

test('output never contains a key, a token or a response body', async () => {
  const w = fakeWorld({ failView: true });
  const r = await runJob([], { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'sb-secret-VALUE', NOTION_TOKEN: 'ntn-secret-VALUE' }, w.fetch, NOW);
  assert.doesNotMatch(r.out.join('\n') + JSON.stringify(w.appended) + JSON.stringify([...w.table.values()]), /secret-VALUE/);
});

test('missing settings: red (exit 2), never a quiet pass', async () => {
  const w = fakeWorld();
  const r = await runJob([], {}, w.fetch, NOW);
  assert.notEqual(r.code, 0);
});

// ---------- pins to the migration and the workflow ----------
test('the migration holds the same vocabulary as the job', () => {
  for (const m of MEASURES) assert.ok(MIGRATION.includes(`'${m}'`));
  for (const s of ['ok', 'lower_bound', 'no_stored_scans', 'dormant', 'no_scans', 'not_computable', 'failed']) assert.ok(MIGRATION.includes(`'${s}'`), s);
  assert.match(MIGRATION, /enable row level security/);
  assert.match(MIGRATION, /primary key \(as_of, measure\)/);
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ''), /\b(drop|delete|truncate|alter table (?!public\.metrics_daily))/i);   // additive: touches only its own table
});
test('the workflow: daily 06:00 UTC, manual drill, calls the job, no write permission on the repo', () => {
  assert.match(WORKFLOW, /cron: '0 6 \* \* \*'/);
  assert.match(WORKFLOW, /workflow_dispatch/);
  assert.match(WORKFLOW, /node scripts\/metrics-daily\.mjs/);
  assert.match(WORKFLOW, /contents: read/);
  assert.doesNotMatch(WORKFLOW, /^\s*continue-on-error:/m);   // a failed run must stay red
});
