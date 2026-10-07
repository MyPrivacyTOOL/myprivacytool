-- MPC-7300: schema integration assertions. Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and
-- the whole file rolls back, leaving the throwaway database clean. Covers the tables the Workers write:
--   mpt-leads -> mpt_user_engagement, mpt_score_baselines; scan-report -> users/scans/signals/...;
--   github-channel -> channel_tokens.
begin;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
-- Runs a statement as a given role and reports the SQLSTATE class it raised ('' = succeeded).
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== every service-only table is closed to anon and authenticated, open to service_role ==========
do $$
declare t text;
begin
  foreach t in array array['mpt_api_rate_limits','mpt_channel_metrics','mpt_score_baselines','users','scans','signals',
                           'hexagon_scores','removal_tasks','leads','channel_tokens',
                           'osint_results','conversation_states','channel_preferences','translation_queue'] loop
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon must be denied');
    perform pg_temp.assert(pg_temp.try_as('authenticated', format('select 1 from public.%I', t)) = '42501', t || ': authenticated must be denied');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role must read');
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS must be enabled and forced');
  end loop;
end $$;

-- ===== MPT-1001: leads columns + constraints for Progressive Trust / OSINT ========================
select pg_temp.assert((select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'leads'
  and column_name in ('phone_number','whatsapp_opt_in','locale_code','confidence_score')), 'leads: MPT-1001 columns missing');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.leads (email, phone_number, whatsapp_opt_in, locale_code, confidence_score)
  values ('mpt1001-ok@example.invalid', '+15550100', true, 'es-MX', 80)$$) = '', 'leads: valid MPT-1001 row must insert');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.leads (email, phone_number) values ('mpt1001-a@example.invalid', '5550100')$$) = '23514', 'leads: non-E.164 phone must be rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.leads (email, confidence_score) values ('mpt1001-b@example.invalid', 101)$$) = '23514', 'leads: confidence_score > 100 must be rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.leads (email, whatsapp_opt_in) values ('mpt1001-c@example.invalid', true)$$) = '23514', 'leads: whatsapp opt-in without phone must be rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.osint_results (lead_id, source, finding_type)
  select id, 'test', 'breach' from public.leads where email = 'mpt1001-ok@example.invalid'$$) = '', 'osint_results: insert must succeed');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.translation_queue (source_locale, target_locale, source_text) values ('en','en','x')$$) = '23514', 'translation_queue: same locale must be rejected');

-- ===== mpt-leads: engagement row exactly as the Worker writes it ================================
select pg_temp.assert(pg_temp.try_as('service_role',
  $$insert into public.mpt_user_engagement (session_id, full_scan_completed) values (gen_random_uuid()::text, true)$$) = '',
  'Worker engagement insert (no user_id, text session_id) must succeed');
select pg_temp.assert(pg_temp.try_as('anon',
  $$insert into public.mpt_user_engagement (session_id) values ('x')$$) = '42501', 'anon must not insert engagement');
select pg_temp.assert(pg_temp.try_as('authenticated',
  $$insert into public.mpt_user_engagement (session_id) values ('x')$$) = '42501', 'authenticated must not insert engagement');

-- an authenticated user never sees ownerless (channel-session) rows
set local role service_role;
insert into public.mpt_user_engagement (session_id) values ('ownerless');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select pg_temp.assert((select count(*) from public.mpt_user_engagement) = 0, 'ownerless engagement rows are invisible to users');
reset role;

-- ===== mpt-leads: baseline "first scan wins" contract ===========================================
set local role service_role;
insert into public.mpt_score_baselines (email_hash, overall_score, category_scores)
  values (repeat('a', 64), 40, '{"fingerprint":50}');
-- the Worker POSTs with Prefer: resolution=ignore-duplicates  ==  ON CONFLICT DO NOTHING
insert into public.mpt_score_baselines (email_hash, overall_score) values (repeat('a', 64), 99) on conflict (email_hash) do nothing;
select pg_temp.assert((select overall_score from public.mpt_score_baselines where email_hash = repeat('a', 64)) = 40, 'first baseline must win');
select pg_temp.assert((select count(*) from public.mpt_score_baselines) = 1, 'one baseline per email hash');
reset role;
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.mpt_score_baselines (email_hash, overall_score) values ('NOT-A-HASH', 1)$$) = '23514', 'email_hash must be 64 hex chars');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.mpt_score_baselines (email_hash, overall_score) values (repeat('b', 64), 101)$$) = '23514', 'overall_score must be 0..100');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.mpt_score_baselines (email_hash, overall_score) values (repeat('A', 64), 1)$$) = '23514', 'email_hash must be lower-case hex');

-- ===== scan-report pipeline: constraints, cascade, dedupe ======================================
set local role service_role;
insert into public.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'Dedupe@Example.com');
reset role;
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.users (email) values ('dedupe@example.COM')$$) = '23505', 'users.email is unique case-insensitively');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.users (email, tier) values ('t@x.co', 'platinum')$$) = '23514', 'users.tier is constrained');

set local role service_role;
insert into public.scans (id, user_id, email_scanned) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'dedupe@example.com');
insert into public.signals (id, scan_id, category, signal_type, severity, data_source)
  values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'broker', 'listing', 'high', 'spokeo');
insert into public.hexagon_scores (scan_id, category, score, risk_multiplier, color) values ('22222222-2222-2222-2222-222222222222', 'broker', 70, 1.5, 'ff0000');
insert into public.removal_tasks (user_id, signal_id, broker_name) values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Spokeo');
select pg_temp.assert((select report_status from public.scans) = 'pending', 'new scans start as report_status=pending');
select pg_temp.assert((select report_due_at - created_at from public.scans) = interval '48 hours', 'report is due 48 hours after the scan');
reset role;
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.scans (user_id, email_scanned, privacy_score) values ('11111111-1111-1111-1111-111111111111', 'a@b.co', 101)$$) = '23514', 'privacy_score is 0..100');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.scans (user_id, email_scanned, report_status) values ('11111111-1111-1111-1111-111111111111', 'a@b.co', 'done')$$) = '23514', 'report_status is constrained');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.signals (scan_id, category, signal_type, severity, data_source) values ('22222222-2222-2222-2222-222222222222', 'bogus', 't', 'low', 's')$$) = '23514', 'signal category is constrained');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.hexagon_scores (scan_id, category, risk_multiplier, color) values ('22222222-2222-2222-2222-222222222222', 'broker', 1.0, '00ff00')$$) = '23505', 'one hexagon score per scan+category');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.scans (user_id, email_scanned) values (gen_random_uuid(), 'a@b.co')$$) = '23503', 'scans require an existing user');

-- deleting a user cascades through scans -> signals -> hexagon_scores/removal_tasks (data-deletion requests)
set local role service_role;
delete from public.users where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.assert((select count(*) from public.scans) = 0 and (select count(*) from public.signals) = 0
  and (select count(*) from public.hexagon_scores) = 0 and (select count(*) from public.removal_tasks) = 0, 'user deletion cascades to all scan data');
reset role;

-- ===== github-channel: channel_tokens after the worker-columns migration =========================
select pg_temp.assert((select column_default from information_schema.columns where table_name = 'channel_tokens' and column_name = 'key_version') = '1', 'key_version defaults to 1');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.channel_tokens (user_id, provider, access_token_enc) values ('u1', 'github', 'v2.abc')$$) = '', 'rotated-key ciphertext (v2.) is accepted');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.channel_tokens (user_id, provider, access_token_enc) values ('u2', 'github', 'plaintext-token')$$) = '23514', 'plaintext tokens are rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.channel_tokens (user_id, provider, access_token_enc, refresh_token_enc) values ('u3', 'github', 'v1.a', 'raw')$$) = '23514', 'plaintext refresh tokens are rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.channel_tokens (user_id, provider, access_token_enc) values ('u1', 'github', 'v1.dup')$$) = '23505', '(user_id, provider) is unique');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.channel_tokens (user_id, provider, access_token_enc, key_version) values ('u4', 'github', 'v1.a', 0)$$) = '23514', 'key_version must be >= 1');

-- ===== oauth-poc: public.mpt_find_auth_user_by_email (MPC-6971) ===================================
-- Matches case-insensitively, only CONFIRMED and NOT-deleted users, and is callable by service_role only.
insert into auth.users (id, email, email_confirmed_at, deleted_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'Confirmed@Example.com', now(), null),
  ('00000000-0000-0000-0000-0000000000a2', 'unconfirmed@example.com', null, null),
  ('00000000-0000-0000-0000-0000000000a3', 'deleted@example.com', now(), now());
select pg_temp.assert(pg_temp.try_as('service_role', $$select public.mpt_find_auth_user_by_email('x@example.com')$$) = '', 'service_role can call the lookup');
set local role service_role;
select pg_temp.assert(public.mpt_find_auth_user_by_email('confirmed@example.COM') = '00000000-0000-0000-0000-0000000000a1', 'lookup is case-insensitive and finds the confirmed user');
select pg_temp.assert(public.mpt_find_auth_user_by_email('unconfirmed@example.com') is null, 'an unconfirmed email is not linkable');
select pg_temp.assert(public.mpt_find_auth_user_by_email('deleted@example.com') is null, 'a deleted user is not linkable');
select pg_temp.assert(public.mpt_find_auth_user_by_email('nobody@example.com') is null, 'an unknown email returns NULL');
reset role;
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_find_auth_user_by_email('confirmed@example.com')$$) = '42501', 'anon cannot call the lookup');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select public.mpt_find_auth_user_by_email('confirmed@example.com')$$) = '42501', 'authenticated cannot call the lookup');

-- ===== MPC-7508: subscribers (public newsletter signup), indexes, updated_at, default privileges =========
select pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = 'public.subscribers'::regclass), 'subscribers: RLS enabled and forced');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.subscribers (email, consent_given_at, consent_source) values ('a@example.com', now(), 'newsletter_page')$$) = '', 'anon can sign up with the Newsletter payload');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.subscribers (email, consent_given_at, consent_source) values ('a@example.com', now(), 'newsletter_page')$$) = '23505', 'duplicate signup is a unique violation (page treats it as success)');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.subscribers (email) values ('not-an-email')$$) = '42501', 'anon: malformed email rejected by policy');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.subscribers (email) values (repeat('a', 300) || '@example.com')$$) = '42501', 'anon: oversized email rejected by policy');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.subscribers (email, risk_score) values ('b@example.com', 1)$$) = '42501', 'anon cannot set server-owned columns');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.subscribers (email, ip_address) values ('b@example.com', '1.2.3.4')$$) = '42501', 'anon cannot set ip_address');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.subscribers$$) = '42501', 'anon cannot read subscribers');
select pg_temp.assert(pg_temp.try_as('anon', $$update public.subscribers set email = 'x@example.com'$$) = '42501', 'anon cannot update subscribers');
select pg_temp.assert(pg_temp.try_as('anon', $$delete from public.subscribers$$) = '42501', 'anon cannot delete subscribers');
select pg_temp.assert(pg_temp.try_as('anon', $$truncate public.subscribers$$) = '42501', 'anon cannot truncate subscribers');
select pg_temp.assert(pg_temp.try_as('authenticated', $$insert into public.subscribers (email) values ('c@example.com')$$) = '42501', 'authenticated cannot write subscribers');
select pg_temp.assert(pg_temp.try_as('service_role', $$select 1 from public.subscribers$$) = '', 'service_role reads subscribers');
select pg_temp.assert(to_regclass('public.subscribers_email_idx') is null, 'redundant subscribers_email_idx is gone');
select pg_temp.assert(to_regclass('public.leads_user_id_idx') is not null and to_regclass('public.removal_tasks_signal_id_idx') is not null, 'FK covering indexes exist');

-- updated_at is maintained on update
insert into public.users (id, email, updated_at) values ('00000000-0000-0000-0000-0000000000b1', 'upd@example.com', now() - interval '1 day');
update public.users set tier = 'basic' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.assert((select updated_at > now() - interval '1 minute' from public.users where id = '00000000-0000-0000-0000-0000000000b1'), 'users.updated_at is bumped on update');

-- a table created later is not exposed to anon/authenticated by default
create table public.mpc7508_probe (id int);
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.mpc7508_probe$$) = '42501', 'new tables are not granted to anon by default');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select 1 from public.mpc7508_probe$$) = '42501', 'new tables are not granted to authenticated by default');

-- ===== CK-006: OSINT + Progressive Trust tables and leads columns ==========================================
do $$
declare t text;
begin
  foreach t in array array['osint_results','conversation_states','channel_preferences','translation_queue'] loop
    perform pg_temp.assert(to_regclass('public.' || t) is not null, t || ': table exists');
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon must be denied');
    perform pg_temp.assert(pg_temp.try_as('authenticated', format('select 1 from public.%I', t)) = '42501', t || ': authenticated must be denied');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role must read');
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS must be enabled and forced');
  end loop;
end $$;
select pg_temp.assert((select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'leads'
  and column_name in ('phone_number','whatsapp_opt_in','locale_code','confidence_score')), 'leads has the four CK-006 columns');

insert into public.leads (id, email, phone_number, locale_code, confidence_score)
  values ('00000000-0000-0000-0000-0000000000c1', 'ck006@example.com', '+15551234567', 'pt-BR', 0.85);
select pg_temp.assert((select whatsapp_opt_in = false from public.leads where id = '00000000-0000-0000-0000-0000000000c1'), 'leads.whatsapp_opt_in defaults to false');
select pg_temp.assert(pg_temp.try_as('service_role', $$update public.leads set phone_number = '5551234' where email = 'ck006@example.com'$$) = '23514', 'leads: non-E.164 phone rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$update public.leads set confidence_score = 1.5 where email = 'ck006@example.com'$$) in ('23514','22003'), 'leads: confidence_score > 1 rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$update public.leads set locale_code = 'not a locale' where email = 'ck006@example.com'$$) = '23514', 'leads: bad locale_code rejected');

insert into public.osint_results (lead_id, source, query_type) values ('00000000-0000-0000-0000-0000000000c1', 'test', 'email');
insert into public.conversation_states (lead_id, channel) values ('00000000-0000-0000-0000-0000000000c1', 'whatsapp');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.conversation_states (lead_id, channel) values ('00000000-0000-0000-0000-0000000000c1', 'whatsapp')$$) = '23505', 'conversation_states: one row per lead per channel');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.conversation_states (lead_id, channel) values ('00000000-0000-0000-0000-0000000000c1', 'fax')$$) = '23514', 'conversation_states: unknown channel rejected');
insert into public.channel_preferences (lead_id, channel, is_preferred) values ('00000000-0000-0000-0000-0000000000c1', 'whatsapp', true);
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.channel_preferences (lead_id, channel, is_preferred) values ('00000000-0000-0000-0000-0000000000c1', 'sms', true)$$) = '23505', 'channel_preferences: only one preferred channel per lead');
insert into public.translation_queue (lead_id, source_text, source_locale, target_locale) values ('00000000-0000-0000-0000-0000000000c1', 'hello', 'en', 'pt-BR');
select pg_temp.assert((select status = 'pending' from public.translation_queue limit 1), 'translation_queue: new jobs start pending');
update public.conversation_states set updated_at = now() - interval '1 day';
update public.conversation_states set state = 'engaged';
select pg_temp.assert((select updated_at > now() - interval '1 minute' from public.conversation_states limit 1), 'conversation_states.updated_at is bumped on update');
delete from public.leads where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.assert((select count(*) = 0 from public.osint_results) and (select count(*) = 0 from public.conversation_states)
  and (select count(*) = 0 from public.channel_preferences) and (select count(*) = 0 from public.translation_queue), 'deleting a lead erases its OSINT/trust/channel/translation rows');

rollback;
select 'schema.test.sql: all assertions passed' as result;
