#!/usr/bin/env node
// MPC-11547: prints the four hexagon-scorecard measures as one JSON document. READ ONLY: GET requests on the scorecard views, nothing is written.
// The locked KPI (10,000 free scans / 1,000 paid / $120k ARR by 2027-08-01) stays the headline and is NOT computed here; these are secondary.
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/metrics-report.mjs [--now <ISO time>] [--rows <file.json>]
//
//   --now   compute "the current period" as of this instant (default: now)
//   --rows  read the view rows from a JSON file instead of the database: { "<view name>": [rows], "config_versions_above_0": <n> }
//
// The definitions are in supabase/migrations/20261127075144_mpc_11547_hexagon_scorecard_views.sql and docs/scorecard-mpc-11547.md.
// Output is counts and rates only. Exit code 0 = printed, 1 = failed, 2 = bad usage.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VIEWS = {
  m1: 'mpt_scorecard_m1_weekly',
  m2: 'mpt_scorecard_m2_weekly',
  m3: 'mpt_scorecard_m3_monthly',
  g: 'mpt_scorecard_g_weekly',
  deleted: 'mpt_scorecard_deleted_scans_weekly',
};
const HK_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const TRAILING_WEEKS = 8;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the Hong Kong week containing this instant, as YYYY-MM-DD (the KPI views also use Hong Kong Mondays). */
export function hkWeekOf(instantMs) {
  const hk = new Date(instantMs + HK_OFFSET_MS);
  const sinceMonday = (hk.getUTCDay() + 6) % 7;
  return iso(Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), hk.getUTCDate()) - sinceMonday * DAY_MS);
}
/** First day of the Hong Kong month containing this instant. */
export function hkMonthOf(instantMs) {
  const hk = new Date(instantMs + HK_OFFSET_MS);
  return iso(Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), 1));
}
const addDays = (ymd, n) => iso(Date.parse(ymd + 'T00:00:00Z') + n * DAY_MS);

const num = (v) => (v === null || v === undefined ? null : Number(v));
const byWeek = (rows, key = 'week_of') => new Map((rows ?? []).map((r) => [String(r[key]).slice(0, 10), r]));

const CAVEATS = {
  stored_scans: 'Counts the web scans still stored. A deleted scan leaves only an undated counter, so any week is a lower bound (see coverage).',
  test_scans: 'Test-mailbox scans are left out, but only while the linked scans row still exists to prove it.',
};

function m1(rows, p) {
  const w = byWeek(rows);
  const at = (week) => {
    const r = w.get(week);
    return { week_of: week, activated_scans: r ? Number(r.activated_scans) : 0, completed_scans: r ? Number(r.completed_scans) : 0, test_scans_excluded: r ? Number(r.test_scans_excluded) : 0 };
  };
  const wrap = (week, complete) => {
    const x = at(week);
    return {
      ...x, value: x.activated_scans, week_complete: complete,
      // a lower bound is never a measured zero: say so when nothing real is stored for the week
      status: x.completed_scans > 0 ? 'lower_bound' : 'no_stored_scans',
      ...(x.completed_scans > 0 ? {} : { reason: 'No stored non-test scan for this week, so 0 here is a lower bound, not a measurement: deleted scans cannot be dated to the week they were made (see coverage).' }),
    };
  };
  return {
    definition: 'Completed web scans with at least one found result, per Hong Kong (ISO) week; test mailbox left out.',
    current_week: wrap(p.currentWeek, false),
    last_complete_week: wrap(p.lastCompleteWeek, true),
    trailing: trailing(w, p, at),
    caveats: [CAVEATS.stored_scans, CAVEATS.test_scans],
  };
}

function m2(rows, p) {
  const w = byWeek(rows);
  const at = (week) => {
    const r = w.get(week);
    return { week_of: week, median_verified_facts: r ? num(r.median_verified_facts) : null, completed_scans: r ? Number(r.completed_scans) : 0 };
  };
  const wrap = (week, complete) => {
    const x = at(week);
    return { ...x, value: x.median_verified_facts, week_complete: complete, status: x.completed_scans > 0 ? 'ok' : 'no_scans', ...(x.completed_scans > 0 ? {} : { reason: 'No stored completed scan in this week, so there is no median (not 0).' }) };
  };
  return {
    definition: 'Median, per completed web scan, of hexagons found or checked-and-clear (distinct registry hexagons), per Hong Kong week; scans with none count as 0; test mailbox left out.',
    current_week: wrap(p.currentWeek, false),
    last_complete_week: wrap(p.lastCompleteWeek, true),
    trailing: trailing(w, p, at),
    caveats: [CAVEATS.stored_scans, CAVEATS.test_scans],
  };
}

function m3(rows, p, configVersionsAbove0, answersEver) {
  const mo = byWeek(rows, 'month_of');
  const value = (month) => (mo.has(month) ? Number(mo.get(month).calibrated_tiles) : 0);
  const out = {
    definition: 'Tiles whose confidence_config value was changed and then validated by 30+ follow-up responders (95% Wilson interval contains the new value), per Hong Kong month, counted in the month the 30th responder arrived.',
    current_month: { month_of: p.currentMonth, value: value(p.currentMonth) },
    previous_month: { month_of: p.previousMonth, value: value(p.previousMonth) },
    months_with_calibrated_tiles: [...mo.entries()].map(([month_of, r]) => ({ month_of, calibrated_tiles: Number(r.calibrated_tiles) })).sort((a, b) => a.month_of.localeCompare(b.month_of)),
    evidence: { config_versions_above_0: configVersionsAbove0, answers_recorded_ever: answersEver },
  };
  out.status = out.current_month.value === 0 && configVersionsAbove0 === 0 ? 'dormant' : 'ok';
  if (out.status === 'dormant') {
    out.reason = 'Zero is the expected value: only confidence_config version 0 (the registry numbers) exists, so no tile has been recalibrated. The learning loop is dormant; this is reported, not worked around.';
  }
  if (answersEver === 0) out.note = 'No tile answer (yes, not me, disputed, kept) has been recorded either: the browser sends no person key since MPC-9892 and public.mpt_hexagon_events is empty, so a version bump alone could not be validated yet.';
  return out;
}

function g(rows, p) {
  const w = byWeek(rows);
  const at = (week) => {
    const r = w.get(week);
    return {
      week_of: week,
      high_confidence_shown: r ? Number(r.high_confidence_shown) : 0,
      high_confidence_disputed: r ? Number(r.high_confidence_disputed) : 0,
      high_confidence_kept: r ? Number(r.high_confidence_kept) : 0,
      answers_all_tiles: r ? Number(r.answers_all_tiles) : 0,
      dispute_rate: r ? num(r.dispute_rate) : null,
      answered_dispute_rate: r ? num(r.answered_dispute_rate) : null,
    };
  };
  const wrap = (week, complete) => {
    const x = at(week);
    const ok = x.dispute_rate !== null;
    return {
      ...x, value: x.dispute_rate, week_complete: complete,
      status: ok ? 'ok' : 'not_computable',
      ...(ok ? { response_rate: x.high_confidence_shown > 0 ? Math.round(((x.high_confidence_disputed + x.high_confidence_kept) / x.high_confidence_shown) * 10000) / 10000 : null }
             : { reason: x.answers_all_tiles === 0
                   ? 'No tile answer was recorded this week, so there is nothing to divide: no dispute rate (not 0%).'
                   : 'Answers exist, but none on a high-confidence tile this week: no dispute rate (not 0%).' }),
    };
  };
  const allWeeks = [...w.values()];
  const answersEver = allWeeks.reduce((s, r) => s + Number(r.answers_all_tiles), 0);
  const shownEver = allWeeks.reduce((s, r) => s + Number(r.high_confidence_shown), 0);
  return {
    out: {
      definition: 'Disputes on high-confidence tiles (confidence in force above 0.8) / high-confidence tiles shown with a dispute prompt, per Hong Kong week. answered_dispute_rate divides by responders instead. NULL, never 0%, when nobody has answered.',
      current_week: wrap(p.currentWeek, false),
      last_complete_week: wrap(p.lastCompleteWeek, true),
      trailing: trailing(w, p, at),
      caveats: [
        'High confidence is the confidence in force today (active confidence_config, else the registry); the counters carry neither the confidence nor the config version.',
        'Shown counts tiles offered an answer, not every finding; with silence common, read the rate beside response_rate.',
      ],
    },
    answersEver, shownEver,
  };
}

function trailing(weeks, p, at) {
  const out = [];
  for (let i = TRAILING_WEEKS - 1; i >= 0; i--) {
    const week = addDays(p.currentWeek, -7 * i);
    if (week >= (p.firstWeek ?? week)) out.push({ ...at(week), week_complete: i > 0 });
  }
  return out;
}

/**
 * Pure: view rows in, report out.
 * @param {{m1?: object[], m2?: object[], m3?: object[], g?: object[], deleted?: object[], configVersionsAbove0?: number}} data
 * @param {number} nowMs  instant that defines "current"
 */
export function buildReport(data, nowMs) {
  const currentWeek = hkWeekOf(nowMs);
  const currentMonth = hkMonthOf(nowMs);
  const earliest = [data.m1, data.m2, data.g].flatMap((r) => (r ?? []).map((x) => String(x.week_of).slice(0, 10))).sort()[0];
  const p = {
    currentWeek, lastCompleteWeek: addDays(currentWeek, -7), currentMonth,
    previousMonth: hkMonthOf(Date.parse(currentMonth + 'T00:00:00Z') - HK_OFFSET_MS - DAY_MS),
    firstWeek: earliest ? addDays(earliest, 0) : undefined,
  };
  const gr = g(data.g, p);
  return {
    generated_at: new Date(nowMs).toISOString(),
    timezone: 'Asia/Hong_Kong',
    headline_note: 'The locked KPI (10,000 free scans / 1,000 paid / $120k ARR by 2027-08-01) is the headline and is not changed or computed here. These four are secondary.',
    period: { current_week_of: p.currentWeek, last_complete_week_of: p.lastCompleteWeek, current_month: p.currentMonth },
    m1_activated_scans_per_week: m1(data.m1, p),
    m2_verified_facts_per_completed_scan: m2(data.m2, p),
    m3_calibrated_tiles_per_month: m3(data.m3, p, data.configVersionsAbove0 ?? 0, gr.answersEver),
    g_dispute_rate_on_high_confidence: gr.out,
    coverage: {
      note: 'Scans already deleted are not in M1/M2 and cannot be dated to the week they were made. They are listed by week of deletion; test scans are not separated.',
      deleted_scans_by_week_of_deletion: (data.deleted ?? []).map((r) => ({ week_of_deletion: String(r.week_of_deletion).slice(0, 10), deleted_scans: Number(r.deleted_scans) })).sort((a, b) => a.week_of_deletion.localeCompare(b.week_of_deletion)),
    },
  };
}

async function get(env, fetchImpl, path) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'), { usage: true });
  const res = await fetchImpl(`${base}/rest/v1/${path}`, { method: 'GET', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`database read ${path.split('?')[0]} failed with HTTP ${res.status}`);   // never include the body
  return res.json();
}

/** Reads the views (GET only) and returns { code, out } where out is the lines to print. Pure apart from the injected fetch. */
export async function run(argv, env = process.env, fetchImpl = fetch, now = Date.now()) {
  const args = [...argv];
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const nowFlag = take('--now');
  const rowsFile = take('--rows');
  if (args.length > 0) return { code: 2, out: ['usage: metrics-report [--now <ISO time>] [--rows <file.json>]'] };
  let nowMs = now;
  if (nowFlag !== undefined) { nowMs = Date.parse(nowFlag); if (!Number.isFinite(nowMs)) return { code: 2, out: [`bad --now: ${nowFlag}`] }; }
  try {
    let data;
    if (rowsFile) {
      const f = JSON.parse(readFileSync(rowsFile, 'utf8'));
      data = { m1: f[VIEWS.m1], m2: f[VIEWS.m2], m3: f[VIEWS.m3], g: f[VIEWS.g], deleted: f[VIEWS.deleted], configVersionsAbove0: f.config_versions_above_0 ?? 0 };
    } else {
      const [m1r, m2r, m3r, gr, del, cfg] = await Promise.all([
        get(env, fetchImpl, `${VIEWS.m1}?select=*&order=week_of`),
        get(env, fetchImpl, `${VIEWS.m2}?select=*&order=week_of`),
        get(env, fetchImpl, `${VIEWS.m3}?select=*&order=month_of`),
        get(env, fetchImpl, `${VIEWS.g}?select=*&order=week_of`),
        get(env, fetchImpl, `${VIEWS.deleted}?select=*&order=week_of_deletion`),
        get(env, fetchImpl, 'confidence_config?select=version&version=gt.0'),
      ]);
      data = { m1: m1r, m2: m2r, m3: m3r, g: gr, deleted: del, configVersionsAbove0: cfg.length };
    }
    return { code: 0, out: [JSON.stringify(buildReport(data, nowMs), null, 2)] };
  } catch (e) {
    return { code: e.usage ? 2 : 1, out: [`metrics-report failed: ${e.message}`] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, out } = await run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(out.join('\n'));
  process.exit(code);
}
