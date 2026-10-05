-- MPC-6977: hourly purge of expired OSINT scan results, run inside Supabase by pg_cron
-- (no Worker, key or deploy needed). Applied to project xmdmkumwxpgahmlweuug on 2026-10-05
-- as migration mpc_6977_purge_expired_scan_results_pg_cron.
-- The tables have FORCE ROW LEVEL SECURITY and no delete policy, so the delete lives in a
-- SECURITY DEFINER function that only the cron job (postgres) can execute.
-- Verified 2026-10-05: inserted one row with expires_at in the past, ran the function
-- (returned 1), and expired rows = 0 afterwards.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.mpt_purge_expired_scan_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  delete from public.mpt_osint_scan_results where expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mpt_purge_expired_scan_results() from public, anon, authenticated;

select cron.schedule(
  'mpt-purge-expired-scan-results',
  '0 * * * *',
  $$select public.mpt_purge_expired_scan_results();$$
);
