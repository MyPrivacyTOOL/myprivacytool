// MPC-9889: independent "has the visit-log purge run in the last 26 hours" check (design 3.4). Same shape as scripts/collector-alive: it does not depend on the
// purge job, reads one JSON value through a service_role-only RPC, and exits 1 (red GitHub Actions run) when the job is late or unreadable. Counts and ages only.
export const MAX_AGE_HOURS = 26;

export function judge(health) {
  if (!health || typeof health !== 'object') return { ok: false, reason: 'no purge health answer' };
  if (health.last_run == null) return { ok: false, reason: 'the visit-log purge has never run' };
  return health.degraded
    ? { ok: false, reason: `the visit-log purge last ran ${health.age_hours} hours ago (limit ${MAX_AGE_HOURS}), at ${health.last_run}` }
    : { ok: true, reason: `the visit-log purge ran ${health.age_hours} hours ago (limit ${MAX_AGE_HOURS})` };
}

export async function readHealth(env, fetchImpl = fetch) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/mpt_visit_log_purge_health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: '{}',
  });
  if (!res.ok) throw new Error(`database read failed: HTTP ${res.status}`);
  return res.json();
}

export async function main(env = process.env, fetchImpl = fetch, log = console.log) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { log('visit-log-purge-alive: NOT CONFIGURED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). A missing check is not a pass.'); return 2; }
  let health;
  try { health = await readHealth(env, fetchImpl); } catch (e) { log(`visit-log-purge-alive: FAIL, ${String(e.message).replace(env.SUPABASE_SERVICE_ROLE_KEY, '[redacted]')}`); return 1; }
  const j = judge(health);
  log(`visit-log-purge-alive: ${j.ok ? 'OK' : 'FAIL'}, ${j.reason}`);
  return j.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
