-- Test-mailbox scans stay out of the scan KPIs, the raw counter keeps every scan, and history is reclassified only on evidence.
-- Runs after supabase/tests/run.sh has applied migration 20261127060000 to the THROWAWAY database. Everything here is rolled back.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;

select pg_temp.assert(public.mpt_is_test_address('testingnt69@gmail.com') and public.mpt_is_test_address('  TestingNT69+nightly-20261127@Gmail.com ')
  and not public.mpt_is_test_address('testingnt69@example.com') and not public.mpt_is_test_address('xtestingnt69+a@gmail.com')
  and not public.mpt_is_test_address('testingnt69+a@gmail.com.evil.io') and not public.mpt_is_test_address('testingnt69+a@gmailxcom') and not public.mpt_is_test_address(null), 'test address rule');

-- 1. new scans: two test, one not, on one Hong Kong day far from any other test data
insert into public.users (id, email) values ('11491000-0000-4000-8000-000000000001', 'kpi-excl@example.com');
insert into public.scans (user_id, email_scanned, created_at) values
  ('11491000-0000-4000-8000-000000000001', 'testingnt69+a@gmail.com', '2026-03-02 03:00:00+00'),
  ('11491000-0000-4000-8000-000000000001', 'testingnt69+b@gmail.com', '2026-03-02 03:20:00+00'),
  ('11491000-0000-4000-8000-000000000001', 'person@example.com',      '2026-03-02 03:40:00+00');
select pg_temp.assert((select scans_created = 3 and test_scans = 2 from public.scan_hourly_counts where "hour" = '2026-03-02 03:00:00+00'), 'raw count keeps all 3, 2 marked test');
select pg_temp.assert((select new_scans from public.mpt_daily_metrics where day = '2026-03-02') = 1, 'daily new_scans leaves test scans out');
select pg_temp.assert((select cumulative_scans + test_scans_excluded from public.mpt_daily_metrics where day = '2026-03-02')
  = (select sum(scans_created) from public.scan_hourly_counts where "hour" < public.mpt_hk_ts(date '2026-03-03')), 'headline plus excluded rebuilds the old number');
select pg_temp.assert((select weekly_new_scans from public.mpt_weekly_metrics where week_of = '2026-03-02') = 1, 'weekly_new_scans leaves test scans out');

-- 2. history: hours counted before the column existed, with different evidence
insert into public.scan_hourly_counts ("hour", scans_created) values
  ('2026-04-06 01:00:00+00', 2),   -- two test emails: both reclassified
  ('2026-04-06 02:00:00+00', 3),   -- one test email: one reclassified, two stay counted
  ('2026-04-06 03:00:00+00', 1),   -- only a real email: stays counted
  ('2026-04-06 04:00:00+00', 1),   -- no evidence: stays counted
  ('2026-04-06 05:00:00+00', 1);   -- more test emails than scans: capped
insert into public.email_sends (provider_message_id, email_type, is_test, sent_at) values
  ('x-1', 'confirm', true, '2026-04-06 01:05:00+00'), ('x-2', 'confirm', true, '2026-04-06 01:06:00+00'),
  ('x-3', 'confirm', true, '2026-04-06 02:05:00+00'), ('x-4', 'report', true, '2026-04-06 02:06:00+00'),
  ('x-5', 'confirm', false, '2026-04-06 03:05:00+00'),
  ('x-6', 'confirm', true, '2026-04-06 05:05:00+00'), ('x-7', 'confirm', true, '2026-04-06 05:06:00+00');
\i supabase/migrations/20261127060000_exclude_test_scans_from_kpi.sql
select pg_temp.assert((select array_agg(test_scans order by "hour") from public.scan_hourly_counts where "hour" >= '2026-04-06 00:00+00' and "hour" < '2026-04-07 00:00+00') = array[2,1,0,0,1]::bigint[], 'history reclassified only on evidence, capped');
select pg_temp.assert((select sum(scans_created) from public.scan_hourly_counts where "hour" >= '2026-04-06 00:00+00' and "hour" < '2026-04-07 00:00+00') = 8, 'raw history unchanged');
select pg_temp.assert((select test_scans from public.scan_hourly_counts where "hour" = '2026-03-02 03:00:00+00') = 2, 're-running never double counts');

-- 3. access unchanged
select pg_temp.assert(not has_function_privilege('anon', 'public.mpt_is_test_address(text)', 'execute') and not has_table_privilege('anon', 'public.mpt_weekly_metrics', 'select')
  and not has_table_privilege('authenticated', 'public.mpt_daily_metrics', 'select') and has_table_privilege('service_role', 'public.mpt_weekly_metrics', 'select'), 'grants');
set local role service_role;
select count(*) > 0 as service_role_reads_weekly_view from public.mpt_weekly_metrics;   -- a missing grant stops the run here
reset role;
select 'exclude test scans: all assertions passed';
rollback;
