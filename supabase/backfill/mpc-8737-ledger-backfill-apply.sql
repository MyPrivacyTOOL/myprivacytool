-- MPC-8737 / design M4: backfill APPLY. *** NOT RUN BY THE MPC-8737 TASK AGAINST LIVE DATA. ***
-- Writes persons, identifiers and data points into the ledger from the legacy tables. Legacy tables are only READ.
--   psql "$DATABASE_URL" -f supabase/backfill/mpc-8737-ledger-backfill-apply.sql
-- Gates (it refuses to run unless they hold):
--   * M3 erase parity: public.mpt_dsar_erase must call ledger.erase_person, so the ledger honours deletion from day one. NOT built yet (it edits live
--     functions, which this additive task does not do), so against the live project this script stops at the first statement. Only a database named
--     mpt_integration_test (the throwaway CI database) bypasses the gate, so the script can be tested.
--   * The registry default_check_confidence for a type is NULL until Chris / Qwen approve it. Rows that need one are HELD (skipped), never guessed.
--     Approve defaults, then simply run this again: it is idempotent on legacy_ref, so only the previously held rows are added.
-- One transaction, one backfill_batch_id. Reversal: select ledger.rollback_backfill_batch('<batch id>'); (persons / identifiers are left; they carry no claim).
-- Counts it produces are asserted equal to mpc-8737-ledger-backfill-dryrun.sql by supabase/tests/mpc-8737-backfill.test.sql.
\set ON_ERROR_STOP on
begin;

do $$ begin
  if current_database() <> 'mpt_integration_test'
     and not exists (select 1 from pg_proc where proname = 'mpt_dsar_erase' and pronamespace = 'public'::regnamespace and prosrc ilike '%ledger.erase_person%') then
    raise exception 'backfill refused: M3 (erase parity) is not in place. public.mpt_dsar_erase does not call ledger.erase_person, so a backfilled person could not be erased from the ledger.';
  end if;
end $$;

insert into ledger.backfill_batch (source_name, note) values ('mpc-8737-ledger-backfill', 'design M4 backfill from signals, web_scans, scans, users, leads, conversation_states, baselines, engagement, consent copies') returning backfill_batch_id \gset

-- ── 1. identifiers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
create temp table bf_raw on commit drop as
with
u as (select id, email, email_verified, encode(sha256(convert_to(lower(btrim(email)), 'UTF8')), 'hex') as h from public.users where email is not null),
l as (select id, email, phone_number, encode(sha256(convert_to(lower(btrim(email)), 'UTF8')), 'hex') as h from public.leads where email is not null)
select 'email_hash' as id_type, h as id_value, case when bool_or(email_verified) then 'proven' else 'claimed' end as proof_state,
       case when bool_or(email_verified) then 'users.email_verified' end as proof_method, 'e:' || h as group_key from u group by h
union all select 'user_id', id::text, 'unproven', null, 'e:' || h from u
union all select 'email_hash', h, 'claimed', null, 'e:' || h from l group by h
union all select 'lead_id', id::text, 'unproven', null, 'e:' || h from l
union all select 'wa_id', ledger.normalise_wa_id(phone_number), 'claimed', null, 'e:' || h from l where ledger.normalise_wa_id(phone_number) is not null
union all select 'email_hash', email_hash, 'claimed', null, 'e:' || email_hash from public.mpt_score_baselines
union all select 'scan_id', s.id::text, 'unproven', null, 'e:' || encode(sha256(convert_to(lower(btrim(us.email)), 'UTF8')), 'hex')
  from public.scans s join public.users us on us.id = s.user_id
-- conversations: the sender is the anchor, the conversation id hangs off it
union all select 'telegram_id', c.sender_id, 'proven', 'telegram_inbound',
       coalesce((select 'e:' || encode(sha256(convert_to(lower(btrim(le.email)), 'UTF8')), 'hex') from public.leads le where le.id = c.lead_id), 'k:telegram_id:' || c.sender_id)
  from public.conversation_states c where c.channel = 'telegram' and c.sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'
union all select 'wa_id', ledger.normalise_wa_id(c.sender_id), 'proven', 'whatsapp_inbound',
       coalesce((select 'e:' || encode(sha256(convert_to(lower(btrim(le.email)), 'UTF8')), 'hex') from public.leads le where le.id = c.lead_id), 'k:wa_id:' || ledger.normalise_wa_id(c.sender_id))
  from public.conversation_states c where c.channel = 'whatsapp' and ledger.normalise_wa_id(c.sender_id) is not null
union all select 'conversation_id', c.id::text, 'unproven', null,
       coalesce((select 'e:' || encode(sha256(convert_to(lower(btrim(le.email)), 'UTF8')), 'hex') from public.leads le where le.id = c.lead_id),
                case when c.channel = 'telegram' and c.sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$' then 'k:telegram_id:' || c.sender_id
                     when c.channel = 'whatsapp' and ledger.normalise_wa_id(c.sender_id) is not null then 'k:wa_id:' || ledger.normalise_wa_id(c.sender_id)
                     end)
  from public.conversation_states c
  -- a conversation is a locator, not an identity: one with no lead and no usable sender mints no person
  where c.lead_id is not null or (c.channel = 'telegram' and c.sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$') or (c.channel = 'whatsapp' and ledger.normalise_wa_id(c.sender_id) is not null)
union all select 'web_scan_id', w.id::text, 'unproven', null,
       coalesce((select 'e:' || encode(sha256(convert_to(lower(btrim(us.email)), 'UTF8')), 'hex') from public.web_scan_contacts wc join public.scans sc on sc.id = wc.contact_id join public.users us on us.id = sc.user_id
                  where wc.web_scan_id = w.id and wc.channel = 'email' limit 1), 'k:web_scan_id:' || w.id::text)
  from public.web_scans w
union all select 'session_id', session_id, 'unproven', null, 'k:session_id:' || session_id from public.mpt_user_engagement where session_id is not null group by session_id
union all select 'social_x', platform_user_id, 'unproven', null, 'k:social_x:' || platform_user_id from public.social_contacts where platform = 'x'
union all select 'telegram_id', sender_id, 'unproven', null, 'k:telegram_id:' || sender_id from public.channel_probe_captures where platform = 'telegram' and sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$' group by sender_id;

-- one row per (type, value): prefer the email-anchored group, then the strongest proof
create temp table bf_ident on commit drop as
select distinct on (id_type, id_value) id_type, id_value, proof_state, proof_method, group_key
from bf_raw order by id_type, id_value, (group_key like 'e:%') desc, case proof_state when 'proven' then 3 when 'claimed' then 2 else 1 end desc;

-- the person for each group: an existing ledger person when any of its identifiers is already there, else a new one
create temp table bf_gp on commit drop as
select g.group_key,
       coalesce((select ledger.root_person(pi.person_id) from bf_ident i join ledger.person_identifier pi on pi.id_type = i.id_type and pi.id_value = i.id_value
                  where i.group_key = g.group_key limit 1), gen_random_uuid()) as person_id,
       exists (select 1 from bf_ident i join ledger.person_identifier pi on pi.id_type = i.id_type and pi.id_value = i.id_value where i.group_key = g.group_key) as existed
from (select distinct group_key from bf_ident) g;

insert into ledger.person (person_id, status)
select person_id, case when exists (select 1 from bf_ident i where i.group_key = gp.group_key and i.proof_state = 'proven') then 'active' else 'provisional' end
from bf_gp gp where not existed;

insert into ledger.person_identifier (person_id, id_type, id_value, proof_state, proven_at, proof_method)
select gp.person_id, i.id_type, i.id_value, i.proof_state, case when i.proof_state = 'proven' then now() end, i.proof_method
from bf_ident i join bf_gp gp using (group_key)
on conflict (id_type, id_value) do nothing;

-- ── 2. registry: every legacy (category, signal_type) and web item id gets a type ──────────────────────────────────────────────────
insert into ledger.data_point_type (code, domain, scope, value_schema, sensitivity, phrase_key_base, untyped, note)
select distinct 'signal.' || category || '.' || regexp_replace(lower(signal_type), '[^a-z0-9]+', '_', 'g'), category, 'scan', '{"type":"object"}'::jsonb, 'medium',
       category || '_' || regexp_replace(lower(signal_type), '[^a-z0-9]+', '_', 'g'), false, 'registered by the MPC-8737 backfill from public.signals; default_check_confidence deliberately NULL'
from public.signals where check_status in ('found','clear','not_checked')
on conflict (code) do nothing;

insert into ledger.data_point_type (code, domain, scope, value_schema, sensitivity, phrase_key_base, untyped, note)
select distinct on (code) 'web.' || regexp_replace(lower(item->>'id'), '[^a-z0-9]+', '_', 'g'), coalesce(nullif(item->>'category', ''), 'web'), 'device',
       '{"type":"object","required":["legacy_text"],"properties":{"legacy_text":{"type":"string"}}}'::jsonb, 'medium',
       regexp_replace(lower(item->>'id'), '[^a-z0-9]+', '_', 'g'), true, 'registered by the MPC-8737 backfill from public.web_scans; UNTYPED (F7): value is the legacy browser sentence, untrusted'
from public.web_scans w, jsonb_array_elements(case when jsonb_typeof(w.results) = 'array' then w.results else '[]'::jsonb end) item
cross join lateral (select 'web.' || regexp_replace(lower(item->>'id'), '[^a-z0-9]+', '_', 'g') as code) c
where item->>'id' is not null
on conflict (code) do nothing;

insert into ledger.data_point_type (code, domain, scope, value_schema, sensitivity, phrase_key_base, note) values
  ('score.baseline.overall', 'score', 'person', '{"type":"object","required":["score"]}', 'medium', 'score_baseline', 'mpt_score_baselines (earliest row wins)'),
  ('engagement.bridge_clicked', 'engagement', 'person', '{}', 'low', 'bridge_clicked', 'mpt_user_engagement'),
  ('engagement.email_confirmed', 'engagement', 'person', '{}', 'low', 'email_confirmed', 'mpt_user_engagement: a link click proves possession of the mailbox'),
  ('engagement.mobile_confirmed', 'engagement', 'person', '{}', 'low', 'mobile_confirmed', 'mpt_user_engagement'),
  ('consent.web_scan.save', 'consent', 'person', '{"type":"object","required":["granted"]}', 'medium', 'consent_save', 'web_scan_contacts.save_consent_at (the table stays the authoritative consent record)'),
  ('consent.web_scan.recognise', 'consent', 'person', '{"type":"object","required":["granted"]}', 'medium', 'consent_recognise', 'web_scan_contacts.recognise_consent_at')
on conflict (code) do nothing;

-- ── 3. data points ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- signals (email scans). not_checked keeps NULL / NULL; found / clear need the registry default and are HELD while it is NULL.
insert into ledger.data_point (person_id, type_code, subject_ref, value, status, confidence, source, channel, method, source_name, collector_version, provenance_extra, observed_at, legacy_ref, backfill_batch_id)
select ledger.root_person(pe.person_id), t.code, s.scan_id::text,
       case s.check_status when 'found' then jsonb_build_object('severity', s.severity) when 'clear' then jsonb_build_object('detected', false) end,
       s.check_status, case when s.check_status = 'not_checked' then null else t.default_check_confidence end,
       'checked', 'email', case when s.data_source ilike 'Analysed inside our Worker%' then 'local_analysis' else 'exact_lookup' end,
       left(coalesce(nullif(btrim(s.data_source), ''), 'unknown'), 200), 'backfill-mpc-8737',
       jsonb_strip_nulls(jsonb_build_object('legacy_text', s.details, 'legacy_untrusted', true, 'confidence_basis', case when s.check_status <> 'not_checked' then 'registry_default' end)),
       s.created_at, 'signals:' || s.id::text, :'backfill_batch_id'::uuid
from public.signals s
join public.scans sc on sc.id = s.scan_id
join public.users us on us.id = sc.user_id
join ledger.person_identifier pe on pe.id_type = 'email_hash' and pe.id_value = encode(sha256(convert_to(lower(btrim(us.email)), 'UTF8')), 'hex')
join ledger.data_point_type t on t.code = 'signal.' || s.category || '.' || regexp_replace(lower(s.signal_type), '[^a-z0-9]+', '_', 'g')
where s.check_status in ('found','clear','not_checked') and (s.check_status = 'not_checked' or t.default_check_confidence is not null)
on conflict (legacy_ref) where legacy_ref is not null do nothing;

-- web scan items (browser-reported, untrusted). A 100 is capped at 99 (H10); a not_checked item loses its number (F3) but the original is kept in provenance.
insert into ledger.data_point (person_id, type_code, subject_ref, value, status, confidence, source, channel, method, collector_version, provenance_extra, observed_at, legacy_ref, backfill_batch_id)
select ledger.root_person(pe.person_id), 'web.' || regexp_replace(lower(i.item->>'id'), '[^a-z0-9]+', '_', 'g'), w.id::text,
       case when i.st = 'not_checked' then null else jsonb_build_object('legacy_text', coalesce(i.item->>'value', '')) end,
       i.st, case when i.st = 'not_checked' then null else least(99, round(i.conf))::smallint end,
       'taken', 'web', case when (i.item->>'estimate') = 'true' then 'estimate' else 'heuristic' end, 'backfill-mpc-8737',
       jsonb_strip_nulls(jsonb_build_object('legacy_confidence', i.conf, 'confidence_capped', case when i.conf = 100 and i.st <> 'not_checked' then true end,
         'legacy_anomaly', case when i.st = 'found' and i.conf <= 2 then true end, 'legacy_risk_text', i.item->>'risk', 'legacy_category', i.item->>'category',
         'legacy_untrusted', true, 'legacy_confirmed', i.item->'confirmed')),
       w.created_at, 'web_scans:' || w.id::text || ':' || i.ord::text, :'backfill_batch_id'::uuid
from public.web_scans w
cross join lateral (
  select e.ord, e.item,
         case when e.item->>'id' is null then 'missing' else coalesce(e.item->>'status', 'missing') end as st,
         case when jsonb_typeof(e.item->'confidence') = 'number' then (e.item->>'confidence')::numeric end as conf
  from jsonb_array_elements(case when jsonb_typeof(w.results) = 'array' then w.results else '[]'::jsonb end) with ordinality e(item, ord)) i
join ledger.person_identifier pe on pe.id_type = 'web_scan_id' and pe.id_value = w.id::text
where i.st in ('found','clear','not_checked') and (i.st = 'not_checked' or i.conf between 0 and 100)
on conflict (legacy_ref) where legacy_ref is not null do nothing;

-- baselines (held until a default exists)
insert into ledger.data_point (person_id, type_code, value, status, confidence, source, channel, method, source_name, collector_version, provenance_extra, observed_at, legacy_ref, backfill_batch_id)
select ledger.root_person(pe.person_id), t.code, jsonb_strip_nulls(jsonb_build_object('score', b.overall_score, 'version', to_jsonb(b)->>'score_version')), 'found', t.default_check_confidence,
       'checked', 'email', 'mpt_score', 'mpt_score_baseline', 'backfill-mpc-8737', jsonb_build_object('confidence_basis', 'registry_default'), b.created_at, 'mpt_score_baselines:' || b.id::text, :'backfill_batch_id'::uuid
from public.mpt_score_baselines b
join ledger.person_identifier pe on pe.id_type = 'email_hash' and pe.id_value = b.email_hash
join ledger.data_point_type t on t.code = 'score.baseline.overall'
where t.default_check_confidence is not null
on conflict (legacy_ref) where legacy_ref is not null do nothing;

-- engagement (only TRUE flags are claims; a false flag is an absence). Held until a default exists.
insert into ledger.data_point (person_id, type_code, value, status, confidence, source, channel, method, source_name, collector_version, provenance_extra, observed_at, legacy_ref, backfill_batch_id)
select ledger.root_person(pe.person_id), t.code, jsonb_build_object('value', true), 'found', t.default_check_confidence,
       case when f.k = 'bridge_clicked' then 'taken' else 'checked' end, case when e.channel in ('web','email','telegram','whatsapp','sms') then e.channel else 'web' end,
       case when f.k = 'bridge_clicked' then 'webhook' else 'exact_lookup' end, case when f.k = 'bridge_clicked' then null else 'link_click' end,
       'backfill-mpc-8737', jsonb_build_object('confidence_basis', 'registry_default'), e.created_at, 'mpt_user_engagement:' || e.id::text || ':' || f.k, :'backfill_batch_id'::uuid
from public.mpt_user_engagement e
cross join lateral (values ('bridge_clicked', e.bridge_clicked), ('email_confirmed', e.email_confirmed), ('mobile_confirmed', e.mobile_confirmed)) f(k, v)
join ledger.person_identifier pe on pe.id_type = 'session_id' and pe.id_value = e.session_id
join ledger.data_point_type t on t.code = 'engagement.' || f.k
where f.v and t.default_check_confidence is not null
on conflict (legacy_ref) where legacy_ref is not null do nothing;

-- consent copies (GIVEN; the table stays the authoritative record). Held until a default exists.
insert into ledger.data_point (person_id, type_code, value, status, confidence, source, channel, method, input_ref, collector_version, provenance_extra, observed_at, legacy_ref, backfill_batch_id)
select ledger.root_person(pe.person_id), t.code, jsonb_build_object('granted', true, 'version', f.ver), 'found', least(t.default_check_confidence, 99::smallint),
       'given', 'web', 'button_tap', 'web_scan_contacts:' || c.id::text, 'backfill-mpc-8737', jsonb_build_object('confidence_basis', 'registry_default'), f.at, 'web_scan_contacts:' || c.id::text || ':' || f.k, :'backfill_batch_id'::uuid
from public.web_scan_contacts c
cross join lateral (values ('save', c.save_consent_at, c.save_consent_version), ('recognise', c.recognise_consent_at, c.recognise_consent_version)) f(k, at, ver)
join ledger.person_identifier pe on pe.id_type = 'web_scan_id' and pe.id_value = c.web_scan_id::text
join ledger.data_point_type t on t.code = 'consent.web_scan.' || f.k
where f.at is not null and t.default_check_confidence is not null
on conflict (legacy_ref) where legacy_ref is not null do nothing;

-- ── 4. report ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select 'batch ' || :'backfill_batch_id' || ': ' || (select count(*) from ledger.data_point where backfill_batch_id = :'backfill_batch_id'::uuid) || ' data points, '
       || (select count(*) from ledger.person) || ' persons, ' || (select count(*) from ledger.person_identifier) || ' identifiers';
commit;
