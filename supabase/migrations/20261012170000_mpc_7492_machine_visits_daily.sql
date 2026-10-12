-- MPC-7492: daily aggregate of bot and AI edge visits for the machine mirror (workers/mpt-metrics-collector).
-- One call returns counts only: per class and user agent, requests, pages served (distinct paths, 2xx/3xx, not robots.txt, sitemap.xml or /api),
-- robots.txt fetches, first and last seen in the window, and the first time that user agent was ever seen. Person and unknown rows are
-- never returned (only the total request count of the window, used as the denominator for "share of all traffic"). No IP is read.
--
-- Rollback:
--   drop function if exists public.mpt_machine_visits_daily(timestamptz, timestamptz);
--   drop index if exists public.edge_visits_machine_ua_idx;

create index if not exists edge_visits_machine_ua_idx on public.edge_visits (user_agent, seen_at) where class in ('bot', 'ai');

create or replace function public.mpt_machine_visits_daily(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with win as (select class, user_agent, path, status, seen_at from public.edge_visits where seen_at >= p_from and seen_at < p_to),
  m as (
    select class, user_agent,
           count(*) as requests,
           min(seen_at) as first_seen,
           max(seen_at) as last_seen,
           count(*) filter (where path = '/robots.txt') as robots_fetches,
           coalesce(array_agg(distinct path) filter (where path <> '/robots.txt' and path <> '/sitemap.xml' and path not like '/api/%' and status between 200 and 399), '{}') as pages
      from win where class in ('bot', 'ai') group by class, user_agent
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total_requests', (select count(*) from win),
    'machine_requests', (select coalesce(sum(requests), 0) from m),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'class', class, 'user_agent', user_agent, 'requests', requests, 'pages', to_jsonb(pages),
        'first_seen', first_seen, 'last_seen', last_seen, 'robots_fetches', robots_fetches,
        'first_ever', (select min(e.seen_at) from public.edge_visits e where e.user_agent is not distinct from m.user_agent and e.class in ('bot', 'ai'))
      ) order by requests desc) from m), '[]'::jsonb)
  );
$$;
revoke all on function public.mpt_machine_visits_daily(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mpt_machine_visits_daily(timestamptz, timestamptz) to service_role;
comment on function public.mpt_machine_visits_daily(timestamptz, timestamptz) is 'MPC-7492. Bot and AI edge visits aggregated per user agent for [p_from, p_to). Counts and paths only, no IP, no person or unknown rows. service_role only.';
