-- MPC-7893: assertions for dashboard_links / dashboard_sessions and mpt_redeem_dashboard_link (migration 20261026220000). Throwaway database only.
-- Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and the file rolls back. The concurrent-redemption race is tested in run.sh with two real connections.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== closed to anon / authenticated, open to service_role; RLS forced =====
do $$
declare t text;
begin
  foreach t in array array['dashboard_links', 'dashboard_sessions'] loop
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon denied');
    perform pg_temp.assert(pg_temp.try_as('authenticated', format('select 1 from public.%I', t)) = '42501', t || ': authenticated denied');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role reads');
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS enabled and forced');
  end loop;
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select public.mpt_redeem_dashboard_link(repeat('a',64), repeat('b',64))$q$) = '42501', 'redeem not callable by anon');
  perform pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_redeem_dashboard_link(repeat('a',64), repeat('b',64))$q$) = '42501', 'redeem not callable by authenticated');
end $$;

-- ===== fixtures: one live snapshot and one expired snapshot =====
insert into public.profile_snapshots (id, sender_id, update_id, status, scan_version, risk_version, consent, get_chat, photos, expires_at)
values ('00000000-0000-0000-0000-0000000000a1', '111', 1, 'complete', 'telegram-baseline-1', 'risk-count-1', '{}', '{}', '{}', now() + interval '90 days'),
       ('00000000-0000-0000-0000-0000000000a2', '111', 2, 'complete', 'telegram-baseline-1', 'risk-count-1', '{}', '{}', '{}', now() - interval '1 hour');

-- ===== a link can never outlive 15 minutes =====
do $$
begin
  perform pg_temp.assert(pg_temp.try_as('service_role', $q$insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at) values (repeat('c',64), '111', '00000000-0000-0000-0000-0000000000a1', now() + interval '16 minutes')$q$) = '23514', '16 minute link rejected');
  perform pg_temp.assert(pg_temp.try_as('service_role', $q$insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at) values ('not-a-hash', '111', '00000000-0000-0000-0000-0000000000a1', now() + interval '15 minutes')$q$) = '23514', 'malformed hash rejected');
end $$;

insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at) values
  (repeat('1',64), '111', '00000000-0000-0000-0000-0000000000a1', now() + interval '15 minutes'),   -- valid
  (repeat('2',64), '111', '00000000-0000-0000-0000-0000000000a1', now() + interval '15 minutes'),   -- will be aged past expiry
  (repeat('3',64), '111', '00000000-0000-0000-0000-0000000000a2', now() + interval '15 minutes');   -- scan already expired

-- ===== valid redemption works once, and creates exactly one session scoped to the link's sender and snapshot =====
select pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('1',64), repeat('9',64), 30) is true, 'first redemption succeeds');
select pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('1',64), repeat('8',64), 30) is false, 'second redemption of the same link fails');
select pg_temp.assert((select count(*) from public.dashboard_sessions) = 1, 'exactly one session exists');
select pg_temp.assert((select sender_id || snapshot_id::text from public.dashboard_sessions where session_hash = repeat('9',64)) = '11100000000-0000-0000-0000-0000000000a1', 'session scoped to the link sender and snapshot');
select pg_temp.assert((select expires_at <= now() + interval '30 minutes 1 second' from public.dashboard_sessions where session_hash = repeat('9',64)), 'session lifetime is 30 minutes');
select pg_temp.assert(not exists (select 1 from public.dashboard_sessions where session_hash = repeat('8',64)), 'the losing attempt created no session');

-- ===== unknown, expired and deleted/expired-scan links redeem nothing =====
select pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('f',64), repeat('7',64), 30) is false, 'unknown link fails');
update public.dashboard_links set created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes' where token_hash = repeat('2',64);
select pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('2',64), repeat('6',64), 30) is false, 'expired link fails');
select pg_temp.assert((select redeemed_at is null from public.dashboard_links where token_hash = repeat('2',64)), 'an expired attempt does not mark the link redeemed');
select pg_temp.assert(public.mpt_redeem_dashboard_link(repeat('3',64), repeat('5',64), 30) is false, 'link to an expired scan fails');
select pg_temp.assert((select count(*) from public.dashboard_sessions) = 1, 'failed attempts created no sessions');

-- ===== bad session length is refused =====
do $$ begin
  perform pg_temp.assert(pg_temp.try_as('service_role', $q$select public.mpt_redeem_dashboard_link(repeat('1',64), repeat('4',64), 600)$q$) <> '', '600 minute session refused');
end $$;

-- ===== deleting a person's snapshots (existing DSAR function) removes their links and sessions =====
select public.mpt_delete_profile_snapshots('111');
select pg_temp.assert((select count(*) from public.dashboard_links) = 0 and (select count(*) from public.dashboard_sessions) = 0, 'delete-on-request cascades to links and sessions');

-- ===== purge removes expired sessions and old links =====
insert into public.profile_snapshots (id, sender_id, update_id, status, scan_version, risk_version, consent, get_chat, photos, expires_at)
values ('00000000-0000-0000-0000-0000000000b1', '222', 1, 'complete', 'telegram-baseline-1', 'risk-count-1', '{}', '{}', '{}', now() + interval '90 days');
insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at, created_at) values (repeat('d',64), '222', '00000000-0000-0000-0000-0000000000b1', now() - interval '2 days' + interval '15 minutes', now() - interval '2 days');
select pg_temp.assert(public.mpt_purge_dashboard_credentials() = 1, 'purge removes the old link');
rollback;
