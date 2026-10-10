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
  w.errors   as worker_errors
from latest l
left join lateral (
  select e->'dimensions'->>'scriptName' as script_name,
         (e->'sum'->>'requests')::bigint as requests,
         (e->'sum'->>'errors')::bigint   as errors
  from jsonb_array_elements(coalesce(l.payload #> '{workers,data,viewer,accounts,0,workersInvocationsAdaptive}', '[]'::jsonb)) e
) w on true;

revoke all on public.mpt_cloudflare_daily from anon, authenticated;
grant select on public.mpt_cloudflare_daily to service_role;
