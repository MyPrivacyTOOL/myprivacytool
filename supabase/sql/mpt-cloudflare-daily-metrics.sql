-- MPC-7381: expose Cloudflare analytics next to GA4 in mpt_daily_metrics (MPT analytics 6/9).
-- DEPENDS ON supabase/sql/mpt-raw-metrics.sql (MPC-7376, PR #165): apply that first. This file only re-creates
-- mpt_daily_metrics with five columns APPENDED at the end (CREATE OR REPLACE VIEW allows nothing else), so the
-- existing columns and mpt_weekly_metrics are untouched. NOT YET APPLIED.
--
-- Collector contract (workers/mpt-metrics-collector, source = cloudflare, period_start = the UTC day covered):
--   cloudflare / zone_daily     GraphQL data for zone myprivacytool.io: httpRequests1dGroups[0].sum.requests, uniq.uniques
--   cloudflare / workers_daily  GraphQL data: workersInvocationsAdaptive[] per script (mpt-leads, core-brain, social-listeners)
-- Failed pulls are status=error with an empty payload and are ignored here, so the cells stay NULL (never estimated).

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
cf_zone as (
  select distinct on (period_start::date) period_start::date as day, payload
  from public.mpt_raw_metrics
  where source = 'cloudflare' and report = 'zone_daily' and status in ('ok', 'partial') and period_start is not null
  order by period_start::date, captured_at desc
),
cf_workers as (
  select distinct on (period_start::date) period_start::date as day, payload
  from public.mpt_raw_metrics
  where source = 'cloudflare' and report = 'workers_daily' and status in ('ok', 'partial') and period_start is not null
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
  -- MPC-7381: Cloudflare cross-check on GA4 (consent banners and ad blockers hide visitors from GA4). NULL = not collected.
  nullif(cf_zone.payload #>> '{viewer,zones,0,httpRequests1dGroups,0,sum,requests}', '')::numeric as cloudflare_requests,
  nullif(cf_zone.payload #>> '{viewer,zones,0,httpRequests1dGroups,0,uniq,uniques}', '')::numeric as cloudflare_visitors,
  (select sum(nullif(g #>> '{sum,requests}', '')::numeric)
     from jsonb_array_elements(coalesce(cf_workers.payload #> '{viewer,accounts,0,workersInvocationsAdaptive}', '[]'::jsonb)) g) as cloudflare_worker_invocations,
  (select sum(nullif(g #>> '{sum,errors}', '')::numeric)
     from jsonb_array_elements(coalesce(cf_workers.payload #> '{viewer,accounts,0,workersInvocationsAdaptive}', '[]'::jsonb)) g) as cloudflare_worker_errors,
  -- Gap: visitors Cloudflare saw that GA4 did not (positive = GA4 undercounts). NULL unless both were collected.
  nullif(cf_zone.payload #>> '{viewer,zones,0,httpRequests1dGroups,0,uniq,uniques}', '')::numeric
    - public.mpt_ga4_metric(ga_overview.payload, 'activeUsers') as cloudflare_visitors_minus_ga4_active_users
from days
left join scan_n on scan_n.day = days.day
left join eng_n on eng_n.day = days.day
left join lead_n on lead_n.day = days.day
left join sub_n on sub_n.day = days.day
left join user_n on user_n.day = days.day
left join raw_n on raw_n.day = days.day
left join ga_overview on ga_overview.day = days.day
left join ga_events on ga_events.day = days.day
left join cf_zone on cf_zone.day = days.day
left join cf_workers on cf_workers.day = days.day;
comment on view public.mpt_daily_metrics is
  'MPC-7376/7381. One row per UTC day. cumulative_scans = rows in public.scans (D5). engagement_* and ga4_scan_events are separate signals, never merged. cloudflare_* come from the read-only Cloudflare GraphQL pull; cloudflare_visitors_minus_ga4_active_users shows the GA4 undercount. NULL = not collected, never an estimate. Counts only, no personal data. service_role only.';

revoke all on public.mpt_daily_metrics from public, anon, authenticated;
grant select on public.mpt_daily_metrics to service_role;
