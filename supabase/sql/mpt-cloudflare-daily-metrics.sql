-- MPC-7381 (MPT analytics 6/9): Cloudflare numbers per day, taken from the untouched payloads in public.mpt_raw_metrics.
-- Requires public.mpt_raw_metrics (MPC-7376). Aggregates only; a failed pull (status='error') yields NULL cells, never a guess.
-- mpt_daily_metrics (MPC-7376) should LEFT JOIN this view on metric_date and expose cloudflare_visitors / cloudflare_requests
-- beside the GA4 active-users column, so the GA4 undercount (consent banners, ad blockers) is visible:
--   LEFT JOIN public.mpt_cloudflare_daily cf USING (metric_date)   -- adds cf.cloudflare_visitors, cf.cloudflare_requests, ...

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
