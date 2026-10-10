-- MPC-7380 criterion 3: expose YouTube followers (subscribers) and posts (videos published that day) per day in mpt_daily_metrics.
-- Adds two columns at the END of the existing MPC-7376 view (create or replace keeps grants; security_invoker restated).
-- Requires public.mpt_youtube_daily (supabase/sql/mpt-youtube-daily-metrics.sql). NULL = not collected that day.

create or replace view public.mpt_daily_metrics with (security_invoker = true) as
with bounds as (
  select least(
           coalesce((select min(created_at)::date from public.scans), current_date),
           coalesce((select min(period_start)::date from public.mpt_raw_metrics), current_date)
         ) as first_day
),
days as (
  select d::date as day from bounds, generate_series(bounds.first_day::timestamp, current_date::timestamp, interval '1 day') d
),
scan_n as (select created_at::date as day, count(*) n from public.scans group by 1),
eng_n as (
  select created_at::date as day, count(*) sessions, count(*) filter (where full_scan_completed) full_scans
  from public.mpt_user_engagement group by 1
),
lead_n as (select created_at::date as day, count(*) n from public.leads group by 1),
sub_n as (select created_at::date as day, count(*) n from public.subscribers group by 1),
user_n as (select created_at::date as day, count(*) n from public.users group by 1),
raw_n as (
  select captured_at::date as day, count(*) n, count(*) filter (where status = 'error') failed
  from public.mpt_raw_metrics group by 1
),
ga_overview as (
  select distinct on (period_start::date) period_start::date as day, payload
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'daily_overview' and status in ('ok', 'partial') and period_start is not null
  order by period_start::date, captured_at desc
),
ga_events as (
  select distinct on (period_start::date) period_start::date as day,
    (select coalesce(sum(nullif(r -> 'metricValues' -> 0 ->> 'value', '')::numeric), 0)
       from jsonb_array_elements(coalesce(payload -> 'rows', '[]'::jsonb)) r
       where r -> 'dimensionValues' -> 0 ->> 'value' ilike '%scan%') as scan_events
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'daily_events' and status in ('ok', 'partial') and period_start is not null
  order by period_start::date, captured_at desc
)
select
  days.day,
  (select count(*) from public.scans s where s.created_at < days.day + 1)::bigint as cumulative_scans,
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
  yt.youtube_videos_published
from days
left join scan_n on scan_n.day = days.day
left join eng_n on eng_n.day = days.day
left join lead_n on lead_n.day = days.day
left join sub_n on sub_n.day = days.day
left join user_n on user_n.day = days.day
left join raw_n on raw_n.day = days.day
left join ga_overview on ga_overview.day = days.day
left join ga_events on ga_events.day = days.day
left join public.mpt_youtube_daily yt on yt.metric_date = days.day;
