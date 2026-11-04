-- MPC-8671: the KPI views read public.scan_hourly_counts, so purging public.scans leaves every KPI number unchanged.
-- supabase/tests/run.sh has already applied the views (supabase/sql chain + migration 20261028120000_mpc_8671_kpi_views_hourly_counter.sql) to the THROWAWAY database. Any failed assertion aborts.
\set ON_ERROR_STOP on

create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if not ok then raise exception 'FAIL: %', msg; end if; end $$;

-- 1. structural: neither view (nor anything under it) reads public.scans
select pg_temp.assert(not exists (
  select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
   where r.ev_class in ('public.mpt_daily_metrics'::regclass, 'public.mpt_weekly_metrics'::regclass)
     and d.refobjid = 'public.scans'::regclass), 'KPI views must not depend on public.scans');
select pg_temp.assert(exists (
  select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
   where r.ev_class = 'public.mpt_daily_metrics'::regclass and d.refobjid = 'public.scan_hourly_counts'::regclass), 'daily view reads scan_hourly_counts');

-- 2. five expired scans on known Hong Kong days (HK = UTC+8). 15:30Z Jan 1 is HK Jan 1 23:30; 16:30Z Jan 1 is HK Jan 2 00:30.
insert into public.users (id, email) values ('86710000-0000-0000-0000-000000000001', 'kpi8671@example.com');
insert into public.scans (id, user_id, email_scanned, created_at, expires_at) values
  ('86710000-0000-0000-0000-0000000000a1', '86710000-0000-0000-0000-000000000001', 'a@example.com', '2026-01-01 15:30:00+00', '2026-01-08 15:30:00+00'),
  ('86710000-0000-0000-0000-0000000000a2', '86710000-0000-0000-0000-000000000001', 'b@example.com', '2026-01-01 16:30:00+00', '2026-01-08 16:30:00+00'),
  ('86710000-0000-0000-0000-0000000000a3', '86710000-0000-0000-0000-000000000001', 'c@example.com', '2026-01-02 03:00:00+00', '2026-01-09 03:00:00+00'),
  ('86710000-0000-0000-0000-0000000000a4', '86710000-0000-0000-0000-000000000001', 'd@example.com', '2026-01-03 03:00:00+00', '2026-01-10 03:00:00+00'),
  ('86710000-0000-0000-0000-0000000000a5', '86710000-0000-0000-0000-000000000001', 'e@example.com', '2026-01-03 05:00:00+00', '2026-01-10 05:00:00+00');
select pg_temp.assert((select new_scans from public.mpt_daily_metrics where day = '2026-01-01') = 1, 'HK Jan 1 has 1 scan');
select pg_temp.assert((select new_scans from public.mpt_daily_metrics where day = '2026-01-02') = 2, 'HK Jan 2 has 2 scans');
select pg_temp.assert((select new_scans from public.mpt_daily_metrics where day = '2026-01-03') = 2, 'HK Jan 3 has 2 scans');
select pg_temp.assert((select cumulative_scans from public.mpt_daily_metrics where day = '2026-01-03') - (select cumulative_scans from public.mpt_daily_metrics where day = '2026-01-01') = 4, 'cumulative grows by 4 from Jan 1 to Jan 3');

-- 3. snapshot every KPI column the scans feed, purge, compare
create temp table daily0 as select day, cumulative_scans, new_scans from public.mpt_daily_metrics;
create temp table weekly0 as select week_of, cumulative_scans, weekly_new_scans, conversion_rate_pct from public.mpt_weekly_metrics;
create temp table scans0 as select count(*) as n from public.scans;
select pg_temp.assert((select count(*) from daily0) > 3 and (select count(*) from weekly0) > 0, 'snapshots are not empty');

select pg_temp.assert((public.mpt_purge_expired_scans(false)->>'deleted')::int >= 5, 'purge deleted the five expired test scans (and any other expired rows)');
select pg_temp.assert((select count(*) from public.scans) < (select n from scans0), 'public.scans shrank');
select pg_temp.assert(not exists (select 1 from public.scans where id::text like '86710000-%a%'), 'test scans are gone');

select pg_temp.assert(not exists (select * from daily0 except select day, cumulative_scans, new_scans from public.mpt_daily_metrics), 'daily KPIs unchanged by the purge (before minus after)');
select pg_temp.assert(not exists (select day, cumulative_scans, new_scans from public.mpt_daily_metrics except select * from daily0), 'daily KPIs unchanged by the purge (after minus before)');
select pg_temp.assert(not exists (select * from weekly0 except select week_of, cumulative_scans, weekly_new_scans, conversion_rate_pct from public.mpt_weekly_metrics), 'weekly KPIs unchanged by the purge (before minus after)');
select pg_temp.assert(not exists (select week_of, cumulative_scans, weekly_new_scans, conversion_rate_pct from public.mpt_weekly_metrics except select * from weekly0), 'weekly KPIs unchanged by the purge (after minus before)');
select pg_temp.assert((select new_scans from public.mpt_daily_metrics where day = '2026-01-02') = 2, 'HK Jan 2 still reports 2 scans after the purge');
select pg_temp.assert((select min(day) from public.mpt_daily_metrics) <= '2026-01-01', 'the day series still starts at the first scan day after the purge');
select 'mpc-8671 kpi views: all assertions passed';
