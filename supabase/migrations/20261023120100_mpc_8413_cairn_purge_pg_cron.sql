-- MPC-8413: hourly purge of expired Cairn sessions (72 h retention), run by pg_cron inside Supabase.
-- Calls public.mpt_purge_expired_cairn_sessions() (20261023120000), which deletes sessions past retain_until; facts and intents cascade.
--
-- Idempotent: it replaces only its own job, by name. Rollback: select cron.unschedule('mpt-purge-expired-cairn-sessions');
-- Applied to production on 2026-10-23 (together with the tables); this file records it.

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-expired-cairn-sessions';
    perform cron.schedule('mpt-purge-expired-cairn-sessions', '45 * * * *', 'select public.mpt_purge_expired_cairn_sessions();');
  end if;
end $$;
