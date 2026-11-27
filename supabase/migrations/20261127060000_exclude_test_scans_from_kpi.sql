-- MPT test scans out of the scan KPIs (follow-up to CK-11491). shared/test-records.js says test records never count in KPIs, but the hourly counter
-- (MPC-8659) added 1 for EVERY new public.scans row, so the daily test runs were counted in Cumulative Scans, new scans, the pace gap and the
-- conversion-rate denominator.
--
--   scan_hourly_counts.scans_created  UNCHANGED: still every scan, so every number shown before this can be rebuilt.
--   scan_hourly_counts.test_scans     NEW: how many of that hour's scans were the test mailbox.
--   KPI views                         count scans_created - test_scans, and append test_scans_excluded (running total) as their last column.
--
-- History: marked as test ONLY on direct evidence in the same hour: a logged test confirmation email (public.email_sends, one per scan) or a
-- surviving test row in public.scans. The counter holds no address, so this is a match by hour, not by scan. Hours with no evidence either way stay
-- counted: the corrected figure is therefore an UPPER BOUND on non-test scans. "Non-test" means "not the test mailbox", not "a proven customer".
-- The email log starts 2026-10-29 HKT, so almost nothing before it can be reclassified.
--
-- These view definitions supersede 20261028120001 and the older restatements in supabase/sql/. Idempotent; runs in one transaction.
-- To go back to counting everything: re-create the views with sum(scans_created); the raw counts are untouched.

create or replace function public.mpt_is_test_address(p_email text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  -- The SQL copy of isTestAddress() in shared/test-records.js; a test keeps the two in step.
  select coalesce(btrim(p_email) ~* '^testingnt69(\+[a-z0-9._-]{1,60})?@gmail\.com$', false);
$$;
revoke all on function public.mpt_is_test_address(text) from public, anon, authenticated;
grant execute on function public.mpt_is_test_address(text) to service_role;

alter table public.scan_hourly_counts add column if not exists test_scans bigint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scan_hourly_counts_test_scans_range' and conrelid = 'public.scan_hourly_counts'::regclass) then
    alter table public.scan_hourly_counts add constraint scan_hourly_counts_test_scans_range check (test_scans >= 0 and test_scans <= scans_created);
  end if;
end $$;
comment on column public.scan_hourly_counts.test_scans is 'Of scans_created, how many were the test mailbox. KPI views subtract it. History before this column: only where the email log or a surviving row proves it.';

-- The existing trigger keeps calling this function; only its body changes.
create or replace function public.mpt_count_scan_hourly() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.scan_hourly_counts (hour, scans_created, test_scans)
  values (date_trunc('hour', new.created_at), 1, case when public.mpt_is_test_address(new.email_scanned) then 1 else 0 end)
  on conflict (hour) do update set scans_created = public.scan_hourly_counts.scans_created + 1,
                                   test_scans = public.scan_hourly_counts.test_scans + excluded.test_scans;
  return new;
end $$;
revoke all on function public.mpt_count_scan_hourly() from public, anon, authenticated;

-- History. greatest(), not a sum: the email and the row may be the same scan. Never above the hour's own count, never lowers a count already there.
with mail as (
  select date_trunc('hour', sent_at) as hr, count(*) as n from public.email_sends where email_type = 'confirm' and is_test group by 1
),
kept as (
  select date_trunc('hour', created_at) as hr, count(*) as n from public.scans where public.mpt_is_test_address(email_scanned) group by 1
),
proof as (
  select c.hour as hr, least(c.scans_created, greatest(coalesce(mail.n, 0), coalesce(kept.n, 0))) as n
  from public.scan_hourly_counts c
  left join mail on mail.hr = c.hour
  left join kept on kept.hr = c.hour
)
update public.scan_hourly_counts h set test_scans = proof.n from proof where h.hour = proof.hr and proof.n > h.test_scans;

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
scan_n as (select public.mpt_hk_date(hour) as day, sum(scans_created - test_scans) n from public.scan_hourly_counts group by 1),
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
  (select coalesce(sum(h.scans_created - h.test_scans), 0) from public.scan_hourly_counts h where h.hour < public.mpt_hk_ts(days.day + 1))::bigint as cumulative_scans,
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
  cf.cloudflare_threats_blocked,
  (select coalesce(sum(h.test_scans), 0) from public.scan_hourly_counts h where h.hour < public.mpt_hk_ts(days.day + 1))::bigint as test_scans_excluded
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
  select count(*) filter (where payment_status = 'active' and tier <> 'free' and not public.mpt_is_test_address(email)) as paid_users from public.users
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
  (select coalesce(sum(h.scans_created - h.test_scans), 0) from public.scan_hourly_counts h where h.hour < least(public.mpt_hk_ts(weeks.week_of + 7), public.mpt_hk_ts(public.mpt_hk_date(now()) + 1)))::bigint as cumulative_scans,
  (select coalesce(sum(h.scans_created - h.test_scans), 0) from public.scan_hourly_counts h
     where h.hour >= public.mpt_hk_ts(weeks.week_of) and h.hour < public.mpt_hk_ts(weeks.week_of + 7))::bigint as weekly_new_scans,
  -- Scan-to-paid conversion has no stored history: only the current week is filled, from live users.
  case when weeks.week_of = date_trunc('week', public.mpt_hk_date(now())::timestamp)::date
        and (select coalesce(sum(scans_created - test_scans), 0) from public.scan_hourly_counts) > 0
       then round(100.0 * paid.paid_users / (select sum(scans_created - test_scans) from public.scan_hourly_counts), 2) end as conversion_rate_pct,
  mrr.mrr as current_mrr,
  public.mpt_ga4_metric(ga_week.payload, 'activeUsers') as ga4_active_users,
  blog.n as blog_posts_published,
  xt.n as x_threads_posted,
  (select coalesce(sum(d.engagement_sessions), 0) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7)::bigint as engagement_sessions,
  (select coalesce(sum(d.engagement_full_scans), 0) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7)::bigint as engagement_full_scans,
  (select sum(d.ga4_scan_events) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7) as ga4_scan_events,
  (select coalesce(sum(h.test_scans), 0) from public.scan_hourly_counts h where h.hour < least(public.mpt_hk_ts(weeks.week_of + 7), public.mpt_hk_ts(public.mpt_hk_date(now()) + 1)))::bigint as test_scans_excluded
from weeks
cross join paid
left join mrr on mrr.week_of = weeks.week_of
left join ga_week on ga_week.week_of = weeks.week_of
left join latest_week_count blog on blog.source = 'blog' and blog.week_of = weeks.week_of
left join latest_week_count xt on xt.source = 'x' and xt.week_of = weeks.week_of;

comment on view public.mpt_weekly_metrics is
  'One row per Monday-start Hong Kong week. Notion tracker mapping: week_of=Week Of, cumulative_scans=Cumulative Scans, weekly_new_scans=Weekly New Scans, conversion_rate_pct=Conversion Rate %, current_mrr=Current MRR, ga4_active_users=GA4 Active Users, blog_posts_published=Blog Posts Published, x_threads_posted=X Threads Posted. Scan figures leave out test-mailbox scans (test_scans_excluded = how many, to week end); scans with no evidence either way are counted. engagement_* and ga4_scan_events are separate signals. NULL = not collected. service_role only.';

revoke all on public.mpt_daily_metrics, public.mpt_weekly_metrics from public, anon, authenticated, service_role;
grant select on public.mpt_daily_metrics, public.mpt_weekly_metrics to service_role;
