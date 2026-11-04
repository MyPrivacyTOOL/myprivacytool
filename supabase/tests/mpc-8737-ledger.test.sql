-- MPC-8737: assertions for the data-point ledger (supabase/migrations/20261028130000_mpc_8737_data_point_ledger_v1.sql).
-- supabase/tests/run.sh has already applied the migration to the THROWAWAY database; this re-applies it once (idempotency) and then tries to break every rule.
-- Any failed assertion aborts the run.
\set ON_ERROR_STOP on
\i supabase/migrations/20261028130000_mpc_8737_data_point_ledger_v1.sql

create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;
-- run a statement that MUST be rejected; passes only when it raises (optionally with a given SQLSTATE)
create or replace function pg_temp.rejects(stmt text, msg text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if state is not null and sqlstate <> state then raise exception 'FAIL: % (wrong error %: %)', msg, sqlstate, sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL: % (statement was accepted)', msg;
end $$;

-- fixtures ----------------------------------------------------------------------------------------------------------------------
insert into ledger.data_point_type (code, domain, scope, value_schema, clean_phrase_allowed, phrase_key_base, max_age) values
  ('t.photo_public',  'profile', 'person', '{"type":"object","required":["public"],"additionalProperties":false,"properties":{"public":{"type":"boolean"}}}', false, 'photo_public', null),
  ('t.breach',        'email',   'person', '{"type":"object","required":["in_breach"],"properties":{"in_breach":{"type":"boolean"}}}', true,  'email_breach',  interval '30 days'),
  ('t.issued_region', 'phone',   'number', '{"type":"string"}', false, 'issued_region', null),
  ('t.residence',     'phone',   'person', '{"type":"string"}', false, 'residence', null)
on conflict do nothing;
insert into ledger.person (person_id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
\set p1 '''00000000-0000-4000-8000-000000000001'''
\set p2 '''00000000-0000-4000-8000-000000000002'''

-- 0. security: nobody can read or write the ledger directly --------------------------------------------------------------------------
set role service_role;
select pg_temp.rejects('select * from ledger.data_point', 'service_role cannot SELECT data_point', '42501');
select pg_temp.rejects('select * from ledger.v_data_point_current', 'service_role cannot SELECT the current view', '42501');
select pg_temp.rejects('select * from ledger.v_disagreement', 'service_role cannot SELECT the disagreement view', '42501');
select pg_temp.rejects('insert into ledger.person default values', 'service_role cannot INSERT person directly', '42501');
select pg_temp.rejects('select * from ledger.render_log', 'service_role cannot read render_log', '42501');
reset role;
set role anon;
select pg_temp.rejects('select ledger.render_claim(gen_random_uuid(), ''t.photo_public'', null, ''en'', ''web'')', 'anon cannot call the guard', '42501');
select pg_temp.rejects('select public.mpt_ledger_pop_check(repeat(''a'',43))', 'anon cannot call the pop check', '42501');
reset role;
set role authenticated;
select pg_temp.rejects('select public.mpt_ledger_pop_revoke(''+85212345678'', 1, 60)', 'authenticated cannot revoke', '42501');
reset role;
set role service_role;
select pg_temp.assert((select count(*) from ledger.render_claim(:p1, 't.photo_public', null, 'en', 'web')) = 1, 'service_role CAN call the guard');
reset role;

-- 1. honesty constraints ---------------------------------------------------------------------------------------------------------------
-- H2: not_checked / check_failed carry neither a number nor a value
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','not_checked',100,'checked','web','heuristic','x')$$, 'not_checked with a confidence', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','not_checked','{"public":false}','checked','web','heuristic','x')$$, 'not_checked with a value', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','check_failed',0,'checked','web','heuristic','x')$$, 'check_failed with a confidence (0 is still a number)', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}','checked','web','heuristic','x')$$, 'found without a confidence', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','clear',90,'checked','web','heuristic','x')$$, 'clear without a value', '23514');
-- H4: provenance
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',90,'checked','web','heuristic')$$, 'checked without source_name', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',90,'checked','web','heuristic','   ')$$, 'checked with a blank source_name', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',90,'given','web','button_tap')$$, 'given without input_ref', '23514');
-- vocabulary: no fourth source, no "guess" source
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',60,'guess','web','heuristic','x')$$, 'source = guess', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',101,'checked','web','heuristic','x')$$, 'confidence 101', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','maybe','{"public":true}',60,'checked','web','heuristic','x')$$, 'unknown status', '23514');
-- H10: 100 is earned
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,input_ref) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',100,'given','web','button_tap','tap1')$$, 'a user answer at 100', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true}',100,'checked','web','heuristic','x')$$, 'a heuristic check at 100', '23514');
-- value must match the registry schema
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','"all clear, nothing to worry about"',90,'checked','web','heuristic','x')$$, 'a sentence as a value', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":"yes"}',90,'checked','web','heuristic','x')$$, 'wrong value type', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','t.photo_public','found','{"public":true,"note":"x"}',90,'checked','web','heuristic','x')$$, 'an extra key', '23514');
select pg_temp.rejects($$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values ('00000000-0000-4000-8000-000000000001','nope.nope','found','{"public":true}',90,'checked','web','heuristic','x')$$, 'unregistered type', '23503');
-- a legal row goes in (the rules are not just "reject everything")
select pg_temp.assert((select ledger.record_data_point(:p1, 't.photo_public', null, '{"public":true}', 'found', 90::smallint, 'checked', 'web', 'heuristic', 'photo-lookup')) is not null, 'a lawful checked row is accepted');
select pg_temp.assert((select ledger.record_data_point(:p1, 't.breach', null, null, 'not_checked', null, 'checked', 'web', 'exact_lookup', 'hibp')) is not null, 'a lawful not_checked row (null, null) is accepted');
-- H8
select pg_temp.rejects($$select ledger.record_data_point('00000000-0000-4000-8000-000000000001','t.residence',null,'"HK"','found',70::smallint,'checked','whatsapp','heuristic','calling-code',null,null,now(),null,null,'{"derived_from":["t.issued_region"]}')$$, 'H8: a number-scoped fact used for a person-scoped claim', '23514');
select pg_temp.assert((select ledger.record_data_point(:p1, 't.issued_region', null, '"HK"', 'found', 99::smallint, 'checked', 'whatsapp', 'heuristic', 'calling-code')) is not null, 'H8: the number-scoped fact itself is fine');
select pg_temp.assert((select ledger.record_data_point(:p1, 't.issued_region', 'b', '"HK"', 'found', 90::smallint, 'checked', 'whatsapp', 'heuristic', 'calling-code', null, null, now(), null, null, '{"derived_from":["t.issued_region"]}')) is not null, 'H8: same scope may derive');

-- 2. H5 append-only ----------------------------------------------------------------------------------------------------------------------
select ledger.record_shown(:p1, 't.photo_public', 'h5', 50::smallint, 'web') is not null as seeded;
select pg_temp.rejects('update ledger.data_point set confidence = 99', 'UPDATE data_point', '42501');
select pg_temp.rejects('delete from ledger.data_point', 'DELETE data_point', '42501');
select pg_temp.rejects('truncate ledger.data_point', 'TRUNCATE data_point');
select pg_temp.rejects('truncate ledger.render_log', 'TRUNCATE render_log');
select pg_temp.rejects('delete from ledger.render_log', 'DELETE render_log', '42501');
select pg_temp.rejects('update ledger.shown_event set response = ''confirmed''', 'UPDATE shown_event', '42501');
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ledger_t_rogue') then create role ledger_t_rogue nologin bypassrls; end if;
  alter role ledger_t_rogue bypassrls; grant usage on schema ledger to ledger_t_rogue; grant select, delete on ledger.data_point to ledger_t_rogue;
end $$;
set role ledger_t_rogue;
select pg_temp.rejects($$select set_config('ledger.allow_erase','on',false); delete from ledger.data_point$$, 'a non-owner role setting the erase flag itself', '42501');
reset role;
-- corrections are new rows via supersedes_id, same person / type / subject / source only
do $$ declare a uuid; b uuid; begin
  a := ledger.record_data_point('00000000-0000-4000-8000-000000000001', 't.issued_region', 'c', '"HK"', 'found', 99::smallint, 'checked', 'whatsapp', 'heuristic', 'calling-code');
  b := ledger.record_data_point('00000000-0000-4000-8000-000000000001', 't.issued_region', 'c', '"MO"', 'found', 99::smallint, 'checked', 'whatsapp', 'heuristic', 'calling-code', null, null, now(), null, a);
  perform pg_temp.assert((select value from ledger.v_data_point_current where type_code = 't.issued_region' and subject_ref = 'c') = '"MO"', 'the correction is the current row');
  perform pg_temp.assert(exists (select 1 from ledger.data_point where data_point_id = a), 'the corrected row is still there');
  perform pg_temp.rejects(format($q$select ledger.record_data_point('00000000-0000-4000-8000-000000000002','t.issued_region','c','"MO"','found',99::smallint,'checked','whatsapp','heuristic','x',null,null,now(),null,%L)$q$, a), 'supersedes another person''s row', '23514');
  perform pg_temp.rejects(format($q$select ledger.record_data_point('00000000-0000-4000-8000-000000000001','t.breach','c','{"in_breach":false}','clear',90::smallint,'checked','web','heuristic','x',null,null,now(),null,%L)$q$, a), 'supersedes a row of another type', '23514');
end $$;

-- 3. person keys (D1) ----------------------------------------------------------------------------------------------------------------------
select pg_temp.assert(ledger.normalise_wa_id('+852 1234-5678') = '+85212345678', 'wa_id: formatted -> E.164');
select pg_temp.assert(ledger.normalise_wa_id('85212345678') = '+85212345678', 'wa_id: digits (Meta style) -> E.164');
select pg_temp.assert(ledger.normalise_wa_id('0085212345678') = '+85212345678', 'wa_id: 00 prefix -> E.164');
select pg_temp.assert(ledger.normalise_wa_id('abc') is null and ledger.normalise_wa_id('12') is null and ledger.normalise_wa_id(null) is null, 'wa_id: junk -> null');
select pg_temp.rejects($$insert into ledger.person_identifier (person_id,id_type,id_value) values ('00000000-0000-4000-8000-000000000001','wa_id','85212345678')$$, 'wa_id without + stored raw', '23514');
select pg_temp.rejects($$insert into ledger.person_identifier (person_id,id_type,id_value) values ('00000000-0000-4000-8000-000000000001','email_hash','user@example.com')$$, 'a plain email stored as email_hash', '23514');
select pg_temp.rejects($$insert into ledger.person_identifier (person_id,id_type,id_value) values ('00000000-0000-4000-8000-000000000001','email','x')$$, 'unknown id_type', '23514');
select pg_temp.rejects($$insert into ledger.person_identifier (person_id,id_type,id_value,proof_state) values ('00000000-0000-4000-8000-000000000001','telegram_id','123','proven')$$, 'proven without proven_at / method', '23514');

do $$ declare w uuid; w2 uuid; tg uuid; em uuid; r jsonb; sc uuid; s2 uuid; lk uuid; begin
  -- resolve is find-or-create and is stable across formats
  w := ledger.resolve_person('wa_id', '85200000001', true);
  perform pg_temp.assert(ledger.resolve_person('wa_id', '+852 0000 0001', false) = w, 'same wa_id in two formats -> same person');
  perform pg_temp.assert(ledger.resolve_person('wa_id', '85299999999', false) is null, 'unknown identifier without create -> null');
  perform pg_temp.assert((select proof_state from ledger.person_identifier where id_value = '+85200000001') = 'unproven', 'a new wa_id starts unproven');
  -- telegram + hashed email are independent people until something proves they are one
  tg := ledger.resolve_person('telegram_id', '777000111', true);
  em := ledger.resolve_person('email_hash', repeat('a', 64), true);
  perform pg_temp.assert(w <> tg and tg <> em, 'different keys = different persons');
  -- an UNPROVEN strong identifier landing on someone else's identifier never merges: it proposes a link
  r := ledger.attach_identifier(tg, 'wa_id', '85200000001', 'unproven');
  perform pg_temp.assert(r->>'outcome' = 'proposed_link', 'unproven shared wa_id -> proposed link, got ' || (r->>'outcome'));
  perform pg_temp.assert(ledger.root_person(tg) = tg and ledger.root_person(w) = w, 'no merge happened');
  perform pg_temp.assert((select state from ledger.identity_link limit 1) = 'proposed', 'link is proposed');
  -- a weak identifier (scan number) shared by two people never merges, even when "proven"-looking
  sc := ledger.resolve_person('web_scan_id', 'scan-bearer-1', true);
  s2 := ledger.resolve_person('email_hash', repeat('b', 64), true);
  r := ledger.attach_identifier(s2, 'web_scan_id', 'scan-bearer-1', 'claimed');
  perform pg_temp.assert(r->>'outcome' = 'proposed_link', 'weak shared identifier -> proposed link only');
  perform pg_temp.assert(ledger.root_person(sc) = sc, 'weak identifier never merges');
  -- proving requires a method
  perform pg_temp.rejects(format($q$select ledger.attach_identifier(%L,'wa_id','85200000001','proven',null)$q$, tg), 'proven without a proof_method', null);
  -- both PROVEN strong -> merge, older person survives, data keeps its original person_id, unmerge is one pointer
  perform ledger.attach_identifier(w, 'wa_id', '85200000001', 'proven', 'inbound_code');
  perform ledger.record_data_point(tg, 't.issued_region', 'merge-test', '"HK"', 'found', 99::smallint, 'checked', 'telegram', 'heuristic', 'x');
  perform ledger.attach_identifier(tg, 'telegram_id', '777000111', 'proven', 'inbound_message');
  r := ledger.attach_identifier(tg, 'wa_id', '85200000001', 'proven', 'inbound_code');
  perform pg_temp.assert(r->>'outcome' = 'merged', 'two proven strong identifiers -> merged, got ' || (r->>'outcome'));
  perform pg_temp.assert(ledger.root_person(tg) = ledger.root_person(w) and ledger.root_person(tg) <> tg or ledger.root_person(w) <> w, 'one root after the merge');
  perform pg_temp.assert((select person_id from ledger.data_point where subject_ref = 'merge-test') = tg, 'merge did not rewrite data_point.person_id');
  perform pg_temp.assert(ledger.resolve_person('telegram_id', '777000111', false) = ledger.root_person(w), 'resolving the loser''s key now returns the root');
  perform pg_temp.assert((select count(*) from ledger.render_claim(ledger.root_person(w), 't.issued_region', 'merge-test', 'en', 'web') r2 where r2.class = 'verified') = 1, 'the merged person''s evidence is visible from the root');
  perform ledger.unmerge_person(case when ledger.root_person(w) = w then tg else w end);
  perform pg_temp.assert(ledger.root_person(tg) = tg and ledger.root_person(w) = w, 'unmerge restored both people (one pointer)');
  -- writes to a merged person are refused (write to the root)
  perform ledger._merge_persons(tg, w);
  perform pg_temp.rejects(format($q$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name) values (%L,'t.issued_region','found','"HK"',90,'checked','web','heuristic','x')$q$, tg), 'direct insert for a merged person', 'P0001');
  perform ledger.unmerge_person(tg);
  -- user-confirmed merge needs the person's OWN given identity.link_confirmation point
  lk := (select link_id from ledger.identity_link order by created_at limit 1);
  perform pg_temp.rejects(format($q$select ledger.confirm_link(%L, %L)$q$, lk, ledger.record_data_point(w, 't.photo_public', null, '{"public":true}', 'found', 90::smallint, 'checked', 'web', 'heuristic', 'x')), 'confirming a link with a checked point', 'P0001');
end $$;

-- 4. the render guard ---------------------------------------------------------------------------------------------------------------------
create temp table cls as select * from ledger.render_claim('00000000-0000-4000-8000-000000000002', 't.photo_public', null, 'en', 'web');
select pg_temp.assert((select class from cls) = 'unknown' and (select phrase_key from cls) = 'report.unknown.photo_public.not_checked' and (select bar from cls) is null and (select render_id from cls) is not null,
  'no row -> unknown, not_checked phrase, no bar, traced');
drop table cls;

do $$
declare p uuid := '00000000-0000-4000-8000-000000000002'; r record; a uuid; g uuid;
begin
  -- unknown is never clean: not_checked, check_failed, expired
  perform ledger.record_data_point(p, 't.breach', null, null, 'not_checked', null, 'checked', 'email', 'exact_lookup', 'hibp');
  select * into r from ledger.render_claim(p, 't.breach', null, 'en', 'email');
  perform pg_temp.assert(r.class = 'unknown' and r.phrase_key = 'report.unknown.email_breach.not_checked' and r.phrase_key not like '%clean%' and r.bar is null, 'not_checked -> unknown, never clean');
  perform ledger.record_data_point(p, 't.breach', null, null, 'check_failed', null, 'checked', 'email', 'exact_lookup', 'hibp', null, null, now() + interval '1 second');
  select * into r from ledger.render_claim(p, 't.breach', null, 'en', 'email');
  perform pg_temp.assert(r.class = 'unknown' and r.phrase_key = 'report.unknown.email_breach.unavailable' and r.action_key = 'retry', 'check_failed -> "check unavailable, retry"');
  -- a clear check by the allowed source is the ONLY way to the clean family, and a LATER failed check takes it away again (latest row governs)
  perform ledger.record_data_point(p, 't.breach', null, '{"in_breach":false}', 'clear', 100::smallint, 'checked', 'email', 'exact_lookup', 'hibp', null, null, now() + interval '2 seconds');
  select * into r from ledger.render_claim(p, 't.breach', null, 'en', 'email');
  perform pg_temp.assert(r.class = 'verified' and r.phrase_key = 'report.verified.email_breach.clean' and r.bar = 5, 'a fresh exact clear check from an allowed type -> verified clean');
  perform ledger.record_data_point(p, 't.breach', null, null, 'check_failed', null, 'checked', 'email', 'exact_lookup', 'hibp', null, null, now() + interval '3 seconds');
  select * into r from ledger.render_claim(p, 't.breach', null, 'en', 'email');
  perform pg_temp.assert(r.class = 'unknown' and r.phrase_key like 'report.unknown.%', 'a newer failed check -> unknown again (never the older clean)');
  -- not allowed type: a clear check says "not found in that source", never clean
  perform ledger.record_data_point(p, 't.photo_public', null, '{"public":false}', 'clear', 95::smallint, 'checked', 'web', 'exact_lookup', 'photo-lookup');
  select * into r from ledger.render_claim(p, 't.photo_public', null, 'en', 'web');
  perform pg_temp.assert(r.class = 'verified' and r.phrase_key = 'report.verified.photo_public.clear_in_source', 'clean_phrase_allowed = false -> clear_in_source, not clean');
  -- 79 is a guess, 80 is not (the boundary)
  perform ledger.record_data_point(p, 't.residence', 'b79', '"HK"', 'found', 79::smallint, 'checked', 'web', 'heuristic', 'x');
  perform ledger.record_data_point(p, 't.residence', 'b80', '"HK"', 'found', 80::smallint, 'checked', 'web', 'heuristic', 'x');
  perform pg_temp.assert((select class from ledger.render_claim(p, 't.residence', 'b79', 'en', 'web')) = 'inferred', '79 -> inferred');
  perform pg_temp.assert((select class from ledger.render_claim(p, 't.residence', 'b80', 'en', 'web')) = 'verified', '80 -> verified (80 itself is not a guess)');
  select * into r from ledger.render_claim(p, 't.residence', 'b79', 'en', 'web');
  perform pg_temp.assert(r.action_key = 'confirm' and r.phrase_key = 'report.inferred.residence.guess' and r.bar = 3, 'inferred offers confirm and a word+bar');
  -- a user Y is Self-attested and never Verified, even at 99 (the cap is 99 by H10)
  perform ledger.record_data_point(p, 't.residence', 'told', '"HK"', 'found', 95::smallint, 'given', 'whatsapp', 'button_tap', null, 'tap-1');
  select * into r from ledger.render_claim(p, 't.residence', 'told', 'en', 'whatsapp');
  perform pg_temp.assert(r.class = 'self_attested' and r.phrase_key = 'report.self_attested.residence.told', 'given -> self_attested "you told us"');
  -- self-report and check are two rows; a check that disagrees wins, with a mismatch phrase
  perform ledger.record_data_point(p, 't.photo_public', 'mm', '{"public":false}', 'found', 90::smallint, 'given', 'whatsapp', 'button_tap', null, 'tap-2', null, now() - interval '2 minutes');
  perform ledger.record_data_point(p, 't.photo_public', 'mm', '{"public":true}',  'found', 90::smallint, 'checked', 'whatsapp', 'exact_lookup', 'photo-lookup', null, null, now() - interval '1 minute');
  select * into r from ledger.render_claim(p, 't.photo_public', 'mm', 'en', 'whatsapp');
  perform pg_temp.assert(r.class = 'verified' and r.phrase_key = 'report.verified.photo_public.mismatch' and cardinality(r.data_point_ids) = 2, 'given vs checked disagree -> verified + mismatch, both rows traced');
  perform pg_temp.assert(exists (select 1 from ledger.v_disagreement where subject_ref = 'mm'), 'v_disagreement lists the pair');
  -- "I fixed it": the given row is NEWER than the check -> self_attested, stale-check phrase (not re-checked)
  perform ledger.record_data_point(p, 't.photo_public', 'mm', '{"public":false}', 'found', 95::smallint, 'given', 'whatsapp', 'button_tap', null, 'tap-3');
  select * into r from ledger.render_claim(p, 't.photo_public', 'mm', 'en', 'whatsapp');
  perform pg_temp.assert(r.class = 'self_attested' and r.phrase_key = 'report.self_attested.photo_public.told_stale_check' and r.action_key = 'recheck', 'newer given -> self_attested, not re-checked');
  -- expiry (H9)
  perform ledger.record_data_point(p, 't.residence', 'exp', '"HK"', 'found', 90::smallint, 'checked', 'web', 'heuristic', 'x', null, null, now() - interval '2 hours', now() - interval '1 hour');
  select * into r from ledger.render_claim(p, 't.residence', 'exp', 'en', 'web');
  perform pg_temp.assert(r.class = 'unknown' and r.phrase_key = 'report.unknown.residence.stale' and r.action_key = 'recheck', 'expired -> unknown, recheck');
  perform ledger.record_data_point(p, 't.breach', 'old', '{"in_breach":false}', 'clear', 100::smallint, 'checked', 'email', 'exact_lookup', 'hibp', null, null, now() - interval '31 days');
  select * into r from ledger.render_claim(p, 't.breach', 'old', 'en', 'email');
  perform pg_temp.assert(r.class = 'unknown' and r.phrase_key like '%stale', 'older than the type max_age -> unknown');
  -- taken data at 80+ is Verified, labelled observed
  perform ledger.record_data_point(p, 't.issued_region', 'taken', '"HK"', 'found', 99::smallint, 'taken', 'whatsapp', 'webhook', null, null);
  perform pg_temp.assert((select phrase_key from ledger.render_claim(p, 't.issued_region', 'taken', 'en', 'whatsapp')) = 'report.verified.issued_region.observed', 'taken >= 80 -> verified "observed by us"');
  -- fail closed (G2): a bad channel, a missing person, a missing type all come back unknown + retry, never an error
  select * into r from ledger.render_claim(p, 't.residence', 'told', 'en', 'carrier-pigeon');
  perform pg_temp.assert(r.class = 'unknown' and r.action_key = 'retry' and r.render_id is null and r.bar is null, 'bad channel -> fail closed');
  select * into r from ledger.render_claim(gen_random_uuid(), 't.residence', null, 'en', 'web');
  perform pg_temp.assert(r.class = 'unknown', 'unknown person -> unknown');
  select * into r from ledger.render_claim(p, 'no.such_type', null, 'en', 'web');
  perform pg_temp.assert(r.class = 'unknown' and r.phrase_key = 'report.unknown.unregistered.not_checked', 'unregistered type -> unknown');
  -- trace (G5): every rendered claim has a render_log row naming its data points
  perform pg_temp.assert((select count(*) from ledger.render_log l where l.render_id is not null and l.person_id = p and l.kind = 'claim') >= 10, 'renders are logged');
end $$;

-- 5. progress line (criterion 7): three integers, expected set, no fraction -----------------------------------------------------------------
do $$
declare p uuid := gen_random_uuid(); r record;
begin
  insert into ledger.person (person_id) values (p);
  insert into ledger.report_profile (profile, description) values ('t_profile', 't') on conflict do nothing;
  insert into ledger.report_profile_item (profile, type_code, subject_ref) values ('t_profile','t.photo_public',''),('t_profile','t.breach',''),('t_profile','t.residence',''),('t_profile','t.issued_region','') on conflict do nothing;
  select * into r from ledger.render_progress(p, 't_profile', 'en', 'web');
  perform pg_temp.assert(r.verified = 0 and r.self_attested_fixes = 0 and r.not_yet_checked = 4, 'nothing checked: every expected item is "not yet checked", none vanish');
  perform ledger.record_data_point(p, 't.photo_public', null, '{"public":false}', 'clear', 95::smallint, 'checked', 'web', 'exact_lookup', 'photo-lookup');
  perform ledger.record_data_point(p, 't.residence', null, '"HK"', 'found', 95::smallint, 'given', 'web', 'button_tap', null, 'tap');
  perform ledger.record_data_point(p, 't.issued_region', null, '"HK"', 'found', 60::smallint, 'checked', 'web', 'heuristic', 'x');   -- a guess counts as not yet checked
  perform ledger.record_data_point(p, 't.breach', null, null, 'check_failed', null, 'checked', 'web', 'exact_lookup', 'hibp');       -- a failure counts as not yet checked
  select * into r from ledger.render_progress(p, 't_profile', 'en', 'web');
  perform pg_temp.assert(r.verified = 1 and r.self_attested_fixes = 1 and r.not_yet_checked = 2 and r.verified + r.self_attested_fixes + r.not_yet_checked = 4, 'X verified, Y fixes, Z not yet checked; guess + failure are Z; total = expected');
  perform pg_temp.assert(r.phrase_key = 'report.progress.line' and r.phrase_params = '{"verified":1,"fixes":1,"not_yet_checked":2}', 'phrase params are the three integers');
  perform pg_temp.assert((select count(*) from pg_proc where proname = 'render_progress' and pronamespace = 'ledger'::regnamespace and pg_get_function_result(oid) ~* '(score|ratio|percent|fraction|pct)') = 0, 'render_progress has no score / ratio / percentage column');
  -- G7: an undefined or empty profile never reads as "nothing missing"
  select * into r from ledger.render_progress(p, 'whatsapp_audit_14', 'en', 'whatsapp');
  perform pg_temp.assert(r.phrase_key = 'report.progress.profile_undefined' and r.render_id is null, 'an item-less profile is "undefined", not complete');
  select * into r from ledger.render_progress(p, 'no_such_profile', 'en', 'whatsapp');
  perform pg_temp.assert(r.phrase_key = 'report.progress.profile_undefined', 'unknown profile -> undefined');
  select * into r from ledger.render_progress(p, 't_profile', 'en', 'carrier-pigeon');
  perform pg_temp.assert(r.phrase_key = 'report.progress.unavailable' and r.not_yet_checked = 0 and r.verified = 0, 'fail closed on a bad channel');
  select * into r from ledger.render_progress(p, 'mirror_8_hexagon', 'en', 'web');
  perform pg_temp.assert(r.not_yet_checked = 8 and r.verified = 0, 'seeded Mirror profile: 8 expected items, all not yet checked');
end $$;

-- 6. D4: explicit "not me" + the shown event ------------------------------------------------------------------------------------------------
do $$
declare p uuid := gen_random_uuid(); dp uuid; r record;
begin
  insert into ledger.person (person_id) values (p);
  dp := ledger.record_answer(p, 't.photo_public', 'hx', 'not_me', 60::smallint, 1500, 'whatsapp', 'tap-nm');
  perform pg_temp.assert((select source || ':' || confidence || ':' || (value->>'answer') from ledger.data_point where data_point_id = dp) = 'given:95:not_me', 'not_me is a GIVEN point at 95 (D2)');
  perform pg_temp.assert((select response || ':' || confidence_at_display || ':' || latency_ms from ledger.shown_event where data_point_id = dp) = 'not_me:60:1500', 'shown event keeps the confidence shown and the latency');
  select * into r from ledger.render_claim(p, 't.photo_public', 'hx', 'en', 'whatsapp');
  perform pg_temp.assert(r.class = 'self_attested' and r.phrase_key = 'report.self_attested.photo_public.told_not_me', 'not_me renders "you told us it is not you"');
  perform ledger.record_shown(p, 't.photo_public', 'silent', 40::smallint, 'whatsapp');
  perform pg_temp.assert((select response from ledger.shown_event where subject_ref = 'silent') = 'no_response', 'silence is a shown event');
  perform pg_temp.assert(not exists (select 1 from ledger.data_point where person_id = p and subject_ref = 'silent'), 'silence is NEVER stored as a data point (no "no" fact)');
  perform pg_temp.assert((select class from ledger.render_claim(p, 't.photo_public', 'silent', 'en', 'whatsapp')) = 'unknown', 'a shown-but-ignored claim stays unknown');
  perform pg_temp.rejects(format($q$select ledger.record_answer(%L,'t.photo_public','hx','maybe',60::smallint,1,'whatsapp','x')$q$, p), 'an answer outside confirmed / not_me / disputed', 'P0001');
  perform pg_temp.rejects(format($q$insert into ledger.shown_event (person_id,type_code,confidence_at_display,response,latency_ms,channel) values (%L,'t.photo_public',50,'no_response',10,'web')$q$, p), 'no_response with a latency', '23514');
end $$;

select (floor(extract(epoch from now()) * 1000) - 1000)::bigint as now_ms \gset
-- 7. MPC-7902 repoint: bind / check / revoke through the public RPCs, as the Worker calls them (service_role) -----------------------------------
set role service_role;
select pg_temp.assert(public.mpt_ledger_pop_bind(repeat('s', 43), '85212345678', (:now_ms), 1760000001, 'pop-consent-v1', true, 'hmsg', 3600), 'bind returns true');
select pg_temp.assert((public.mpt_ledger_pop_check(repeat('s', 43)) #>> '{proof,wa}') = '85212345678', 'check returns the wa_id as digits (the Worker compares digits)');
select pg_temp.assert((public.mpt_ledger_pop_check(repeat('s', 43)) #>> '{proof,bound_at_ms}') = (:now_ms)::text, 'bound_at round-trips in ms');
select pg_temp.assert((public.mpt_ledger_pop_check(repeat('s', 43)) #>> '{proof,consent_v}') = 'pop-consent-v1' and (public.mpt_ledger_pop_check(repeat('s', 43)) #>> '{proof,consent_accepted}') = 'true', 'consent round-trips');
select pg_temp.assert((public.mpt_ledger_pop_check(repeat('z', 43)) -> 'proof') = 'null'::jsonb, 'unknown session -> no proof');
select pg_temp.rejects(format($q$select public.mpt_ledger_pop_bind(repeat('s', 43), '85212345678', %s, 1760000001, 'pop-consent-v1', true, 'hmsg', 3600)$q$, :now_ms), 'a second bind for one session must fail, never overwrite', '23505');
select pg_temp.rejects($$select public.mpt_ledger_pop_bind(repeat('q', 43), 'not a number', 1, 1, 'v', true, null, 60)$$, 'bind with a bad wa_id');
select pg_temp.rejects($$select public.mpt_ledger_pop_bind(repeat('q', 43), '85212345678', 1, 1, 'v', true, null, 0)$$, 'bind with a zero ttl');
reset role;
select pg_temp.assert((select proof_state from ledger.person_identifier where id_type = 'wa_id' and id_value = '+85212345678') = 'proven', 'the inbound code proved the wa_id (D1)');
select pg_temp.assert((select count(*) from ledger.data_point where type_code = 'phone.possession_proof' and source = 'taken' and method = 'webhook' and confidence = 100 and channel = 'whatsapp') = 1, 'the proof is a taken / webhook / 100 / whatsapp point');
select pg_temp.assert((select expires_at - observed_at from ledger.data_point where type_code = 'phone.possession_proof') = interval '1 hour', 'the proof expires 60 minutes after binding');
set role service_role;
select pg_temp.assert(public.mpt_ledger_pop_revoke('+852 1234 5678', (:now_ms + 5000), 86400), 'revoke returns true');
select pg_temp.assert((public.mpt_ledger_pop_check(repeat('s', 43)) ->> 'revoked_at_ms') = (:now_ms + 5000)::text, 'revocation time is returned');
select pg_temp.assert(public.mpt_ledger_pop_revoke('85277777777', (:now_ms + 5000), 86400), 'revoke for a never-seen number is a no-op that succeeds');
reset role;
select pg_temp.assert(not exists (select 1 from ledger.person_identifier where id_value = '+85277777777'), 'a stranger who only said STOP gets no ledger record');

-- 8. erase: removes a person's points, shown events, render_log and identifiers ------------------------------------------------------------
do $$
declare p uuid; r jsonb;
begin
  p := ledger.resolve_person('telegram_id', '555000999', true);
  perform ledger.record_data_point(p, 't.photo_public', null, '{"public":true}', 'found', 90::smallint, 'checked', 'telegram', 'heuristic', 'x');
  perform ledger.record_answer(p, 't.photo_public', 'e1', 'confirmed', 50::smallint, 100, 'telegram', 'tap');
  perform ledger.render_claim(p, 't.photo_public', null, 'en', 'telegram');
  r := ledger.erase_person(p);
  perform pg_temp.assert((r->>'data_points')::int = 2 and (r->>'shown_events')::int = 1 and (r->>'render_log')::int = 1 and (r->>'identifiers')::int = 1, 'erase counts: ' || r::text);
  perform pg_temp.assert(not exists (select 1 from ledger.data_point where person_id = p) and not exists (select 1 from ledger.person_identifier where person_id = p)
    and not exists (select 1 from ledger.render_log where person_id = p) and not exists (select 1 from ledger.shown_event where person_id = p), 'nothing of the person is left');
  perform pg_temp.assert((select status from ledger.person where person_id = p) = 'erased', 'the person row stays only as an empty erased tombstone');
  perform pg_temp.assert(ledger.resolve_person('telegram_id', '555000999', false) is null, 'the identifier no longer resolves');
  perform pg_temp.rejects(format($q$select ledger.record_data_point(%L,'t.photo_public',null,'{"public":true}','found',90::smallint,'checked','web','heuristic','x')$q$, p), 'writing to an erased person', 'P0001');
  perform pg_temp.assert(current_setting('ledger.allow_erase', true) = 'off', 'the erase flag is switched off again');
end $$;
select pg_temp.rejects('delete from ledger.data_point', 'a direct DELETE still fails after an erase ran', '42501');

-- 9. backfill batches can be reversed exactly -------------------------------------------------------------------------------------------------
do $$
declare b uuid; p uuid := gen_random_uuid(); n int;
begin
  insert into ledger.person (person_id) values (p);
  insert into ledger.backfill_batch (source_name) values ('test') returning backfill_batch_id into b;
  insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name,legacy_ref,backfill_batch_id)
    values (p,'t.photo_public','found','{"public":true}',90,'checked','web','legacy_import','x','t:1',b);
  perform pg_temp.rejects(format($q$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name,legacy_ref,backfill_batch_id) values (%L,'t.photo_public','found','{"public":true}',90,'checked','web','legacy_import','x','t:1',%L)$q$, p, b), 'a second backfill of the same legacy_ref', '23505');
  perform pg_temp.rejects(format($q$insert into ledger.data_point (person_id,type_code,status,value,confidence,source,channel,method,source_name,legacy_ref) values (%L,'t.photo_public','found','{"public":true}',90,'checked','web','legacy_import','x','t:2')$q$, p), 'legacy_ref without a batch id', '23514');
  n := ledger.rollback_backfill_batch(b);
  perform pg_temp.assert(n = 1 and not exists (select 1 from ledger.data_point where backfill_batch_id = b), 'the batch is removed exactly');
end $$;
set role service_role;
select pg_temp.rejects($$select ledger.rollback_backfill_batch(gen_random_uuid())$$, 'service_role cannot roll back batches', '42501');
reset role;

select 'mpc-8737 ledger: all assertions passed';
