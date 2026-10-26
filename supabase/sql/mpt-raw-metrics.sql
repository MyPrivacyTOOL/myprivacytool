-- MPC-7376: MPT analytics raw metrics store and rollup views (strategy sections 4 and 5).
-- Target: Supabase project xmdmkumwxpgahmlweuug ("MyPrivacyTOOL Project2").
-- Applied 2026-10-10 as migrations mpc_7376_mpt_raw_metrics and mpc_7376_views_select_only.
--
-- Model (same as the other aggregate mpt_ tables, see mpt-operational-rls.sql):
--   RLS enabled + FORCED, no policies, all grants revoked from anon/authenticated, service_role only.
--   The table is append-only: service_role may INSERT and SELECT; UPDATE/DELETE/TRUNCATE are revoked
--   and also blocked by triggers, so even a role that regains the grant cannot rewrite history.
--   No personal data: payloads are aggregates / API reports. A CHECK rejects payloads containing an
--   e-mail address. The views select counts only, never e-mail, IP or any person-level column.
--
-- Definitions (decision record D5/D6):
--   cumulative_scans = count of rows in public.scans (the headline). Engagement sessions with
--   full_scan_completed and GA4 scan events are separate columns and are never merged into it.

create table public.mpt_raw_metrics (
  id uuid primary key default gen_random_uuid(),
  source text not null check (char_length(source) between 1 and 64),
  report text not null check (char_length(report) between 1 and 128),
  captured_at timestamptz not null default now(),
  period_start timestamptz,
  period_end timestamptz,
  payload jsonb not null default '{}'::jsonb,
  collector_version text not null check (char_length(collector_version) between 1 and 64),
  status text not null default 'ok' check (status in ('ok', 'partial', 'error')),
  error text,
  check (period_end is null or period_start is null or period_end >= period_start),
  check (status <> 'error' or error is not null),
  check (payload::text !~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}')
);
comment on table public.mpt_raw_metrics is
  'MPC-7376. Append-only raw metric pulls: one row per source per pull, API response kept untouched in payload. Aggregates only, no e-mail/IP/person-level data. service_role only; views mpt_daily_metrics / mpt_weekly_metrics read it.';
comment on column public.mpt_raw_metrics.source is 'ga4, hubspot, x, youtube, cloudflare, supabase, ... (open set; new collectors add values).';
comment on column public.mpt_raw_metrics.report is 'Which API report or query produced the payload, e.g. ga4 daily_overview.';
comment on column public.mpt_raw_metrics.period_start is 'Start of the period the payload covers (UTC). Views join on its UTC date.';

create index mpt_raw_metrics_source_report_period_idx
  on public.mpt_raw_metrics (source, report, period_start desc, captured_at desc);
create index mpt_raw_metrics_captured_at_idx on public.mpt_raw_metrics (captured_at desc);

alter table public.mpt_raw_metrics enable row level security;
alter table public.mpt_raw_metrics force row level security;
revoke all on public.mpt_raw_metrics from public, anon, authenticated;
revoke all on public.mpt_raw_metrics from service_role;
grant select, insert on public.mpt_raw_metrics to service_role;
-- No policies: deny-by-default for everyone except roles that bypass RLS (service_role).

create function public.mpt_raw_metrics_block_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'public.mpt_raw_metrics is append-only (% blocked)', tg_op using errcode = '42501';
end $$;
revoke all on function public.mpt_raw_metrics_block_changes() from public, anon, authenticated;

create trigger mpt_raw_metrics_no_update_delete
  before update or delete on public.mpt_raw_metrics
  for each row execute function public.mpt_raw_metrics_block_changes();
create trigger mpt_raw_metrics_no_truncate
  before truncate on public.mpt_raw_metrics
  for each statement execute function public.mpt_raw_metrics_block_changes();

-- Reads one named metric from a GA4 Data API runReport response (metricHeaders[] + rows[0]).
-- Returns null when the metric is absent. Order-independent, so collectors may request any metric set.
create function public.mpt_ga4_metric(p jsonb, metric text) returns numeric
language sql immutable set search_path = '' as $$
  select nullif(p #>> array['rows', '0', 'metricValues', (h.ord - 1)::text, 'value'], '')::numeric
  from jsonb_array_elements(coalesce(p -> 'metricHeaders', '[]'::jsonb)) with ordinality as h(el, ord)
  where h.el ->> 'name' = metric
  limit 1
$$;
revoke all on function public.mpt_ga4_metric(jsonb, text) from public, anon, authenticated;
grant execute on function public.mpt_ga4_metric(jsonb, text) to service_role;

-- Collector contract the views rely on (ok/partial rows only; the latest capture per period wins).
-- A missing row gives NULL, never an estimate.
--   ga4 / daily_overview    runReport for one UTC day, period_start = that day; metrics sessions, activeUsers
--   ga4 / daily_events      runReport for one day with dimension eventName and metric eventCount
--   ga4 / weekly_overview   runReport for Mon..Sun, period_start = that Monday; metric activeUsers
--   blog / posts_published  payload {"count": n} for the period (day or week), period_start = start
--   x / threads_posted      payload {"count": n} for the period, period_start = start
--   revenue / mrr           payload {"mrr_usd": n}, period_start = the instant the MRR was read
-- Anything else in the table is retained but not yet surfaced.

create view public.mpt_daily_metrics with (security_invoker = true) as
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
  coalesce(raw_n.failed, 0)::bigint as raw_pulls_failed
from days
left join scan_n on scan_n.day = days.day
left join eng_n on eng_n.day = days.day
left join lead_n on lead_n.day = days.day
left join sub_n on sub_n.day = days.day
left join user_n on user_n.day = days.day
left join raw_n on raw_n.day = days.day
left join ga_overview on ga_overview.day = days.day
left join ga_events on ga_events.day = days.day;
comment on view public.mpt_daily_metrics is
  'MPC-7376. One row per UTC day. cumulative_scans = rows in public.scans (D5). engagement_* and ga4_scan_events are separate signals, never merged. NULL = not collected, never an estimate. Counts only, no personal data. service_role only.';

create view public.mpt_weekly_metrics with (security_invoker = true) as
with bounds as (
  select date_trunc('week', min(day))::date as first_week from public.mpt_daily_metrics
),
weeks as (
  select w::date as week_of
  from bounds, generate_series(bounds.first_week::timestamp, date_trunc('week', current_date), interval '7 days') w
),
paid as (
  select count(*) filter (where payment_status = 'active' and tier <> 'free') as paid_users from public.users
),
latest_week_count as (
  select distinct on (source, period_start::date) source, period_start::date as week_of,
         nullif(payload ->> 'count', '')::numeric as n
  from public.mpt_raw_metrics
  where ((source = 'blog' and report = 'posts_published') or (source = 'x' and report = 'threads_posted'))
    and status in ('ok', 'partial') and period_start is not null
  order by source, period_start::date, captured_at desc
),
ga_week as (
  select distinct on (period_start::date) period_start::date as week_of, payload
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'weekly_overview' and status in ('ok', 'partial') and period_start is not null
  order by period_start::date, captured_at desc
),
mrr as (
  select distinct on (date_trunc('week', period_start)::date) date_trunc('week', period_start)::date as week_of,
         nullif(payload ->> 'mrr_usd', '')::numeric as mrr
  from public.mpt_raw_metrics
  where source = 'revenue' and report = 'mrr' and status in ('ok', 'partial') and period_start is not null
  order by date_trunc('week', period_start)::date, period_start desc, captured_at desc
)
select
  weeks.week_of,
  (select count(*) from public.scans s where s.created_at < least(weeks.week_of + 7, current_date + 1))::bigint as cumulative_scans,
  (select count(*) from public.scans s
     where s.created_at >= weeks.week_of and s.created_at < weeks.week_of + 7)::bigint as weekly_new_scans,
  -- Scan-to-paid conversion has no stored history: only the current week is filled, from live users.
  case when weeks.week_of = date_trunc('week', current_date)::date
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
  'MPC-7376. One row per Monday-start UTC week. Notion tracker mapping: week_of=Week Of, cumulative_scans=Cumulative Scans, weekly_new_scans=Weekly New Scans, conversion_rate_pct=Conversion Rate %, current_mrr=Current MRR, ga4_active_users=GA4 Active Users, blog_posts_published=Blog Posts Published, x_threads_posted=X Threads Posted. cumulative_scans = rows in public.scans as of week end (or now) per D5. engagement_* and ga4_scan_events are separate signals. NULL = not collected. service_role only.';

revoke all on public.mpt_daily_metrics, public.mpt_weekly_metrics from public, anon, authenticated, service_role;
grant select on public.mpt_daily_metrics, public.mpt_weekly_metrics to service_role;
