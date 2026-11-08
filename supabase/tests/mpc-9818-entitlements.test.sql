-- MPC-9818: assertions for the 20 entitlement rows, plan_scan_allowance, mpt_consume_scan (monthly window, idempotent, confirmed-email key), mpt_get_entitlements, mpt_set_plan.
-- SYNTHETIC identities only (example.test). Throwaway database only. Every check RAISES on failure (psql ON_ERROR_STOP=1) and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== the 20 entitlement rows, pinned exactly (a change to any of these is a decision, not a drive-by) =====
select pg_temp.assert((select count(*) from public.capability_min_tier) = 20, 'exactly 20 capability rows');
select pg_temp.assert((select string_agg(key || '=' || min_tier || '/' || coalesce(cost, '-') || '/' || status, ',' order by key) from public.capability_min_tier) =
  'action.managed_removal=executive/-/planned,action.removal_requests=pro/-/planned,alice.email_reply=basic/-/planned,breach.check=basic/third_party/planned,'
  'broker.licensed_lookup=basic/third_party/planned,broker.listing_check_pasted=free/none/live,family.seat_report=basic/-/planned,journey.memory=basic/-/planned,'
  'report.breach_section=basic/-/planned,report.broker_section_full=basic/-/planned,report.export_json=basic/-/planned,report.export_pdf=basic/-/planned,'
  'report.hexagon_guides=free/-/live,report.history_full=basic/-/live,report.optout_guides=free/-/live,report.score=free/-/live,scan.browser_hexagons=free/-/live,'
  'scan.email_checks=free/-/live,watch.alerts=pro/-/planned,watch.auto_monthly_rescan=pro/-/planned', 'the 20 rows match the Paid Exposure Report spec section 3');
select pg_temp.assert((select count(*) from public.capability_min_tier where min_tier = 'free') = 6 and (select count(*) from public.capability_min_tier where min_tier = 'basic') = 10
  and (select count(*) from public.capability_min_tier where min_tier = 'pro') = 3 and (select count(*) from public.capability_min_tier where min_tier = 'executive') = 1, '6 free / 10 basic / 3 pro / 1 executive');
select pg_temp.assert(not exists (select 1 from public.capability_min_tier where cost = 'third_party' and min_tier = 'free'), 'AT-9: every third_party-cost capability is above free');
select pg_temp.assert((select count(*) from public.capability_min_tier where cost = 'third_party') = 2, 'two third_party-cost rows (licensed broker lookup, breach check)');

-- ===== allowances: 1 / 5 / 25 / unlimited (NULL) =====
select pg_temp.assert((select string_agg(plan || '=' || coalesce(per_month::text, 'unlimited'), ',' order by public.mpt_tier_rank(plan)) from public.plan_scan_allowance) = 'free=1,basic=5,pro=25,executive=unlimited', 'allowances free 1, basic 5, pro 25, executive unlimited');
select pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.plan_scan_allowance') = '42501' and pg_temp.try_as('authenticated', 'select 1 from public.plan_scan_allowance') = '42501'
  and pg_temp.try_as('anon', 'select 1 from public.scan_consumption') = '42501' and pg_temp.try_as('authenticated', 'select 1 from public.scan_consumption') = '42501'
  and pg_temp.try_as('anon', 'select 1 from public.account_plan_log') = '42501' and pg_temp.try_as('authenticated', 'select 1 from public.account_plan_log') = '42501', 'anon and authenticated cannot read allowance, counter or plan log');
select pg_temp.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.plan_scan_allowance'::regclass, 'public.scan_consumption'::regclass, 'public.account_plan_log'::regclass)), 'RLS enabled and forced on the three new tables');
select pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0001', 'a@example.test')$q$) = '42501'
  and pg_temp.try_as('authenticated', $q$select public.mpt_set_plan('00000000-0000-0000-0000-0000000a0001', 'pro', 'test')$q$) = '42501'
  and pg_temp.try_as('anon', $q$select public.mpt_get_entitlements(null, 'a@example.test')$q$) = '42501', 'the functions are service_role only (a signed-in user cannot grant themselves a plan)');
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('plan_scan_allowance', 'scan_consumption', 'account_plan_log')
  and (column_name ~* '(^|_)ip(_|$)' or column_name ~* 'ip_?address' or column_name ~* 'email$' or udt_name = 'inet')), 'no IP column and no email column on the new tables (the counter keys on a hash)');

-- ===== Free by confirmed email: the first scan counts, the second is refused, with the upgrade path =====
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0001', 'Free.Person@example.test', false)->>'allowed')::boolean, 'free: first scan of the month is allowed (counts for 24h while unconfirmed)');
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0001', 'free.person@example.test', false)->>'already')::boolean, 'idempotent on the scan number: a retry does not count twice');
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0001', 'free.person@example.test', false)->>'used')::int = 1, 'a retry still reports 1 used');
select pg_temp.assert(not (public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0002', 'free.person@example.test', false)->>'allowed')::boolean, 'free: the second scan in the month is refused (case-insensitive email)');
select pg_temp.assert(public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0002', 'free.person@example.test', false)->'upgrade'->>'plan' = 'basic'
  and (public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0002', 'free.person@example.test', false)->'upgrade'->>'per_month')::int = 5, 'the refusal carries the upgrade path: Basic, 5 a month (read from data)');
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0002', 'free.person@example.test', false)->>'resets_at')::timestamptz > now()
  and (public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0002', 'free.person@example.test', false)->>'resets_at')::timestamptz <= now() + interval '32 days', 'the refusal says when the allowance resets (start of next month UTC)');
select pg_temp.assert(not exists (select 1 from public.scan_consumption where scan_id = '00000000-0000-0000-0000-0000000e0002'), 'a refusal inserts nothing');
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0003', 'someone.else@example.test', false)->>'allowed')::boolean, 'another address has its own allowance');

-- ===== typing someone else's address cannot use up their month: an unconfirmed scan stops counting after 24 hours =====
update public.scan_consumption set consumed_at = now() - interval '25 hours' where scan_id = '00000000-0000-0000-0000-0000000e0001';
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0004', 'free.person@example.test', false)->>'allowed')::boolean, 'an unconfirmed scan older than 24h no longer counts');
select pg_temp.assert(public.mpt_confirm_scan_consumption('00000000-0000-0000-0000-0000000e0004') and public.mpt_confirm_scan_consumption('00000000-0000-0000-0000-0000000e0004'), 'confirming is idempotent');
select pg_temp.assert(not public.mpt_confirm_scan_consumption('00000000-0000-0000-0000-0000000eeeee'), 'confirming an unknown scan reports false');
select pg_temp.assert(not (public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0005', 'free.person@example.test', false)->>'allowed')::boolean, 'a confirmed scan counts for the whole month');

-- ===== the monthly window: last month does not count =====
update public.scan_consumption set period_start = (public.mpt_scan_period() - interval '1 month')::date, consumed_at = now() - interval '40 days' where scan_id = '00000000-0000-0000-0000-0000000e0004';
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0006', 'free.person@example.test', true)->>'allowed')::boolean, 'a scan counted last month leaves the new month free again');
select pg_temp.assert(not (public.mpt_consume_scan('00000000-0000-0000-0000-0000000e0007', 'free.person@example.test', true)->>'allowed')::boolean, 'and one is again the limit this month');

-- ===== all four tiers, by account =====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000a0001', 'basic.person@example.test'), ('00000000-0000-0000-0000-0000000a0002', 'pro.person@example.test'),
  ('00000000-0000-0000-0000-0000000a0003', 'exec.person@example.test'), ('00000000-0000-0000-0000-0000000a0004', 'free.account@example.test');
select public.mpt_ensure_account('00000000-0000-0000-0000-0000000a0001', 'basic.person@example.test', null);
select public.mpt_ensure_account('00000000-0000-0000-0000-0000000a0002', 'pro.person@example.test', null);
select public.mpt_ensure_account('00000000-0000-0000-0000-0000000a0003', 'exec.person@example.test', null);
select public.mpt_ensure_account('00000000-0000-0000-0000-0000000a0004', 'free.account@example.test', null);
select pg_temp.assert((public.mpt_set_plan('00000000-0000-0000-0000-0000000a0001', 'basic', 'test grant')->>'changed')::boolean, 'set_plan: free -> basic');
select pg_temp.assert(not (public.mpt_set_plan('00000000-0000-0000-0000-0000000a0001', 'basic', 'test grant')->>'changed')::boolean, 'set_plan: setting the same plan changes nothing (idempotent)');
select public.mpt_set_plan('00000000-0000-0000-0000-0000000a0002', 'pro', 'test grant');
select public.mpt_set_plan('00000000-0000-0000-0000-0000000a0003', 'executive', 'test grant');
select pg_temp.assert((select count(*) from public.account_plan_log) = 3, 'every real plan change is logged (3 changes, the no-op is not)');
select pg_temp.assert(pg_temp.try_as('service_role', $q$select public.mpt_set_plan('00000000-0000-0000-0000-0000000a0001', 'platinum', 'test')$q$) = '22023', 'set_plan: unknown plan rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $q$select public.mpt_set_plan('00000000-0000-0000-0000-0000000a0001', 'pro', '')$q$) = '22023', 'set_plan: a reason is required');
select pg_temp.assert(public.mpt_set_plan('00000000-0000-0000-0000-0000000eeeee', 'pro', 'test')->>'reason' = 'no_account', 'set_plan: no such account changes nothing');

do $$
declare i int; r jsonb;
begin
  -- Basic: 5 allowed, the 6th refused, upgrade path Pro 25
  for i in 1..5 loop
    r := public.mpt_consume_scan(('00000000-0000-0000-0000-0000000b000' || i)::uuid, 'basic.person@example.test', true);
    perform pg_temp.assert((r->>'allowed')::boolean and (r->>'remaining')::int = 5 - i and r->>'plan' = 'basic', 'basic scan ' || i || ' allowed, remaining ' || (5 - i));
  end loop;
  r := public.mpt_consume_scan('00000000-0000-0000-0000-0000000b0006', 'basic.person@example.test', true);
  perform pg_temp.assert(not (r->>'allowed')::boolean and r->'upgrade'->>'plan' = 'pro' and (r->'upgrade'->>'per_month')::int = 25, 'basic: the 6th scan is refused with Pro (25) as the upgrade');
  -- Pro: 25 allowed, the 26th refused, upgrade path Executive unlimited
  for i in 1..25 loop
    r := public.mpt_consume_scan(('00000000-0000-0000-0000-0000000c' || lpad(i::text, 4, '0'))::uuid, 'pro.person@example.test', true);
    perform pg_temp.assert((r->>'allowed')::boolean and r->>'plan' = 'pro', 'pro scan ' || i || ' allowed');
  end loop;
  r := public.mpt_consume_scan('00000000-0000-0000-0000-0000000c0026', 'pro.person@example.test', true);
  perform pg_temp.assert(not (r->>'allowed')::boolean and (r->'upgrade'->>'unlimited')::boolean, 'pro: the 26th scan is refused; Executive is unlimited');
  -- Executive: unlimited, never refused, remaining is null (no cap)
  for i in 1..60 loop
    r := public.mpt_consume_scan(('00000000-0000-0000-0000-0000000d' || lpad(i::text, 4, '0'))::uuid, 'exec.person@example.test', true);
    perform pg_temp.assert((r->>'allowed')::boolean and r->'remaining' = 'null'::jsonb and r->>'limit' is null, 'executive scan ' || i || ' allowed with no cap');
  end loop;
  -- Free account (has an account, plan free): 1 then refused
  r := public.mpt_consume_scan('00000000-0000-0000-0000-0000000f0001', 'free.account@example.test', true);
  perform pg_temp.assert((r->>'allowed')::boolean and r->>'plan' = 'free', 'free account: first scan allowed');
  r := public.mpt_consume_scan('00000000-0000-0000-0000-0000000f0002', 'free.account@example.test', true);
  perform pg_temp.assert(not (r->>'allowed')::boolean, 'free account: second scan refused');
end $$;

-- ===== the service-role bump: a refused Free account is allowed once it is Basic (the live check does this over HTTP) =====
select public.mpt_set_plan('00000000-0000-0000-0000-0000000a0004', 'basic', 'test bump');
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000f0003', 'free.account@example.test', true)->>'allowed')::boolean, 'after the service-role bump to Basic the same email can scan again (1 used of 5)');
select pg_temp.assert((public.mpt_consume_scan('00000000-0000-0000-0000-0000000f0003', 'free.account@example.test', true)->>'remaining')::int = 3, 'after the bump: Basic limit 5, two used this month (the free one and the new one), 3 left');
select pg_temp.assert((public.mpt_get_entitlements('00000000-0000-0000-0000-0000000a0004', null)->'scans'->>'used')::int = 2, 'entitlements count the earlier free scan and the new one this month');

-- ===== mpt_get_entitlements: capabilities per tier =====
select pg_temp.assert((public.mpt_get_entitlements(null, 'nobody@example.test')->>'tier') = 'free' and not (public.mpt_get_entitlements(null, 'nobody@example.test')->>'has_account')::boolean, 'no account: Free');
select pg_temp.assert((public.mpt_get_entitlements(null, 'nobody@example.test')->'capabilities'->>'report.score')::boolean and not (public.mpt_get_entitlements(null, 'nobody@example.test')->'capabilities'->>'report.broker_section_full')::boolean, 'Free sees free capabilities, not the paid broker section');
select pg_temp.assert(public.mpt_get_entitlements(null, 'nobody@example.test')->'limits'->'scan.per_month' = '1'::jsonb, 'limits carry scan.per_month = 1 for Free');
select pg_temp.assert(public.mpt_get_entitlements(null, 'exec.person@example.test')->'limits'->'scan.per_month' = 'null'::jsonb and (public.mpt_get_entitlements(null, 'exec.person@example.test')->'scans'->>'unlimited')::boolean, 'Executive limit is null = unlimited');
select pg_temp.assert((select bool_and(v::boolean) from jsonb_each_text(public.mpt_get_entitlements('00000000-0000-0000-0000-0000000a0003', null)->'capabilities') t(k, v)), 'Executive has every capability');
select pg_temp.assert((select count(*) from jsonb_each_text(public.mpt_get_entitlements('00000000-0000-0000-0000-0000000a0002', null)->'capabilities') t(k, v) where v::boolean) = 19, 'Pro has 19 of 20 (not managed removal)');
select pg_temp.assert((select count(*) from jsonb_each_text(public.mpt_get_entitlements('00000000-0000-0000-0000-0000000a0001', null)->'capabilities') t(k, v) where v::boolean) = 16, 'Basic has 16 of 20 (not the 3 Pro rows or managed removal)');
select pg_temp.assert((public.mpt_can('00000000-0000-0000-0000-0000000a0001', 'report.export_pdf')->>'allowed')::boolean and not (public.mpt_can('00000000-0000-0000-0000-0000000a0001', 'watch.alerts')->>'allowed')::boolean, 'can(): Basic has the export, not Pro alerts');

-- ===== changing a threshold is a data change (AT-8) =====
update public.capability_min_tier set min_tier = 'pro' where key = 'breach.check';
select pg_temp.assert(not (public.mpt_can('00000000-0000-0000-0000-0000000a0001', 'breach.check')->>'allowed')::boolean, 'AT-8: breach.check moved to pro in data: Basic loses it with no code change');

rollback;
select 'mpc-9818 entitlements and scan allowances: all assertions passed';
