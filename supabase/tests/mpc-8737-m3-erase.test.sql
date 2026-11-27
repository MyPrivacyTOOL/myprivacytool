-- MPC-8737 M3: the three live erase functions also erase the ledger record (supabase/migrations/20261028210000_mpc_8737_m3_ledger_erase_parity.sql).
\set ON_ERROR_STOP on
create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;

-- Supabase has an `extensions` schema with pgcrypto; the throwaway database does not, so stub the one function mpt_dsar_erase uses (sha256 only).
create schema if not exists extensions;
create or replace function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;

select pg_temp.assert((select prosrc ilike '%ledger.erase_person%' from pg_proc where proname = 'mpt_dsar_erase' and pronamespace = 'public'::regnamespace), 'the backfill gate text is satisfied: mpt_dsar_erase calls ledger.erase_person');

-- DSAR: a user with a ledger record (email_hash + user_id identifiers, one data point) --------------------------------------------------------------
insert into public.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'm3-person@example.com');
insert into ledger.person (person_id, status) values ('00000000-0000-4000-8000-0000000000e2', 'active');
insert into ledger.person_identifier (person_id, id_type, id_value) values
  ('00000000-0000-4000-8000-0000000000e2', 'email_hash', encode(sha256(convert_to('m3-person@example.com', 'UTF8')), 'hex')),
  ('00000000-0000-4000-8000-0000000000e2', 'user_id', '00000000-0000-4000-8000-0000000000e1');
select ledger.record_data_point('00000000-0000-4000-8000-0000000000e2', 'category.email.exposure', null, '{"x":1}'::jsonb, 'found', 90::smallint, 'checked', 'web', 'local_analysis', 'm3 test');
-- a second, unrelated person must survive
insert into ledger.person (person_id, status) values ('00000000-0000-4000-8000-0000000000e3', 'active');
insert into ledger.person_identifier (person_id, id_type, id_value) values ('00000000-0000-4000-8000-0000000000e3', 'email_hash', repeat('b', 64));

set role service_role;
select public.mpt_dsar_erase('M3-Person@Example.com') as r \gset
reset role;
select pg_temp.assert((:'r'::jsonb->>'ledger_persons')::int = 1 and (:'r'::jsonb->>'users')::int = 1, 'DSAR reports 1 user and 1 ledger person erased');
select pg_temp.assert((select status = 'erased' from ledger.person where person_id = '00000000-0000-4000-8000-0000000000e2'), 'DSAR: the ledger person is erased');
select pg_temp.assert((select count(*) from ledger.data_point where person_id = '00000000-0000-4000-8000-0000000000e2') = 0
                      and (select count(*) from ledger.person_identifier where person_id = '00000000-0000-4000-8000-0000000000e2') = 0, 'DSAR: its data points and identifiers are gone');
select pg_temp.assert((select count(*) from public.users where lower(email) = 'm3-person@example.com') = 0, 'DSAR: the legacy user is still deleted as before');
select pg_temp.assert((select status = 'active' from ledger.person where person_id = '00000000-0000-4000-8000-0000000000e3'), 'DSAR: an unrelated ledger person is untouched');
-- an email with no ledger record: no error, ledger_persons 0
select pg_temp.assert((public.mpt_dsar_erase('nobody-m3@example.com')->>'ledger_persons')::int = 0, 'DSAR with no ledger record: 0 ledger persons, no error');

-- chat sender: Telegram id and WhatsApp number ------------------------------------------------------------------------------------------------------
insert into ledger.person (person_id, status) values ('00000000-0000-4000-8000-0000000000f1', 'active'), ('00000000-0000-4000-8000-0000000000f2', 'active');
insert into ledger.person_identifier (person_id, id_type, id_value) values
  ('00000000-0000-4000-8000-0000000000f1', 'telegram_id', '555000771'),
  ('00000000-0000-4000-8000-0000000000f2', 'wa_id', '+85255550123');
set role service_role;
select public.mpt_erase_chat_sender('telegram', '555000771');
select public.mpt_erase_chat_sender('whatsapp', '85255550123');   -- the +-less form Meta may send normalises to the same wa_id
select public.mpt_erase_chat_sender('telegram', 'no-such-sender');
reset role;
select pg_temp.assert((select count(*) from ledger.person where person_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2') and status = 'erased') = 2, 'chat sender: the Telegram and WhatsApp ledger persons are erased (service_role)');

-- X contact -------------------------------------------------------------------------------------------------------------------------------------------
insert into ledger.person (person_id, status) values ('00000000-0000-4000-8000-0000000000f3', 'active'), ('00000000-0000-4000-8000-0000000000f4', 'active');
insert into ledger.person_identifier (person_id, id_type, id_value) values
  ('00000000-0000-4000-8000-0000000000f3', 'social_x', '424242424'), ('00000000-0000-4000-8000-0000000000f4', 'social_x', '434343434');
set role service_role;
select public.mpt_erase_social_contact('x', '424242424');
select public.mpt_erase_social_contact('linkedin', '434343434');   -- another platform never touches an X identifier
reset role;
select pg_temp.assert((select status = 'erased' from ledger.person where person_id = '00000000-0000-4000-8000-0000000000f3'), 'social contact: the X ledger person is erased');
select pg_temp.assert((select status = 'active' from ledger.person where person_id = '00000000-0000-4000-8000-0000000000f4'), 'social contact: another platform does not erase an X identifier');
select 'MPC-8737 M3 erase parity: all assertions passed' as ok;
