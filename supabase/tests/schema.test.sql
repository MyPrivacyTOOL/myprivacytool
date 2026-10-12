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
                           'hexagon_scores','removal_tasks','leads','channel_tokens'] loop
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon must be denied');
    perform pg_temp.assert(pg_temp.try_as('authenticated', format('select 1 from public.%I', t)) = '42501', t || ': authenticated must be denied');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role must read');
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS must be enabled and forced');
  end loop;
end $$;

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

-- ===== MPC-8601: core-brain state write-back + interaction_log ====================================
select pg_temp.assert(to_regclass('public.interaction_log') is not null, 'interaction_log: table exists');
select pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.interaction_log') = '42501', 'interaction_log: anon must be denied');
select pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.interaction_log') = '42501', 'interaction_log: authenticated must be denied');
select pg_temp.assert(pg_temp.try_as('service_role', 'select 1 from public.interaction_log') = '', 'interaction_log: service_role must read');
select pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = 'public.interaction_log'::regclass), 'interaction_log: RLS must be enabled and forced');
select pg_temp.assert((select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name = 'interaction_log'
  and column_name in ('message_text','message','text','body','sender_id')), 'interaction_log: carries no message text and no sender id');

-- the write-back functions are service_role only (checked on the privilege itself: the functions run as the caller, so a
-- SQLSTATE test would also pass through the tables' own denial)
do $$
declare f text;
begin
  foreach f in array array['public.mpt_brain_record(text,text,text,text,text,text,smallint)',
                           'public.mpt_erase_chat_sender(text,text)',
                           'public.mpt_purge_expired_interaction_log()'] loop
    perform pg_temp.assert(not has_function_privilege('anon', f, 'execute'), f || ': anon must not execute');
    perform pg_temp.assert(not has_function_privilege('authenticated', f, 'execute'), f || ': authenticated must not execute');
    perform pg_temp.assert(has_function_privilege('service_role', f, 'execute'), f || ': service_role must execute');
  end loop;
end $$;

-- a state row needs a lead or a sender
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.conversation_states (channel) values ('telegram')$$) = '23514', 'conversation_states: a row needs a lead_id or a sender_id');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.conversation_states (channel, sender_id) values ('telegram', '')$$) = '23514', 'conversation_states: empty sender_id rejected');

-- first scan: creates the sender's row (no lead), state awaiting_confirmation, trust 0
select pg_temp.assert((select public.mpt_brain_record('telegram','sender-1','scan','qwen','bot.first_hexagon.title','awaiting_confirmation',0::smallint))
  = '{"state":"awaiting_confirmation","trust_level":0,"persisted":true}'::jsonb, 'brain_record: first scan result');
select pg_temp.assert((select count(*) = 1 and bool_and(lead_id is null) and bool_and(state = 'awaiting_confirmation') and bool_and(trust_level = 0)
  and bool_and(last_message_at is not null) from public.conversation_states where channel = 'telegram' and sender_id = 'sender-1'),
  'brain_record: a chat sender gets one state row without a lead');
-- "yes": confirmed, trust rises to the floor
select pg_temp.assert((select public.mpt_brain_record('telegram','sender-1','verify','rules','bot.confirmed_y.title','confirmed',1::smallint))
  = '{"state":"confirmed","trust_level":1,"persisted":true}'::jsonb, 'brain_record: confirmation raises trust to 1');
-- a later message can never lower trust, even with a lower floor and another state
select pg_temp.assert((select public.mpt_brain_record('telegram','sender-1','help','rules','bot.unknown.title','confirmed',0::smallint))
  = '{"state":"confirmed","trust_level":1,"persisted":true}'::jsonb, 'brain_record: trust never decreases');
select pg_temp.assert((select count(*) = 1 from public.conversation_states where channel = 'telegram' and sender_id = 'sender-1'), 'brain_record: repeated calls keep one row per sender');
select pg_temp.assert((select count(*) = 3 and bool_and(conversation_state_id is not null) from public.interaction_log l
  join public.conversation_states c on c.id = l.conversation_state_id where c.sender_id = 'sender-1'), 'interaction_log: one row per routed message, linked to the state row');
select pg_temp.assert((select state_before = 'awaiting_confirmation' and state_after = 'confirmed' and trust_before = 0 and trust_after = 1 and intent = 'verify'
  from public.interaction_log l join public.conversation_states c on c.id = l.conversation_state_id
  where c.sender_id = 'sender-1' and l.response_key = 'bot.confirmed_y.title'), 'interaction_log: records the before/after state and trust');

-- a NULL state keeps the current state (the Worker sends it when it could not read the sender's state)
select pg_temp.assert((select public.mpt_brain_record('telegram','sender-1','scan','rules','bot.first_hexagon.title', null, 0::smallint))
  = '{"state":"confirmed","trust_level":1,"persisted":true}'::jsonb, 'brain_record: a NULL state keeps the stored state and trust');
select pg_temp.assert((select count(*) = 1 and bool_and(state_after = 'confirmed' and trust_before = 1 and trust_after = 1)
  from public.interaction_log l join public.conversation_states c on c.id = l.conversation_state_id
  where c.sender_id = 'sender-1' and l.intent = 'scan' and l.state_before = 'confirmed'), 'interaction_log: a NULL-state call logs an unchanged state');

-- input validation
select pg_temp.assert(pg_temp.try_as('service_role', $$select public.mpt_brain_record('telegram','s2','scan','qwen','k','bogus_state',0::smallint)$$) = '22023', 'brain_record: unknown state rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$select public.mpt_brain_record('telegram','s2','scan','qwen','k','new',6::smallint)$$) = '22023', 'brain_record: trust floor above 5 rejected');
select pg_temp.assert(pg_temp.try_as('service_role', $$select public.mpt_brain_record('telegram','s2','bogus','qwen','k','new',0::smallint)$$) = '23514', 'brain_record: unknown intent rejected');
select pg_temp.assert((select count(*) = 0 from public.conversation_states where sender_id = 's2'), 'brain_record: a rejected call leaves no state row behind');

-- channels without a state row (X) and calls without a sender are log-only
select pg_temp.assert((select public.mpt_brain_record('x', null, 'help', 'rules', 'bot.unknown.title', 'new', 0::smallint))
  = '{"state":"new","trust_level":0,"persisted":false}'::jsonb, 'brain_record: X is log-only');
select pg_temp.assert((select count(*) = 0 from public.conversation_states where channel = 'x'), 'brain_record: no state row for X');
select pg_temp.assert((select count(*) = 1 and bool_and(conversation_state_id is null) from public.interaction_log where channel = 'x'), 'interaction_log: X row is logged without a state link');

-- erasing a chat sender removes its state and its log rows, and only those
select pg_temp.assert((select public.mpt_erase_chat_sender('telegram', 'sender-1')) = 1, 'mpt_erase_chat_sender: removes the sender row');
select pg_temp.assert((select count(*) = 0 from public.interaction_log where channel = 'telegram'), 'mpt_erase_chat_sender: log rows cascade');
select pg_temp.assert((select count(*) = 1 from public.interaction_log where channel = 'x'), 'mpt_erase_chat_sender: other log rows stay');
select pg_temp.assert((select public.mpt_erase_chat_sender('telegram', 'sender-1')) = 0, 'mpt_erase_chat_sender: erasing twice is a no-op');

-- retention purge
update public.interaction_log set retain_until = now() - interval '1 day';
select pg_temp.assert((select public.mpt_purge_expired_interaction_log()) = 1, 'mpt_purge_expired_interaction_log: removes expired rows');
select pg_temp.assert((select count(*) = 0 from public.interaction_log), 'mpt_purge_expired_interaction_log: table is empty after purge');

-- an existing lead-owned row still works next to sender-owned rows, and deleting the lead still erases it
insert into public.leads (id, email) values ('00000000-0000-0000-0000-0000000000c8', 'mpc8601@example.com');
insert into public.conversation_states (lead_id, channel, sender_id) values ('00000000-0000-0000-0000-0000000000c8', 'telegram', 'sender-lead');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.conversation_states (channel, sender_id) values ('telegram', 'sender-lead')$$) = '23505', 'conversation_states: one row per channel and sender');
select pg_temp.assert(public.mpt_brain_record('telegram','sender-lead','scan','qwen','bot.first_hexagon.title','awaiting_confirmation',0::smallint) is not null, 'brain_record: works for a sender that also has a lead');
delete from public.leads where id = '00000000-0000-0000-0000-0000000000c8';
select pg_temp.assert((select count(*) = 0 from public.conversation_states where sender_id = 'sender-lead') and (select count(*) = 0 from public.interaction_log where channel = 'telegram'),
  'deleting a lead erases its sender-linked state and log rows');

-- ===== MPC-7450: hk_spam_registrations is anon INSERT-only, no phone column, day-10 view for service_role ====
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name = 'hk_spam_registrations' and column_name ilike any (array['%phone%', '%mobile%', '%msisdn%', '%number%'])),
  'hk_spam_registrations must not have a phone number column');
select pg_temp.assert(pg_temp.try_as('anon',
  $$insert into public.hk_spam_registrations (platform, language, protection_date) values ('ios', 'en', '2026-10-23')$$) = '',
  'hk_spam_registrations: anon may insert');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.hk_spam_registrations$$) = '42501', 'hk_spam_registrations: anon must not select');
select pg_temp.assert(pg_temp.try_as('anon', $$update public.hk_spam_registrations set email = 'x@y.zz'$$) = '42501', 'hk_spam_registrations: anon must not update');
select pg_temp.assert(pg_temp.try_as('anon', $$delete from public.hk_spam_registrations$$) = '42501', 'hk_spam_registrations: anon must not delete');
select pg_temp.assert(pg_temp.try_as('authenticated', $$insert into public.hk_spam_registrations (platform, language, protection_date) values ('ios', 'en', '2026-10-23')$$) = '42501',
  'hk_spam_registrations: authenticated has no insert');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date) values ('windows', 'en', '2026-10-23')$$) = '23514', 'platform is constrained');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, reminder_consent) values ('ios', 'en', '2026-10-23', true)$$) = '23514', 'consent needs an email');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, marketing_consent) values ('ios', 'en', '2026-10-23', true)$$) = '23514', 'marketing consent needs an email');
select pg_temp.assert((select column_default from information_schema.columns where table_name = 'hk_spam_registrations' and column_name = 'marketing_consent') = 'false', 'marketing_consent defaults to false');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, email) values ('ios', 'en', '2026-10-23', 'not-an-email')$$) = '23514', 'email shape is checked');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.hk_spam_due_reminders$$) = '42501', 'hk_spam_due_reminders: anon must not read');
select pg_temp.assert(pg_temp.try_as('service_role', $$select 1 from public.hk_spam_due_reminders$$) = '', 'hk_spam_due_reminders: service_role reads');

set local role service_role;
insert into public.hk_spam_registrations (platform, language, protection_date, email, reminder_consent) values
  ('android', 'yue', (now() at time zone 'Asia/Hong_Kong')::date, 'due@example.com', true),                       -- due
  ('android', 'en',  (now() at time zone 'Asia/Hong_Kong')::date, 'noconsent@example.com', false),                -- no consent
  ('ios',     'en',  (now() at time zone 'Asia/Hong_Kong')::date, null, false),                                   -- no email
  ('ios',     'en',  (now() at time zone 'Asia/Hong_Kong')::date + 1, 'tomorrow@example.com', true);              -- not today
select pg_temp.assert((select count(*) from public.hk_spam_due_reminders) = 1 and (select email from public.hk_spam_due_reminders) = 'due@example.com',
  'hk_spam_due_reminders: only today + email + consent');
reset role;

-- ===== MPC-7448: reminder_sent_at (at-most-once) and email_suppressions =====
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, reminder_sent_at) values ('ios', 'en', '2026-10-23', now())$$) = '42501',
  'hk_spam_registrations: anon cannot set reminder_sent_at');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, email, reminder_consent, marketing_consent, utm_source, source_page) values ('ios', 'yue', '2026-10-23', 'a@example.com', true, true, 'x', '/HongKongSpam')$$) = '',
  'hk_spam_registrations: anon can still insert all the form columns');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.email_suppressions$$) = '42501', 'email_suppressions: anon must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.email_suppressions (email_hash) values (repeat('a', 64))$$) = '42501', 'email_suppressions: anon must not insert');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select 1 from public.email_suppressions$$) = '42501', 'email_suppressions: authenticated must not read');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.email_suppressions (email_hash, source) values (repeat('a', 64), 'unsubscribe')$$) = '', 'email_suppressions: service_role inserts');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.email_suppressions (email_hash) values (repeat('a', 64))$$) = '23505', 'email_suppressions: one row per hash');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.email_suppressions (email_hash) values ('not-a-hash')$$) = '23514', 'email_suppressions: hash shape is checked');

set local role service_role;
insert into public.hk_spam_registrations (platform, language, protection_date, email, reminder_consent) values
  ('ios', 'en', (now() at time zone 'Asia/Hong_Kong')::date, 'claim@example.com', true);
select pg_temp.assert((select count(*) from public.hk_spam_due_reminders where email = 'claim@example.com') = 1, 'due view: unsent row is listed');
select pg_temp.assert((select count(*) from public.hk_spam_registrations where email = 'claim@example.com' and reminder_sent_at is null) = 1, 'reminder_sent_at starts null');
update public.hk_spam_registrations set reminder_sent_at = now() where email = 'claim@example.com' and reminder_sent_at is null;
select pg_temp.assert((select count(*) from public.hk_spam_due_reminders where email = 'claim@example.com') = 0, 'due view: a claimed row is no longer listed');
with u as (update public.hk_spam_registrations set reminder_sent_at = now() where email = 'claim@example.com' and reminder_sent_at is null returning 1)
  select pg_temp.assert(count(*) = 0, 'claim is atomic: a second claim matches nothing') from u;
reset role;

-- ===== MPC-7538: marketing consent, 90-day retention job, deletion/access routes =====
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, email, marketing_consent) values ('ios', 'en', '2026-10-23', 'tips@example.com', true)$$) = '',
  'hk_spam: anon may insert marketing_consent with an email');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.hk_spam_registrations (platform, language, protection_date, marketing_consent) values ('ios', 'en', '2026-10-23', true)$$) = '23514',
  'hk_spam: marketing consent needs an email');
select pg_temp.assert((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'hk_spam_registrations' and column_name = 'marketing_consent') = 'false',
  'hk_spam: marketing_consent defaults to false (unticked)');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.hk_spam_marketing_recipients$$) = '42501', 'hk_spam_marketing_recipients: anon must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_purge_expired_hk_spam(true)$$) = '42501', 'mpt_purge_expired_hk_spam: anon must not run');
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_delete_hk_spam_by_email('a@example.com')$$) = '42501', 'mpt_delete_hk_spam_by_email: anon must not run');
select pg_temp.assert(pg_temp.try_as('anon', $$select * from public.mpt_export_hk_spam_by_email('a@example.com')$$) = '42501', 'mpt_export_hk_spam_by_email: anon must not run');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.hk_spam_deletion_log$$) = '42501', 'hk_spam_deletion_log: anon must not read');

set local role service_role;
delete from public.hk_spam_registrations;
insert into public.hk_spam_registrations (platform, language, protection_date, email, reminder_consent, marketing_consent) values
  ('ios', 'en',  (now() at time zone 'Asia/Hong_Kong')::date - 91, 'old-reminder@example.com', true,  false),   -- past 90 days, no marketing: deleted
  ('ios', 'en',  (now() at time zone 'Asia/Hong_Kong')::date - 90, 'edge@example.com',         true,  false),   -- exactly 90 days: deleted
  ('ios', 'en',  (now() at time zone 'Asia/Hong_Kong')::date - 89, 'recent@example.com',       true,  false),   -- 89 days: kept
  ('ios', 'yue', (now() at time zone 'Asia/Hong_Kong')::date - 200, 'tips@example.com',        true,  true),    -- marketing consent: kept
  ('ios', 'yue', (now() at time zone 'Asia/Hong_Kong')::date - 200, 'unsub@example.com',       false, true),    -- unsubscribed: consent ends, then deleted
  ('ios', 'en',  (now() at time zone 'Asia/Hong_Kong')::date - 300, null,                      false, false);   -- no email: the row still goes
insert into public.email_suppressions (email_hash, source) values (encode(sha256(convert_to('unsub@example.com', 'UTF8')), 'hex'), 'unsubscribe');
select pg_temp.assert((select count(*) from public.hk_spam_marketing_recipients) = 1 and (select email from public.hk_spam_marketing_recipients) = 'tips@example.com',
  'marketing recipients: only marketing_consent = true and not unsubscribed');
select pg_temp.assert((public.mpt_purge_expired_hk_spam(true)->>'rows_deleted')::int = 4, 'purge dry run counts 4 rows');
select pg_temp.assert((select count(*) from public.hk_spam_registrations) = 6, 'purge dry run deletes nothing');
select pg_temp.assert((public.mpt_purge_expired_hk_spam()->>'rows_deleted')::int = 4, 'purge deletes 4 rows');
select pg_temp.assert((select count(*) from public.hk_spam_registrations) = 2
  and exists (select 1 from public.hk_spam_registrations where email = 'recent@example.com')
  and exists (select 1 from public.hk_spam_registrations where email = 'tips@example.com'),
  'purge keeps the 89-day row and the marketing-consent row');
select pg_temp.assert((select count(*) from public.hk_spam_deletion_log where kind = 'purge' and rows_deleted = 4 and consent_ended = 1) = 1
  and (select count(*) from public.hk_spam_deletion_log where kind = 'purge_dry_run') = 1, 'purge is logged, counts only');
select pg_temp.assert((select count(*) from public.mpt_export_hk_spam_by_email(' TIPS@example.com ')) = 1, 'export finds the record by email');
select pg_temp.assert(public.mpt_delete_hk_spam_by_email('Tips@Example.com') = 1, 'deletion by email reports one record');
select pg_temp.assert(not exists (select 1 from public.hk_spam_registrations where email = 'tips@example.com'), 'deletion by email removes the record');
reset role;

-- ===== MPC-7465: web_scans + web_scan_contacts (service_role only) =====
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.web_scans$$) = '42501', 'web_scans: anon must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.web_scans (hexagon_count, results, results_bytes) values (1, '[{}]', 4)$$) = '42501', 'web_scans: anon must not insert');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select 1 from public.web_scan_contacts$$) = '42501', 'web_scan_contacts: authenticated must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.web_scan_funnel$$) = '42501', 'web_scan_funnel: anon must not read');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scans (hexagon_count, results, results_bytes) values (2, '[{}]', 4)$$) = '23514', 'web_scans: hexagon_count must match results');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scans (hexagon_count, results, results_bytes) values (1, '{}', 2)$$) = '23514', 'web_scans: results must be an array');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values (gen_random_uuid(), 'email', gen_random_uuid())$$) = '23503', 'web_scan_contacts: scan number must exist');
select pg_temp.assert((select relforcerowsecurity from pg_class where oid = 'public.web_scans'::regclass) and (select relforcerowsecurity from pg_class where oid = 'public.web_scan_contacts'::regclass), 'web scan tables: RLS forced');

set local role service_role;
insert into public.web_scans (id, hexagon_count, results, results_bytes) values
  ('00000000-0000-4000-8000-000000007465', 1, '[{"id":"browser","label":"Browser","value":"Testfox 1"}]', 50),
  ('00000000-0000-4000-8000-000000007466', 1, '[{"id":"browser","label":"Browser","value":"Testfox 2"}]', 50);
insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values ('00000000-0000-4000-8000-000000007465', 'email', gen_random_uuid());
insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values ('00000000-0000-4000-8000-000000007465', 'telegram', gen_random_uuid());   -- a new channel needs no schema change
update public.web_scan_contacts set save_consent_at = now(), save_consent_version = '2026-10-12-v1' where web_scan_id = '00000000-0000-4000-8000-000000007465' and channel = 'email';   -- MPC-7470: consent record on the link
select pg_temp.assert((select count(*) from public.web_scan_contacts where web_scan_id = '00000000-0000-4000-8000-000000007465' and save_consent_at is not null and save_consent_version = '2026-10-12-v1') = 1, 'web_scan_contacts: stores the save-consent time and wording version (MPC-7470)');
select pg_temp.assert((select sum(scans_completed) from public.web_scan_funnel) >= 2 and (select sum(scans_with_contact) from public.web_scan_funnel) >= 1
  and (select sum(scans_without_contact) from public.web_scan_funnel) >= 1, 'web_scan_funnel: counts scans with and without a contact');
reset role;

-- ===== MPC-7470: web scan retention purge (service_role only; 90 days unlinked, 12 months linked) =====
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_purge_expired_web_scans()$$) = '42501', 'mpt_purge_expired_web_scans: anon must not execute');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select public.mpt_purge_expired_web_scans()$$) = '42501', 'mpt_purge_expired_web_scans: authenticated must not execute');

-- ===== MPC-7488: deletion by scan number, retention setting, dry run, deletion log (service_role only) =====
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_delete_web_scan(gen_random_uuid())$$) = '42501', 'mpt_delete_web_scan: anon must not execute');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select public.mpt_export_web_scan(gen_random_uuid())$$) = '42501', 'mpt_export_web_scan: authenticated must not execute');
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_purge_expired_web_scans(true)$$) = '42501', 'mpt_purge_expired_web_scans(dry run): anon must not execute');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.web_scan_deletion_log$$) = '42501', 'web_scan_deletion_log: anon must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.web_scan_retention$$) = '42501', 'web_scan_retention: anon must not read');
select pg_temp.assert((select months from public.web_scan_retention) = 12 and (select unlinked_days from public.web_scan_retention) = 90, 'web_scan_retention: defaults are 12 months, 90 days unlinked');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_retention (id, months) values (false, 6)$$) = '23514', 'web_scan_retention: only one row is possible');

set local role service_role;
-- fixtures (made-up ids): A old+linked, B old+unlinked (past 90 days, under 12 months), C recent, D recent+linked, E older than 12 months, unlinked
insert into public.web_scans (id, created_at, hexagon_count, results, results_bytes) values
  ('00000000-0000-4000-8000-0000000074a1', now() - interval '13 months', 1, '[{"id":"browser","label":"Browser","value":"Testfox A"}]', 50),
  ('00000000-0000-4000-8000-0000000074a2', now() - interval '120 days',  1, '[{"id":"browser","label":"Browser","value":"Testfox B"}]', 50),
  ('00000000-0000-4000-8000-0000000074a3', now() - interval '10 days',   1, '[{"id":"browser","label":"Browser","value":"Testfox C"}]', 50),
  ('00000000-0000-4000-8000-0000000074a4', now() - interval '10 days',   1, '[{"id":"browser","label":"Browser","value":"Testfox D"}]', 50),
  ('00000000-0000-4000-8000-0000000074a5', now() - interval '14 months', 1, '[{"id":"browser","label":"Browser","value":"Testfox E"}]', 50);
insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values
  ('00000000-0000-4000-8000-0000000074a1', 'email', gen_random_uuid()),
  ('00000000-0000-4000-8000-0000000074a4', 'email', gen_random_uuid());
delete from public.web_scan_deletion_log;

-- dry run: reports the count, deletes nothing, logs a dry-run row
select pg_temp.assert((public.mpt_purge_expired_web_scans(true)->>'scans')::int = 3 and (public.mpt_purge_expired_web_scans(true)->>'dry_run')::boolean, 'purge dry run: counts A, B and E');
select pg_temp.assert((select count(*) from public.web_scans where id::text like '00000000-0000-4000-8000-0000000074a%') = 5, 'purge dry run: nothing deleted');
select pg_temp.assert((select count(*) from public.web_scan_deletion_log where kind = 'purge_dry_run') = 2 and (select count(*) from public.web_scan_deletion_log where kind = 'purge') = 0, 'purge dry run: logged as a dry run');

-- the period is one setting: shorten unlinked_days off and months to 12 -> only the over-12-months scans go (A linked, E unlinked)
update public.web_scan_retention set unlinked_days = null;
select pg_temp.assert((public.mpt_purge_expired_web_scans(true)->>'scans')::int = 2, 'retention setting: with unlinked_days off only the 12-month rule applies');
update public.web_scan_retention set unlinked_days = 90;

-- real run: A (old, linked), B (unlinked past 90 days), E (older than 12 months) go; C and D stay
create temp table purge_runs as select 1 as n, public.mpt_purge_expired_web_scans() as j;
insert into purge_runs select 2, public.mpt_purge_expired_web_scans(false);
select pg_temp.assert((select (j->>'scans')::int from purge_runs where n = 1) = 3 and (select (j->>'scans')::int from purge_runs where n = 2) = 0, 'purge: deletes A, B, E and nothing on a second run');
select pg_temp.assert((select array_agg(right(id::text, 2) order by id) from public.web_scans where id::text like '00000000-0000-4000-8000-0000000074a%') = array['a3','a4'], 'purge: keeps the recent scans');
select pg_temp.assert((select count(*) from public.web_scan_contacts where web_scan_id = '00000000-0000-4000-8000-0000000074a1') = 0, 'purge: the contact link goes with its scan');
select pg_temp.assert((select scans_deleted from public.web_scan_deletion_log where kind = 'purge' order by id limit 1) = 3 and (select links_deleted from public.web_scan_deletion_log where kind = 'purge' order by id limit 1) = 1, 'purge: count logged');

-- export and delete by scan number
select pg_temp.assert((public.mpt_export_web_scan('00000000-0000-4000-8000-0000000074a4')->'web_scan'->>'id') = '00000000-0000-4000-8000-0000000074a4'
  and jsonb_array_length(public.mpt_export_web_scan('00000000-0000-4000-8000-0000000074a4')->'contact_links') = 1, 'export by scan number: returns the scan and its links');
select pg_temp.assert((public.mpt_export_web_scan(gen_random_uuid())->'web_scan') = 'null'::jsonb, 'export by scan number: unknown number returns nothing');
create temp table delete_run as select public.mpt_delete_web_scan('00000000-0000-4000-8000-0000000074a4') as j;
select pg_temp.assert((select (j->>'scans_deleted')::int = 1 and (j->>'contact_links_deleted')::int = 1 from delete_run), 'delete by scan number: reports one scan and one link deleted');
select pg_temp.assert((select count(*) from public.web_scan_contacts where web_scan_id = '00000000-0000-4000-8000-0000000074a4') = 0
  and (select count(*) from public.web_scans where id = '00000000-0000-4000-8000-0000000074a4') = 0, 'delete by scan number: removes the scan and its contact link');
select pg_temp.assert((select count(*) from public.web_scans where id = '00000000-0000-4000-8000-0000000074a3') = 1, 'delete by scan number: leaves other scans');
create temp table delete_run2 as select public.mpt_delete_web_scan(gen_random_uuid()) as j;
select pg_temp.assert((select (j->>'found')::boolean = false and (j->>'scans_deleted')::int = 0 from delete_run2), 'delete by scan number: unknown number deletes nothing');
select pg_temp.assert((select count(*) from public.web_scan_deletion_log where kind = 'by_scan_number') = 2, 'delete by scan number: each call is logged');
-- the log holds counts only: no uuid, no email, no browser value anywhere in it
select pg_temp.assert(not exists (select 1 from public.web_scan_deletion_log l where l::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-|@|Testfox'), 'deletion log: no scan number, email or value');
reset role;

-- ===== MPC-7490: edge_visits (service_role only), IP cut for person/unknown after the retention setting =====
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.edge_visits$$) = '42501', 'edge_visits: anon must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.edge_visits (path, method, class, rule, ruleset_version) values ('/', 'GET', 'person', 'R8', 'v')$$) = '42501', 'edge_visits: anon must not insert');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select 1 from public.edge_visit_retention$$) = '42501', 'edge_visit_retention: authenticated must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_cut_edge_visit_ips()$$) = '42501', 'mpt_cut_edge_visit_ips: anon must not execute');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select public.mpt_cut_edge_visit_ips(true)$$) = '42501', 'mpt_cut_edge_visit_ips: authenticated must not execute');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.edge_visits (path, method, class, rule, ruleset_version) values ('/', 'GET', 'robot', 'R8', 'v')$$) = '23514', 'edge_visits: class must be one of the four');
select pg_temp.assert((select relforcerowsecurity from pg_class where oid = 'public.edge_visits'::regclass) and (select relforcerowsecurity from pg_class where oid = 'public.edge_visit_retention'::regclass), 'edge visit tables: RLS forced');
select pg_temp.assert((select ip_days from public.edge_visit_retention) = 30, 'edge_visit_retention: default 30 days');
-- made-up rows: 40 days old (older than the 30-day default) and 5 days old, one per class; documentation-range IPs only
insert into public.edge_visits (seen_at, path, method, status, user_agent, ip, class, rule, ruleset_version) values
  (now() - interval '40 days', '/', 'GET', 200, 'ExampleBrowser/1.0', '192.0.2.10', 'person',  'R8', 'test'),
  (now() - interval '40 days', '/', 'GET', 200, 'ExampleBrowser/1.0', '192.0.2.11', 'unknown', 'R5', 'test'),
  (now() - interval '40 days', '/', 'GET', 200, 'ExampleAIBot/1.0',   '192.0.2.12', 'ai',      'R1', 'test'),
  (now() - interval '40 days', '/', 'GET', 200, 'ExampleCrawler/1.0', '192.0.2.13', 'bot',     'R4', 'test'),
  (now() - interval '5 days',  '/', 'GET', 200, 'ExampleBrowser/1.0', '192.0.2.14', 'person',  'R8', 'test');
create temp table cut_dry as select public.mpt_cut_edge_visit_ips(true) as j;
select pg_temp.assert((select (j->>'ips_cut')::int = 2 and (j->>'dry_run')::boolean from cut_dry) and (select count(*) from public.edge_visits where ip is not null) = 5, 'edge ip cut: dry run counts person+unknown only and changes nothing');
create temp table cut_run as select public.mpt_cut_edge_visit_ips(false) as j;
select pg_temp.assert((select (j->>'ips_cut')::int = 2 from cut_run), 'edge ip cut: cuts the old person and unknown rows');
select pg_temp.assert((select count(*) from public.edge_visits where class in ('person','unknown') and seen_at < now() - interval '30 days' and ip is not null) = 0, 'edge ip cut: no old person/unknown IP left');
select pg_temp.assert((select count(*) from public.edge_visits where class in ('bot','ai') and ip is not null) = 2, 'edge ip cut: bot and ai rows kept in full');
select pg_temp.assert((select ip from public.edge_visits where ip is not null and class = 'person') = '192.0.2.14', 'edge ip cut: recent person row keeps its IP');
select pg_temp.assert((select count(*) from public.edge_visits where ip is null and ip_cut_at is not null and user_agent is not null and path = '/' and rule is not null) = 2, 'edge ip cut: the rest of a cut row stays');
update public.edge_visit_retention set ip_days = 3;
select pg_temp.assert((select (public.mpt_cut_edge_visit_ips(false)->>'ips_cut')::int) = 1, 'edge ip cut: reads the retention setting (3 days cuts the 5-day-old person row)');
reset role;

-- ===== MPC-7493: learning loop: web_scan_events, web_scan_returns, mpt_learning_loop (service_role only; aggregates only) =====
select pg_temp.assert(pg_temp.try_as('anon', $$select 1 from public.web_scan_events$$) = '42501', 'web_scan_events: anon must not read');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select 1 from public.web_scan_returns$$) = '42501', 'web_scan_returns: authenticated must not read');
select pg_temp.assert(pg_temp.try_as('anon', $$insert into public.web_scan_events (web_scan_id, step) values (gen_random_uuid(), 'results_viewed')$$) = '42501', 'web_scan_events: anon must not insert');
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_learning_loop(now() - interval '7 days', now())$$) = '42501', 'mpt_learning_loop: anon must not execute');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select public.mpt_learning_loop(now() - interval '7 days', now())$$) = '42501', 'mpt_learning_loop: authenticated must not execute');
select pg_temp.assert((select relforcerowsecurity from pg_class where oid = 'public.web_scan_events'::regclass) and (select relforcerowsecurity from pg_class where oid = 'public.web_scan_returns'::regclass), 'learning loop tables: RLS forced');

set local role service_role;
-- made-up scans. Window [now-9.5d, now-2d), grace 24h. S1 stayer; S2, S3, S4 leavers; S5 too young to call a leaver. S0 and S00 are older scans outside the window.
insert into public.web_scans (id, created_at, hexagon_count, results, results_bytes) values
  ('00000000-0000-4000-8000-000000007490', now() - interval '45 days',  1, '[{"id":"screen","label":"Screen","value":"x","status":"found"}]', 50),
  ('00000000-0000-4000-8000-000000007491', now() - interval '20 days',  1, '[{"id":"screen","label":"Screen","value":"x","status":"found"}]', 50),
  ('00000000-0000-4000-8000-000000007493', now() - interval '9 days',   2, '[{"id":"screen","label":"Screen","value":"x","status":"found"},{"id":"dns","label":"DNS","value":"x","status":"not_checked"}]', 100),
  ('00000000-0000-4000-8000-000000007494', now() - interval '8 days',   2, '[{"id":"screen","label":"Screen","value":"x","status":"found"},{"id":"dns","label":"DNS","value":"x","status":"found"}]', 100),
  ('00000000-0000-4000-8000-000000007495', now() - interval '7 days',   2, '[{"id":"screen","label":"Screen","value":"x","status":"found"},{"id":"dns","label":"DNS","value":"x","status":"not_checked"}]', 100),
  ('00000000-0000-4000-8000-000000007496', now() - interval '6 days',   1, '[{"id":"screen","label":"Screen","value":"x","status":"not_checked"}]', 50),
  ('00000000-0000-4000-8000-000000007497', now() - interval '60 hours', 1, '[{"id":"screen","label":"Screen","value":"x","status":"found"}]', 50),
  ('00000000-0000-4000-8000-000000007498', now() - interval '1 day',    1, '[{"id":"screen","label":"Screen","value":"x","status":"found"}]', 50);
insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values
  ('00000000-0000-4000-8000-000000007493', 'email', gen_random_uuid()),
  ('00000000-0000-4000-8000-000000007498', 'email', gen_random_uuid());   -- outside the window
insert into public.web_scan_events (web_scan_id, step, seconds) values
  ('00000000-0000-4000-8000-000000007493', 'scan_finished', null), ('00000000-0000-4000-8000-000000007493', 'results_viewed', null),
  ('00000000-0000-4000-8000-000000007493', 'contact_step_opened', null), ('00000000-0000-4000-8000-000000007493', 'contact_given', null), ('00000000-0000-4000-8000-000000007493', 'results_time', 40),
  ('00000000-0000-4000-8000-000000007494', 'scan_finished', null), ('00000000-0000-4000-8000-000000007494', 'results_viewed', null),
  ('00000000-0000-4000-8000-000000007494', 'contact_step_opened', null), ('00000000-0000-4000-8000-000000007494', 'results_time', 10),
  ('00000000-0000-4000-8000-000000007495', 'scan_finished', null), ('00000000-0000-4000-8000-000000007495', 'results_viewed', null), ('00000000-0000-4000-8000-000000007495', 'results_time', 20),
  ('00000000-0000-4000-8000-000000007496', 'scan_finished', null),
  ('00000000-0000-4000-8000-000000007497', 'scan_finished', null);
-- returns: S3 came back 3 days after S2 (7 and 30 days); S4 came back after 39 days (neither); S5 after 14 days (30 days only)
insert into public.web_scan_returns (web_scan_id, previous_scan_id, returned_at) values
  ('00000000-0000-4000-8000-000000007495', '00000000-0000-4000-8000-000000007494', (select created_at + interval '3 days' from public.web_scans where id = '00000000-0000-4000-8000-000000007494')),
  ('00000000-0000-4000-8000-000000007496', '00000000-0000-4000-8000-000000007490', now() - interval '6 days'),
  ('00000000-0000-4000-8000-000000007497', '00000000-0000-4000-8000-000000007491', now() - interval '60 hours');

-- step rules
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_events (web_scan_id, step) values ('00000000-0000-4000-8000-000000007496', 'results_time')$$) = '23514', 'web_scan_events: results_time needs seconds');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_events (web_scan_id, step, seconds) values ('00000000-0000-4000-8000-000000007496', 'results_viewed', 5)$$) = '23514', 'web_scan_events: only results_time carries seconds');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_events (web_scan_id, step, seconds) values ('00000000-0000-4000-8000-000000007496', 'results_time', 4000)$$) = '23514', 'web_scan_events: seconds capped at one hour');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_events (web_scan_id, step) values ('00000000-0000-4000-8000-000000007496', 'purchase')$$) = '23514', 'web_scan_events: only the six steps');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_events (web_scan_id, step) values ('00000000-0000-4000-8000-000000007496', 'scan_finished')$$) = '23505', 'web_scan_events: one row per step per scan');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_events (web_scan_id, step) values (gen_random_uuid(), 'scan_finished')$$) = '23503', 'web_scan_events: the scan number must exist');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_returns (web_scan_id, previous_scan_id) values ('00000000-0000-4000-8000-000000007496', '00000000-0000-4000-8000-000000007496')$$) = '23514', 'web_scan_returns: a scan cannot return to itself');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.web_scan_returns (web_scan_id, previous_scan_id) values ('00000000-0000-4000-8000-000000007494', gen_random_uuid())$$) = '23503', 'web_scan_returns: the earlier scan number must exist');

-- rollup
create temp table loop_run as select public.mpt_learning_loop(now() - interval '9 days 12 hours', now() - interval '2 days', 24) as j;
select pg_temp.assert((select (j->>'finished')::int = 5 and (j->>'contacts_given')::int = 1 from loop_run), 'learning loop: scans finished against contacts given');
select pg_temp.assert((select (j->>'leavers')::int = 3 and (j->>'pending')::int = 1 from loop_run), 'learning loop: three leavers; a scan under 24 hours old is pending, not a leaver');
select pg_temp.assert((select (j->'leavers_last_step'->>'scan_finished')::int = 1 and (j->'leavers_last_step'->>'results_viewed')::int = 1 and (j->'leavers_last_step'->>'contact_step_opened')::int = 1 from loop_run), 'learning loop: last step reached by those who left');
select pg_temp.assert((select (j->'results_seconds'->>'leavers_n')::int = 2 and (j->'results_seconds'->>'leavers_avg')::numeric = 15.0 and (j->'results_seconds'->>'stayers_n')::int = 1 and (j->'results_seconds'->>'stayers_avg')::numeric = 40.0 from loop_run), 'learning loop: time on results, leavers vs stayers');
select pg_temp.assert((select (h->>'leavers_found')::int = 2 and (h->>'leavers_total')::int = 3 and (h->>'stayers_found')::int = 1 and (h->>'stayers_total')::int = 1 from loop_run, jsonb_array_elements(j->'hexagons') h where h->>'id' = 'screen'), 'learning loop: hexagon shown as a finding to leavers vs stayers (screen)');
select pg_temp.assert((select (h->>'leavers_found')::int = 1 and (h->>'leavers_total')::int = 2 and (h->>'stayers_found')::int = 0 and (h->>'stayers_total')::int = 1 from loop_run, jsonb_array_elements(j->'hexagons') h where h->>'id' = 'dns'), 'learning loop: hexagon shown as a finding to leavers vs stayers (dns)');
select pg_temp.assert((select (j->'returns'->>'returned_total')::int = 3 and (j->'returns'->>'within_7_days')::int = 1 and (j->'returns'->>'within_30_days')::int = 2 from loop_run), 'learning loop: returned within 7 and 30 days');
select pg_temp.assert((select not (j::text ~* '(0000-4000|@|Testfox)') from loop_run), 'learning loop: the result holds no scan number or value, only counts');
select pg_temp.assert((select (public.mpt_learning_loop(now() - interval '400 days', now() - interval '390 days')->>'finished')::int = 0), 'learning loop: an empty window returns zero, not an error');

-- steps and returns go with the scan when it is deleted by its scan number (the visitor's right) and by the clean-up
create temp table loop_delete as select public.mpt_delete_web_scan('00000000-0000-4000-8000-000000007494') as j;
select pg_temp.assert((select count(*) from public.web_scan_events where web_scan_id = '00000000-0000-4000-8000-000000007494') = 0, 'delete by scan number: its funnel steps go too');
select pg_temp.assert((select count(*) from public.web_scan_returns where previous_scan_id = '00000000-0000-4000-8000-000000007494' or web_scan_id = '00000000-0000-4000-8000-000000007494') = 0, 'delete by scan number: return links to or from it go too');
select pg_temp.assert((select count(*) from public.web_scan_events where web_scan_id = '00000000-0000-4000-8000-000000007493') = 5, 'delete by scan number: other scans keep their steps');
create temp table loop_purge as select public.mpt_purge_expired_web_scans(false) as j;   -- S0 is 45 days old and never linked (>90 days? no): keep; nothing here is past retention
select pg_temp.assert((select count(*) from public.web_scans where id = '00000000-0000-4000-8000-000000007490') = 1, 'clean-up leaves recent scans (and their returns) alone');
reset role;
-- MPC-7492: machine mirror aggregate. Fresh made-up rows in a window far in the past so earlier test rows do not interfere.
select pg_temp.assert(pg_temp.try_as('anon', $$select public.mpt_machine_visits_daily(now() - interval '1 day', now())$$) = '42501', 'mpt_machine_visits_daily: anon must not execute');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select public.mpt_machine_visits_daily(now() - interval '1 day', now())$$) = '42501', 'mpt_machine_visits_daily: authenticated must not execute');
delete from public.edge_visits;
insert into public.edge_visits (seen_at, path, method, status, user_agent, ip, class, rule, ruleset_version) values
  ('2031-03-02 01:00+00', '/robots.txt', 'GET', 200, 'ExampleAIBot/1.0', '192.0.2.20', 'ai',      'R1', 'test'),
  ('2031-03-02 01:01+00', '/',           'GET', 200, 'ExampleAIBot/1.0', '192.0.2.20', 'ai',      'R1', 'test'),
  ('2031-03-02 01:02+00', '/blog/a',     'GET', 200, 'ExampleAIBot/1.0', '192.0.2.20', 'ai',      'R1', 'test'),
  ('2031-03-02 01:03+00', '/missing',    'GET', 404, 'ExampleAIBot/1.0', '192.0.2.20', 'ai',      'R1', 'test'),
  ('2031-03-02 02:00+00', '/',           'GET', 200, 'ExampleCrawler/1.0', '192.0.2.21', 'bot',   'R4', 'test'),
  ('2031-03-02 03:00+00', '/',           'GET', 200, 'ExampleBrowser/1.0', '192.0.2.22', 'person','R8', 'test'),
  ('2031-03-02 03:01+00', '/',           'GET', 200, 'ExampleBrowser/1.0', '192.0.2.23', 'unknown','R5', 'test'),
  ('2031-03-01 01:00+00', '/',           'GET', 200, 'ExampleAIBot/1.0', '192.0.2.20', 'ai',      'R1', 'test');
create temp table mv as select public.mpt_machine_visits_daily('2031-03-02 00:00+00', '2031-03-03 00:00+00') as j;
select pg_temp.assert((select (j->>'total_requests')::int = 7 and (j->>'machine_requests')::int = 5 from mv), 'machine visits: totals count every class, machine requests only bot+ai');
select pg_temp.assert((select jsonb_array_length(j->'rows') = 2 from mv) and not (select j::text like '%ExampleBrowser%' or j::text like '%192.0.2.%' from mv), 'machine visits: no person or unknown row and no IP in the output');
select pg_temp.assert((select (r->>'requests')::int = 4 and (r->>'robots_fetches')::int = 1 and r->'pages' = '["/", "/blog/a"]'::jsonb from mv, jsonb_array_elements(j->'rows') r where r->>'user_agent' = 'ExampleAIBot/1.0'), 'machine visits: requests, robots.txt fetches and pages served (no robots.txt, no 404)');
select pg_temp.assert((select r->>'first_ever' = '2031-03-01T01:00:00+00:00' from mv, jsonb_array_elements(j->'rows') r where r->>'user_agent' = 'ExampleAIBot/1.0'), 'machine visits: first_ever looks past the window');

-- ===== MPC-7494: recognition candidates (save + recognise consent, retention, hash match, service_role only, no personal link) =====
select pg_temp.assert(pg_temp.try_as('anon', $$select * from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"}]'::jsonb)$$) = '42501', 'mpt_recognition_candidates: anon must not execute');
select pg_temp.assert(pg_temp.try_as('authenticated', $$select * from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"}]'::jsonb)$$) = '42501', 'mpt_recognition_candidates: authenticated must not execute');
insert into public.web_scans (id, created_at, hexagon_count, results, results_bytes) values
  ('00000000-0000-4000-8000-0000000074f1', now() - interval '10 days',  2, '[{"id":"canvas-fingerprint","label":"c","value":"h1","status":"found"},{"id":"browser","label":"b","value":"Chrome 141","status":"found"}]', 200),  -- consented, in retention, canvas h1
  ('00000000-0000-4000-8000-0000000074f2', now() - interval '10 days',  2, '[{"id":"canvas-fingerprint","label":"c","value":"h1","status":"found"},{"id":"browser","label":"b","value":"Chrome 141","status":"found"}]', 200),  -- same values, linked WITHOUT consent record
  ('00000000-0000-4000-8000-0000000074f3', now() - interval '400 days', 2, '[{"id":"canvas-fingerprint","label":"c","value":"h1","status":"found"},{"id":"browser","label":"b","value":"Chrome 141","status":"found"}]', 200),  -- consented but past 12 months
  ('00000000-0000-4000-8000-0000000074f4', now() - interval '5 days',   2, '[{"id":"canvas-fingerprint","label":"c","value":"h1","status":"found"},{"id":"browser","label":"b","value":"Chrome 141","status":"found"}]', 200),  -- same values, never linked to any contact
  ('00000000-0000-4000-8000-0000000074f5', now() - interval '3 days',   2, '[{"id":"canvas-fingerprint","label":"c","value":"other","status":"found"},{"id":"audio-fingerprint","label":"a","value":"h2","status":"found"}]', 200);  -- consented, audio h2
insert into public.web_scans (id, created_at, hexagon_count, results, results_bytes) values
  ('00000000-0000-4000-8000-0000000074f6', now() - interval '2 days', 2, '[{"id":"canvas-fingerprint","label":"c","value":"h1","status":"found"},{"id":"browser","label":"b","value":"Chrome 141","status":"found"}]', 200);   -- same values, save consent but NO recognise consent
insert into public.web_scan_contacts (web_scan_id, channel, contact_id, save_consent_at, save_consent_version, recognise_consent_at, recognise_consent_version) values
  ('00000000-0000-4000-8000-0000000074f1', 'email', gen_random_uuid(), now(), '2026-10-12-v1', now(), '2026-10-12-v1'),
  ('00000000-0000-4000-8000-0000000074f2', 'email', gen_random_uuid(), null, null, now(), '2026-10-12-v1'),   -- recognise consent but no save consent: not a candidate
  ('00000000-0000-4000-8000-0000000074f3', 'email', gen_random_uuid(), now() - interval '400 days', '2026-10-12-v1', now() - interval '400 days', '2026-10-12-v1'),
  ('00000000-0000-4000-8000-0000000074f5', 'email', gen_random_uuid(), now(), '2026-10-12-v1', now(), '2026-10-12-v1'),
  ('00000000-0000-4000-8000-0000000074f6', 'email', gen_random_uuid(), now(), '2026-10-12-v1', null, null);
set local role service_role;
select pg_temp.assert((select array_agg(right(web_scan_id::text, 2)) from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"}]'::jsonb)) = array['f1'], 'recognition candidates: only the scan with BOTH consents, unexpired, with that hash (not the saved-but-not-recognise-consented, unconsented, expired or unlinked ones)');
select pg_temp.assert((select array_agg(right(web_scan_id::text, 2) order by web_scan_id) from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"},{"id":"audio-fingerprint","value":"h2"}]'::jsonb)) = array['f1','f5'], 'recognition candidates: any of the given hashes can bring a candidate');
select pg_temp.assert((select count(*) from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"nope"}]'::jsonb)) = 0, 'recognition candidates: no shared hash, no candidate');
select pg_temp.assert((select count(*) from public.mpt_recognition_candidates('[]'::jsonb)) = 0 and (select count(*) from public.mpt_recognition_candidates('"x"'::jsonb)) = 0 and (select count(*) from public.mpt_recognition_candidates('[1,2]'::jsonb)) = 0, 'recognition candidates: empty or malformed input returns nothing');
select pg_temp.assert((select count(*) from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"}]'::jsonb, 0)) = 1, 'recognition candidates: the limit is clamped to at least 1');
select pg_temp.assert((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'web_scans' and table_schema = 'public' and column_name in ('id')) is not null
  and (select pg_get_function_result('public.mpt_recognition_candidates(jsonb, integer)'::regprocedure)) = 'TABLE(web_scan_id uuid, scanned_at timestamp with time zone, results jsonb)', 'recognition candidates: returns scan number, time and results only (no contact or user column)');
select pg_temp.assert((select count(*) from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"}]'::jsonb) where right(web_scan_id::text, 2) = 'f6') = 0, 'recognition candidates: a scan saved with the save consent but WITHOUT the recognise consent is NOT a candidate');
select pg_temp.assert((select count(*) from public.mpt_recognition_candidates('[{"id":"canvas-fingerprint","value":"h1"}]'::jsonb) where right(web_scan_id::text, 2) = 'f1') = 1, 'recognition candidates: a scan with the recognise consent is a candidate');
-- reading candidates changes nothing and logs nothing
select pg_temp.assert((select count(*) from public.web_scans where id::text like '00000000-0000-4000-8000-0000000074f%') = 6, 'recognition candidates: read-only, all six scans still there');
reset role;
select pg_temp.assert((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'web_scan_contacts' and column_name in ('recognise_consent_at', 'recognise_consent_version')) = 2, 'web_scan_contacts: has the recognise consent columns (MPC-7494)');
select pg_temp.assert(not has_function_privilege('anon', 'public.mpt_recognition_candidates(jsonb, integer)', 'execute') and not has_function_privilege('authenticated', 'public.mpt_recognition_candidates(jsonb, integer)', 'execute') and has_function_privilege('service_role', 'public.mpt_recognition_candidates(jsonb, integer)', 'execute'), 'mpt_recognition_candidates: grants unchanged, service_role only');

-- ===== MPC-7650: Family Plan households (5-profile cap, owner sees children only, adults private, RLS) =====
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000007650', 'owner@example.test'), ('00000000-0000-4000-8000-000000007651', 'adult@example.test'),
  ('00000000-0000-4000-8000-000000007652', 'child@example.test'), ('00000000-0000-4000-8000-000000007653', 'other@example.test');
insert into public.households (id, owner_user_id) values ('00000000-0000-4000-8000-0000000076a0', '00000000-0000-4000-8000-000000007650');
insert into public.household_members (household_id, user_id, display_name, role, status) values
  ('00000000-0000-4000-8000-0000000076a0', '00000000-0000-4000-8000-000000007650', 'Owner', 'owner', 'active'),
  ('00000000-0000-4000-8000-0000000076a0', '00000000-0000-4000-8000-000000007651', 'Adult', 'adult', 'active'),
  ('00000000-0000-4000-8000-0000000076a0', '00000000-0000-4000-8000-000000007652', 'Child', 'child', 'active');
select pg_temp.assert(public.mpt_household_can_view_reports('00000000-0000-4000-8000-000000007650', '00000000-0000-4000-8000-000000007652'), 'household: the owner can view a child');
select pg_temp.assert(not public.mpt_household_can_view_reports('00000000-0000-4000-8000-000000007650', '00000000-0000-4000-8000-000000007651'), 'household: the owner cannot view another adult');
select pg_temp.assert(not public.mpt_household_can_view_reports('00000000-0000-4000-8000-000000007651', '00000000-0000-4000-8000-000000007650'), 'household: an adult cannot view the owner');
select pg_temp.assert(not public.mpt_household_can_view_reports('00000000-0000-4000-8000-000000007652', '00000000-0000-4000-8000-000000007650'), 'household: a child cannot view the owner');
select pg_temp.assert(public.mpt_household_can_view_reports('00000000-0000-4000-8000-000000007651', '00000000-0000-4000-8000-000000007651'), 'household: anyone can view their own reports');
select pg_temp.assert(not public.mpt_household_can_view_reports('00000000-0000-4000-8000-000000007653', '00000000-0000-4000-8000-000000007652'), 'household: a stranger cannot view a child');
insert into public.household_members (household_id, email, display_name, role) values
  ('00000000-0000-4000-8000-0000000076a0', 'a@example.test', 'A', 'adult'), ('00000000-0000-4000-8000-0000000076a0', 'b@example.test', 'B', 'child');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.household_members (household_id, email, display_name, role) values ('00000000-0000-4000-8000-0000000076a0', 'c@example.test', 'C', 'child')$$) = '23514', 'household: a sixth profile is refused');
update public.household_members set status = 'removed' where email = 'b@example.test';
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.household_members (household_id, email, display_name, role) values ('00000000-0000-4000-8000-0000000076a0', 'c@example.test', 'C', 'child')$$) = '', 'household: removing a profile frees its slot');
select pg_temp.assert(pg_temp.try_as('anon', $$select * from public.household_members$$) = '42501', 'household_members: anon denied');
select pg_temp.assert(pg_temp.try_as('anon', $$select * from public.households$$) = '42501', 'households: anon denied');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000007651","role":"authenticated"}', true);
select pg_temp.assert((select count(*) from public.household_members) = 1, 'household_members: an adult sees only their own row');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000007650","role":"authenticated"}', true);
select pg_temp.assert((select count(*) from public.household_members) = 6, 'household_members: the owner sees every profile in their household');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000007653","role":"authenticated"}', true);
select pg_temp.assert((select count(*) from public.household_members) = 0 and (select count(*) from public.households) = 0, 'household: a stranger sees nothing');
reset role;

rollback;
select 'schema.test.sql: all assertions passed' as result;
