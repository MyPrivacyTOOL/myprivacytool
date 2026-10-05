-- MPC-6977 / MPC-6957: hourly purge of expired OSINT scan results (record of what is applied in
-- project xmdmkumwxpgahmlweuug via migrations `mpc_6977_purge_expired_scan_results_pg_cron` and
-- `mpc_6957_purge_health_check`). Re-run safe documentation only; the live DB is the source of truth.

-- Job: pg_cron, hourly, name `mpt-purge-expired-scan-results`, calls
--   select public.mpt_purge_expired_scan_results();
-- (SECURITY DEFINER; EXECUTE revoked from anon/authenticated.) Deletes rows where expires_at < now().

-- Health check (read-only, service_role only). healthy = last success < 2h ago, no failed runs in
-- 24h, and no rows expired for more than 2h.
create or replace function public.mpt_purge_health()
returns table (healthy boolean, last_success timestamptz, failed_runs_24h bigint, expired_rows bigint, checked_at timestamptz)
language sql
security definer
set search_path = public, cron, pg_temp
as $$
  with runs as (
    select d.status, d.start_time
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = 'mpt-purge-expired-scan-results'
  ), s as (
    select
      (select max(start_time) from runs where status = 'succeeded') as last_success,
      (select count(*) from runs where status <> 'succeeded' and start_time > now() - interval '24 hours') as failed_24h,
      (select count(*) from public.mpt_osint_scan_results where expires_at < now() - interval '2 hours') as stale_expired
  )
  select
    (s.last_success > now() - interval '2 hours' and s.failed_24h = 0 and s.stale_expired = 0),
    s.last_success, s.failed_24h, s.stale_expired, now()
  from s;
$$;
revoke all on function public.mpt_purge_health() from public, anon, authenticated;
grant execute on function public.mpt_purge_health() to service_role;

-- Alerting (migration `mpc_6957_purge_alert_telegram`): pg_net + Vault. Secrets are NOT in this file.
-- create extension if not exists pg_net with schema extensions;
-- function public.mpt_purge_alert(p_test boolean default false) — SECURITY DEFINER, service_role only:
--   reads vault.decrypted_secrets (telegram_alert_token, telegram_alert_chat_id), and when
--   mpt_purge_health().healthy is false (or p_test) POSTs a message to Telegram sendMessage via net.http_post.
-- select cron.schedule('mpt-purge-alert', '30 * * * *', $$select public.mpt_purge_alert(false)$$);
