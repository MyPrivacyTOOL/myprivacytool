-- MPC-7641: daily Channel OSINT funnel per platform, for the Channel OSINT section of the MPT dashboard (workers/mpt-metrics-collector).
-- Counts only, per platform (X, LinkedIn, Telegram, ...): no sender id, no message text, no email, no IP.
--   dms_received     interaction_log rows (one per routed inbound message)
--   scan_requests    interaction_log rows with intent = 'scan'
--   consents_given   conversations that moved awaiting_confirmation -> confirmed (the sender typed "yes")
--   conversions      leads created in the window whose utm_medium = 'channel_osint', grouped by utm_source
-- Clicks and scans completed are NOT here: edge_visits drops the query string and web_scans carries no campaign, so GA4 (sessions and
-- privacy_scan_completed events by session source / medium) is the source. The collector joins them. Tag every link the bots send: utm_source=<platform>&utm_medium=channel_osint.
--
-- Rollback:
--   drop function if exists public.mpt_channel_osint_daily(timestamptz, timestamptz);

create or replace function public.mpt_channel_osint_daily(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with i as (
    select lower(channel) as platform,
           count(*) as dms_received,
           count(*) filter (where intent = 'scan') as scan_requests,
           count(*) filter (where state_before = 'awaiting_confirmation' and state_after = 'confirmed') as consents_given
      from public.interaction_log where created_at >= p_from and created_at < p_to group by 1
  ), l as (
    select lower(utm_source) as platform, count(*) as conversions
      from public.leads where created_at >= p_from and created_at < p_to and lower(utm_medium) = 'channel_osint' and utm_source is not null group by 1
  ), p as (select platform from i union select platform from l)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'platforms', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', p.platform,
        'dms_received', coalesce(i.dms_received, 0), 'consents_given', coalesce(i.consents_given, 0),
        'scan_requests', coalesce(i.scan_requests, 0),
        'conversions', coalesce(l.conversions, 0)) order by p.platform)
      from p left join i using (platform) left join l using (platform)), '[]'::jsonb)
  );
$$;
revoke all on function public.mpt_channel_osint_daily(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mpt_channel_osint_daily(timestamptz, timestamptz) to service_role;
comment on function public.mpt_channel_osint_daily(timestamptz, timestamptz) is 'MPC-7641. Channel OSINT funnel counts per platform for [p_from, p_to): DMs, scan requests, consents, leads tagged utm_medium=channel_osint. Counts only. service_role only.';
