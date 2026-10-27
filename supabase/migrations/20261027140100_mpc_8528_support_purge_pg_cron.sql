-- MPC-8528 / D-6: daily retention purge for the AI support tables, run by pg_cron inside Supabase.
-- Schedule approved by Chris 2026-10-27. support_purge_expired() (previous migration) blanks raw message text after 90 days, deletes cases
-- inactive for 6 months, proofs a day after expiry and usage rows after 7 days. The tables are empty until the support Worker is enabled,
-- so the first runs delete nothing. Same pattern as the MPC-7893 purge: skipped where pg_cron is not installed (local test databases), idempotent by job name.
-- Rollback: select cron.unschedule('support-purge-expired');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'support-purge-expired';
    perform cron.schedule('support-purge-expired', '17 3 * * *', 'select public.support_purge_expired();');
  end if;
end $$;
