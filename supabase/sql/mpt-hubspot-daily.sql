-- MPC-7379: HubSpot contacts per Hong Kong day from the aggregate payloads in public.mpt_raw_metrics (source='hubspot', report='portal_daily').
-- Exposes hubspot_total_contacts and hubspot_new_contacts in mpt_daily_metrics (two columns appended at the END of the live view;
-- `create or replace` keeps grants; security_invoker restated). Follows mpt-youtube-daily-metrics.sql + mpt-youtube-daily-join.sql.
-- Only rows whose portal guard passed (guard.ok, portal 246502821) and whose contact counts were read count. A wrong/unreadable portal
-- or a failed contacts pull has no contact numbers, so that day is NULL, never a guess. A row where only the deals pull failed
-- (status='error') still carries valid contact counts, so those are kept.
-- metric_date = payload->>'day' = the Hong Kong day the new-contact count covers; total is the count when the run happened (~00:15 HKT next day).
-- Counts only, no personal data. service_role only. Apply this file with the Supabase SQL editor/MCP (it is not under supabase/migrations/).

create or replace view public.mpt_hubspot_daily with (security_invoker = true) as
select distinct on ((payload->>'day')::date)
  (payload->>'day')::date as metric_date,
  nullif(payload #>> '{contacts,total}', '')::bigint as hubspot_total_contacts,
  nullif(payload #>> '{contacts,created_on_day}', '')::bigint as hubspot_new_contacts
from public.mpt_raw_metrics
where source = 'hubspot' and report = 'portal_daily'
  and payload #>> '{contacts,total}' is not null
  and payload #>> '{guard,ok}' = 'true' and payload #>> '{portal_id}' = '246502821'
order by (payload->>'day')::date, captured_at desc;

revoke all on public.mpt_hubspot_daily from public, anon, authenticated;
grant select on public.mpt_hubspot_daily to service_role;

create or replace view public.mpt_daily_metrics with (security_invoker = true) as
with bounds as (
  select least(
           coalesce((select public.mpt_hk_date(min(created_at)) from public.scans), public.mpt_hk_date(now())),
           coalesce((select public.mpt_hk_date(min(period_start)) from public.mpt_raw_metrics), public.mpt_hk_date(now()))
         ) as first_day
),
days as (
  select d::date as day from bounds, generate_series(bounds.first_day::timestamp, public.mpt_hk_date(now())::timestamp, interval '1 day') d
),
scan_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.scans group by 1),
eng_n as (
  select public.mpt_hk_date(created_at) as day, count(*) sessions, count(*) filter (where full_scan_completed) full_scans
  from public.mpt_user_engagement group by 1
),
lead_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.leads group by 1),
sub_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.subscribers group by 1),
user_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.users group by 1),
raw_n as (
  select public.mpt_hk_date(captured_at) as day, count(*) n, count(*) filter (where status = 'error') failed
  from public.mpt_raw_metrics group by 1
),
ga_overview as (
  select distinct on (public.mpt_hk_date(period_start)) public.mpt_hk_date(period_start) as day, payload
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'daily_overview' and status in ('ok', 'partial') and period_start is not null
  order by public.mpt_hk_date(period_start), captured_at desc
),
ga_events as (
  select distinct on (public.mpt_hk_date(period_start)) public.mpt_hk_date(period_start) as day,
    (select coalesce(sum(nullif(r -> 'metricValues' -> 0 ->> 'value', '')::numeric), 0)
       from jsonb_array_elements(coalesce(payload -> 'rows', '[]'::jsonb)) r
       where r -> 'dimensionValues' -> 0 ->> 'value' ilike '%scan%') as scan_events
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'daily_events' and status in ('ok', 'partial') and period_start is not null
  order by public.mpt_hk_date(period_start), captured_at desc
)
select
  days.day,
  (select count(*) from public.scans s where s.created_at < public.mpt_hk_ts(days.day + 1))::bigint as cumulative_scans,
  coalesce(scan_n.n, 0)::bigint as new_scans,
  coalesce(eng_n.sessions, 0)::bigint as engagement_sessions,
  coalesce(eng_n.full_scans, 0)::bigint as engagement_full_scans,
  public.mpt_ga4_metric(ga_overview.payload, 'sessions') as ga4_sessions,
  public.mpt_ga4_metric(ga_overview.payload, 'activeUsers') as ga4_active_users,
  ga_events.scan_events as ga4_scan_events,
  coalesce(lead_n.n, 0)::bigint as new_leads,
  coalesce(sub_n.n, 0)::bigint as new_subscribers,
  coalesce(user_n.n, 0)::bigint as new_users,
  coalesce(raw_n.n, 0)::bigint as raw_rows_captured,
  coalesce(raw_n.failed, 0)::bigint as raw_pulls_failed,
  yt.youtube_subscribers,
  yt.youtube_videos_published,
  hs.hubspot_total_contacts,
  hs.hubspot_new_contacts
from days
left join scan_n on scan_n.day = days.day
left join eng_n on eng_n.day = days.day
left join lead_n on lead_n.day = days.day
left join sub_n on sub_n.day = days.day
left join user_n on user_n.day = days.day
left join raw_n on raw_n.day = days.day
left join ga_overview on ga_overview.day = days.day
left join ga_events on ga_events.day = days.day
left join public.mpt_youtube_daily yt on yt.metric_date = days.day
left join public.mpt_hubspot_daily hs on hs.metric_date = days.day;
