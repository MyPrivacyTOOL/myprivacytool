// MPC-7557: independent "is the metrics collector alive" check. The nightly-test alert is raised BY the collector, so if the collector itself dies the alert can
// never fire: that is exactly what happened from 2026-10-27 to 2026-11-02 (Too many subrequests, no rows stored, nobody told). This check does not depend on the
// collector: it reads the newest collector row straight from the database and exits 1 (a red GitHub Actions run) when it is too old or unreadable.
// Counts and ages only. Reads one row, writes nothing.
export const MAX_AGE_HOURS = 26; // the collector runs once a day (16:15 UTC); one missed day plus slack

export function judge(row, now, maxAgeHours = MAX_AGE_HOURS) {
  if (!row?.captured_at) return { ok: false, reason: 'no collector row found in mpt_raw_metrics' };
  const ageHours = (now.getTime() - Date.parse(row.captured_at)) / 3600000;
  if (!Number.isFinite(ageHours)) return { ok: false, reason: 'newest collector row has an unreadable time' };
  const age = Math.round(ageHours * 10) / 10;
  return ageHours > maxAgeHours
    ? { ok: false, age, reason: `newest collector row is ${age} hours old (limit ${maxAgeHours}); the daily collector has not stored anything since ${row.captured_at}` }
    : { ok: true, age, reason: `newest collector row is ${age} hours old (limit ${maxAgeHours})` };
}

export async function newestCollectorRow(env, fetchImpl = fetch) {
  // table_counts is written by the first collector stage every day; any collector report would do, this one has no skip rule.
  const url = `${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics?source=eq.supabase&report=eq.table_counts&order=captured_at.desc&limit=1&select=captured_at,status`;
  const res = await fetchImpl(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`database read failed: HTTP ${res.status}`);
  return (await res.json())[0] ?? null;
}

export async function main(env = process.env, now = new Date(), fetchImpl = fetch, log = console.log) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { log('collector-alive: NOT CONFIGURED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). A missing check is not a pass.'); return 2; }
  let row;
  try { row = await newestCollectorRow(env, fetchImpl); } catch (e) { log(`collector-alive: FAIL, ${String(e.message).replace(env.SUPABASE_SERVICE_ROLE_KEY, '[redacted]')}`); return 1; }
  const j = judge(row, now);
  log(`collector-alive: ${j.ok ? 'OK' : 'FAIL'}, ${j.reason}`);
  return j.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
