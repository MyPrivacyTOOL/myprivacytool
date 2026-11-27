-- MPC-8737: backfill assertions. Driven by run.sh, which loads the fixtures, captures the dry run into :dryfile, applies, and then runs this file.
\set ON_ERROR_STOP on
create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;
-- run.sh exports DRYFILE: the dry run's output ("metric|n" lines), captured BEFORE apply ran
\set drytext `cat "$DRYFILE"`
create temp table dry as
  select regexp_replace(l, '\|[0-9]+$', '') as metric, substring(l from '\|([0-9]+)$')::bigint as n from regexp_split_to_table(:'drytext', E'\n') l where l ~ '\|[0-9]+$';
create or replace function pg_temp.dry(m text) returns bigint language sql as $$ select n from dry where metric = m $$;

-- 1. the dry run predicted exactly what apply wrote -----------------------------------------------------------------------------------------
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'signals:%') = pg_temp.dry('signals: not_checked -> data_point with NULL confidence, NULL value (would insert)'), 'signals inserted = dry run (not_checked only; found / clear are held)');
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'web_scans:%' and status = 'not_checked') = pg_temp.dry('web_scans: not_checked -> data_point with NULL confidence (F3: original kept in provenance)'), 'web not_checked inserted = dry run');
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'web_scans:%' and status in ('found','clear')) = pg_temp.dry('web_scans: found / clear with a usable confidence -> would insert'), 'web found / clear inserted = dry run');
select pg_temp.assert((select count(*) from ledger.data_point where backfill_batch_id is not null) = pg_temp.dry('TOTAL data points that would be inserted now'), 'TOTAL inserted = dry run total');
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'web_scans:%' and (provenance_extra->>'confidence_capped') = 'true') = pg_temp.dry('  of which confidence 100, capped at 99 (H10)') - 0, 'capped count = dry run');
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'web_scans:%' and (provenance_extra->>'legacy_anomaly') = 'true') = pg_temp.dry('  of which found at 0-2 (legacy_anomaly, Inferred)'), 'anomaly tag count = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'user_id') = pg_temp.dry('identifiers: user_id'), 'user_id identifiers = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'lead_id') = pg_temp.dry('identifiers: lead_id'), 'lead_id identifiers = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'scan_id') = pg_temp.dry('identifiers: scan_id'), 'scan_id identifiers = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'web_scan_id') = pg_temp.dry('identifiers: web_scan_id'), 'web_scan_id identifiers = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'wa_id') = pg_temp.dry('identifiers: wa_id (leads.phone_number + whatsapp conversations)'), 'wa_id identifiers = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'conversation_id') = pg_temp.dry('identifiers: conversation_id (only conversations with a lead or a usable sender; a locator never mints a person)'), 'conversation_id identifiers = dry run');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'email_hash') = pg_temp.dry('persons: distinct email hashes (users + leads + baselines)'), 'email_hash identifiers = distinct email hashes');
select pg_temp.assert((select count(*) from ledger.person where status <> 'erased') =
  pg_temp.dry('persons: distinct email hashes (users + leads + baselines)') + pg_temp.dry('persons: telegram ids with no email behind them') + pg_temp.dry('persons: wa_ids with no email behind them')
  + pg_temp.dry('persons: web scans with no linked email (provisional, bearer id only)') + pg_temp.dry('persons: engagement session ids (provisional)') + pg_temp.dry('persons: x social contacts'), 'persons = dry run');

-- 2. honesty: nothing invented, nothing blurred ---------------------------------------------------------------------------------------------
select pg_temp.assert(not exists (select 1 from ledger.data_point where status in ('not_checked','check_failed') and (confidence is not null or value is not null)), 'no not_checked row carries a number or a value');
select pg_temp.assert(not exists (select 1 from ledger.data_point where status in ('found','clear') and legacy_ref like 'signals:%'), 'found / clear signals were HELD (registry default is NULL), not guessed');
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'web_scans:%' and (provenance_extra->>'legacy_confidence')::numeric > 0 and status = 'not_checked') = pg_temp.dry('  of which carried a confidence > 0 that is NOT carried over (F3)'), 'the original not_checked confidence is kept in provenance, not in the column');
select pg_temp.assert(not exists (select 1 from ledger.data_point where legacy_ref like 'web_scans:%' and confidence = 100), 'no browser-reported 100 survives (H10 cap)');
select pg_temp.assert(not exists (select 1 from ledger.data_point where legacy_ref like 'web_scans:%' and source <> 'taken'), 'web items are taken, never checked / given');
select pg_temp.assert(not exists (select 1 from ledger.data_point where legacy_ref like 'web_scans:%' and status in ('found','clear') and (value->>'legacy_text') is null), 'web values are the untyped legacy text only');
select pg_temp.assert((select count(*) from ledger.data_point where legacy_ref like 'web_scans:%' and (provenance_extra->>'legacy_untrusted') = 'true') = (select count(*) from ledger.data_point where legacy_ref like 'web_scans:%'), 'every web item is tagged untrusted');
select pg_temp.assert(not exists (select 1 from ledger.data_point where legacy_ref like 'web_scans:%:%' and legacy_ref ~ ':(7|8)$'), 'an item with no id, and an item with no status, were skipped');
select pg_temp.assert(not exists (select 1 from ledger.data_point where source = 'given'), 'nothing was backfilled as given (web confirmed is always false; A1.1)');
-- classes through the real guard: a backfilled 70 is Inferred, never a fact; a not_checked is Unknown
select pg_temp.assert((select class from ledger.render_claim(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d1', false), 'web.language', '87370000-0000-4000-8000-0000000000d1', 'en', 'web')) = 'inferred', 'backfilled 70 -> inferred');
select pg_temp.assert((select class from ledger.render_claim(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d1', false), 'web.webgl', '87370000-0000-4000-8000-0000000000d1', 'en', 'web')) = 'unknown', 'backfilled not_checked -> unknown (it had confidence 100 in the legacy row)');
select pg_temp.assert((select class from ledger.render_claim(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d1', false), 'web.timezone', '87370000-0000-4000-8000-0000000000d1', 'en', 'web')) = 'verified'
  and (select phrase_key from ledger.render_claim(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d1', false), 'web.timezone', '87370000-0000-4000-8000-0000000000d1', 'en', 'web')) = 'report.verified.timezone.observed', 'a taken web observation at 99 is Verified "observed by us", never clean');
select pg_temp.assert((select class from ledger.render_claim(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d1', false), 'web.canvas', '87370000-0000-4000-8000-0000000000d1', 'en', 'web')) = 'inferred', 'the legacy 0-2 anomaly renders as a guess, never a fact');

-- 3. identity: keys resolved per D1 -----------------------------------------------------------------------------------------------------------
select pg_temp.assert(ledger.resolve_person('email_hash', encode(sha256(convert_to('alice@example.com', 'UTF8')), 'hex')) = ledger.resolve_person('user_id', '87370000-0000-4000-8000-000000000001'), 'alice: the email hash and the user id are one person');
select pg_temp.assert(ledger.resolve_person('lead_id', '87370000-0000-4000-8000-0000000000a1') = ledger.resolve_person('wa_id', '+85212345678'), 'alice: the lead and her phone number are one person');
select pg_temp.assert(ledger.resolve_person('scan_id', '87370000-0000-4000-8000-0000000000b1') = ledger.resolve_person('user_id', '87370000-0000-4000-8000-000000000001'), 'alice: her scan resolves to her');
select pg_temp.assert(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d1') = ledger.resolve_person('user_id', '87370000-0000-4000-8000-000000000001'), 'alice: her linked web scan resolves to her');
select pg_temp.assert(ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d2') <> ledger.resolve_person('user_id', '87370000-0000-4000-8000-000000000001'), 'an unlinked web scan is its own provisional person (a bearer id never merges anyone)');
select pg_temp.assert((select status from ledger.person where person_id = ledger.resolve_person('web_scan_id', '87370000-0000-4000-8000-0000000000d2')) = 'provisional', '... and it is provisional');
select pg_temp.assert((select proof_state from ledger.person_identifier where id_type = 'email_hash' and id_value = encode(sha256(convert_to('alice@example.com', 'UTF8')), 'hex')) = 'proven', 'users.email_verified -> proven');
select pg_temp.assert((select proof_state from ledger.person_identifier where id_type = 'email_hash' and id_value = encode(sha256(convert_to('bob@example.com', 'UTF8')), 'hex')) = 'claimed', 'an unverified email is only claimed');
select pg_temp.assert((select proof_state from ledger.person_identifier where id_type = 'wa_id' and id_value = '+85212345678') = 'claimed', 'a typed phone number is claimed, never proven (only an inbound message proves it)');
select pg_temp.assert((select proof_state from ledger.person_identifier where id_type = 'telegram_id' and id_value = '777000111') = 'proven', 'a telegram id that messaged the bot is proven');
select pg_temp.assert((select proof_state from ledger.person_identifier where id_type = 'telegram_id' and id_value = '555000333') = 'unproven', 'a telegram id seen only in a probe capture is unproven');
select pg_temp.assert(ledger.resolve_person('conversation_id', '87370000-0000-4000-8000-0000000000f1') = ledger.resolve_person('telegram_id', '777000111'), 'a conversation resolves to its sender');
select pg_temp.assert(ledger.resolve_person('conversation_id', '87370000-0000-4000-8000-0000000000f3') = ledger.resolve_person('email_hash', encode(sha256(convert_to('carol@example.com', 'UTF8')), 'hex')), 'a lead-linked conversation resolves to the lead');
select pg_temp.assert(not exists (select 1 from ledger.person_identifier where id_type = 'telegram_id' and id_value = 'someone_username') and pg_temp.dry('conversation_states skipped: telegram sender_id not numeric / h1: hash') = 1, 'a non-numeric telegram sender produced no identifier (skipped, and counted in the dry run)');
select pg_temp.assert((select count(*) from ledger.person_identifier where id_type = 'email_hash' and id_value in (encode(sha256(convert_to('alice@example.com', 'UTF8')), 'hex'))) = 1, 'one identifier per email hash even though users, leads and baselines all carry it');
select pg_temp.assert(not exists (select 1 from ledger.person where status = 'merged'), 'the backfill merged nobody');
select pg_temp.assert(not exists (select 1 from ledger.identity_link), 'and proposed no link');

select 'mpc-8737 backfill: apply == dry run, and every honesty rule held';
