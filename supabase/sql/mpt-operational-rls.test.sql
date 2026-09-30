-- MPC-6956 isolation test. Runs in one transaction and rolls back; expected results in the labels.
-- Run 2026-09-30 against xmdmkumwxpgahmlweuug: all 10 rows matched expectation.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rls-a@test.invalid'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rls-b@test.invalid');
set local role service_role;
insert into public.mpt_osint_scan_results (session_id,user_id,platform,user_handle) values
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000000a','x','a1'),
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000000b','x','b1');
insert into public.mpt_osint_scan_results (session_id,user_id,platform,user_handle,expires_at) values
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000000a','x','a-expired', now()-interval '1 hour');
insert into public.mpt_user_engagement (session_id,user_id) values
 (gen_random_uuid(),'00000000-0000-0000-0000-00000000000a'),(gen_random_uuid(),'00000000-0000-0000-0000-00000000000b');
insert into public.mpt_api_rate_limits (platform,endpoint,call_limit) values ('x','/e',100);
insert into public.mpt_channel_metrics (platform,metric_date) values ('x',current_date);
create temp table res(test text, result text);
grant all on res to public;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
insert into res select 'A sees own unexpired scans (expect 1)', count(*)::text from public.mpt_osint_scan_results;
insert into res select 'A sees own engagement (expect 1)', count(*)::text from public.mpt_user_engagement;
insert into res select 'A other-user rows visible (expect 0)', count(*)::text from public.mpt_osint_scan_results where user_id='00000000-0000-0000-0000-00000000000b';
do $$ begin perform 1 from public.mpt_api_rate_limits; exception when insufficient_privilege then insert into res values ('A rate_limits blocked (expect denied)','denied'); end $$;
do $$ begin perform 1 from public.mpt_channel_metrics; exception when insufficient_privilege then insert into res values ('A channel_metrics blocked (expect denied)','denied'); end $$;
do $$ begin insert into public.mpt_osint_scan_results(session_id,user_id,platform,user_handle) values (gen_random_uuid(),'00000000-0000-0000-0000-00000000000a','x','forge'); exception when insufficient_privilege then insert into res values ('A direct insert blocked (expect denied)','denied'); end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
insert into res select 'B sees own scans (expect 1)', count(*)::text from public.mpt_osint_scan_results;
insert into res select 'B sees A rows (expect 0)', count(*)::text from public.mpt_osint_scan_results where user_id='00000000-0000-0000-0000-00000000000a';

reset role;
set local role anon;
do $$ begin perform 1 from public.mpt_osint_scan_results; exception when insufficient_privilege then insert into res values ('anon scans blocked (expect denied)','denied'); end $$;
do $$ begin perform 1 from public.mpt_user_engagement; exception when insufficient_privilege then insert into res values ('anon engagement blocked (expect denied)','denied'); end $$;
reset role;
select * from res;
rollback;
