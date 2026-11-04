-- MPC-7893: daily purge of spent dashboard credentials, run by pg_cron inside Supabase.
-- Calls public.mpt_purge_dashboard_credentials() (20261026220000), which deletes sessions that expired or were revoked and links whose
-- 15 minute window ended more than a day ago. Links and sessions are already unusable after expiry (checked on every redemption and read), so this is
-- housekeeping for credential material, not a retention rule for personal data. Hashes only are stored. Deleting a person's snapshots also cascades to their links and sessions.
--
-- NOT covered here (needs the open retention decision, strategy 9.9 / D-A): scheduling mpt_purge_expired_profile_snapshots() and mpt_purge_expired_deep_data().
-- Idempotent: it replaces only its own job, by name. Rollback: select cron.unschedule('mpt-purge-dashboard-credentials');

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-dashboard-credentials';
    perform cron.schedule('mpt-purge-dashboard-credentials', '40 19 * * *', 'select public.mpt_purge_dashboard_credentials();');
  end if;
end $$;
