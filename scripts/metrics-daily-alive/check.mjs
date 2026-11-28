// MPC-11567: independent "did the daily scorecard job store today's rows" check. The job (metrics-daily.yml, 06:00 UTC) writes a failed row when it fails, but a day on which GitHub
// never starts it writes nothing at all, and nothing then turns red (the Notion page just keeps an old as_of). This check does not depend on that job or on Notion: it reads the newest
// rows straight from public.metrics_daily and exits 1 (a red GitHub Actions run, which emails the repository watchers) when today's four rows are not there.
// Counts and dates only. Reads a few rows, writes nothing. A failed row counts as present: the daily job is already red for that and says why.
export const MEASURES = ['M1', 'M2', 'M3', 'G'];

export const utcDay = (now) => now.toISOString().slice(0, 10);

/** Pure: the newest rows (any order) and the current time -> { ok, reason }. */
export function judge(rows, now) {
  const today = utcDay(now);
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'metrics_daily has no rows at all' };
  const days = rows.map((r) => String(r.as_of ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (days.length === 0) return { ok: false, reason: 'metrics_daily rows have an unreadable as_of' };
  const newest = days[days.length - 1];
  if (newest < today) return { ok: false, reason: `no rows for ${today}: the newest metrics_daily row is for ${newest}; the daily scorecard job has not stored today's rows` };
  const have = new Set(rows.filter((r) => String(r.as_of).slice(0, 10) === newest).map((r) => r.measure));
  const missing = MEASURES.filter((m) => !have.has(m));
  if (missing.length) return { ok: false, reason: `the rows for ${newest} are incomplete: missing ${missing.join(', ')}` };
  const failed = rows.filter((r) => String(r.as_of).slice(0, 10) === newest && r.status === 'failed').length;
  return { ok: true, reason: `all four rows are there for ${newest}${failed ? ` (${failed} marked failed: the daily job reports why)` : ''}` };
}

export async function newestRows(env, fetchImpl = fetch) {
  const url = `${env.SUPABASE_URL}/rest/v1/metrics_daily?select=as_of,measure,status&order=as_of.desc&limit=8`;
  const res = await fetchImpl(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`database read failed: HTTP ${res.status}`);
  return res.json();
}

export async function main(env = process.env, now = new Date(), fetchImpl = fetch, log = console.log) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { log('metrics-daily-alive: NOT CONFIGURED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). A missing check is not a pass.'); return 2; }
  let rows;
  try { rows = await newestRows(env, fetchImpl); } catch (e) { log(`metrics-daily-alive: FAIL, ${String(e.message).replace(env.SUPABASE_SERVICE_ROLE_KEY, '[redacted]')}`); return 1; }
  const j = judge(rows, now);
  log(`metrics-daily-alive: ${j.ok ? 'OK' : 'FAIL'}, ${j.reason}`);
  return j.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
