-- MPC-7893 / MPC-7891 / MPC-7892: daily purge of Telegram scan data past its stored expiry, run by pg_cron inside Supabase.
-- Implements the owner's retention decision of 2026-10-27 ("90-day retention"): every profile_snapshots and deep_jobs row already gets expires_at = created_at + 90 days
-- (PROFILE_SNAPSHOT_RETENTION_DAYS / DEEP_RETENTION_DAYS, default 90, clamped 1-365), and this job deletes rows once that date has passed.
-- Cascades: deleting a snapshot also deletes its fix_wizard_items, dashboard_links and dashboard_sessions; deleting a DEEP job deletes its deep_osint_results.
-- At the time of writing no row is past its expiry, so scheduling deletes nothing today. It does NOT touch the bot-wide probe logs (channel_probe_captures, telegram_event_log).
--
-- Idempotent: it replaces only its own jobs, by name. Rollback:
--   select cron.unschedule('mpt-purge-expired-profile-snapshots'); select cron.unschedule('mpt-purge-expired-deep-data');

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('mpt-purge-expired-profile-snapshots', 'mpt-purge-expired-deep-data');
    perform cron.schedule('mpt-purge-expired-profile-snapshots', '50 19 * * *', 'select public.mpt_purge_expired_profile_snapshots();');
    perform cron.schedule('mpt-purge-expired-deep-data', '55 19 * * *', 'select public.mpt_purge_expired_deep_data();');
  end if;
end $$;
