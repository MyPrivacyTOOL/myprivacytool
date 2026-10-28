-- MPC-8753: assertions for the ledger risk axis, education-before-acceptance, scan-scoped decisions, the 366 registry and the risk-aware guard
-- (supabase/migrations/20261028200000_mpc_8753_ledger_risk_axis.sql, design MPC-7898 A3 + A3.9). Run by supabase/tests/run.sh against the THROWAWAY database.
\set ON_ERROR_STOP on
\i supabase/migrations/20261028200000_mpc_8753_ledger_risk_axis.sql

create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;
create or replace function pg_temp.rejects(stmt text, msg text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if state is not null and sqlstate <> state then raise exception 'FAIL: % (wrong error %: %)', msg, sqlstate, sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL: % (statement was accepted)', msg;
end $$;

-- 1. the registry holds exactly the 366 hexagons, and agrees with the public catalogue -----------------------------------------------------
select pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id is not null) = 366, 'registry has 366 hexagon types');
select pg_temp.assert((select count(distinct code) from ledger.data_point_type where hexagon_id is not null) = 366, '366 distinct codes');
select pg_temp.assert((select count(*) from ledger.data_point_type h join public.hexagon_catalogue c on c.id = h.hexagon_id) = 366, 'every registry hexagon_id is a catalogue id and vice versa');
select pg_temp.assert(not exists (select 1 from public.hexagon_catalogue c where not exists (select 1 from ledger.data_point_type h where h.hexagon_id = c.id)), 'no catalogue hexagon is missing from the registry');
select pg_temp.assert((select count(*) filter (where risk_tier = 'high') || '/' || count(*) filter (where risk_tier = 'medium') || '/' || count(*) filter (where risk_tier = 'low')
                         from ledger.data_point_type where hexagon_id is not null) = '90/208/68', 'risk tiers 90/208/68');
select pg_temp.assert((select count(*) filter (where arrival = 'A') || '/' || count(*) filter (where arrival = 'B') || '/' || count(*) filter (where arrival = 'C') || '/' || count(*) filter (where arrival = 'D')
                         from ledger.data_point_type where hexagon_id is not null) = '201/92/64/9', 'arrival A/B/C/D 201/92/64/9');
select pg_temp.assert((select count(distinct channel) from ledger.data_point_type where hexagon_id is not null) = 26, '26 channels');
select pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id is not null and channel = 'web') = 83
                      and (select count(*) from ledger.data_point_type where hexagon_id is not null and channel = 'telegram') = 47
                      and (select count(*) from ledger.data_point_type where hexagon_id is not null and channel = 'email') = 21, 'web 83, telegram 47, email 21');
select pg_temp.assert((select count(*) filter (where build_state = 'built') from ledger.data_point_type where hexagon_id is not null) = (select count(*) from public.hexagon_catalogue where status = 'defined'), 'built == catalogue defined');
select pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id is not null and risk_applicable) = 366, 'all 366 have the risk axis');
select pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id is null and risk_applicable) = 0, 'v1 non-hexagon types have no risk axis');
select pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id is not null and consequence_key_base is not null) = 0, 'no consequence text is invented: all NULL');
select pg_temp.assert(ledger.hexagon_type_code('primary-language', 'web') = 'web.primary_language' and ledger.hexagon_type_code('email-name', 'email') = 'email.name'
                      and ledger.hexagon_type_code('tg.bio', 'telegram') = 'tg.bio', 'hexagon_type_code');
select pg_temp.assert((select count(*) from ledger.data_point_type where code in ('phone.possession_proof','identity.link_confirmation','category.broker.exposure')) = 3, 'v1 seed rows untouched');
-- idempotent: the whole migration was applied twice (run.sh applies it, this file applies it again) and the count is still 366 (asserted above)

-- fixtures ----------------------------------------------------------------------------------------------------------------------------
insert into public.localization (key, locale, value, status) values
  ('report.consequence.bio.v1', 'en', 'Someone could read your bio and use it to work out who you are.', 'approved'),
  ('report.consequence.birthday.v1', 'en', 'Draft text', 'draft')
on conflict do nothing;
update ledger.data_point_type set consequence_key_base = 'bio', consequence_version = 1 where code = 'tg.bio';
update ledger.data_point_type set consequence_key_base = 'birthday', consequence_version = 1 where code = 'tg.birthday';   -- text exists but is only a draft
insert into ledger.person (person_id) values ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a2'), ('00000000-0000-4000-8000-0000000000a3');
\set a1 '''00000000-0000-4000-8000-0000000000a1'''
\set a2 '''00000000-0000-4000-8000-0000000000a2'''
\set a3 '''00000000-0000-4000-8000-0000000000a3'''

-- 2. H18 -----------------------------------------------------------------------------------------------------------------------------
insert into ledger.report_profile (profile, description, defined) values ('risk_h18', 'H18 test', true) on conflict do nothing;
select pg_temp.rejects($$insert into ledger.report_profile_item (profile, type_code) select 'risk_h18', code from ledger.data_point_type where hexagon_id is not null and build_state = 'not_built' limit 1$$, 'H18: an unbuilt hexagon cannot be promised', '23514');
select pg_temp.rejects($$insert into ledger.report_profile_item (profile, type_code) select 'risk_h18', code from ledger.data_point_type where hexagon_id is not null and build_state = 'built' and access_class <> 'ok' limit 1$$, 'H18: a built but non-ok hexagon cannot be promised', '23514');
insert into ledger.report_profile_item (profile, type_code) select 'risk_h18', code from ledger.data_point_type where code in ('tg.bio','tg.birthday') ;
select pg_temp.assert((select count(*) from ledger.report_profile_item where profile = 'risk_h18') = 2, 'H18: built ok hexagons are accepted');
select pg_temp.rejects($$select ledger.record_data_point(ledger.root_person('00000000-0000-4000-8000-0000000000a1'), 'sms.other_apps', null, '"x"'::jsonb, 'found', 90::smallint, 'checked', 'sms', 'exact_lookup', 'src')$$, 'H18: nothing may be checked for a not_allowed type', '23514');

-- 3. the claim: a found tg.bio for a1, a not-yet-checked tg.birthday ----------------------------------------------------------------------
select ledger.record_data_point(:a1, 'tg.bio', null, '{"bio":"hello"}'::jsonb, 'found', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'telegram getChat') as bio_dp \gset
select ledger.record_data_point(:a1, 'tg.birthday', null, null, 'not_checked', null, 'checked', 'telegram', 'exact_lookup', 'telegram getChat') as bday_dp \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-1')) = 'unknown', 'a found claim starts unknown (implicit)');
select pg_temp.assert((select o_state || '/' || o_reason from ledger._risk_eval(:a1, 'tg.birthday', null, 'scan-1')) = 'not_applicable/not_checked', 'not_checked is not_applicable, never unaddressed risk');
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'phone.possession_proof', null, 'scan-1')) = 'not_applicable', 'a type without the risk axis is not_applicable');

-- 4. H12: no acceptance without education -------------------------------------------------------------------------------------------------
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-1', 'accepted', 'accepted', null, 'tap-1', null, null, 'telegram')$$, 'H12: accepted with no education id is refused', '23514');
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-1', 'accepted', 'accepted', gen_random_uuid(), 'tap-1', null, null, 'telegram')$$, 'H12: accepted naming an education that does not exist is refused', null);
select pg_temp.rejects($$insert into ledger.risk_decision_event (person_id, type_code, subject_key, scan_key, data_point_id, value_hash, kind, from_state, to_state, basis, input_ref, channel)
  select o_root, 'tg.bio', '', 'scan-1', o_dp, o_hash, 'accepted', 'unknown', 'accepted', 'accepted', 'tap', 'telegram' from ledger._risk_claim('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null)$$,
  'H12: a direct INSERT cannot skip education either', '23514');
-- H13: no consequence text -> no education; a draft text is not enough
select pg_temp.assert((select count(*) from ledger.render_consequence(:a1, 'tg.address_nope', null, 'en', 'telegram') where render_id is null) = 1, 'render_consequence for an unknown type fails closed');
select pg_temp.assert((select render_id is null from ledger.render_consequence(:a1, 'tg.birthday', null, 'en', 'telegram')), 'render_consequence refuses a type whose text is not approved / claim not found');
select pg_temp.assert((select render_id is null from ledger.render_consequence(:a1, 'sms.number', null, 'en', 'sms')), 'render_consequence refuses a type with no consequence text at all');

-- 5. the happy path: shown -> educated -> accepted ---------------------------------------------------------------------------------------
select render_id as r1, phrase_key as r1key from ledger.render_consequence(:a1, 'tg.bio', null, 'en', 'telegram') \gset
select pg_temp.assert(:'r1key' = 'report.consequence.bio.v1' and :'r1' is not null, 'render_consequence returns the approved consequence key and a render id');
-- a forged render does not count: a claim render is not a consequence render
select render_id as claimr from ledger.render_claim(:a1, 'tg.bio', null, 'en', 'telegram') \gset
select pg_temp.rejects(format($$select ledger.record_risk_education('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-1', %L, 'telegram')$$, :'claimr'), 'H13: a claim render is not a consequence render', '23514');
select pg_temp.rejects($$select ledger.record_risk_education('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-1', gen_random_uuid(), 'telegram')$$, 'H13: a made-up render id is refused', null);
select pg_temp.rejects(format($$select ledger.record_risk_education('00000000-0000-4000-8000-0000000000a2', 'tg.bio', null, 'scan-1', %L, 'telegram')$$, :'r1'), 'H13: a render shown to someone else does not educate this person', null);
select ledger.record_risk_education(:a1, 'tg.bio', null, 'scan-1', :'r1', 'telegram', 'en', 4200) as ed1 \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-1')) = 'educated', 'after education the claim is educated (and still unaddressed)');
-- the same education does not cover another scan (D7), nor another person
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-2')) = 'unknown', 'D7: a new scan starts at unknown');
select pg_temp.rejects(format($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-2', 'accepted', 'accepted', %L, 'tap-x', %L, null, 'telegram')$$, :'ed1', :'r1'), 'D7: an education from scan-1 cannot back an acceptance in scan-2', null);
-- accept
select ledger.record_risk_decision(:a1, 'tg.bio', null, 'scan-1', 'accepted', 'accepted', :'ed1', 'tap-1', :'r1', null, 'telegram', 'en') as dec1 \gset
select pg_temp.assert((select o_state || '/' || o_basis from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-1')) = 'accepted/accepted', 'accepted, with its own provenance');
-- H15: nothing leaves accepted inside a scan (no reopen)
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-1', 'removed', 'given', null, 'tap-2', null, null, 'telegram')$$, 'H15: cannot remove an accepted claim in the same scan', null);
-- a new scan must be educated again before it can be accepted
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-2', 'accepted', 'accepted', null, 'tap-3', null, null, 'telegram')$$, 'D7: scan-2 acceptance needs scan-2 education', '23514');

-- 6. value change stops covering an acceptance (hash validity) -----------------------------------------------------------------------------
select ledger.record_data_point(:a1, 'tg.bio', null, '{"bio":"changed"}'::jsonb, 'found', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'telegram getChat', null, null, now(), null, :'bio_dp') as bio_dp2 \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-1')) = 'unknown', 'a changed value returns the claim to unknown even inside the scan');
select pg_temp.rejects(format($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-1', 'accepted', 'accepted', %L, 'tap-4', %L, null, 'telegram')$$, :'ed1', :'r1'), 'H12: the old education was for a different value', null);

-- 7. consequence version bump invalidates education ----------------------------------------------------------------------------------------
select render_id as r2 from ledger.render_consequence(:a1, 'tg.bio', null, 'en', 'telegram') \gset
select ledger.record_risk_education(:a1, 'tg.bio', null, 'scan-3', :'r2', 'telegram') as ed3 \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-3')) = 'educated', 'educated in scan-3');
update ledger.data_point_type set consequence_version = 2 where code = 'tg.bio';
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-3')) = 'unknown', 'a new consequence version voids earlier education');
update ledger.data_point_type set consequence_version = 1 where code = 'tg.bio';

-- 8. removal: by the person's word, and by a re-check --------------------------------------------------------------------------------------
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-4', 'removed', 'checked', null, null, null, null, 'telegram')$$, 'H14: removed-by-checked needs evidence', '23514');
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-4', 'removed', 'given', null, null, null, null, 'telegram')$$, 'H14: removed-by-given needs an input_ref and a render', '23514');
select ledger.record_risk_decision(:a1, 'tg.bio', null, 'scan-4', 'removed', 'given', null, 'tap-9', :'r2', null, 'telegram') as dec_rm \gset
select pg_temp.assert((select o_state || '/' || o_basis from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-4')) = 'removed/given', 'removed-by-given has its own provenance');
select ledger.record_data_point(:a1, 'tg.bio', null, '{"bio":"gone"}'::jsonb, 'clear', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'telegram getChat', null, null, now(), null, :'bio_dp2') as bio_clear \gset
select pg_temp.assert((select o_state || '/' || o_reason from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-4')) = 'not_applicable/clear', 'once re-checked clear the claim is no longer a risk');
select ledger.record_data_point(:a1, 'tg.bio', null, '{"bio":"back"}'::jsonb, 'found', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'telegram getChat', null, null, now(), null, :'bio_clear') as bio_back \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a1, 'tg.bio', null, 'scan-4')) = 'unknown', 'a fact that reappears is unaddressed again (no reopen event needed)');
select pg_temp.rejects(format($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a1', 'tg.bio', null, 'scan-4', 'removed', 'checked', null, null, null, %L, 'telegram')$$, :'bio_back'), 'H14: a found point is not evidence of removal', '23514');

-- 9. H17: not_me -----------------------------------------------------------------------------------------------------------------------------
select ledger.record_data_point(:a2, 'tg.bio', null, '{"bio":"someone else"}'::jsonb, 'found', 70::smallint, 'checked', 'telegram', 'heuristic', 'guess') as a2dp \gset
select ledger.record_answer(:a2, 'tg.bio', null, 'not_me', 70::smallint, 1500, 'telegram', 'tap-nm') as a2ans \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a2, 'tg.bio', null, 'scan-1')) = 'not_me', 'the person said not me: leaves the score');
select pg_temp.rejects($$select ledger.record_risk_decision('00000000-0000-4000-8000-0000000000a2', 'tg.bio', null, 'scan-1', 'removed', 'given', null, 'tap', null, null, 'telegram')$$, 'H17: no decision on a not_me claim', '23514');
select pg_temp.assert((select render_id is null from ledger.render_consequence(:a2, 'tg.bio', null, 'en', 'telegram')), 'H17: no consequence is rendered for a not_me claim');
-- identity and risk are independent: a confirm tap does not educate or accept
select ledger.record_data_point(:a3, 'tg.bio', null, '{"bio":"mine"}'::jsonb, 'found', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'x') as a3dp \gset
select ledger.record_answer(:a3, 'tg.bio', null, 'confirmed', 100::smallint, 900, 'telegram', 'tap-c') as a3ans \gset
select pg_temp.assert((select o_state from ledger._risk_eval(:a3, 'tg.bio', null, 'scan-1')) = 'unknown', 'H17: a confirm tap leaves the risk state unknown');

-- 10. H16: append-only, no direct access ------------------------------------------------------------------------------------------------------
select pg_temp.rejects('update ledger.risk_decision_event set basis = ''given''', 'H16: decisions cannot be updated', '42501');
select pg_temp.rejects('delete from ledger.risk_education_event', 'H16: educations cannot be deleted', '42501');
select pg_temp.rejects('truncate ledger.risk_decision_event', 'H16: no truncate', '42501');
set role service_role;
select pg_temp.rejects('select * from ledger.risk_decision_event', 'service_role cannot read decisions', '42501');
select pg_temp.rejects('insert into ledger.risk_education_event (person_id) values (gen_random_uuid())', 'service_role cannot insert educations', '42501');
select pg_temp.assert((select count(*) from ledger.render_claim_risk(gen_random_uuid(), 'tg.bio', null, 'scan-1', 'en', 'telegram')) = 1, 'service_role may call the risk guard');
reset role;
set role anon;
select pg_temp.rejects('select * from ledger.render_progress_risk(gen_random_uuid(), ''risk_h18'', ''s'', ''en'', ''web'')', 'anon cannot call the risk guard', '42501');
reset role;

-- 11. render_claim_risk: every v1 field kept, risk fields added, accepted is never clean --------------------------------------------------------
select ledger.record_data_point(:a3, 'tg.birthday', null, '{"birthday":"1990-01-01"}'::jsonb, 'found', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'x') as a3b \gset
select * from ledger.render_claim_risk(:a3, 'tg.bio', null, 'scan-1', 'en', 'telegram') \gset rc_
select pg_temp.assert(:'rc_class' = 'verified' and :'rc_risk_state' = 'unknown' and :'rc_action_key' = 'educate' and :'rc_risk_phrase_key' = 'report.risk.tg_bio.unknown', 'unknown risk: verified claim, action educate');
select pg_temp.assert((select risk_state = 'not_applicable' and class = 'unknown' and action_key = 'retry' from ledger.render_claim_risk(:a1, 'tg.bio', null, 'scan-1', 'en', 'bogus_channel')), 'G12: an error is unknown + not_applicable + retry, never accepted');
select pg_temp.assert((select class = 'unknown' and risk_state = 'not_applicable' from ledger.render_claim_risk(:a1, 'tg.birthday', null, 'scan-1', 'en', 'telegram')), 'a not-checked claim has no risk state');
select render_id as r3 from ledger.render_consequence(:a3, 'tg.bio', null, 'en', 'telegram') \gset
select ledger.record_risk_education(:a3, 'tg.bio', null, 'scan-1', :'r3', 'telegram') as ed_a3 \gset
select pg_temp.assert((select risk_state = 'educated' and action_key = 'decide' from ledger.render_claim_risk(:a3, 'tg.bio', null, 'scan-1', 'en', 'telegram')), 'educated: action decide');
select ledger.record_risk_decision(:a3, 'tg.bio', null, 'scan-1', 'accepted', 'accepted', :'ed_a3', 'tap-acc', :'r3', null, 'telegram') as dec_a3 \gset
select pg_temp.assert((select risk_state = 'accepted' and action_key is null and risk_event_id = :'dec_a3'::uuid and education_id = :'ed_a3'::uuid and phrase_key not like '%.clean' and phrase_key not like '%.clear_in_source'
                              and risk_phrase_key = 'report.risk.tg_bio.accepted' from ledger.render_claim_risk(:a3, 'tg.bio', null, 'scan-1', 'en', 'telegram')), 'G9/G10: accepted is traceable, never clean, and not re-offered');

-- 12. render_progress_risk: integers only, the risk buckets partition the profile, axes independent --------------------------------------------------
insert into ledger.report_profile (profile, description, defined) values ('risk_prog', 'risk progress test', true) on conflict do nothing;
insert into ledger.report_profile_item (profile, type_code) select 'risk_prog', code from ledger.data_point_type where code in ('tg.bio','tg.birthday','tg.username','tg.language','phone.possession_proof');
select ledger.record_data_point(:a3, 'tg.username', null, '{"u":"x"}'::jsonb, 'clear', 100::smallint, 'checked', 'telegram', 'exact_lookup', 'x') as a3u \gset
select * from ledger.render_progress_risk(:a3, 'risk_prog', 'scan-1', 'en', 'telegram') \gset pr_
select pg_temp.assert(:pr_accepted = 1 and :pr_unaddressed_unknown = 1 and :pr_unaddressed_educated = 0 and :pr_unaddressed_risk = 1 and :pr_clear = 1 and :pr_not_checked = 1 and :pr_risk_not_applicable = 1 and :pr_removed = 0 and :pr_not_me = 0,
  'progress: accepted 1 (bio), unaddressed 1 (birthday), clear 1 (username), not_checked 1 (language), no-axis 1');
select pg_temp.assert(:pr_unaddressed_risk + :pr_accepted + :pr_removed + :pr_clear + :pr_not_me + :pr_not_checked + :pr_risk_not_applicable = 5, 'the risk buckets partition the profile (no item disappears)');
select pg_temp.assert(:pr_verified = 3 and :pr_self_attested_fixes = 0 and :pr_not_yet_checked = 2, 'v1 provenance line unchanged: bio, birthday, username verified; language and the no-axis proof not yet checked');
-- accepting moves the risk line only, never the provenance line (axes are independent)
select ledger.record_answer(:a3, 'tg.birthday', null, 'confirmed', 100::smallint, 800, 'telegram', 'tap-cb') as a3cb \gset
select * from ledger.render_progress_risk(:a3, 'risk_prog', 'scan-1', 'en', 'telegram') \gset pr2_
select pg_temp.assert(:pr2_unaddressed_risk = :pr_unaddressed_risk, 'an identity confirm does not change the score');
select pg_temp.assert(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ledger' and p.proname = 'render_progress_risk'
                                  and (pg_get_function_result(p.oid) ~* '(numeric|double|real|float|decimal)')), 'G6: the risk guard return type has no fractional field');
-- v1 contract untouched
select pg_temp.assert((select pg_get_function_result('ledger.render_progress(uuid,text,text,text)'::regprocedure)) like 'TABLE(verified integer, self_attested_fixes integer, not_yet_checked integer, phrase_key text, phrase_params jsonb, data_point_ids uuid[], render_id uuid)', 'v1 render_progress return type is unchanged');
select pg_temp.assert((select pg_get_function_result('ledger.render_claim(uuid,text,text,text,text)'::regprocedure)) like 'TABLE(class text, phrase_key text, phrase_params jsonb, bar smallint, action_key text, data_point_ids uuid[], render_id uuid)', 'v1 render_claim return type is unchanged');
-- undefined / empty profile still fails closed
select pg_temp.assert((select unaddressed_risk = 0 and phrase_key = 'report.progress.profile_undefined' from ledger.render_progress_risk(:a3, 'whatsapp_audit_14', 'scan-1', 'en', 'web')), 'an undefined profile never reads as nothing missing');

-- 13. erase parity -------------------------------------------------------------------------------------------------------------------------------
select pg_temp.assert((select count(*) from ledger.risk_decision_event where person_id = :a3) = 1 and (select count(*) from ledger.risk_education_event where person_id = :a3) = 1, 'a3 has risk rows before erase');
select ledger.erase_person(:a3) as erased \gset
select pg_temp.assert((:'erased'::jsonb->>'risk_decisions')::int = 1 and (:'erased'::jsonb->>'risk_educations')::int = 1, 'erase_person reports the risk rows it removed');
select pg_temp.assert((select count(*) from ledger.risk_decision_event where person_id = :a3) = 0 and (select count(*) from ledger.risk_education_event where person_id = :a3) = 0, 'erase_person removed every risk row');
select pg_temp.assert((select count(*) from ledger.risk_decision_event where person_id = :a1) >= 1, 'erase of one person leaves another person''s risk rows');
select 'MPC-8753 risk axis: all assertions passed' as ok;
