-- MPC-7378 follow-up: report in Hong Kong time. Every day is a Hong Kong day (00:00-24:00 HKT, Asia/Hong_Kong, no DST) and every
-- week starts on Monday HKT. Replaces the UTC-date bucketing of mpt_daily_metrics and mpt_weekly_metrics (same columns, so
-- `create or replace` keeps grants and dependants). APPLIED 2026-10-10 17:3x HKT to project xmdmkumwxpgahmlweuug (migration mpc_7378_hong_kong_days).
--
-- Safe to apply BEFORE the Worker switches to Hong Kong days: a UTC-midnight period_start (what the old Worker wrote) is
-- 08:00 HKT the same date, so existing raw rows keep their dates; the new Worker writes HKT-midnight instants (16:00 UTC the
-- day before), which the old UTC views would put one day early. So: apply this file first, then merge the Worker.
--
-- Not changed: mpt_cloudflare_daily and mpt_youtube_daily read payload->>'day', which the Worker now writes as the Hong Kong day.

create function public.mpt_hk_date(ts timestamptz) returns date
language sql immutable set search_path = '' as $$ select (ts at time zone 'Asia/Hong_Kong')::date $$;
create function public.mpt_hk_ts(d date) returns timestamptz
language sql immutable set search_path = '' as $$ select d::timestamp at time zone 'Asia/Hong_Kong' $$;
revoke all on function public.mpt_hk_date(timestamptz), public.mpt_hk_ts(date) from public, anon, authenticated;
grant execute on function public.mpt_hk_date(timestamptz), public.mpt_hk_ts(date) to service_role;

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

comment on view public.mpt_daily_metrics is
  'MPC-7376 / HKT follow-up. One row per Hong Kong day (00:00-24:00 HKT). cumulative_scans = rows in public.scans (D5). engagement_* and ga4_scan_events are separate signals, never merged. NULL = not collected, never an estimate. Counts only, no personal data. service_role only.';

create or replace view public.mpt_weekly_metrics with (security_invoker = true) as
with bounds as (
  select date_trunc('week', min(day)::timestamp)::date as first_week from public.mpt_daily_metrics
),
weeks as (
  select w::date as week_of
  from bounds, generate_series(bounds.first_week::timestamp, date_trunc('week', public.mpt_hk_date(now())::timestamp), interval '7 days') w
),
paid as (
  select count(*) filter (where payment_status = 'active' and tier <> 'free') as paid_users from public.users
),
latest_week_count as (
  select distinct on (source, public.mpt_hk_date(period_start)) source, public.mpt_hk_date(period_start) as week_of,
         nullif(payload ->> 'count', '')::numeric as n
  from public.mpt_raw_metrics
  where ((source = 'blog' and report = 'posts_published') or (source = 'x' and report = 'threads_posted'))
    and status in ('ok', 'partial') and period_start is not null
  order by source, public.mpt_hk_date(period_start), captured_at desc
),
ga_week as (
  select distinct on (public.mpt_hk_date(period_start)) public.mpt_hk_date(period_start) as week_of, payload
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'weekly_overview' and status in ('ok', 'partial') and period_start is not null
  order by public.mpt_hk_date(period_start), captured_at desc
),
mrr as (
  select distinct on (date_trunc('week', public.mpt_hk_date(period_start)::timestamp)::date) date_trunc('week', public.mpt_hk_date(period_start)::timestamp)::date as week_of,
         nullif(payload ->> 'mrr_usd', '')::numeric as mrr
  from public.mpt_raw_metrics
  where source = 'revenue' and report = 'mrr' and status in ('ok', 'partial') and period_start is not null
  order by date_trunc('week', public.mpt_hk_date(period_start)::timestamp)::date, period_start desc, captured_at desc
)
select
  weeks.week_of,
  (select count(*) from public.scans s where s.created_at < least(public.mpt_hk_ts(weeks.week_of + 7), public.mpt_hk_ts(public.mpt_hk_date(now()) + 1)))::bigint as cumulative_scans,
  (select count(*) from public.scans s
     where s.created_at >= public.mpt_hk_ts(weeks.week_of) and s.created_at < public.mpt_hk_ts(weeks.week_of + 7))::bigint as weekly_new_scans,
  -- Scan-to-paid conversion has no stored history: only the current week is filled, from live users.
  case when weeks.week_of = date_trunc('week', public.mpt_hk_date(now())::timestamp)::date
        and (select count(*) from public.scans) > 0
       then round(100.0 * paid.paid_users / (select count(*) from public.scans), 2) end as conversion_rate_pct,
  mrr.mrr as current_mrr,
  public.mpt_ga4_metric(ga_week.payload, 'activeUsers') as ga4_active_users,
  blog.n as blog_posts_published,
  xt.n as x_threads_posted,
  (select coalesce(sum(d.engagement_sessions), 0) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7)::bigint as engagement_sessions,
  (select coalesce(sum(d.engagement_full_scans), 0) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7)::bigint as engagement_full_scans,
  (select sum(d.ga4_scan_events) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7) as ga4_scan_events
from weeks
cross join paid
left join mrr on mrr.week_of = weeks.week_of
left join ga_week on ga_week.week_of = weeks.week_of
left join latest_week_count blog on blog.source = 'blog' and blog.week_of = weeks.week_of
left join latest_week_count xt on xt.source = 'x' and xt.week_of = weeks.week_of;

comment on view public.mpt_weekly_metrics is
  'MPC-7376 / HKT follow-up. One row per Monday-start Hong Kong week. Notion tracker mapping: week_of=Week Of, cumulative_scans=Cumulative Scans, weekly_new_scans=Weekly New Scans, conversion_rate_pct=Conversion Rate %, current_mrr=Current MRR, ga4_active_users=GA4 Active Users, blog_posts_published=Blog Posts Published, x_threads_posted=X Threads Posted. cumulative_scans = rows in public.scans as of week end (or now) per D5. engagement_* and ga4_scan_events are separate signals. NULL = not collected. service_role only.';
