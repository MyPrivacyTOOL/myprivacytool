-- MPC-8320: hourly purge of expired WhatsApp / channel state, run by pg_cron inside Supabase.
--
-- The Cloudflare account is at the Workers Free limit of 5 cron triggers (error 10072), so the Worker has no Cron Trigger. This does the same job
-- from the database, like the other mpt-purge-* jobs. It calls public.purge_expired_conversation_state() (20261019150000), which deletes only
-- rows past expires_at (24 h life). The Worker also purges after each successful start-deep-dive; both are safe to run together.
--
-- Idempotent: it replaces only its own job, by name. Rollback: select cron.unschedule('mpt-purge-conversation-state');
-- Applied to production by hand on 2026-10-19 (job id 9); this file records it.

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-conversation-state';
    perform cron.schedule('mpt-purge-conversation-state', '17 * * * *', 'select public.purge_expired_conversation_state();');
  end if;
end $$;
