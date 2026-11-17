-- MPC-8671 (part of MPC-8659): the KPI views read public.scan_hourly_counts instead of counting public.scans, so purging expired scans
-- (public.mpt_purge_expired_scans, MPC-8659) cannot lower Cumulative Scans, scans per day or the conversion rate.
--
-- Changes (everything else in both views is unchanged, column list and order included, so `create or replace` keeps grants):
--   mpt_daily_metrics : first_day bound, new_scans and cumulative_scans come from scan_hourly_counts (hour buckets give Hong Kong days, UTC+8)
--   mpt_weekly_metrics: cumulative_scans, weekly_new_scans and the conversion_rate_pct denominator come from scan_hourly_counts
-- Daily definition = the live one (supabase/sql/mpt-cloudflare-daily-join.sql); weekly = supabase/sql/mpt-hk-days.sql. Those files carry the same change.
-- The counter is filled by the scans_count_hourly trigger and was backfilled in 20261027150000_mpc_8659_scans_retention.sql, so the numbers are identical today.
--
-- Rollback: re-apply the views from git history before this commit (they count public.scans again), then: select cron.unschedule('mpt-purge-expired-scans');
--           (rows already deleted by the purge are not recoverable, and the views would then undercount; keep the first run small).

create or replace view public.mpt_daily_metrics with (security_invoker = true) as
with bounds as (
  select least(
           coalesce((select public.mpt_hk_date(min(hour)) from public.scan_hourly_counts), public.mpt_hk_date(now())),
           coalesce((select public.mpt_hk_date(min(period_start)) from public.mpt_raw_metrics), public.mpt_hk_date(now()))
         ) as first_day
),
days as (
  select d::date as day from bounds, generate_series(bounds.first_day::timestamp, public.mpt_hk_date(now())::timestamp, interval '1 day') d
),
scan_n as (select public.mpt_hk_date(hour) as day, sum(scans_created) n from public.scan_hourly_counts group by 1),
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
  (select coalesce(sum(h.scans_created), 0) from public.scan_hourly_counts h where h.hour < public.mpt_hk_ts(days.day + 1))::bigint as cumulative_scans,
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
  hs.hubspot_new_contacts,
  cf.cloudflare_visitors,
  cf.cloudflare_requests,
  cf.cloudflare_bandwidth_bytes,
  cf.cloudflare_cache_hit_ratio,
  cf.cloudflare_error_4xx,
  cf.cloudflare_error_5xx,
  cf.cloudflare_threats_blocked
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
left join public.mpt_hubspot_daily hs on hs.metric_date = days.day
left join public.mpt_cloudflare_day cf on cf.metric_date = days.day;

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
  (select coalesce(sum(h.scans_created), 0) from public.scan_hourly_counts h where h.hour < least(public.mpt_hk_ts(weeks.week_of + 7), public.mpt_hk_ts(public.mpt_hk_date(now()) + 1)))::bigint as cumulative_scans,
  (select coalesce(sum(h.scans_created), 0) from public.scan_hourly_counts h
     where h.hour >= public.mpt_hk_ts(weeks.week_of) and h.hour < public.mpt_hk_ts(weeks.week_of + 7))::bigint as weekly_new_scans,
  -- Scan-to-paid conversion has no stored history: only the current week is filled, from live users.
  case when weeks.week_of = date_trunc('week', public.mpt_hk_date(now())::timestamp)::date
        and (select coalesce(sum(scans_created), 0) from public.scan_hourly_counts) > 0
       then round(100.0 * paid.paid_users / (select sum(scans_created) from public.scan_hourly_counts), 2) end as conversion_rate_pct,
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
  'MPC-7376 / HKT follow-up. One row per Monday-start Hong Kong week. Notion tracker mapping: week_of=Week Of, cumulative_scans=Cumulative Scans, weekly_new_scans=Weekly New Scans, conversion_rate_pct=Conversion Rate %, current_mrr=Current MRR, ga4_active_users=GA4 Active Users, blog_posts_published=Blog Posts Published, x_threads_posted=X Threads Posted. cumulative_scans = scans created as of week end, from public.scan_hourly_counts (MPC-8671) (or now) per D5. engagement_* and ga4_scan_events are separate signals. NULL = not collected. service_role only.';

-- create or replace view keeps grants; restate to be explicit and safe
revoke all on public.mpt_daily_metrics, public.mpt_weekly_metrics from public, anon, authenticated, service_role;
grant select on public.mpt_daily_metrics, public.mpt_weekly_metrics to service_role;
