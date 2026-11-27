-- MPC-9817: assertions for accounts, account_scans, mpt_ensure_account / mpt_link_scan_to_account / mpt_list_account_scans / mpt_delete_account / mpt_can.
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

-- ===== closed to anon, own-row read for authenticated, RLS forced; functions service_role only =====
do $$
declare t text;
begin
  foreach t in array array['accounts', 'account_scans', 'capability_min_tier'] loop
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS enabled and forced');
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon denied');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role reads');
  end loop;
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.account_scans') = '42501', 'account_scans: authenticated denied (the Worker lists scans, not the browser)');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.capability_min_tier') = '42501', 'capability_min_tier: authenticated denied');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.accounts') = '', 'accounts: authenticated may read (own row by policy)');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select public.mpt_can('00000000-0000-0000-0000-000000000001', 'report.score')$q$) = '42501', 'mpt_can not callable by anon');
  perform pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_delete_account('00000000-0000-0000-0000-000000000001')$q$) = '42501', 'mpt_delete_account not callable by authenticated');
  perform pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_link_scan_to_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','claim')$q$) = '42501', 'mpt_link_scan_to_account not callable by authenticated');
end $$;

-- ===== NO IP anywhere on the account tables =====
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('accounts', 'account_scans', 'capability_min_tier')
                                   and (column_name ~* '(^|_)ip(_|$)' or column_name ~* 'ip_?address' or udt_name = 'inet')), 'no IP column on accounts, account_scans or capability_min_tier');

-- ===== fixtures: two synthetic people, each with a saved scan =====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a001', 'zelda.test+9817@example.test'), ('00000000-0000-0000-0000-00000000a002', 'other.test+9817@example.test');
insert into public.users (id, email) values ('00000000-0000-0000-0000-00000000b001', 'zelda.test+9817@example.test'), ('00000000-0000-0000-0000-00000000b002', 'other.test+9817@example.test');
insert into public.scans (id, user_id, email_scanned, source, expires_at) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'zelda.test+9817@example.test', 'web_scan', now() + interval '7 days'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000b002', 'other.test+9817@example.test', 'web_scan', now() + interval '7 days'),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000b001', 'zelda.test+9817@example.test', 'web_scan', now() + interval '7 days');
insert into public.signals (scan_id, category, signal_type, severity, data_source, check_status) select id, 'email', 'synthetic', 'low', 'synthetic', 'not_checked' from public.scans where id in ('00000000-0000-0000-0000-00000000c001') on conflict do nothing;
insert into public.web_scans (id, source, hexagon_count, results, results_bytes) values
  ('00000000-0000-0000-0000-00000000d001', 'web', 1, '[{"id":"x"}]', 12), ('00000000-0000-0000-0000-00000000d002', 'web', 1, '[{"id":"x"}]', 12), ('00000000-0000-0000-0000-00000000d003', 'web', 1, '[{"id":"x"}]', 12);
insert into public.web_scan_contacts (web_scan_id, channel, contact_id, save_consent_at, save_consent_version) values
  ('00000000-0000-0000-0000-00000000d001', 'email', '00000000-0000-0000-0000-00000000c001', '2026-11-08 01:00+00', '2026-11-08-v1'),
  ('00000000-0000-0000-0000-00000000d002', 'email', '00000000-0000-0000-0000-00000000c002', '2026-11-08 02:00+00', '2026-10-12-v1'),
  ('00000000-0000-0000-0000-00000000d003', 'email', '00000000-0000-0000-0000-00000000c003', null, null);
insert into public.web_scan_listing_checks (web_scan_id, scan_id, full_name) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Zelda Test');

-- ===== account creation carries the consent from the scan it signed up on, only when the scan is the same email =====
select public.mpt_ensure_account('00000000-0000-0000-0000-00000000a001', 'Zelda.Test+9817@example.test', '00000000-0000-0000-0000-00000000d001');
select public.mpt_ensure_account('00000000-0000-0000-0000-00000000a002', 'other.test+9817@example.test', '00000000-0000-0000-0000-00000000d001');   -- someone else's scan number: no consent carried
select pg_temp.assert((select plan from public.accounts where id = '00000000-0000-0000-0000-00000000a001') = 'free', 'plan defaults to free');
select pg_temp.assert((select email from public.accounts where id = '00000000-0000-0000-0000-00000000a001') = 'zelda.test+9817@example.test', 'email stored lower-case');
select pg_temp.assert((select keep_scans from public.accounts where id = '00000000-0000-0000-0000-00000000a001'), 'keep_scans defaults true');
select pg_temp.assert((select consent_version from public.accounts where id = '00000000-0000-0000-0000-00000000a001') = '2026-11-08-v1', 'consent version carried from the scan');
select pg_temp.assert((select consent_hash from public.accounts where id = '00000000-0000-0000-0000-00000000a001') =
  encode(sha256(convert_to('2026-11-08-v1|' || (select consent_at::text from public.accounts where id = '00000000-0000-0000-0000-00000000a001') || '|00000000-0000-0000-0000-00000000d001', 'UTF8')), 'hex'), 'consent hash binds version, time and scan number');
select pg_temp.assert((select consent_version from public.accounts where id = '00000000-0000-0000-0000-00000000a002') is null, 'no consent carried from a scan that belongs to a different email');
select public.mpt_ensure_account('00000000-0000-0000-0000-00000000a001', 'zelda.test+9817@example.test', '00000000-0000-0000-0000-00000000d003');   -- idempotent; no consent on that scan; first consent is kept
select pg_temp.assert((select count(*) from public.accounts where id = '00000000-0000-0000-0000-00000000a001') = 1 and (select consent_version from public.accounts where id = '00000000-0000-0000-0000-00000000a001') = '2026-11-08-v1', 'ensure is idempotent and never overwrites consent');
select pg_temp.assert(pg_temp.try_as('service_role', $q$insert into public.accounts (id, email, plan) values (gen_random_uuid(), 'x@example.test', 'gold')$q$) in ('23514', '23503'), 'plan outside the four tiers is refused');

-- ===== linking: own scan only; leaves the 7-day path =====
select pg_temp.assert((public.mpt_link_scan_to_account('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d001', 'current')->>'linked')::boolean, 'own scan links');
select pg_temp.assert((select expires_at from public.scans where id = '00000000-0000-0000-0000-00000000c001') is null, 'a linked scan leaves the free 7-day deletion path (expires_at null)');
select pg_temp.assert((select expires_at from public.scans where id = '00000000-0000-0000-0000-00000000c003') is not null, 'an unlinked scan keeps its expiry');
select pg_temp.assert((public.mpt_link_scan_to_account('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d001', 'claim')->>'already')::boolean, 'linking twice is a no-op');
select pg_temp.assert(not (public.mpt_link_scan_to_account('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d002', 'claim')->>'linked')::boolean, 'someone else''s scan number cannot be claimed');
select pg_temp.assert(public.mpt_link_scan_to_account('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d002', 'claim') = public.mpt_link_scan_to_account('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000ff', 'claim'),
  'a scan number that is not yours answers the same as one that does not exist');
select public.mpt_link_scan_to_account('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d003', 'claim');
select pg_temp.assert((select count(*) from public.mpt_list_account_scans('00000000-0000-0000-0000-00000000a001')) = 2, 'list returns the two claimed scans');
select pg_temp.assert((select count(*) from public.mpt_list_account_scans('00000000-0000-0000-0000-00000000a002')) = 0, 'the other account sees none of them');

select pg_temp.assert((public.mpt_get_account_scan('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d001')->>'hexagon_count')::int = 1, 'open: own linked scan returns its saved result');
select pg_temp.assert(public.mpt_get_account_scan('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d002') is null, 'open: a scan of someone else returns nothing');
select pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_get_account_scan('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000d001')$q$) = '42501', 'mpt_get_account_scan not callable by authenticated');

-- ===== can(): Free values only; unknown denied =====
select pg_temp.assert((public.mpt_can('00000000-0000-0000-0000-00000000a001', 'report.score')->>'allowed')::boolean, 'free account can a free capability');
select pg_temp.assert(not (public.mpt_can('00000000-0000-0000-0000-00000000a001', 'report.export_pdf')->>'allowed')::boolean and public.mpt_can('00000000-0000-0000-0000-00000000a001', 'report.export_pdf')->>'reason' = 'tier_too_low', 'a paid capability (wired by MPC-9818) is denied to a Free account as tier_too_low');
select pg_temp.assert(public.mpt_can('00000000-0000-0000-0000-00000000a001', 'report.not_a_real_key')->>'reason' = 'unknown_capability', 'an unknown key is still denied as unknown_capability');
select pg_temp.assert(public.mpt_can('00000000-0000-0000-0000-0000000000ee', 'report.score')->>'reason' = 'no_account', 'no account => denied');
insert into public.capability_min_tier (key, min_tier) values ('test.basic_only', 'basic');
select pg_temp.assert(public.mpt_can('00000000-0000-0000-0000-00000000a001', 'test.basic_only')->>'reason' = 'tier_too_low', 'free is below a basic capability');
update public.accounts set plan = 'pro' where id = '00000000-0000-0000-0000-00000000a001';
select pg_temp.assert((public.mpt_can('00000000-0000-0000-0000-00000000a001', 'test.basic_only')->>'allowed')::boolean, 'pro is at or above a basic capability');
update public.accounts set plan = 'free' where id = '00000000-0000-0000-0000-00000000a001';
select pg_temp.assert(pg_temp.try_as('service_role', $q$insert into public.capability_min_tier (key, min_tier, cost) values ('test.paid_but_free', 'free', 'third_party')$q$) = '23514', 'a third-party-cost capability can never be free (pricing principle)');

-- ===== delete: really deletes =====
select pg_temp.assert((public.mpt_delete_account('00000000-0000-0000-0000-00000000a001')->>'account_deleted')::boolean, 'delete reports the account deleted');
select pg_temp.assert(not exists (select 1 from public.accounts where id = '00000000-0000-0000-0000-00000000a001'), 'account row gone');
select pg_temp.assert(not exists (select 1 from public.account_scans where account_id = '00000000-0000-0000-0000-00000000a001'), 'links gone');
select pg_temp.assert(not exists (select 1 from public.web_scans where id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d003')), 'saved scans deleted, not just unlinked');
select pg_temp.assert(not exists (select 1 from public.web_scan_contacts where web_scan_id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d003')), 'contact links cascade');
select pg_temp.assert(not exists (select 1 from public.web_scan_listing_checks where web_scan_id = '00000000-0000-0000-0000-00000000d001'), 'listing checks cascade');
select pg_temp.assert(not exists (select 1 from public.scans where id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c003')), 'email-request scans deleted');
select pg_temp.assert(not exists (select 1 from public.signals where scan_id = '00000000-0000-0000-0000-00000000c001'), 'signals cascade');
select pg_temp.assert(exists (select 1 from public.web_scans where id = '00000000-0000-0000-0000-00000000d002') and exists (select 1 from public.scans where id = '00000000-0000-0000-0000-00000000c002'), 'another person''s scan is untouched');
select pg_temp.assert(exists (select 1 from public.accounts where id = '00000000-0000-0000-0000-00000000a002'), 'another person''s account is untouched');
-- deleting the auth user alone also removes the account row (the Worker does both)
delete from auth.users where id = '00000000-0000-0000-0000-00000000a002';
select pg_temp.assert(not exists (select 1 from public.accounts where id = '00000000-0000-0000-0000-00000000a002'), 'deleting the auth user cascades to the account');

rollback;
select 'mpc-9817 accounts: all assertions passed';
