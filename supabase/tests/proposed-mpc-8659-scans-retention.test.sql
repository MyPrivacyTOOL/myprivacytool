-- MPC-8659: assertions for the PROPOSED scans retention migration (supabase/proposed/20261027150000_mpc_8659_scans_retention.sql).
-- supabase/tests/run.sh has already applied it to the THROWAWAY database; this re-applies it once to prove it is idempotent. Any failed assertion aborts.
\set ON_ERROR_STOP on
\i supabase/proposed/20261027150000_mpc_8659_scans_retention.sql

create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if not ok then raise exception 'FAIL: %', msg; end if; end $$;

insert into public.users (id, email) values ('88590000-0000-0000-0000-000000000001', 'retention@example.com');

-- 1. new rows get a 7-day expiry, and every insert is counted
create temp table c0 as select coalesce(sum(scans_created), 0) as n from public.scan_hourly_counts;
insert into public.scans (id, user_id, email_scanned) values ('88590000-0000-0000-0000-0000000000a1', '88590000-0000-0000-0000-000000000001', 'retention@example.com');
select pg_temp.assert((select expires_at - created_at from public.scans where id = '88590000-0000-0000-0000-0000000000a1') between interval '6 days 23 hours' and interval '7 days 1 hour', 'new scan expires in 7 days');
select pg_temp.assert((select coalesce(sum(scans_created), 0) from public.scan_hourly_counts) = (select n from c0) + 1, 'counter went up by one for one insert');

-- 2. an expired scan with no open removal task is purged; the counter keeps its count
insert into public.scans (id, user_id, email_scanned, expires_at) values ('88590000-0000-0000-0000-0000000000b1', '88590000-0000-0000-0000-000000000001', 'old@example.com', now() - interval '1 day');
insert into public.scans (id, user_id, email_scanned, expires_at) values ('88590000-0000-0000-0000-0000000000b2', '88590000-0000-0000-0000-000000000001', 'held@example.com', now() - interval '1 day');
insert into public.signals (id, scan_id, category, signal_type, severity, data_source) values ('88590000-0000-0000-0000-0000000000c2', '88590000-0000-0000-0000-0000000000b2', 'broker', 't', 'low', 'x');
insert into public.removal_tasks (user_id, signal_id, broker_name, status) values ('88590000-0000-0000-0000-000000000001', '88590000-0000-0000-0000-0000000000c2', 'b', 'in_progress');
create temp table before_counts as select coalesce(sum(scans_created), 0) as n from public.scan_hourly_counts;

-- dry run deletes nothing
select pg_temp.assert((public.mpt_purge_expired_scans(true)->>'deleted')::int = 0, 'dry run deletes nothing');
select pg_temp.assert((select count(*) from public.scans where user_id = '88590000-0000-0000-0000-000000000001') = 3, 'dry run leaves all rows');
select pg_temp.assert((public.mpt_purge_expired_scans(true)->>'held_for_open_removals')::int >= 1, 'dry run reports the held scan');

-- real run: only the scan without an open removal task goes
select pg_temp.assert((public.mpt_purge_expired_scans(false)->>'deleted')::int >= 1, 'purge deletes the expired scan without open removals');
select pg_temp.assert(not exists (select 1 from public.scans where id = '88590000-0000-0000-0000-0000000000b1'), 'expired scan gone');
select pg_temp.assert(exists (select 1 from public.scans where id = '88590000-0000-0000-0000-0000000000b2'), 'scan with an open removal task is kept');
select pg_temp.assert(exists (select 1 from public.scans where id = '88590000-0000-0000-0000-0000000000a1'), 'unexpired scan is kept');
select pg_temp.assert((select coalesce(sum(scans_created), 0) from public.scan_hourly_counts) = (select n from before_counts), 'counter unchanged by the purge');

-- 3. an open removal task holds the scan with NO time limit (owner decision: never delete); completing the task releases it
update public.scans set expires_at = now() - interval '400 days' where id = '88590000-0000-0000-0000-0000000000b2';
select public.mpt_purge_expired_scans(false);
select pg_temp.assert(exists (select 1 from public.scans where id = '88590000-0000-0000-0000-0000000000b2'), 'scan expired 400 days ago is still kept while its removal task is open');
update public.removal_tasks set status = 'completed', completed_at = now() where signal_id = '88590000-0000-0000-0000-0000000000c2';
select pg_temp.assert((public.mpt_purge_expired_scans(false)->>'deleted')::int >= 1, 'scan is purged once its removal task is completed');
select pg_temp.assert(not exists (select 1 from public.scans where id = '88590000-0000-0000-0000-0000000000b2'), 'held scan gone after the task completed');
select pg_temp.assert(not exists (select 1 from public.signals where id = '88590000-0000-0000-0000-0000000000c2'), 'signals cascade with the scan');
select pg_temp.assert(not exists (select 1 from public.removal_tasks where signal_id = '88590000-0000-0000-0000-0000000000c2'), 'removal task cascades with the scan');

-- 4. access: anon and authenticated can neither read the counter nor run the purge
set role anon;
do $$ begin begin perform 1 from public.scan_hourly_counts; raise exception 'FAIL: anon read counter'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform public.mpt_purge_expired_scans(true); raise exception 'FAIL: anon ran purge'; exception when insufficient_privilege then null; end; end $$;
reset role; set role authenticated;
do $$ begin begin perform public.mpt_purge_expired_scans(true); raise exception 'FAIL: authenticated ran purge'; exception when insufficient_privilege then null; end; end $$;
reset role; set role service_role;
select pg_temp.assert(public.mpt_purge_expired_scans(true) ? 'due', 'service_role can run the dry run');
reset role;
select 'mpc-8659 scans retention: all assertions passed';
