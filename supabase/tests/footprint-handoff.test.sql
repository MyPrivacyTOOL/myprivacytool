-- MPC-8689: assertions for hexagon_catalogue (migration 20261028180000) and the footprint handoff scope (20261028190000). Throwaway database only.
-- Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== hexagon_catalogue: 366 rows, approved risk split, read-only for clients =====
do $$
begin
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue) = 366, '366 rows');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue where risk = 'high') = 90, '90 high');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue where risk = 'medium') = 208, '208 medium');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue where risk = 'low') = 68, '68 low');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue where status = 'defined') = 91, '91 defined');
  perform pg_temp.assert((select count(distinct channel) from public.hexagon_catalogue) = 26, '26 channels');
  perform pg_temp.assert((select count(distinct slug) from public.hexagon_catalogue) = 366, 'slugs unique');
  perform pg_temp.assert((select relrowsecurity from pg_class where oid = 'public.hexagon_catalogue'::regclass), 'RLS enabled');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.hexagon_catalogue') = '', 'anon can select');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.hexagon_catalogue') = '', 'authenticated can select');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$insert into public.hexagon_catalogue (id, slug, channel, channel_group, code, arrival, risk, label, status) values ('t1', 't1', 'web', 'Core', 'WEB', 'A', 'low', 't', 'new')$q$) = '42501', 'anon insert denied');
  perform pg_temp.assert(pg_temp.try_as('authenticated', $q$insert into public.hexagon_catalogue (id, slug, channel, channel_group, code, arrival, risk, label, status) values ('t2', 't2', 'web', 'Core', 'WEB', 'A', 'low', 't', 'new')$q$) = '42501', 'authenticated insert denied');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$update public.hexagon_catalogue set label = 'x'$q$) = '42501', 'anon update denied');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$delete from public.hexagon_catalogue$q$) = '42501', 'anon delete denied');
end $$;
do $$
declare code text := '';
begin
  begin update public.hexagon_catalogue set risk = 'bad' where id = 'location'; exception when check_violation then code := 'ck'; end;
  perform pg_temp.assert(code = 'ck', 'risk check constraint rejects an unknown tier');
end $$;

-- ===== footprint scope =====
insert into public.profile_snapshots (id, sender_id, update_id, status, scan_version, risk_version, consent, get_chat, photos, expires_at)
values ('00000000-0000-0000-0000-0000000000f1', '444', 1, 'complete', 'telegram-baseline-1', 'risk-count-1', '{}', '{}', '{}', now() + interval '90 days');
insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at) values
  (repeat('1',64), '444', '00000000-0000-0000-0000-0000000000f1', now() + interval '15 minutes');                 -- no scope given: must default to dashboard
insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at, scope) values
  (repeat('2',64), '444', '00000000-0000-0000-0000-0000000000f1', now() + interval '15 minutes', 'footprint'),
  (repeat('3',64), '444', '00000000-0000-0000-0000-0000000000f1', now() + interval '15 minutes', 'footprint');

do $$
begin
  perform pg_temp.assert((select scope from public.dashboard_links where token_hash = repeat('1',64)) = 'dashboard', 'link scope defaults to dashboard');
  perform pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('1',64), repeat('a',64), 30) is true, 'the 3-argument dashboard call still redeems a dashboard link');
  perform pg_temp.assert((select scope from public.dashboard_sessions where session_hash = repeat('a',64)) = 'dashboard', 'dashboard session has dashboard scope');
  perform pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('2',64), repeat('b',64), 30) is false, 'a footprint link does not redeem as a dashboard link');
  perform pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('2',64), repeat('b',64), 30, 'footprint') is true, 'a footprint link redeems under footprint scope');
  perform pg_temp.assert((select scope from public.dashboard_sessions where session_hash = repeat('b',64)) = 'footprint', 'footprint session has footprint scope');
  perform pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('2',64), repeat('c',64), 30, 'footprint') is false, 'a footprint link is single use');
  perform pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('3',64), repeat('d',64), 30, 'dashboard') is false, 'a footprint link does not redeem as dashboard (explicit)');
  perform pg_temp.assert(pg_temp.try_as('postgres', $q$select public.mpt_redeem_dashboard_link(repeat('3',64), repeat('e',64), 30, 'admin')$q$) = 'P0001', 'unknown scope raises');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select public.mpt_redeem_dashboard_link(repeat('3',64), repeat('e',64), 30, 'footprint')$q$) = '42501', 'redeem (4 args) not callable by anon');
  perform pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_redeem_dashboard_link(repeat('3',64), repeat('e',64), 30, 'footprint')$q$) = '42501', 'redeem (4 args) not callable by authenticated');
end $$;
do $$
declare code text := '';
begin
  begin insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at, scope) values (repeat('9',64), '444', '00000000-0000-0000-0000-0000000000f1', now() + interval '5 minutes', 'root'); exception when check_violation then code := 'ck'; end;
  perform pg_temp.assert(code = 'ck', 'bad scope rejected by check');
end $$;

-- deleting the scan removes its links and sessions, so "Delete my data" also removes the Telegram part of the web count
select public.mpt_delete_profile_snapshots('444');
select pg_temp.assert((select count(*) from public.dashboard_links where sender_id = '444') = 0 and (select count(*) from public.dashboard_sessions where sender_id = '444') = 0, 'delete my data cascades to links and sessions');
rollback;
select 'footprint handoff + catalogue assertions passed';
