// KPI scorecard maths (MPC-7618). Pure functions: no network, no clock except the `today` argument.
// Rule from the collector: a number that was not collected is null and is shown blank ("not collected"), never estimated.

export const GOALS = { scans: 10000, paid: 1000, arr: 120000, deadline: '2027-08-31' }; // North Star: 10K scans, 1K paid, $120K ARR by Aug 2027
const DAY_MS = 86400000;

export const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export const pct = (value, goal) => (num(value) === null || !(goal > 0) ? null : Math.round((1000 * value) / goal) / 10);
// Week-on-week change in percent. null when either week is missing or the earlier week was 0 (a % of zero is meaningless).
export const growthPct = (cur, prev) => (num(cur) === null || num(prev) === null || prev === 0 ? null : Math.round((1000 * (cur - prev)) / prev) / 10);
export const weeksLeft = (today, deadline = GOALS.deadline) => Math.max(0, Math.ceil((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * DAY_MS)));
// What the weekly run rate must be from now on to reach the goal by the deadline.
export const neededPerWeek = (value, goal, today) => {
  const w = weeksLeft(today);
  return num(value) === null || w === 0 ? null : Math.max(0, Math.ceil((goal - value) / w));
};

// Top sources from stored ga4/daily_source_medium rows (one payload per Hong Kong day, latest pull per day already chosen).
export function topSources(payloads, n = 5) {
  const totals = new Map();
  for (const p of payloads) {
    for (const r of p?.rows ?? []) {
      const source = r.dimensionValues?.[0]?.value || '(not set)';
      const medium = r.dimensionValues?.[1]?.value || '(not set)';
      const sessions = num(r.metricValues?.[0]?.value);
      if (sessions === null) continue;
      const key = `${source} / ${medium}`;
      totals.set(key, (totals.get(key) ?? 0) + sessions);
    }
  }
  const all = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sum = all.reduce((s, [, v]) => s + v, 0);
  return { total: sum, rows: all.slice(0, n).map(([name, sessions]) => ({ name, sessions, share_pct: sum ? Math.round((1000 * sessions) / sum) / 10 : null })) };
}

// Funnel visit -> scan -> save -> convert over the same window. Every step is compared with the step before it.
// A step with no data is null and the steps after it show no rate (the chain is broken, so no rate is invented).
export function funnel({ sessions, scans, saves, paid }) {
  const steps = [['Visit (GA4 sessions)', sessions], ['Scan completed', scans], ['Saved scan (contact given)', saves], ['Paid conversion', paid]];
  return steps.map(([name, value], i) => {
    const prev = i ? num(steps[i - 1][1]) : null;
    const v = num(value);
    return { name, value: v, from_previous_pct: i && v !== null && prev ? Math.round((1000 * v) / prev) / 10 : null, drop_off: i && v !== null && prev !== null ? Math.max(0, prev - v) : null };
  });
}

// Assemble the whole scorecard from already-read inputs.
//   totals: { scans, paid, saves, mrr }  days: [{day,new_scans,ga4_sessions,new_users}] newest first (today first)
//   weeks: [{week_of,weekly_new_scans}] newest first (current partial week first)  sources: payload[]  window: { sessions, scans, saves, paid } for the funnel
export function buildScorecard({ today, totals, days, weeks, sources, window }) {
  const arr = num(totals.mrr) === null ? null : totals.mrr * 12;
  const lastFull = weeks?.[1]?.weekly_new_scans ?? null;
  const before = weeks?.[2]?.weekly_new_scans ?? null;
  return {
    today,
    goals: [
      { name: 'Scans', value: num(totals.scans), goal: GOALS.scans, pct: pct(totals.scans, GOALS.scans), needed_per_week: neededPerWeek(totals.scans, GOALS.scans, today) },
      { name: 'Paid conversions', value: num(totals.paid), goal: GOALS.paid, pct: pct(totals.paid, GOALS.paid), needed_per_week: neededPerWeek(totals.paid, GOALS.paid, today) },
      { name: 'ARR (USD, MRR x 12)', value: arr, goal: GOALS.arr, pct: pct(arr, GOALS.arr), needed_per_week: neededPerWeek(arr, GOALS.arr, today) },
    ],
    growth: { this_week_so_far: num(weeks?.[0]?.weekly_new_scans), last_full_week: num(lastFull), week_before: num(before), wow_pct: growthPct(lastFull, before), last_full_week_of: weeks?.[1]?.week_of ?? null },
    sources: topSources(sources),
    funnel: funnel(window),
    trend: (days ?? []).slice(0, 7).map((d) => ({ day: d.day, sessions: num(d.ga4_sessions), scans: num(d.new_scans), signups: num(d.new_users) })),
  };
}
