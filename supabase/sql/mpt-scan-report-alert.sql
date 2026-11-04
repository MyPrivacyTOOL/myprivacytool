-- MPC-8406: a FAST alert when a /scan report request is stuck.
--
-- Why: a /scan submission normally gets its confirmation within seconds and its report within about 4 minutes (the mpt-scan-report cron
-- runs every 5 minutes). The only stuck-report signal before this was a log line at the 48 hour deadline, and the daily scan-gap check
-- (workers/mpt-metrics-collector/collectors/scan-gap.js) that compares form submissions with accepted requests. With very low traffic a
-- regression could sit unnoticed for days. This job notices within 10 to 25 minutes.
--
-- Unhealthy (public.mpt_scan_report_health) when, among scans from the last 7 days:
--   * a scan is still 'pending' or 'processing' more than 15 minutes after it was created, or
--   * a scan 'failed' in the last 24 hours (cancelled-by-unsubscribe rows are not failures), or
--   * a scan has no confirmation email more than 5 minutes after it was created (and has not failed).
-- Alert: Telegram, through the existing Vault secrets (telegram_alert_token, telegram_alert_chat_id) and pg_net, the same channel as
-- mpt_purge_alert (supabase/sql/mpt-purge-expired-scan-results.sql). The message carries counts and ages only: never an email address.
-- De-duplication: one alert when it goes unhealthy, repeated at most once an hour while it stays unhealthy, and one "recovered" message.
-- State lives in public.mpt_alert_state (RLS forced, service_role only).
--
-- Applied to production 2026-10-23 as migration mpc_8406_scan_report_alert. Not applied by CI (needs Supabase-only pg_net, Vault, pg_cron).
-- Test the alert path: select public.mpt_scan_report_alert(true);   -- sends one "TEST" message
-- Rollback: select cron.unschedule('mpt-scan-report-alert'); then drop the two functions and the table.

create table if not exists public.mpt_alert_state (
  name        text primary key,
  is_open     boolean not null default false,
  last_sent_at timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.mpt_alert_state enable row level security;
alter table public.mpt_alert_state force row level security;
revoke all on public.mpt_alert_state from anon, authenticated;

create or replace function public.mpt_scan_report_health()
returns table (healthy boolean, stuck_count integer, oldest_stuck_minutes integer, failed_24h integer, unconfirmed_count integer, checked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with s as (
    select
      count(*) filter (where report_status in ('pending', 'processing') and created_at < now() - interval '15 minutes') as stuck,
      max(extract(epoch from (now() - created_at)) / 60) filter (where report_status in ('pending', 'processing') and created_at < now() - interval '15 minutes') as oldest,
      count(*) filter (where report_status = 'failed' and created_at > now() - interval '24 hours' and coalesce(report_last_error, '') not like 'cancelled:%') as failed,
      count(*) filter (where confirmation_sent_at is null and report_status <> 'failed' and created_at < now() - interval '5 minutes') as unconfirmed
    from public.scans
    where created_at > now() - interval '7 days'
  )
  select (stuck = 0 and failed = 0 and unconfirmed = 0), stuck::integer, coalesce(oldest, 0)::integer, failed::integer, unconfirmed::integer, now()
  from s;
$$;
revoke all on function public.mpt_scan_report_health() from public, anon, authenticated;
grant execute on function public.mpt_scan_report_health() to service_role;

create or replace function public.mpt_scan_report_alert(p_test boolean default false)
returns text
language plpgsql security definer set search_path = public, extensions, net, vault, pg_temp
as $$
declare
  h record;
  st record;
  v_token text;
  v_chat  text;
  v_msg   text;
  v_send  boolean := false;
  v_recovered boolean := false;
begin
  select * into h from public.mpt_scan_report_health();
  insert into public.mpt_alert_state (name) values ('scan_report') on conflict (name) do nothing;
  select * into st from public.mpt_alert_state where name = 'scan_report' for update;

  if p_test then
    v_send := true;
  elsif not h.healthy then
    v_send := (not st.is_open) or st.last_sent_at is null or st.last_sent_at < now() - interval '1 hour';
  elsif st.is_open then
    v_send := true;
    v_recovered := true;
  end if;

  if not v_send then
    return case when h.healthy then 'healthy: no alert sent' else 'unhealthy: alert already sent within the last hour' end;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_alert_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_alert_chat_id';
  if v_token is null or v_chat is null then
    raise warning 'mpt_scan_report_alert: telegram secrets missing in Vault';
    return 'secrets missing';
  end if;

  v_msg := case when p_test then '✅ TEST: MPT scan report alerting works. '
                when v_recovered then '✅ MPT scan reports recovered. '
                else '⚠️ MPT scan reports STUCK. ' end
        || 'stuck_over_15min=' || h.stuck_count
        || ', oldest_stuck_min=' || h.oldest_stuck_minutes
        || ', failed_24h=' || h.failed_24h
        || ', no_confirmation_over_5min=' || h.unconfirmed_count;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', v_chat, 'text', v_msg)
  );

  if not p_test then
    update public.mpt_alert_state
       set is_open = not v_recovered, last_sent_at = now(), updated_at = now()
     where name = 'scan_report';
  end if;
  return 'alert queued';
end;
$$;
revoke all on function public.mpt_scan_report_alert(boolean) from public, anon, authenticated;
grant execute on function public.mpt_scan_report_alert(boolean) to service_role;

-- Every 10 minutes (pg_cron). Guarded so a database without pg_cron simply skips it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mpt-scan-report-alert') then
      perform cron.unschedule('mpt-scan-report-alert');
    end if;
    perform cron.schedule('mpt-scan-report-alert', '*/10 * * * *', 'select public.mpt_scan_report_alert(false)');
  end if;
end
$$;
