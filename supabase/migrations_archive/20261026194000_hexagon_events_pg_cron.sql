-- MPC-7915: daily purge of raw learning events. Calls public.rollup_and_purge_hexagon_events (20261019180000), which rolls events older than
-- 90 days into daily counts (no person_key) and deletes the raw rows. Nothing is written to those tables until both learning switches are on,
-- so until then this deletes nothing; the Privacy Policy section 2.4A promises "about 90 days".
--
-- Idempotent: it replaces only its own job, by name. Rollback: select cron.unschedule('mpt-purge-hexagon-events');
-- Applied to production by hand on 2026-10-26 (job id 12); this file records it. The function was first run by hand and removed 0 rows.

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-hexagon-events';
    perform cron.schedule('mpt-purge-hexagon-events', '40 19 * * *', 'select public.rollup_and_purge_hexagon_events(interval ''90 days'');');
  end if;
end $$;
