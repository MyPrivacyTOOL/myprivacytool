-- MPC-9890: assertions for the free-record deletion (scans.delete_after, mpt_purge_free_records, countdown claims, keep). SYNTHETIC identities only (example.test).
-- Throwaway database only. Every check RAISES on failure and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- access: every new function is service_role only
select pg_temp.assert(pg_temp.try_as('anon', 'select public.mpt_purge_free_records(true)') = '42501', 'anon cannot purge');
select pg_temp.assert(pg_temp.try_as('authenticated', 'select public.mpt_keep_scan(gen_random_uuid())') = '42501', 'authenticated cannot keep a scan');
select pg_temp.assert(pg_temp.try_as('authenticated', 'select * from public.mpt_claim_deletion_notices(1)') = '42501', 'authenticated cannot claim notices');
select pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.free_record_policy') = '42501', 'anon cannot read the policy');
select pg_temp.assert(pg_temp.try_as('service_role', 'select public.mpt_purge_free_records(true)') = '', 'service_role can run a dry run');
select pg_temp.assert((select n_hours = 168 from public.free_record_policy where id), 'policy N is 168 h = 7 days (equals CONSENT_CONFIG.n_hours)');
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'free_record_deletion_log' and (column_name ~* 'mail|ip|scan_id' or udt_name = 'inet')), 'deletion log has counts only');

insert into public.recipients_registry (key, body, registry_hash) values ('resend-9890-test', '{}', repeat('c',64)) on conflict do nothing;
-- fixtures. A: free, delivered 8 days ago (overdue by 1 day). B: signed up. C: kept. D: not due. I: consent N = 24 h.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000b0002', 'bee.test+9890@example.test');
insert into public.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0001', 'ayla.test+9890@example.test'), ('00000000-0000-0000-0000-0000000b0001', 'bee.test+9890@example.test'),
  ('00000000-0000-0000-0000-0000000c0001', 'cato.test+9890@example.test'), ('00000000-0000-0000-0000-0000000d0001', 'dara.test+9890@example.test'),
  ('00000000-0000-0000-0000-0000000e0001', 'eli.test+9890@example.test');
insert into public.accounts (id, email) values ('00000000-0000-0000-0000-0000000b0002', 'bee.test+9890@example.test');
insert into public.scan_consents (id, scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values
  ('00000000-0000-0000-0000-00000a0a0a01', '00000000-0000-0000-0000-00000a0a0a0f', '2026-11-v1', repeat('a',64), 'en', repeat('b',64), 168),
  ('00000000-0000-0000-0000-00000e0e0e01', '00000000-0000-0000-0000-00000e0e0e0f', '2026-11-v1', repeat('a',64), 'en', repeat('b',64), 24);
insert into public.scans (id, user_id, email_scanned, source, report_sent_at, delivery_status, delivery_status_at, consent_id) values
  ('00000000-0000-0000-0000-0000000a00a1', '00000000-0000-0000-0000-0000000a0001', 'ayla.test+9890@example.test', 'web_scan', now() - interval '8 days', 'delivered', now() - interval '8 days', '00000000-0000-0000-0000-00000a0a0a01'),
  ('00000000-0000-0000-0000-0000000b00b1', '00000000-0000-0000-0000-0000000b0001', 'bee.test+9890@example.test', 'web_scan', now() - interval '9 days', 'delivered', now() - interval '9 days', null),
  ('00000000-0000-0000-0000-0000000c00c1', '00000000-0000-0000-0000-0000000c0001', 'cato.test+9890@example.test', 'web_scan', now() - interval '9 days', 'delivered', now() - interval '9 days', null),
  ('00000000-0000-0000-0000-0000000d00d1', '00000000-0000-0000-0000-0000000d0001', 'dara.test+9890@example.test', 'web_scan', now() - interval '1 day', 'delivered', now() - interval '1 day', null),
  ('00000000-0000-0000-0000-0000000e00e1', '00000000-0000-0000-0000-0000000e0001', 'eli.test+9890@example.test', 'web_scan', now() - interval '1 hour', null, null, '00000000-0000-0000-0000-00000e0e0e01');
insert into public.signals (scan_id, category, signal_type, severity, data_source, check_status) values ('00000000-0000-0000-0000-0000000a00a1', 'email', 'synthetic', 'low', 'synthetic', 'not_checked');
insert into public.leads (email, user_id) values ('ayla.test+9890@example.test', '00000000-0000-0000-0000-0000000a0001'), ('bee.test+9890@example.test', '00000000-0000-0000-0000-0000000b0001');
insert into public.web_scans (id, source, hexagon_count, results, results_bytes) values
  ('00000000-0000-0000-0000-00000a0a0a0f', 'web', 1, '[{"id":"x"}]', 12), ('00000000-0000-0000-0000-00000d0d0d0f', 'web', 1, '[{"id":"x"}]', 12);
insert into public.web_scan_contacts (web_scan_id, channel, contact_id, save_consent_at, save_consent_version) values
  ('00000000-0000-0000-0000-00000a0a0a0f', 'email', '00000000-0000-0000-0000-0000000a00a1', '2026-11-08 01:00+00', '2026-11-08-v1'),
  ('00000000-0000-0000-0000-00000d0d0d0f', 'email', '00000000-0000-0000-0000-0000000d00d1', '2026-11-08 01:00+00', '2026-11-08-v1');
insert into public.scan_recipient_log (scan_id, recipient_key, items, status, at)
  select s, 'resend-9890-test', array['email'], 'ran', now() from unnest(array['00000000-0000-0000-0000-0000000a00a1', '00000000-0000-0000-0000-00000a0a0a0f', '00000000-0000-0000-0000-0000000d00d1']) s;
select public.mpt_keep_scan('00000000-0000-0000-0000-0000000c00c1');

-- the deadline: delivered time + the consented N; kept rows have none; N comes from the consent the person saw
select pg_temp.assert((select delete_after between now() - interval '1 day 1 minute' and now() - interval '23 hours 59 minutes' from public.scans where id = '00000000-0000-0000-0000-0000000a00a1'), 'A: deadline = delivered + 168 h (overdue by one day)');
select pg_temp.assert((select delete_after is null and kept_at is not null from public.scans where id = '00000000-0000-0000-0000-0000000c00c1'), 'C: kept scan has no deadline');
select pg_temp.assert((select delete_after between now() + interval '5 days 23 hours' and now() + interval '6 days 1 hour' from public.scans where id = '00000000-0000-0000-0000-0000000d00d1'), 'D: deadline in about 6 days');
select pg_temp.assert((select delete_after between now() - interval '1 hour 1 minute' + interval '24 hours' - interval '1 minute' and now() - interval '1 hour' + interval '24 hours' + interval '1 minute' from public.scans where id = '00000000-0000-0000-0000-0000000e00e1'),
  'E: no delivered receipt: sent time + the consented 24 h');
-- a late delivered receipt moves the deadline later, never earlier
update public.scans set delivery_status = 'delivered', delivery_status_at = now() where id = '00000000-0000-0000-0000-0000000e00e1';
select pg_temp.assert((select delete_after > now() + interval '23 hours' from public.scans where id = '00000000-0000-0000-0000-0000000e00e1'), 'E: delivered receipt moved the deadline later');
update public.scans set delivery_status_at = now() - interval '30 days' where id = '00000000-0000-0000-0000-0000000e00e1';
select pg_temp.assert((select delete_after > now() + interval '23 hours' from public.scans where id = '00000000-0000-0000-0000-0000000e00e1'), 'E: nothing moves the deadline earlier');

-- the dry run counts and deletes nothing
select pg_temp.assert((select (public.mpt_purge_free_records(true)->>'scans')::int = 1 from (select 1) x), 'dry run: one overdue free record (A); signed-up B and kept C are not counted');
select pg_temp.assert((select count(*) = 1 from public.scans where id = '00000000-0000-0000-0000-0000000a00a1'), 'dry run deleted nothing');

-- the purge: the record is GONE after N hours, in every table the spec names
do $$
declare r jsonb; before_n bigint;
begin
  select coalesce(deleted_n, 0) into before_n from public.scan_consent_counts where consent_version = '2026-11-v1';
  before_n := coalesce(before_n, 0);
  r := public.mpt_purge_free_records(false);
  perform pg_temp.assert((r->>'scans')::int = 1 and (r->>'web_scans')::int = 1 and (r->>'users')::int = 1 and (r->>'leads')::int = 1, 'purge counts: 1 scan, 1 web scan, 1 user, 1 lead: ' || r::text);
  perform pg_temp.assert(r->'notify' = '["ayla.test+9890@example.test"]'::jsonb, 'purge returns only A''s address for the T-0 mail and the HubSpot delete');
  perform pg_temp.assert(not exists (select 1 from public.scans where id = '00000000-0000-0000-0000-0000000a00a1'), 'A: scans row gone');
  perform pg_temp.assert(not exists (select 1 from public.signals where scan_id = '00000000-0000-0000-0000-0000000a00a1'), 'A: signals gone (cascade)');
  perform pg_temp.assert(not exists (select 1 from public.web_scans where id = '00000000-0000-0000-0000-00000a0a0a0f'), 'A: web_scans row gone');
  perform pg_temp.assert(not exists (select 1 from public.web_scan_contacts where web_scan_id = '00000000-0000-0000-0000-00000a0a0a0f'), 'A: web_scan_contacts gone');
  perform pg_temp.assert(not exists (select 1 from public.scan_consents where id = '00000000-0000-0000-0000-00000a0a0a01'), 'A: scan_consents gone');
  perform pg_temp.assert(not exists (select 1 from public.scan_recipient_log where scan_id in ('00000000-0000-0000-0000-0000000a00a1', '00000000-0000-0000-0000-00000a0a0a0f')), 'A: scan_recipient_log gone');
  perform pg_temp.assert(not exists (select 1 from public.users where id = '00000000-0000-0000-0000-0000000a0001'), 'A: users row gone (never signed up)');
  perform pg_temp.assert(not exists (select 1 from public.leads where email = 'ayla.test+9890@example.test'), 'A: leads row gone');
  perform pg_temp.assert((select deleted_n from public.scan_consent_counts where consent_version = '2026-11-v1') = before_n + 1, 'only a count per consent_version remains');
  -- nobody else is touched
  perform pg_temp.assert(exists (select 1 from public.scans where id = '00000000-0000-0000-0000-0000000b00b1') and exists (select 1 from public.users where id = '00000000-0000-0000-0000-0000000b0001') and exists (select 1 from public.leads where email = 'bee.test+9890@example.test'), 'B: signed-up (account) record kept');
  perform pg_temp.assert(exists (select 1 from public.scans where id = '00000000-0000-0000-0000-0000000c00c1'), 'C: kept record kept');
  perform pg_temp.assert(exists (select 1 from public.scans where id = '00000000-0000-0000-0000-0000000d00d1') and exists (select 1 from public.web_scans where id = '00000000-0000-0000-0000-00000d0d0d0f') and exists (select 1 from public.scan_recipient_log where scan_id = '00000000-0000-0000-0000-0000000d00d1'), 'D: a record not yet due is untouched');
  perform pg_temp.assert((public.mpt_purge_free_records(false)->>'scans')::int = 0, 'a second run deletes nothing');
  perform pg_temp.assert((select count(*) = 1 from public.free_record_deletion_log where kind = 'purge'), 'one counts-only log row for the run that deleted (an empty run logs nothing)');
end $$;

-- the p_overdue grace (cron backstop): a record 1 day overdue is "more than 1 hour overdue"; one due in the future is not
update public.scans set delete_after = now() - interval '30 minutes' where id = '00000000-0000-0000-0000-0000000d00d1';
select pg_temp.assert((public.mpt_purge_free_records(true, interval '1 hour')->>'scans')::int = 0, 'backstop ignores a record only 30 minutes overdue (the Worker run sends the T-0 mail first)');
select pg_temp.assert((public.mpt_purge_free_records(true)->>'scans')::int = 1, 'the Worker run takes it');
update public.scans set delete_after = now() + interval '6 days' where id = '00000000-0000-0000-0000-0000000d00d1';

update public.scans set delete_after = now() + interval '3 days' where id = '00000000-0000-0000-0000-0000000e00e1';
-- countdown claims: each stage once; 4 h skips the 24 h mail; kept and signed-up never claimed
update public.scans set delete_after = now() + interval '20 hours' where id = '00000000-0000-0000-0000-0000000d00d1';
select pg_temp.assert((select count(*) = 1 and min(stage) = '24h' from public.mpt_claim_deletion_notices(10)), '24 h notice claimed for D');
select pg_temp.assert((select count(*) = 0 from public.mpt_claim_deletion_notices(10)), '24 h notice is sent once');
update public.scans set delete_after = now() + interval '3 hours' where id = '00000000-0000-0000-0000-0000000d00d1';
select pg_temp.assert((select count(*) = 1 and min(stage) = '4h' from public.mpt_claim_deletion_notices(10)), '4 h notice claimed for D');
select pg_temp.assert((select count(*) = 0 from public.mpt_claim_deletion_notices(10)), '4 h notice is sent once');
select public.mpt_release_deletion_notice('00000000-0000-0000-0000-0000000d00d1', '4h');
select pg_temp.assert((select count(*) = 1 from public.mpt_claim_deletion_notices(10)), 'a released notice can be claimed again (failed send)');
update public.scans set delete_after = now() + interval '3 hours', countdown_4h_sent_at = null where id = '00000000-0000-0000-0000-0000000b00b1';
select pg_temp.assert((select count(*) = 0 from public.mpt_claim_deletion_notices(10)), 'a signed-up person gets no countdown');
-- Keep ends the deadline and the countdown
select pg_temp.assert((select (public.mpt_keep_scan('00000000-0000-0000-0000-0000000d00d1')->>'kept')::boolean), 'Keep works');
select pg_temp.assert((select delete_after is null from public.scans where id = '00000000-0000-0000-0000-0000000d00d1'), 'kept: no deadline');
select pg_temp.assert((public.mpt_purge_free_records(true)->>'scans')::int = 0, 'kept: never purged');
select pg_temp.assert(not (select (public.mpt_keep_scan(gen_random_uuid())->>'kept')::boolean), 'Keep on an unknown scan reports not kept');

-- every other deletion path also takes the consent and the who-saw-what rows (trigger)
insert into public.scan_consents (id, scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values ('00000000-0000-0000-0000-00000f0f0f01', '00000000-0000-0000-0000-00000f0f0f0f', '2026-11-v1', repeat('a',64), 'en', repeat('b',64), 168);
insert into public.web_scans (id, source, hexagon_count, results, results_bytes) values ('00000000-0000-0000-0000-00000f0f0f0f', 'web', 1, '[{"id":"x"}]', 12);
insert into public.scan_recipient_log (scan_id, recipient_key, items, status, at) values ('00000000-0000-0000-0000-00000f0f0f0f', 'resend-9890-test', array['email'], 'ran', now());
select public.mpt_delete_web_scan('00000000-0000-0000-0000-00000f0f0f0f');
select pg_temp.assert(not exists (select 1 from public.scan_consents where scan_id = '00000000-0000-0000-0000-00000f0f0f0f') and not exists (select 1 from public.scan_recipient_log where scan_id = '00000000-0000-0000-0000-00000f0f0f0f'), 'delete by scan number also removes the consent and the recipient log');
-- CK-9848's interim purge no longer deletes kept scans
select pg_temp.assert((select count(*) = 1 from public.scans where id = '00000000-0000-0000-0000-0000000c00c1') and (public.mpt_purge_expired_scans(false)->>'scans')::int = 0, 'interim scans purge delegates and leaves kept scans alone');
rollback;
select 'mpc-9890 free-record deletion: all assertions passed';
