-- MPC-7381 criterion 3: expose Cloudflare numbers per day in mpt_daily_metrics, next to GA4 active users.
-- 1) mpt_cloudflare_daily (re-stated, same columns): threats_blocked falls back to the zone's own threat count when the firewall query is denied.
-- 2) mpt_cloudflare_day: one row per day (mpt_cloudflare_daily has one row per Worker per day, which would duplicate days in a join).
-- 3) mpt_daily_metrics: the live (Hong Kong day) definition from mpt-hubspot-daily.sql with seven columns appended at the END.
-- Requires mpt-cloudflare-daily-metrics.sql, mpt-youtube-daily-metrics.sql and mpt-hubspot-daily.sql to be applied first. NULL = not collected that day.

create or replace view public.mpt_cloudflare_daily with (security_invoker = true) as
with latest as (
  -- one row per day: the most recent successful pull
  select distinct on ((payload->>'day')::date) (payload->>'day')::date as metric_date, payload
  from public.mpt_raw_metrics
  where source = 'cloudflare' and status = 'ok'
  order by (payload->>'day')::date, captured_at desc
)
select
  l.metric_date,
  (l.payload #>> '{zone,data,viewer,zones,0,httpRequests1dGroups,0,uniq,uniques}')::bigint   as cloudflare_visitors,
  (l.payload #>> '{zone,data,viewer,zones,0,httpRequests1dGroups,0,sum,requests}')::bigint   as cloudflare_requests,
  w.script_name,
  w.requests as worker_invocations,
  w.errors   as worker_errors,
  -- appended columns (create or replace view only allows new columns at the end)
  (z #>> '{sum,bytes}')::bigint                                  as cloudflare_bandwidth_bytes,
  (z #>> '{sum,cachedRequests}')::bigint                         as cloudflare_cached_requests,
  case when (z #>> '{sum,requests}')::numeric > 0
       then round((z #>> '{sum,cachedRequests}')::numeric / (z #>> '{sum,requests}')::numeric, 4) end as cloudflare_cache_hit_ratio,
  (select sum((e->>'requests')::bigint) from jsonb_array_elements(coalesce(z #> '{sum,responseStatusMap}', '[]'::jsonb)) e
     where (e->>'edgeResponseStatus')::int between 400 and 499) as cloudflare_error_4xx,
  (select sum((e->>'requests')::bigint) from jsonb_array_elements(coalesce(z #> '{sum,responseStatusMap}', '[]'::jsonb)) e
     where (e->>'edgeResponseStatus')::int between 500 and 599) as cloudflare_error_5xx,
  -- threats_blocked: firewall block events; falls back to the zone's own threat count (httpRequests1dGroups sum.threats) when
  -- firewall analytics are not available to the token/plan (MPC-7381: Cloudflare denied firewallEventsAdaptiveGroups for this zone)
  coalesce((l.payload #>> '{firewall,data,viewer,zones,0,firewallEventsAdaptiveGroups,0,count}')::bigint, (z #>> '{sum,threats}')::bigint) as cloudflare_threats_blocked
from latest l
cross join lateral (select l.payload #> '{zone,data,viewer,zones,0,httpRequests1dGroups,0}' as z) zz
left join lateral (
  select e->'dimensions'->>'scriptName' as script_name,
         (e->'sum'->>'requests')::bigint as requests,
         (e->'sum'->>'errors')::bigint   as errors
  from jsonb_array_elements(coalesce(l.payload #> '{workers,data,viewer,accounts,0,workersInvocationsAdaptive}', '[]'::jsonb)) e
) w on true;


revoke all on public.mpt_cloudflare_daily from anon, authenticated;
grant select on public.mpt_cloudflare_daily to service_role;

create or replace view public.mpt_cloudflare_day with (security_invoker = true) as
select distinct on (metric_date)
  metric_date, cloudflare_visitors, cloudflare_requests, cloudflare_bandwidth_bytes, cloudflare_cached_requests,
  cloudflare_cache_hit_ratio, cloudflare_error_4xx, cloudflare_error_5xx, cloudflare_threats_blocked
from public.mpt_cloudflare_daily
order by metric_date;

revoke all on public.mpt_cloudflare_day from anon, authenticated;
grant select on public.mpt_cloudflare_day to service_role;

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
