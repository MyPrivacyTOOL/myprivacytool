-- MyPrivacyTOOL Option B baseline migration (MPC-9896). Version 20261127060000.
-- It records the structure of the LIVE production database as of 2026-11-27 (HKT), so a new empty database can be built from this one file.
-- Source: pg_dump of the live project, supabase-schema-snapshot run 45934211616 (2026-11-27 11:28 HKT; artifact live_schema.sql sha256 0e09a36366d6632d65f0314b17a6a70d487f034dc86773cc8f853db49cf5438f),
-- plus what a schema-only dump does not contain (found by comparing with the live catalog): role visit_log_writer, event trigger ensure_rls,
-- and the 17 pg_cron jobs, plus live migration 20261127053004 (exclude_test_scans_from_kpi), applied by hand after that snapshot
-- (section 2b: its recorded SQL, byte-checked against live, without its data-only backfill).
-- The snapshot was replayed on an empty Postgres 17.12 with 0 errors and compared with live (MPC-9896 page, Pass 2 result).
--
-- IMPORTANT: this file is NEVER executed on the live database. The live migration history records version 20261127060000 as already applied
-- (one bookkeeping row). The older live versions are kept as empty placeholder files in this folder so `supabase db push` sees the same
-- history as live; the old migration chain is in supabase/migrations_archive/ (kept for reference, not applied). See supabase/MIGRATIONS.md.
-- Not in this file on purpose (Supabase platform-managed): roles anon/authenticated/service_role, storage/auth/realtime objects.
-- Structure only. No table data. No secret values.

-- ===== 1. roles =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visit_log_writer') THEN
    CREATE ROLE "visit_log_writer" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                 WHERE r.rolname = 'visit_log_writer' AND u.rolname = 'postgres') THEN
    GRANT "visit_log_writer" TO "postgres";
  END IF;
END $$;

-- ===== 2. pg_dump of the live schema (unchanged) =====



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "ledger";


ALTER SCHEMA "ledger" OWNER TO "postgres";


COMMENT ON SCHEMA "ledger" IS 'MPC-8737 data-point ledger v1 (design MPC-7898). Append-only. Not exposed to the REST API; no role reads the tables directly, channels call ledger.render_claim / render_progress.';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "visit_log";


ALTER SCHEMA "visit_log" OWNER TO "visit_log_writer";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "ledger"."_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
begin
  -- Only the erase / batch-rollback functions (SECURITY DEFINER, so current_user is their owner) may remove rows. A caller running as any other role cannot opt in by setting the flag.
  if current_setting('ledger.allow_erase', true) = 'on' and tg_op = 'DELETE'
     and current_user = (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'ledger.erase_person(uuid)'::regprocedure) then
    return old;
  end if;
  raise exception 'ledger: % on %.% is not allowed (append-only; corrections are new rows via supersedes_id)', tg_op, tg_table_schema, tg_table_name using errcode = 'insufficient_privilege';
end $$;


ALTER FUNCTION "ledger"."_append_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_consequence_approved"("p_key" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
begin
  if to_regclass('public.localization') is null then return false; end if;
  return exists (select 1 from public.localization l where l.key = p_key and l.status = 'approved');
end $$;


ALTER FUNCTION "ledger"."_consequence_approved"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_data_point_h18_not_allowed"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
begin
  if new.source = 'checked' and exists (select 1 from ledger.data_point_type where code = new.type_code and access_class = 'not_allowed') then
    raise exception 'ledger: H18 % is not allowed (breaks the MPC-8452 rules); nothing may be checked for it', new.type_code using errcode = 'check_violation';
  end if;
  return new;
end $$;


ALTER FUNCTION "ledger"."_data_point_h18_not_allowed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_data_point_validate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare t ledger.data_point_type%rowtype; pstat text; s ledger.data_point%rowtype; d text; dscope text;
begin
  select status into pstat from ledger.person where person_id = new.person_id;
  if pstat in ('erased','merged') then raise exception 'ledger: person % is % (write to the root person)', new.person_id, pstat; end if;
  select * into t from ledger.data_point_type where code = new.type_code;
  -- a user's answer to a claim (A2.1: value.answer) is the one generic envelope every type accepts, from a GIVEN row only
  if new.status in ('found','clear')
     and not (new.source = 'given' and new.value in ('{"answer":"confirmed"}'::jsonb, '{"answer":"not_me"}'::jsonb, '{"answer":"disputed"}'::jsonb))
     and not ledger.value_matches(t.value_schema, new.value) then
    raise exception 'ledger: value does not match the registry schema of %', new.type_code using errcode = 'check_violation';
  end if;
  -- H8: a point derived from other types may only use types of the same scope
  if jsonb_typeof(new.provenance_extra->'derived_from') = 'array' then
    for d in select jsonb_array_elements_text(new.provenance_extra->'derived_from') loop
      select scope into dscope from ledger.data_point_type where code = d;
      if dscope is null then raise exception 'ledger: derived_from names an unknown type %', d using errcode = 'check_violation'; end if;
      if dscope <> t.scope then raise exception 'ledger: H8 a % fact (%) cannot be used to make a % claim (%)', dscope, d, t.scope, new.type_code using errcode = 'check_violation'; end if;
    end loop;
  end if;
  if new.supersedes_id is not null then
    select * into s from ledger.data_point where data_point_id = new.supersedes_id;
    if not found or ledger.root_person(s.person_id) <> ledger.root_person(new.person_id) or s.type_code <> new.type_code
       or coalesce(s.subject_ref, '') <> coalesce(new.subject_ref, '') or s.source <> new.source then
      raise exception 'ledger: supersedes_id must name an earlier point of the same person, type, subject and source' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;


ALTER FUNCTION "ledger"."_data_point_validate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_eval_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", OUT "o_class" "text", OUT "o_variant" "text", OUT "o_params" "jsonb", OUT "o_bar" smallint, OUT "o_action" "text", OUT "o_ids" "uuid"[], OUT "o_base" "text") RETURNS "record"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare
  root uuid := ledger.root_person(p_person); t ledger.data_point_type%rowtype;
  c ledger.data_point%rowtype; g ledger.data_point%rowtype; have_c boolean; have_g boolean;
  c_exp boolean; g_exp boolean; c_cls text := 'unknown'; g_cls text := 'unknown'; pick ledger.data_point%rowtype; pick_cls text;
  rank_c int; rank_g int;
begin
  select * into t from ledger.data_point_type where code = p_type;
  if not found then o_class := 'unknown'; o_variant := 'not_checked'; o_params := jsonb_build_object('type', p_type); o_ids := '{}'; o_base := 'unregistered'; o_action := null; return; end if;
  o_base := t.phrase_key_base; o_params := jsonb_build_object('type', p_type, 'subject', p_subject); o_ids := '{}';
  select * into c from ledger.v_data_point_current v
   where v.root_person_id = root and v.type_code = p_type and coalesce(v.subject_ref, '') = coalesce(p_subject, '') and v.source in ('checked','taken')
   order by v.observed_at desc, v.created_at desc limit 1;
  have_c := found;
  select * into g from ledger.v_data_point_current v
   where v.root_person_id = root and v.type_code = p_type and coalesce(v.subject_ref, '') = coalesce(p_subject, '') and v.source = 'given'
   order by v.observed_at desc, v.created_at desc limit 1;
  have_g := found;
  if have_c then c_exp := ledger._expired(c.expires_at, c.observed_at, t.max_age); c_cls := ledger.class_of(c.source, c.status, c.confidence, c_exp); end if;
  if have_g then g_exp := ledger._expired(g.expires_at, g.observed_at, t.max_age); g_cls := ledger.class_of(g.source, g.status, g.confidence, g_exp); end if;

  if c_cls = 'unknown' and g_cls = 'unknown' then
    o_class := 'unknown';
    if have_c and c.status = 'check_failed' then o_variant := 'unavailable'; o_action := 'retry'; o_ids := array[c.data_point_id];
    elsif (have_c and coalesce(c_exp, false)) or (have_g and coalesce(g_exp, false)) then o_variant := 'stale'; o_action := 'recheck';
          o_ids := array_remove(array[case when have_c then c.data_point_id end, case when have_g then g.data_point_id end], null);
    else o_variant := 'not_checked'; o_action := null; if have_c then o_ids := array[c.data_point_id]; end if; end if;
    return;
  end if;

  -- both usable and they disagree
  if c_cls <> 'unknown' and g_cls <> 'unknown' and ledger.values_disagree(g.value, c.value) then
    if c_cls = 'verified' and g.observed_at <= c.observed_at then
      o_class := 'verified'; o_variant := 'mismatch'; pick := c; o_params := o_params || jsonb_build_object('told', g.value, 'checked', c.value);
      o_ids := array[c.data_point_id, g.data_point_id];
    else
      -- the person spoke after the check ("I fixed it") or our side is only a guess: their word stands, labelled as not re-checked
      o_class := g_cls; o_variant := 'told_stale_check'; pick := g; o_params := o_params || jsonb_build_object('told', g.value, 'checked', c.value);
      o_ids := array[g.data_point_id, c.data_point_id];
    end if;
  else
    rank_c := case c_cls when 'verified' then 3 when 'self_attested' then 2 when 'inferred' then 1 else 0 end;
    rank_g := case g_cls when 'verified' then 3 when 'self_attested' then 2 when 'inferred' then 1 else 0 end;
    if rank_c >= rank_g then pick := c; pick_cls := c_cls; else pick := g; pick_cls := g_cls; end if;
    o_class := pick_cls; o_ids := array[pick.data_point_id];
    o_params := o_params || jsonb_build_object('value', pick.value);
    o_variant := case pick_cls
      when 'verified' then case when pick.source = 'taken' then 'observed'
                                when pick.status = 'clear' and t.clean_phrase_allowed then 'clean'     -- H3: the only door to the clean family
                                when pick.status = 'clear' then 'clear_in_source' else 'found' end
      when 'self_attested' then case when jsonb_typeof(pick.value) = 'object' and pick.value->>'answer' = 'not_me' then 'told_not_me'
                                     when jsonb_typeof(pick.value) = 'object' and pick.value->>'answer' = 'disputed' then 'told_disputed' else 'told' end
      else 'guess' end;
  end if;
  o_bar := ledger.confidence_band(pick.confidence);
  o_action := case o_class when 'inferred' then 'confirm' else case when o_variant = 'told_stale_check' then 'recheck' end end;
end $$;


ALTER FUNCTION "ledger"."_eval_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", OUT "o_class" "text", OUT "o_variant" "text", OUT "o_params" "jsonb", OUT "o_bar" smallint, OUT "o_action" "text", OUT "o_ids" "uuid"[], OUT "o_base" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_expired"("p_expires" timestamp with time zone, "p_observed" timestamp with time zone, "p_max_age" interval) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select (p_expires is not null and p_expires <= now()) or (p_max_age is not null and p_observed + p_max_age <= now())
$$;


ALTER FUNCTION "ledger"."_expired"("p_expires" timestamp with time zone, "p_observed" timestamp with time zone, "p_max_age" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_merge_persons"("p_from" "uuid", "p_into" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare f uuid := ledger.root_person(p_from); i uuid := ledger.root_person(p_into);
begin
  if f = i then return; end if;
  if exists (select 1 from ledger.person where person_id in (f, i) and status = 'erased') then raise exception 'ledger: cannot merge an erased person'; end if;
  update ledger.person set status = 'merged', merged_into = i where person_id = f;
  update ledger.person set status = 'active' where person_id = i and status = 'provisional';
end $$;


ALTER FUNCTION "ledger"."_merge_persons"("p_from" "uuid", "p_into" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_normalise_identifier"("p_type" "text", "p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case p_type
    when 'wa_id' then ledger.normalise_wa_id(p_value)
    when 'email_hash' then lower(btrim(p_value))
    when 'telegram_id' then btrim(p_value)
    else nullif(btrim(p_value), '') end
$$;


ALTER FUNCTION "ledger"."_normalise_identifier"("p_type" "text", "p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_profile_item_h18"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare t ledger.data_point_type%rowtype;
begin
  select * into t from ledger.data_point_type where code = new.type_code;
  if t.hexagon_id is not null and (t.build_state <> 'built' or t.access_class <> 'ok') then
    raise exception 'ledger: H18 % is % / access %, so it cannot be promised in a report profile', new.type_code, t.build_state, t.access_class using errcode = 'check_violation';
  end if;
  return new;
end $$;


ALTER FUNCTION "ledger"."_profile_item_h18"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_risk_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", OUT "o_root" "uuid", OUT "o_dp" "uuid", OUT "o_status" "text", OUT "o_value" "jsonb", OUT "o_hash" "text", OUT "o_expired" boolean, OUT "o_not_me" boolean) RETURNS "record"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare c ledger.data_point%rowtype; g ledger.data_point%rowtype; t ledger.data_point_type%rowtype;
begin
  o_root := ledger.root_person(p_person);
  select * into t from ledger.data_point_type where code = p_type;
  select * into c from ledger.v_data_point_current v
   where v.root_person_id = o_root and v.type_code = p_type and coalesce(v.subject_ref, '') = coalesce(p_subject, '') and v.source in ('checked','taken')
   order by v.observed_at desc, v.created_at desc limit 1;
  if found then
    o_dp := c.data_point_id; o_status := c.status; o_value := c.value;
    o_hash := case when c.value is null then null else md5(c.value::text) end;
    o_expired := ledger._expired(c.expires_at, c.observed_at, t.max_age);
  end if;
  select * into g from ledger.v_data_point_current v
   where v.root_person_id = o_root and v.type_code = p_type and coalesce(v.subject_ref, '') = coalesce(p_subject, '') and v.source = 'given'
   order by v.observed_at desc, v.created_at desc limit 1;
  o_not_me := found and g.status = 'found' and jsonb_typeof(g.value) = 'object' and (g.value->>'answer') in ('not_me','disputed');
end $$;


ALTER FUNCTION "ledger"."_risk_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", OUT "o_root" "uuid", OUT "o_dp" "uuid", OUT "o_status" "text", OUT "o_value" "jsonb", OUT "o_hash" "text", OUT "o_expired" boolean, OUT "o_not_me" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_risk_decision_validate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare t ledger.data_point_type%rowtype; c record; pstat text; st record; e ledger.risk_education_event%rowtype; ev ledger.data_point%rowtype;
begin
  select status into pstat from ledger.person where person_id = new.person_id;
  if pstat in ('erased','merged') then raise exception 'ledger: person % is % (write to the root person)', new.person_id, pstat; end if;
  select * into t from ledger.data_point_type where code = new.type_code;
  if not t.risk_applicable then raise exception 'ledger: H11 % has no risk axis', new.type_code using errcode = 'check_violation'; end if;
  select * into c from ledger._risk_claim(new.person_id, new.type_code, nullif(new.subject_key, ''));
  if c.o_dp is distinct from new.data_point_id or c.o_status is distinct from 'found' or coalesce(c.o_expired, true) or c.o_hash is distinct from new.value_hash then
    raise exception 'ledger: H11 a risk decision must be about the claim''s current found data point and its value' using errcode = 'check_violation'; end if;
  if c.o_not_me then raise exception 'ledger: H17 a risk decision on a claim the person marked not_me is not allowed' using errcode = 'check_violation'; end if;
  select * into st from ledger._risk_eval(new.person_id, new.type_code, nullif(new.subject_key, ''), new.scan_key);
  -- H15: from_state is the derived state, and only the legal transitions exist
  if st.o_state is distinct from new.from_state then raise exception 'ledger: H15 from_state % but the claim is %', new.from_state, st.o_state using errcode = 'check_violation'; end if;
  if new.kind = 'accepted' and st.o_state <> 'educated' then raise exception 'ledger: H12 accepted needs the claim to be educated first (it is %)', st.o_state using errcode = 'check_violation'; end if;
  if new.kind = 'removed' and st.o_state not in ('unknown','educated') then raise exception 'ledger: H15 cannot remove a claim that is already %', st.o_state using errcode = 'check_violation'; end if;
  if new.kind = 'accepted' then
    select * into e from ledger.risk_education_event where education_id = new.education_id;
    if not found or e.person_id <> any (select x from ledger.person_family(c.o_root) x) then raise exception 'ledger: H12 the education belongs to someone else' using errcode = 'check_violation'; end if;
    if e.value_hash <> new.value_hash or e.data_point_id <> new.data_point_id then raise exception 'ledger: H12 the education was for a different value' using errcode = 'check_violation'; end if;
    if e.consequence_version is distinct from t.consequence_version then raise exception 'ledger: H12 the consequence text changed since the education; educate again' using errcode = 'check_violation'; end if;
    if not (e.shown_at < new.decided_at) then raise exception 'ledger: H12 the education must be shown before the acceptance' using errcode = 'check_violation'; end if;
  end if;
  if new.basis = 'checked' then
    select * into ev from ledger.data_point where data_point_id = new.evidence_data_point_id;
    if not found or ev.status <> 'clear' or ev.source <> 'checked' or ev.type_code <> new.type_code or coalesce(ev.subject_ref, '') <> new.subject_key
       or ledger.root_person(ev.person_id) <> c.o_root then
      raise exception 'ledger: H14 removed-by-checked needs a checked clear data point for the same claim' using errcode = 'check_violation'; end if;
  end if;
  if new.render_id is not null and not exists (select 1 from ledger.render_log r where r.render_id = new.render_id and ledger.root_person(r.person_id) = c.o_root) then
    raise exception 'ledger: H14 render % is not a render shown to this person', new.render_id using errcode = 'check_violation'; end if;
  return new;
end $$;


ALTER FUNCTION "ledger"."_risk_decision_validate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_risk_education_validate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare t ledger.data_point_type%rowtype; c record; pstat text; st record; r ledger.render_log%rowtype; want_key text;
begin
  select status into pstat from ledger.person where person_id = new.person_id;
  if pstat in ('erased','merged') then raise exception 'ledger: person % is % (write to the root person)', new.person_id, pstat; end if;
  select * into t from ledger.data_point_type where code = new.type_code;
  if not t.risk_applicable then raise exception 'ledger: H11 % has no risk axis', new.type_code using errcode = 'check_violation'; end if;
  -- H13: the type needs an approved consequence text, and the event must name exactly it
  if t.consequence_key_base is null then raise exception 'ledger: H13 % has no approved consequence text, so it cannot be educated (and so cannot be accepted)', new.type_code using errcode = 'check_violation'; end if;
  want_key := 'report.consequence.' || t.consequence_key_base || '.v' || t.consequence_version;
  if new.consequence_key <> want_key or new.consequence_version <> t.consequence_version then
    raise exception 'ledger: H13 consequence % v% is not the registry''s current (%)', new.consequence_key, new.consequence_version, want_key using errcode = 'check_violation'; end if;
  if not ledger._consequence_approved(want_key) then raise exception 'ledger: H13 consequence text % is not approved in localization', want_key using errcode = 'check_violation'; end if;
  -- H11: the data point is the claim's current found row, and the hash is that row's value
  select * into c from ledger._risk_claim(new.person_id, new.type_code, nullif(new.subject_key, ''));
  if c.o_dp is distinct from new.data_point_id or c.o_status is distinct from 'found' or coalesce(c.o_expired, true) or c.o_hash is distinct from new.value_hash then
    raise exception 'ledger: H11 education must be about the claim''s current found data point and its value' using errcode = 'check_violation'; end if;
  if c.o_not_me then raise exception 'ledger: H17 the person said this is not theirs; it cannot be educated about' using errcode = 'check_violation'; end if;
  -- H13: the render that showed it is a real guard render of this data point and this consequence, for this person
  select * into r from ledger.render_log where render_id = new.render_id;
  if not found or r.kind <> 'consequence' or r.type_code is distinct from new.type_code or ledger.root_person(r.person_id) <> c.o_root
     or not (r.data_point_ids @> array[new.data_point_id]) or not (r.phrase_keys @> array[new.consequence_key]) then
    raise exception 'ledger: H13 render % is not a guard render of this consequence for this data point', new.render_id using errcode = 'check_violation'; end if;
  -- H15: educating is legal from unknown or educated only
  select * into st from ledger._risk_eval(new.person_id, new.type_code, nullif(new.subject_key, ''), new.scan_key);
  if st.o_state not in ('unknown','educated') then raise exception 'ledger: H15 cannot educate a claim that is already %', st.o_state using errcode = 'check_violation'; end if;
  return new;
end $$;


ALTER FUNCTION "ledger"."_risk_education_validate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."_risk_eval"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan" "text", OUT "o_state" "text", OUT "o_reason" "text", OUT "o_basis" "text", OUT "o_dp" "uuid", OUT "o_hash" "text", OUT "o_education" "uuid", OUT "o_decision" "uuid") RETURNS "record"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare t ledger.data_point_type%rowtype; c record; fam uuid[]; d ledger.risk_decision_event%rowtype; e ledger.risk_education_event%rowtype;
begin
  select * into t from ledger.data_point_type where code = p_type;
  if not found or not t.risk_applicable then o_state := 'not_applicable'; o_reason := 'no_risk_axis'; return; end if;
  select * into c from ledger._risk_claim(p_person, p_type, p_subject);
  o_dp := c.o_dp; o_hash := c.o_hash;
  if c.o_dp is null or c.o_status not in ('found','clear') or coalesce(c.o_expired, true) then o_state := 'not_applicable'; o_reason := 'not_checked'; return; end if;
  if c.o_status = 'clear' then o_state := 'not_applicable'; o_reason := 'clear'; return; end if;
  if c.o_not_me then o_state := 'not_me'; return; end if;
  select array_agg(x) into fam from ledger.person_family(c.o_root) x;
  select * into d from ledger.risk_decision_event r
   where r.person_id = any (fam) and r.type_code = p_type and r.subject_key = coalesce(p_subject, '') and r.scan_key = p_scan and r.value_hash = c.o_hash
   order by r.decided_at desc, r.created_at desc limit 1;
  if found then o_state := d.to_state; o_basis := d.basis; o_decision := d.decision_id; o_education := d.education_id; return; end if;
  select * into e from ledger.risk_education_event r
   where r.person_id = any (fam) and r.type_code = p_type and r.subject_key = coalesce(p_subject, '') and r.scan_key = p_scan and r.value_hash = c.o_hash
     and r.consequence_version is not distinct from t.consequence_version
   order by r.shown_at desc, r.created_at desc limit 1;
  if found then o_state := 'educated'; o_basis := 'checked'; o_education := e.education_id; return; end if;
  o_state := 'unknown';
end $$;


ALTER FUNCTION "ledger"."_risk_eval"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan" "text", OUT "o_state" "text", OUT "o_reason" "text", OUT "o_basis" "text", OUT "o_dp" "uuid", OUT "o_hash" "text", OUT "o_education" "uuid", OUT "o_decision" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."attach_identifier"("p_person" "uuid", "p_type" "text", "p_value" "text", "p_proof_state" "text" DEFAULT 'unproven'::"text", "p_proof_method" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare
  v text := ledger._normalise_identifier(p_type, p_value);
  me uuid := ledger.root_person(p_person);
  ex ledger.person_identifier%rowtype; owner uuid; strong boolean := p_type in ('wa_id','telegram_id','email_hash');
  keep uuid; lose uuid;
begin
  if v is null then raise exception 'ledger: unusable % identifier', p_type; end if;
  if p_proof_state not in ('unproven','claimed','proven') then raise exception 'ledger: bad proof_state'; end if;
  if p_proof_state = 'proven' and nullif(btrim(p_proof_method), '') is null then raise exception 'ledger: proven needs a proof_method'; end if;
  select * into ex from ledger.person_identifier where id_type = p_type and id_value = v;
  if not found then
    insert into ledger.person_identifier (person_id, id_type, id_value, proof_state, proven_at, proof_method)
    values (me, p_type, v, p_proof_state, case when p_proof_state = 'proven' then now() end, p_proof_method);
    if p_proof_state = 'proven' then update ledger.person set status = 'active' where person_id = me and status = 'provisional'; end if;
    return jsonb_build_object('outcome', 'attached', 'person_id', me);
  end if;
  owner := ledger.root_person(ex.person_id);
  -- upgrade the proof (never downgrade)
  if p_proof_state = 'proven' and ex.proof_state <> 'proven' then
    update ledger.person_identifier set proof_state = 'proven', proven_at = now(), proof_method = p_proof_method, last_seen_at = now() where identifier_id = ex.identifier_id;
    ex.proof_state := 'proven';
  elsif p_proof_state = 'claimed' and ex.proof_state = 'unproven' then
    update ledger.person_identifier set proof_state = 'claimed', last_seen_at = now() where identifier_id = ex.identifier_id;
  else
    update ledger.person_identifier set last_seen_at = now() where identifier_id = ex.identifier_id;
  end if;
  if owner = me then return jsonb_build_object('outcome', 'unchanged', 'person_id', me); end if;
  if strong and ex.proof_state = 'proven' and p_proof_state = 'proven' then
    select case when (select created_at from ledger.person where person_id = owner) <= (select created_at from ledger.person where person_id = me) then owner else me end into keep;
    lose := case when keep = owner then me else owner end;
    perform ledger._merge_persons(lose, keep);
    return jsonb_build_object('outcome', 'merged', 'person_id', keep, 'merged_from', lose);
  end if;
  insert into ledger.identity_link (person_a, person_b, confidence, basis)
  values (me, owner, 50, 'shared_' || p_type || case when strong then '_unproven' else '_weak' end) on conflict do nothing;
  return jsonb_build_object('outcome', 'proposed_link', 'person_id', me, 'other_person_id', owner);
end $$;


ALTER FUNCTION "ledger"."attach_identifier"("p_person" "uuid", "p_type" "text", "p_value" "text", "p_proof_state" "text", "p_proof_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."class_of"("p_source" "text", "p_status" "text", "p_confidence" smallint, "p_expired" boolean) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_status is null or p_status not in ('found','clear') or p_confidence is null or coalesce(p_expired, true) then 'unknown'
    when p_confidence < ledger.guess_below() then 'inferred'
    when p_source in ('checked','taken') then 'verified'
    when p_source = 'given' then 'self_attested'
    else 'unknown' end
$$;


ALTER FUNCTION "ledger"."class_of"("p_source" "text", "p_status" "text", "p_confidence" smallint, "p_expired" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."confidence_band"("p_confidence" smallint) RETURNS smallint
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_confidence is null then null
              when p_confidence < 40 then 1 when p_confidence < 60 then 2 when p_confidence < 80 then 3 when p_confidence < 95 then 4 else 5 end::smallint
$$;


ALTER FUNCTION "ledger"."confidence_band"("p_confidence" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."confirm_link"("p_link" "uuid", "p_given_data_point" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare l ledger.identity_link%rowtype; d ledger.data_point%rowtype;
begin
  select * into l from ledger.identity_link where link_id = p_link and state = 'proposed';
  if not found then raise exception 'ledger: no proposed link %', p_link; end if;
  select * into d from ledger.data_point where data_point_id = p_given_data_point;
  if not found or d.source <> 'given' or d.type_code <> 'identity.link_confirmation' or d.status <> 'found'
     or ledger.root_person(d.person_id) not in (ledger.root_person(l.person_a), ledger.root_person(l.person_b)) then
    raise exception 'ledger: a link is confirmed only by the person''s own given identity.link_confirmation point';
  end if;
  update ledger.identity_link set state = 'confirmed', decided_at = now() where link_id = p_link;
  perform ledger._merge_persons(l.person_a, l.person_b);
end $$;


ALTER FUNCTION "ledger"."confirm_link"("p_link" "uuid", "p_given_data_point" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."erase_person"("p_person" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare root uuid := ledger.root_person(p_person); fam uuid[]; n_dp int; n_se int; n_rl int; n_id int; n_rd int; n_re int;
begin
  select array_agg(x) into fam from ledger.person_family(root) x;
  perform set_config('ledger.allow_erase', 'on', true);
  delete from ledger.risk_decision_event where person_id = any (fam); get diagnostics n_rd = row_count;
  delete from ledger.risk_education_event where person_id = any (fam); get diagnostics n_re = row_count;
  delete from ledger.shown_event where person_id = any (fam); get diagnostics n_se = row_count;
  delete from ledger.render_log where person_id = any (fam); get diagnostics n_rl = row_count;
  delete from ledger.data_point where person_id = any (fam); get diagnostics n_dp = row_count;
  delete from ledger.identity_link where person_a = any (fam) or person_b = any (fam);
  delete from ledger.person_identifier where person_id = any (fam); get diagnostics n_id = row_count;
  update ledger.person set status = 'erased', merged_into = null, primary_locale = null where person_id = any (fam);
  perform set_config('ledger.allow_erase', 'off', true);
  return jsonb_build_object('persons', cardinality(fam), 'data_points', n_dp, 'shown_events', n_se, 'render_log', n_rl, 'identifiers', n_id,
                            'risk_decisions', n_rd, 'risk_educations', n_re);
end $$;


ALTER FUNCTION "ledger"."erase_person"("p_person" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."guard_version"() RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select 'ledger-guard-1'::text $$;


ALTER FUNCTION "ledger"."guard_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."guess_below"() RETURNS smallint
    LANGUAGE "sql" IMMUTABLE
    AS $$ select 80::smallint $$;


ALTER FUNCTION "ledger"."guess_below"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."hexagon_type_code"("p_id" "text", "p_channel" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_id like '%.%' then p_id
              when p_channel = 'email' and p_id like 'email-%' then 'email.' || replace(substr(p_id, 7), '-', '_')
              else p_channel || '.' || replace(p_id, '-', '_') end
$$;


ALTER FUNCTION "ledger"."hexagon_type_code"("p_id" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."normalise_wa_id"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select case when d ~ '^[1-9][0-9]{5,14}$' then '+' || d end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', '') as d) s
$_$;


ALTER FUNCTION "ledger"."normalise_wa_id"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."person_family"("p_root" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
  with recursive fam(person_id) as (
    select p_root union select pe.person_id from ledger.person pe join fam on pe.merged_into = fam.person_id)
  select person_id from fam
$$;


ALTER FUNCTION "ledger"."person_family"("p_root" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."record_answer"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_answer" "text", "p_confidence_at_display" smallint, "p_latency_ms" integer, "p_channel" "text", "p_input_ref" "text", "p_locale" "text" DEFAULT NULL::"text", "p_shown_at" timestamp with time zone DEFAULT "now"(), "p_observed_at" timestamp with time zone DEFAULT "now"()) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare dp uuid; root uuid := ledger.root_person(p_person);
begin
  if p_answer not in ('confirmed','not_me','disputed') then raise exception 'ledger: unknown answer %', p_answer; end if;
  dp := ledger.record_data_point(root, p_type, p_subject, jsonb_build_object('answer', p_answer), 'found', 95::smallint, 'given', p_channel, 'button_tap',
                                 null, p_input_ref, p_locale, p_observed_at, null, null, '{}'::jsonb, null);
  insert into ledger.shown_event (person_id, type_code, subject_ref, confidence_at_display, response, latency_ms, channel, shown_at, data_point_id)
  values (root, p_type, p_subject, p_confidence_at_display, p_answer, p_latency_ms, p_channel, p_shown_at, dp);
  return dp;
end $$;


ALTER FUNCTION "ledger"."record_answer"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_answer" "text", "p_confidence_at_display" smallint, "p_latency_ms" integer, "p_channel" "text", "p_input_ref" "text", "p_locale" "text", "p_shown_at" timestamp with time zone, "p_observed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."record_data_point"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_value" "jsonb", "p_status" "text", "p_confidence" smallint, "p_source" "text", "p_channel" "text", "p_method" "text", "p_source_name" "text" DEFAULT NULL::"text", "p_input_ref" "text" DEFAULT NULL::"text", "p_locale" "text" DEFAULT NULL::"text", "p_observed_at" timestamp with time zone DEFAULT "now"(), "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_supersedes" "uuid" DEFAULT NULL::"uuid", "p_provenance" "jsonb" DEFAULT '{}'::"jsonb", "p_collector_version" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare id uuid;
begin
  insert into ledger.data_point (person_id, type_code, subject_ref, value, status, confidence, source, channel, method, source_name, input_ref, locale,
                                 observed_at, expires_at, supersedes_id, provenance_extra, collector_version)
  values (ledger.root_person(p_person), p_type, p_subject, p_value, p_status, p_confidence, p_source, p_channel, p_method, p_source_name, p_input_ref, p_locale,
          coalesce(p_observed_at, now()), p_expires_at, p_supersedes, coalesce(p_provenance, '{}'::jsonb), p_collector_version)
  returning data_point_id into id;
  return id;
end $$;


ALTER FUNCTION "ledger"."record_data_point"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_value" "jsonb", "p_status" "text", "p_confidence" smallint, "p_source" "text", "p_channel" "text", "p_method" "text", "p_source_name" "text", "p_input_ref" "text", "p_locale" "text", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_supersedes" "uuid", "p_provenance" "jsonb", "p_collector_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."record_risk_decision"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_kind" "text", "p_basis" "text", "p_education_id" "uuid", "p_input_ref" "text", "p_render_id" "uuid", "p_evidence_dp" "uuid", "p_channel" "text", "p_locale" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare c record; st record; id uuid;
begin
  select * into c from ledger._risk_claim(p_person, p_type, p_subject);
  select * into st from ledger._risk_eval(p_person, p_type, p_subject, p_scan_key);
  insert into ledger.risk_decision_event (person_id, type_code, subject_key, scan_key, data_point_id, value_hash, kind, from_state, to_state, basis, education_id, input_ref,
                                          evidence_data_point_id, render_id, channel, locale)
  values (c.o_root, p_type, coalesce(p_subject, ''), p_scan_key, c.o_dp, c.o_hash, p_kind, st.o_state, p_kind, p_basis, p_education_id, p_input_ref, p_evidence_dp, p_render_id, p_channel, p_locale)
  returning decision_id into id;
  return id;
end $$;


ALTER FUNCTION "ledger"."record_risk_decision"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_kind" "text", "p_basis" "text", "p_education_id" "uuid", "p_input_ref" "text", "p_render_id" "uuid", "p_evidence_dp" "uuid", "p_channel" "text", "p_locale" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."record_risk_education"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_render_id" "uuid", "p_channel" "text", "p_locale" "text" DEFAULT NULL::"text", "p_visible_ms" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare c record; t ledger.data_point_type%rowtype; id uuid;
begin
  select * into t from ledger.data_point_type where code = p_type;
  select * into c from ledger._risk_claim(p_person, p_type, p_subject);
  insert into ledger.risk_education_event (person_id, type_code, subject_key, scan_key, data_point_id, value_hash, consequence_key, consequence_version, render_id, channel, locale, visible_ms)
  values (c.o_root, p_type, coalesce(p_subject, ''), p_scan_key, c.o_dp, c.o_hash,
          'report.consequence.' || t.consequence_key_base || '.v' || t.consequence_version, t.consequence_version, p_render_id, p_channel, p_locale, p_visible_ms)
  returning education_id into id;
  return id;
end $$;


ALTER FUNCTION "ledger"."record_risk_education"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_render_id" "uuid", "p_channel" "text", "p_locale" "text", "p_visible_ms" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."record_shown"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_confidence_at_display" smallint, "p_channel" "text", "p_shown_at" timestamp with time zone DEFAULT "now"()) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare id uuid;
begin
  insert into ledger.shown_event (person_id, type_code, subject_ref, confidence_at_display, response, channel, shown_at)
  values (ledger.root_person(p_person), p_type, p_subject, p_confidence_at_display, 'no_response', p_channel, p_shown_at) returning shown_id into id;
  return id;
end $$;


ALTER FUNCTION "ledger"."record_shown"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_confidence_at_display" smallint, "p_channel" "text", "p_shown_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."render_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") RETURNS TABLE("class" "text", "phrase_key" "text", "phrase_params" "jsonb", "bar" smallint, "action_key" "text", "data_point_ids" "uuid"[], "render_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare e record; rid uuid; keyname text;
begin
  select * into e from ledger._eval_claim(p_person, p_type, p_subject);
  keyname := 'report.' || e.o_class || '.' || e.o_base || '.' || e.o_variant;
  insert into ledger.render_log (person_id, kind, channel, locale, type_code, subject_ref, class, phrase_keys, data_point_ids, guard_version)
  values (ledger.root_person(p_person), 'claim', p_channel, p_locale, p_type, p_subject, e.o_class, array[keyname], e.o_ids, ledger.guard_version()) returning ledger.render_log.render_id into rid;
  return query select e.o_class, keyname, e.o_params, case when e.o_class = 'unknown' then null::smallint else e.o_bar end, e.o_action, e.o_ids, rid;
exception when others then
  -- G2 fail closed: any error, bad channel, missing person or timeout is Unknown + retry, never an exception the caller could "handle" into something cleaner.
  return query select 'unknown'::text, 'report.unknown.guard.unavailable'::text, jsonb_build_object('reason', 'guard_error'), null::smallint, 'retry'::text, '{}'::uuid[], null::uuid;
end $$;


ALTER FUNCTION "ledger"."render_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."render_claim_risk"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") RETURNS TABLE("class" "text", "phrase_key" "text", "phrase_params" "jsonb", "bar" smallint, "action_key" "text", "data_point_ids" "uuid"[], "render_id" "uuid", "risk_state" "text", "risk_basis" "text", "risk_phrase_key" "text", "risk_event_id" "uuid", "education_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare v record; r record; t ledger.data_point_type%rowtype; act text; rpk text; ids uuid[];
begin
  select * into v from ledger.render_claim(p_person, p_type, p_subject, p_locale, p_channel);
  select * into r from ledger._risk_eval(p_person, p_type, p_subject, p_scan_key);
  select * into t from ledger.data_point_type where code = p_type;
  act := v.action_key;
  if v.render_id is null then   -- the v1 guard failed closed (render_id is null only then): keep its retry, and say nothing about risk (G12)
    return query select v.class, v.phrase_key, v.phrase_params, v.bar, v.action_key, v.data_point_ids, v.render_id, 'not_applicable'::text, null::text, null::text, null::uuid, null::uuid;
    return;
  end if;
  if r.o_state = 'unknown' then act := 'educate';
  elsif r.o_state = 'educated' then act := 'decide';
  elsif r.o_state in ('accepted','removed') then act := null;
  end if;
  rpk := case when r.o_state in ('unknown','educated','accepted','removed') then 'report.risk.' || t.phrase_key_base || '.' || r.o_state end;
  ids := v.data_point_ids;
  return query select v.class, v.phrase_key, v.phrase_params, v.bar, act, ids, v.render_id,
                      case when v.class = 'unknown' and r.o_state in ('unknown','educated','accepted','removed') then 'not_applicable' else r.o_state end,
                      r.o_basis, rpk, r.o_decision, r.o_education;
exception when others then
  return query select 'unknown'::text, 'report.unknown.guard.unavailable'::text, jsonb_build_object('reason', 'guard_error'), null::smallint, 'retry'::text, '{}'::uuid[], null::uuid,
                      'not_applicable'::text, null::text, null::text, null::uuid, null::uuid;
end $$;


ALTER FUNCTION "ledger"."render_claim_risk"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."render_consequence"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") RETURNS TABLE("phrase_key" "text", "phrase_params" "jsonb", "data_point_ids" "uuid"[], "render_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare t ledger.data_point_type%rowtype; c record; k text; rid uuid; root uuid := ledger.root_person(p_person);
begin
  select * into t from ledger.data_point_type where code = p_type;
  select * into c from ledger._risk_claim(root, p_type, p_subject);
  if not found or not t.risk_applicable or t.consequence_key_base is null or c.o_status is distinct from 'found' or coalesce(c.o_expired, true) or c.o_not_me then
    return query select 'report.unknown.guard.unavailable'::text, jsonb_build_object('reason', 'no_consequence'), '{}'::uuid[], null::uuid; return;
  end if;
  k := 'report.consequence.' || t.consequence_key_base || '.v' || t.consequence_version;
  if not ledger._consequence_approved(k) then
    return query select 'report.unknown.guard.unavailable'::text, jsonb_build_object('reason', 'consequence_not_approved'), '{}'::uuid[], null::uuid; return;
  end if;
  insert into ledger.render_log (person_id, kind, channel, locale, type_code, subject_ref, class, phrase_keys, data_point_ids, guard_version)
  values (root, 'consequence', p_channel, p_locale, p_type, p_subject, 'unknown', array[k], array[c.o_dp], ledger.guard_version()) returning ledger.render_log.render_id into rid;
  return query select k, jsonb_build_object('type', p_type, 'subject', p_subject, 'value', c.o_value), array[c.o_dp], rid;
exception when others then
  return query select 'report.unknown.guard.unavailable'::text, jsonb_build_object('reason', 'guard_error'), '{}'::uuid[], null::uuid;
end $$;


ALTER FUNCTION "ledger"."render_consequence"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."render_progress"("p_person" "uuid", "p_profile" "text", "p_locale" "text", "p_channel" "text") RETURNS TABLE("verified" integer, "self_attested_fixes" integer, "not_yet_checked" integer, "phrase_key" "text", "phrase_params" "jsonb", "data_point_ids" "uuid"[], "render_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare it record; e record; v int := 0; s int := 0; n int := 0; ids uuid[] := '{}'; rid uuid; total int; defined boolean;
begin
  select rp.defined into defined from ledger.report_profile rp where rp.profile = p_profile;
  select count(*) into total from ledger.report_profile_item i where i.profile = p_profile;
  if defined is not true or total = 0 then   -- a profile with no items must never read as "nothing missing"
    return query select 0, 0, 0, 'report.progress.profile_undefined'::text, jsonb_build_object('profile', p_profile), '{}'::uuid[], null::uuid; return;
  end if;
  for it in select i.type_code, nullif(i.subject_ref, '') as subject_ref from ledger.report_profile_item i where i.profile = p_profile order by i.type_code, i.subject_ref loop
    begin
      select * into e from ledger._eval_claim(p_person, it.type_code, it.subject_ref);
      if e.o_class = 'verified' then v := v + 1; elsif e.o_class = 'self_attested' then s := s + 1; else n := n + 1; end if;
      ids := ids || e.o_ids;
    exception when others then n := n + 1; end;
  end loop;
  insert into ledger.render_log (person_id, kind, channel, locale, type_code, subject_ref, class, phrase_keys, data_point_ids, guard_version)
  values (ledger.root_person(p_person), 'progress', p_channel, p_locale, p_profile, null, 'unknown', array['report.progress.line'], ids, ledger.guard_version()) returning ledger.render_log.render_id into rid;
  return query select v, s, n, 'report.progress.line'::text, jsonb_build_object('verified', v, 'fixes', s, 'not_yet_checked', n), ids, rid;
exception when others then
  return query select 0, 0, 0, 'report.progress.unavailable'::text, jsonb_build_object('reason', 'guard_error'), '{}'::uuid[], null::uuid;
end $$;


ALTER FUNCTION "ledger"."render_progress"("p_person" "uuid", "p_profile" "text", "p_locale" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."render_progress_risk"("p_person" "uuid", "p_profile" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") RETURNS TABLE("verified" integer, "self_attested_fixes" integer, "not_yet_checked" integer, "unaddressed_unknown" integer, "unaddressed_educated" integer, "unaddressed_risk" integer, "accepted" integer, "removed" integer, "clear" integer, "not_me" integer, "not_checked" integer, "risk_not_applicable" integer, "phrase_key" "text", "phrase_params" "jsonb", "data_point_ids" "uuid"[], "risk_event_ids" "uuid"[], "render_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare it record; e record; r record; v int := 0; s int := 0; n int := 0; uu int := 0; ue int := 0; ac int := 0; rm int := 0; cl int := 0; nm int := 0; nc int := 0; na int := 0;
        ids uuid[] := '{}'; rids uuid[] := '{}'; rid uuid; total int; defined boolean;
begin
  select rp.defined into defined from ledger.report_profile rp where rp.profile = p_profile;
  select count(*) into total from ledger.report_profile_item i where i.profile = p_profile;
  if defined is not true or total = 0 then
    return query select 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'report.progress.profile_undefined'::text, jsonb_build_object('profile', p_profile), '{}'::uuid[], '{}'::uuid[], null::uuid; return;
  end if;
  for it in select i.type_code, nullif(i.subject_ref, '') as subject_ref from ledger.report_profile_item i where i.profile = p_profile order by i.type_code, i.subject_ref loop
    begin
      select * into e from ledger._eval_claim(p_person, it.type_code, it.subject_ref);
      if e.o_class = 'verified' then v := v + 1; elsif e.o_class = 'self_attested' then s := s + 1; else n := n + 1; end if;
      ids := ids || e.o_ids;
      select * into r from ledger._risk_eval(p_person, it.type_code, it.subject_ref, p_scan_key);
      case r.o_state
        when 'unknown'  then uu := uu + 1;
        when 'educated' then ue := ue + 1;
        when 'accepted' then ac := ac + 1; rids := rids || r.o_decision;
        when 'removed'  then rm := rm + 1; rids := rids || r.o_decision;
        when 'not_me'   then nm := nm + 1;
        else
          if r.o_reason = 'clear' then cl := cl + 1; elsif r.o_reason = 'no_risk_axis' then na := na + 1; else nc := nc + 1; end if;
      end case;
    exception when others then n := n + 1; nc := nc + 1; end;
  end loop;
  insert into ledger.render_log (person_id, kind, channel, locale, type_code, subject_ref, class, phrase_keys, data_point_ids, guard_version)
  values (ledger.root_person(p_person), 'progress', p_channel, p_locale, p_profile, null, 'unknown', array['report.progress.risk_line'], ids, ledger.guard_version()) returning ledger.render_log.render_id into rid;
  return query select v, s, n, uu, ue, uu + ue, ac, rm, cl, nm, nc, na, 'report.progress.risk_line'::text,
         jsonb_build_object('verified', v, 'fixes', s, 'not_yet_checked', n, 'unaddressed', uu + ue, 'accepted', ac, 'removed', rm), ids, array_remove(rids, null), rid;
exception when others then
  return query select 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'report.progress.unavailable'::text, jsonb_build_object('reason', 'guard_error'), '{}'::uuid[], '{}'::uuid[], null::uuid;
end $$;


ALTER FUNCTION "ledger"."render_progress_risk"("p_person" "uuid", "p_profile" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."resolve_person"("p_type" "text", "p_value" "text", "p_create" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare v text := ledger._normalise_identifier(p_type, p_value); pid uuid;
begin
  if v is null then return null; end if;
  select person_id into pid from ledger.person_identifier where id_type = p_type and id_value = v;
  if found then return ledger.root_person(pid); end if;
  if not p_create then return null; end if;
  insert into ledger.person default values returning person_id into pid;
  begin
    insert into ledger.person_identifier (person_id, id_type, id_value) values (pid, p_type, v);
  exception when unique_violation then   -- lost a race: use the winner and drop our empty person
    delete from ledger.person where person_id = pid;
    select person_id into pid from ledger.person_identifier where id_type = p_type and id_value = v;
    return ledger.root_person(pid);
  end;
  return pid;
end $$;


ALTER FUNCTION "ledger"."resolve_person"("p_type" "text", "p_value" "text", "p_create" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."rollback_backfill_batch"("p_batch" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare n int;
begin
  perform set_config('ledger.allow_erase', 'on', true);
  delete from ledger.data_point where backfill_batch_id = p_batch; get diagnostics n = row_count;
  perform set_config('ledger.allow_erase', 'off', true);
  return n;
end $$;


ALTER FUNCTION "ledger"."rollback_backfill_batch"("p_batch" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."root_person"("p" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
declare cur uuid := p; nxt uuid; n int := 0;
begin
  loop
    select merged_into into nxt from ledger.person where person_id = cur;
    if nxt is null then return cur; end if;
    cur := nxt; n := n + 1;
    if n > 50 then raise exception 'ledger: merge chain too long'; end if;
  end loop;
end $$;


ALTER FUNCTION "ledger"."root_person"("p" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."unmerge_person"("p_person" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ledger', 'pg_temp'
    AS $$
begin
  update ledger.person set status = 'active', merged_into = null where person_id = p_person and status = 'merged';
  if not found then raise exception 'ledger: person % is not merged', p_person; end if;
end $$;


ALTER FUNCTION "ledger"."unmerge_person"("p_person" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."value_matches"("p_schema" "jsonb", "p_value" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
declare k text; ty text;
begin
  if p_schema is null or p_schema = '{}'::jsonb then return true; end if;
  ty := p_schema->>'type';
  if ty is not null and jsonb_typeof(p_value) is distinct from (case ty when 'integer' then 'number' else ty end) then return false; end if;
  if ty = 'integer' and p_value::text !~ '^-?[0-9]+$' then return false; end if;
  if p_schema ? 'enum' and not ((p_schema->'enum') @> jsonb_build_array(p_value)) then return false; end if;
  if ty = 'object' then
    for k in select jsonb_array_elements_text(coalesce(p_schema->'required', '[]'::jsonb)) loop
      if not (p_value ? k) then return false; end if;
    end loop;
    if p_schema->'additionalProperties' = 'false'::jsonb then
      for k in select jsonb_object_keys(p_value) loop
        if not (coalesce(p_schema->'properties', '{}'::jsonb) ? k) then return false; end if;
      end loop;
    end if;
    for k in select jsonb_object_keys(coalesce(p_schema->'properties', '{}'::jsonb)) loop
      if p_value ? k and not ledger.value_matches(p_schema->'properties'->k, p_value->k) then return false; end if;
    end loop;
  end if;
  return true;
end $_$;


ALTER FUNCTION "ledger"."value_matches"("p_schema" "jsonb", "p_value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ledger"."values_disagree"("p_given" "jsonb", "p_other" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_given is null or p_other is null then false
              when jsonb_typeof(p_given) = 'object' and p_given ? 'answer' then (p_given->>'answer') in ('not_me','disputed')
              else p_given is distinct from p_other end
$$;


ALTER FUNCTION "ledger"."values_disagree"("p_given" "jsonb", "p_other" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_onboarding_cohort"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer;
begin
  perform pg_advisory_xact_lock(7261);
  select cohort_number into n from public.users where id = p_user_id;
  if n is not null then return n; end if;
  select coalesce(max(cohort_number), 0) + 1 into n from public.users;
  if n > 100 then return null; end if;
  update public.users set cohort_number = n, updated_at = now() where id = p_user_id;
  return n;
end $$;


ALTER FUNCTION "public"."claim_onboarding_cohort"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_deletion_consent"("p_scan_ref" "uuid", "p_categories" "text"[], "p_irreversible" boolean DEFAULT false, "p_irreversible_ack" boolean DEFAULT false, "p_price_cents" integer DEFAULT 0) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare cats text[]; cid uuid;
begin
  if p_scan_ref is null then raise exception 'scan_ref_required'; end if;
  select coalesce(array_agg(distinct c order by c), '{}'::text[]) into cats from unnest(p_categories) c;
  insert into public.deletion_consents (scan_ref, categories, irreversible, irreversible_ack, price_cents)
  values (p_scan_ref, cats, coalesce(p_irreversible, false), coalesce(p_irreversible_ack, false), coalesce(p_price_cents, 0))
  returning id into cid;
  return cid;
end $$;


ALTER FUNCTION "public"."create_deletion_consent"("p_scan_ref" "uuid", "p_categories" "text"[], "p_irreversible" boolean, "p_irreversible_ack" boolean, "p_price_cents" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eradication_begin"("p_job_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare j public.eradication_jobs; c public.deletion_consents;
begin
  select * into j from public.eradication_jobs where id = p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status <> 'queued' then raise exception 'job_not_queued'; end if;
  select * into c from public.deletion_consents where id = j.consent_id for share;
  if c.withdrawn_at is not null then
    update public.eradication_jobs set status = 'cancelled', finished_at = now() where id = j.id;
    return false;
  end if;
  update public.eradication_jobs set status = 'running', started_at = now() where id = j.id;
  return true;
end $$;


ALTER FUNCTION "public"."eradication_begin"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eradication_finish"("p_job_id" "uuid", "p_ok" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare j public.eradication_jobs; c public.deletion_consents;
begin
  select * into j from public.eradication_jobs where id = p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status <> 'running' then raise exception 'job_not_running'; end if;
  update public.eradication_jobs set status = case when coalesce(p_ok, false) then 'done' else 'failed' end, finished_at = now() where id = j.id;
  if coalesce(p_ok, false) then
    select * into c from public.deletion_consents where id = j.consent_id for update;
    if c.eradication_completed_at is null and not exists (
         select 1 from unnest(c.categories) cat
          where not exists (select 1 from public.eradication_jobs x where x.consent_id = c.id and x.category = cat and x.status = 'done')) then
      update public.deletion_consents set eradication_completed_at = now() where id = c.id;
    end if;
  end if;
end $$;


ALTER FUNCTION "public"."eradication_finish"("p_job_id" "uuid", "p_ok" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eradication_start"("p_consent_id" "uuid", "p_category" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare c public.deletion_consents; jid uuid;
begin
  select * into c from public.deletion_consents where id = p_consent_id for share;
  if not found then raise exception 'consent_not_found'; end if;
  if c.withdrawn_at is not null then raise exception 'consent_withdrawn'; end if;
  if c.expires_at <= now() then raise exception 'consent_expired'; end if;
  if p_category is null or not (p_category = any (c.categories)) then raise exception 'category_not_consented'; end if;
  begin
    insert into public.eradication_jobs (consent_id, category) values (p_consent_id, p_category) returning id into jid;
  exception when unique_violation then
    raise exception 'job_already_started';
  end;
  return jid;
end $$;


ALTER FUNCTION "public"."eradication_start"("p_consent_id" "uuid", "p_category" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."eradication_start"("p_consent_id" "uuid", "p_category" "text") IS 'MPC-8673. The gate: queues a job only for a consent that exists, is not withdrawn, is inside its 24h window and covers the category. Raises consent_not_found, consent_withdrawn, consent_expired, category_not_consented, job_already_started.';



CREATE OR REPLACE FUNCTION "public"."mpt_aggregate_before_delete"("p_web_scans" "uuid"[]) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$select 1$$;


ALTER FUNCTION "public"."mpt_aggregate_before_delete"("p_web_scans" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_bot_family"("p_user_agent" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with ua as (select lower(btrim(coalesce(p_user_agent, ''))) as v),
  fam(name, needle) as (values
    ('gptbot','gptbot'), ('chatgpt-user','chatgpt-user'), ('oai-searchbot','oai-searchbot'), ('claudebot','claudebot'), ('claude-user','claude-user'),
    ('claude-searchbot','claude-searchbot'), ('anthropic-ai','anthropic-ai'), ('perplexitybot','perplexitybot'), ('perplexity-user','perplexity-user'),
    ('ccbot','ccbot'), ('bytespider','bytespider'), ('amazonbot','amazonbot'), ('applebot-extended','applebot-extended'), ('google-extended','google-extended'),
    ('meta-externalagent','meta-externalagent'), ('meta-externalfetcher','meta-externalfetcher'), ('cohere-ai','cohere-ai'), ('diffbot','diffbot'),
    ('youbot','youbot'), ('mistralai-user','mistralai-user'), ('googlebot','googlebot'), ('bingbot','bingbot'), ('duckduckbot','duckduckbot'),
    ('yandexbot','yandexbot'), ('baiduspider','baiduspider'), ('applebot','applebot'), ('slurp','slurp'), ('ahrefsbot','ahrefsbot'),
    ('semrushbot','semrushbot'), ('mj12bot','mj12bot'), ('dotbot','dotbot'), ('uptimerobot','uptimerobot'), ('pingdom','pingdom'),
    ('curl','curl/'), ('python-requests','python-requests'), ('go-http-client','go-http-client'), ('okhttp','okhttp'), ('scrapy','scrapy'),
    ('headlesschrome','headlesschrome'), ('phantomjs','phantomjs'), ('node-fetch','node-fetch'), ('wget','wget/'), ('libwww-perl','libwww-perl'),
    ('java','java/'), ('axios','axios/'), ('aiohttp','aiohttp'))
  select case when (select v from ua) = '' then 'no_user_agent'
              else coalesce((select f.name from fam f where position(f.needle in (select v from ua)) > 0 order by length(f.needle) desc, f.name limit 1), 'other_agent') end;
$$;


ALTER FUNCTION "public"."mpt_bot_family"("p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_brain_record"("p_channel" "text", "p_sender_id" "text", "p_intent" "text", "p_intent_source" "text", "p_response_key" "text", "p_new_state" "text" DEFAULT NULL::"text", "p_trust_floor" smallint DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id            uuid;
  v_state_before  text := 'new';
  v_trust_before  smallint := 0;
  v_trust_after   smallint := 0;
  v_state_after   text := 'new';
begin
  if p_new_state is not null and p_new_state not in ('new','awaiting_confirmation','confirmed','declined') then
    raise exception 'unknown conversation state: %', p_new_state using errcode = '22023';
  end if;
  if p_trust_floor is null or p_trust_floor not between 0 and 5 then
    raise exception 'trust floor out of range' using errcode = '22023';
  end if;

  if p_sender_id is not null
     and p_channel = any (array['web','email','sms','whatsapp','telegram']) then
    insert into public.conversation_states (channel, sender_id)
      values (p_channel, p_sender_id)
      on conflict (channel, sender_id) where sender_id is not null do nothing;

    select id, state, trust_level
      into v_id, v_state_before, v_trust_before
      from public.conversation_states
     where channel = p_channel and sender_id = p_sender_id
       for update;

    v_trust_after := greatest(v_trust_before, p_trust_floor);
    v_state_after := coalesce(p_new_state, v_state_before);
    update public.conversation_states
       set state = v_state_after, trust_level = v_trust_after, last_message_at = now()
     where id = v_id;
  end if;

  insert into public.interaction_log
    (conversation_state_id, channel, intent, intent_source, response_key, state_before, state_after, trust_before, trust_after)
  values
    (v_id, p_channel, p_intent, p_intent_source, p_response_key, v_state_before, v_state_after, v_trust_before, v_trust_after);

  return jsonb_build_object('state', v_state_after, 'trust_level', v_trust_after, 'persisted', v_id is not null);
end $$;


ALTER FUNCTION "public"."mpt_brain_record"("p_channel" "text", "p_sender_id" "text", "p_intent" "text", "p_intent_source" "text", "p_response_key" "text", "p_new_state" "text", "p_trust_floor" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_authorise"("p_hash" "text", "p_version" "text", "p_share" boolean, "p_results" "jsonb", "p_ref" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare m public.mpt_business_members; v_company text;
begin
  select * into m from public.mpt_business_members where token_hash = p_hash for update;
  if not found or (m.token_expires_at < now() and m.status <> 'authorised') then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  if m.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 3 then raise exception 'results must be an array of at most 3' using errcode = '22023'; end if;
  update public.mpt_business_members
     set status = 'authorised', responded_at = coalesce(responded_at, now()), consent_version = p_version, consent_at = now(), share_detail = coalesce(p_share, false),
         results = p_results, checked_at = now()
   where id = m.id;
  select company into v_company from public.mpt_business_teams where id = m.team_id;
  if m.status <> 'authorised' and p_ref is not null then
    insert into public.mpt_business_requests (ref, contact_email, company, source, consent_source, notes)
      values (p_ref, m.email, v_company, 'employee_consent', 'business_team_employee', 'team ' || m.team_id::text) on conflict (ref) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'status', 'authorised', 'company', v_company);
end $$;


ALTER FUNCTION "public"."mpt_business_authorise"("p_hash" "text", "p_version" "text", "p_share" boolean, "p_results" "jsonb", "p_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_create_team"("p_account" "uuid", "p_company" "text", "p_ref" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_email text; v_company text := btrim(p_company); t public.mpt_business_teams;
begin
  select email into v_email from public.accounts where id = p_account;
  if v_email is null then return jsonb_build_object('created', false, 'reason', 'no_account'); end if;
  if v_company is null or v_company = '' or char_length(v_company) > 200 then raise exception 'company required' using errcode = '22023'; end if;
  if (select count(*) from public.mpt_business_teams where admin_account_id = p_account) >= 5 then return jsonb_build_object('created', false, 'reason', 'team_limit'); end if;
  insert into public.mpt_business_requests (ref, contact_email, company, source, consent_source)
    values (p_ref, v_email, v_company, 'admin_invite', 'business_team_admin');
  insert into public.mpt_business_teams (admin_account_id, company, request_ref) values (p_account, v_company, p_ref) returning * into t;
  return jsonb_build_object('created', true, 'team_id', t.id, 'company', t.company, 'request_ref', t.request_ref, 'created_at', t.created_at);
end $$;


ALTER FUNCTION "public"."mpt_business_create_team"("p_account" "uuid", "p_company" "text", "p_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_decline"("p_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  update public.mpt_business_members set status = 'declined', responded_at = now(), results = null, checked_at = null, share_detail = false
   where token_hash = p_hash and status in ('invited', 'declined') and token_expires_at >= now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;


ALTER FUNCTION "public"."mpt_business_decline"("p_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_delete_team"("p_account" "uuid", "p_team" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int; m int;
begin
  select count(*) into m from public.mpt_business_members where team_id = p_team and exists (select 1 from public.mpt_business_teams where id = p_team and admin_account_id = p_account);
  delete from public.mpt_business_teams where id = p_team and admin_account_id = p_account;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1, 'members_deleted', case when n = 1 then m else 0 end);
end $$;


ALTER FUNCTION "public"."mpt_business_delete_team"("p_account" "uuid", "p_team" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_invite"("p_account" "uuid", "p_team" "uuid", "p_emails" "text"[], "p_hashes" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare i int; v_n int; v_email text; m public.mpt_business_members; v_added jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.mpt_business_teams where id = p_team and admin_account_id = p_account) then return jsonb_build_object('ok', false, 'reason', 'not_your_team'); end if;
  if coalesce(array_length(p_emails, 1), 0) <> coalesce(array_length(p_hashes, 1), 0) or coalesce(array_length(p_emails, 1), 0) = 0 then raise exception 'emails and hashes must line up' using errcode = '22023'; end if;
  select count(*) into v_n from public.mpt_business_members where team_id = p_team;
  for i in 1 .. array_length(p_emails, 1) loop
    v_email := lower(btrim(p_emails[i]));
    select * into m from public.mpt_business_members where team_id = p_team and email = v_email;
    if found then
      if m.status in ('declined', 'revoked') or m.token_expires_at < now() and m.status = 'invited' then
        update public.mpt_business_members set token_hash = p_hashes[i], status = 'invited', invited_at = now(), token_expires_at = now() + interval '30 days', responded_at = null,
               consent_version = null, consent_at = null, share_detail = false, results = null, checked_at = null where id = m.id;
        v_added := v_added || to_jsonb(v_email);
      else
        v_skipped := v_skipped || to_jsonb(v_email);
      end if;
    else
      if v_n >= 50 then v_skipped := v_skipped || to_jsonb(v_email); continue; end if;
      insert into public.mpt_business_members (team_id, email, token_hash) values (p_team, v_email, p_hashes[i]);
      v_n := v_n + 1;
      v_added := v_added || to_jsonb(v_email);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', v_added, 'skipped', v_skipped);
end $$;


ALTER FUNCTION "public"."mpt_business_invite"("p_account" "uuid", "p_team" "uuid", "p_emails" "text"[], "p_hashes" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_list_teams"("p_account" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'company', t.company, 'created_at', t.created_at) order by t.created_at), '[]'::jsonb)
    from public.mpt_business_teams t where t.admin_account_id = p_account
$$;


ALTER FUNCTION "public"."mpt_business_list_teams"("p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_member"("p_hash" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select jsonb_build_object('member_id', m.id, 'email', m.email, 'status', m.status, 'company', t.company, 'share_detail', m.share_detail,
                            'checked_at', m.checked_at, 'results', m.results, 'team_id', t.id)
    from public.mpt_business_members m join public.mpt_business_teams t on t.id = m.team_id
   where m.token_hash = p_hash and (m.token_expires_at >= now() or m.status = 'authorised')
$$;


ALTER FUNCTION "public"."mpt_business_member"("p_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_remove_member"("p_account" "uuid", "p_team" "uuid", "p_member" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  delete from public.mpt_business_members m using public.mpt_business_teams t
   where m.id = p_member and m.team_id = p_team and t.id = m.team_id and t.admin_account_id = p_account;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;


ALTER FUNCTION "public"."mpt_business_remove_member"("p_account" "uuid", "p_team" "uuid", "p_member" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_revoke"("p_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  update public.mpt_business_members set status = 'revoked', responded_at = now(), results = null, checked_at = null, share_detail = false, consent_version = null, consent_at = null
   where token_hash = p_hash and status in ('authorised', 'invited', 'declined');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;


ALTER FUNCTION "public"."mpt_business_revoke"("p_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_set_share"("p_hash" "text", "p_share" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  update public.mpt_business_members set share_detail = coalesce(p_share, false) where token_hash = p_hash and status = 'authorised';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1, 'share_detail', coalesce(p_share, false));
end $$;


ALTER FUNCTION "public"."mpt_business_set_share"("p_hash" "text", "p_share" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_business_summary"("p_account" "uuid", "p_team" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare t public.mpt_business_teams; v_inv int; v_auth int; v_dec int; v_rev int; v_listed int := 0; v_not_listed int := 0; v_not_checked int := 0; v_pages int := 0; v_with_listing int := 0; v_members jsonb;
begin
  select * into t from public.mpt_business_teams where id = p_team and admin_account_id = p_account;
  if not found then return null; end if;
  select count(*) filter (where status = 'invited'), count(*) filter (where status = 'authorised'), count(*) filter (where status = 'declined'), count(*) filter (where status = 'revoked')
    into v_inv, v_auth, v_dec, v_rev from public.mpt_business_members where team_id = p_team;
  select coalesce(sum((select count(*) from jsonb_array_elements(m.results) r where r->>'state' = 'listed')), 0),
         coalesce(sum((select count(*) from jsonb_array_elements(m.results) r where r->>'state' = 'not_listed')), 0),
         coalesce(sum((select count(*) from jsonb_array_elements(m.results) r where r->>'state' = 'not_checked')), 0),
         coalesce(sum(jsonb_array_length(m.results)), 0),
         count(*) filter (where exists (select 1 from jsonb_array_elements(m.results) r where r->>'state' = 'listed'))
    into v_listed, v_not_listed, v_not_checked, v_pages, v_with_listing
    from public.mpt_business_members m where m.team_id = p_team and m.status = 'authorised' and m.results is not null;
  select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'email', m.email, 'status', m.status, 'shared', m.share_detail,
            'detail', case when m.status = 'authorised' and m.share_detail then m.results else null end) order by m.invited_at), '[]'::jsonb)
    into v_members from public.mpt_business_members m where m.team_id = p_team;
  return jsonb_build_object('team_id', t.id, 'company', t.company, 'request_ref', t.request_ref,
    'counts', jsonb_build_object('invited_total', v_inv + v_auth + v_dec + v_rev, 'awaiting', v_inv, 'authorised', v_auth, 'declined', v_dec, 'revoked', v_rev),
    'aggregate', jsonb_build_object('people_included', v_auth, 'people_with_a_listing', v_with_listing, 'pages_checked', v_pages, 'listed', v_listed, 'not_listed', v_not_listed, 'not_checked', v_not_checked),
    'members', v_members);
end $$;


ALTER FUNCTION "public"."mpt_business_summary"("p_account" "uuid", "p_team" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_can"("p_account" "uuid", "p_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_plan text; v_min text;
begin
  select plan into v_plan from public.accounts where id = p_account;
  if v_plan is null then return jsonb_build_object('allowed', false, 'min_tier', null, 'reason', 'no_account'); end if;
  select min_tier into v_min from public.capability_min_tier where key = p_key;
  if v_min is null then return jsonb_build_object('allowed', false, 'min_tier', null, 'reason', 'unknown_capability'); end if;
  if public.mpt_tier_rank(v_plan) >= public.mpt_tier_rank(v_min) then return jsonb_build_object('allowed', true, 'min_tier', v_min, 'reason', 'tier_ok'); end if;
  return jsonb_build_object('allowed', false, 'min_tier', v_min, 'reason', 'tier_too_low');
end $$;


ALTER FUNCTION "public"."mpt_can"("p_account" "uuid", "p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_channel_osint_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with i as (
    select lower(channel) as platform,
           count(*) as dms_received,
           count(*) filter (where intent = 'scan') as scan_requests,
           count(*) filter (where state_before = 'awaiting_confirmation' and state_after = 'confirmed') as consents_given
      from public.interaction_log where created_at >= p_from and created_at < p_to group by 1
  ), l as (
    select lower(utm_source) as platform, count(*) as conversions
      from public.leads where created_at >= p_from and created_at < p_to and lower(utm_medium) = 'channel_osint' and utm_source is not null group by 1
  ), p as (select platform from i union select platform from l)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'platforms', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', p.platform,
        'dms_received', coalesce(i.dms_received, 0), 'consents_given', coalesce(i.consents_given, 0),
        'scan_requests', coalesce(i.scan_requests, 0),
        'conversions', coalesce(l.conversions, 0)) order by p.platform)
      from p left join i using (platform) left join l using (platform)), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."mpt_channel_osint_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_channel_osint_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) IS 'MPC-7641. Channel OSINT funnel counts per platform for [p_from, p_to): DMs, scan requests, consents, leads tagged utm_medium=channel_osint. Counts only. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_claim_deletion_notices"("p_limit" integer DEFAULT 20) RETURNS TABLE("scans_id" "uuid", "email" "text", "stage" "text", "delete_after" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  return query
  with due as (
    select s.id, case when s.delete_after - now() <= interval '4 hours' then '4h' else '24h' end as st
      from public.scans s
     where s.delete_after is not null and s.delete_after > now() and s.delete_after - now() <= interval '24 hours'
       and not public.mpt_scan_is_kept(s)
       and ((s.delete_after - now() <= interval '4 hours' and s.countdown_4h_sent_at is null) or (s.delete_after - now() > interval '4 hours' and s.countdown_24h_sent_at is null))
     order by s.delete_after limit greatest(1, least(p_limit, 100)) for update skip locked)
  update public.scans s set
         countdown_4h_sent_at  = case when d.st = '4h' then now() else s.countdown_4h_sent_at end,
         countdown_24h_sent_at = coalesce(s.countdown_24h_sent_at, now())
    from due d where s.id = d.id
  returning s.id, s.email_scanned, d.st, s.delete_after;
end $$;


ALTER FUNCTION "public"."mpt_claim_deletion_notices"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_complete_referral"("p_referee_user_id" "uuid") RETURNS TABLE("referrer_user_id" "uuid", "rewarded" boolean, "pro_months_earned" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.referrals; months integer;
begin
  update public.referrals set status = 'completed', completed_at = now()
   where referee_user_id = p_referee_user_id and status = 'signed_up'
   returning * into r;
  if r.id is null then return; end if;
  update public.users u set pro_months_earned = u.pro_months_earned + 1, updated_at = now()
   where u.id = r.referrer_user_id and u.pro_months_earned < 12
   returning u.pro_months_earned into months;
  if months is not null then
    update public.referrals set rewarded_at = now() where id = r.id;
    return query select r.referrer_user_id, true, months;
  end if;
  return query select r.referrer_user_id, false, (select u.pro_months_earned from public.users u where u.id = r.referrer_user_id);
end $$;


ALTER FUNCTION "public"."mpt_complete_referral"("p_referee_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_confirm_scan_consumption"("p_scan" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  update public.scan_consumption set confirmed_at = coalesce(confirmed_at, now()) where scan_id = p_scan;
  get diagnostics n = row_count;
  return n > 0;
end $$;


ALTER FUNCTION "public"."mpt_confirm_scan_consumption"("p_scan" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_consume_scan"("p_scan" "uuid", "p_email" "text", "p_confirmed" boolean DEFAULT false, "p_account" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text; v_plan text; v_limit int; v_unlimited boolean; v_used int; v_period date := public.mpt_scan_period();
  v_resets timestamptz := ((public.mpt_scan_period() + interval '1 month')::timestamp at time zone 'UTC');
  v_next text; v_next_limit int; v_existing public.scan_consumption;
begin
  if p_scan is null or v_email = '' then raise exception 'scan and email required' using errcode = '22023'; end if;
  v_key := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  delete from public.scan_consumption where consumed_at < now() - interval '100 days';
  select a.plan into v_plan from public.accounts a where (p_account is not null and a.id = p_account) or (p_account is null and a.email = v_email) limit 1;
  v_plan := coalesce(v_plan, 'free');
  select per_month, per_month is null into v_limit, v_unlimited from public.plan_scan_allowance where plan = v_plan;
  if not found then select per_month, per_month is null into v_limit, v_unlimited from public.plan_scan_allowance where plan = 'free'; v_plan := 'free'; end if;
  select * into v_existing from public.scan_consumption where scan_id = p_scan;
  select count(*) into v_used from public.scan_consumption
   where subject_key = v_key and period_start = v_period and scan_id <> p_scan and (confirmed_at is not null or consumed_at > now() - interval '24 hours');
  if v_existing.scan_id is not null then
    return jsonb_build_object('allowed', true, 'already', true, 'plan', v_existing.plan, 'limit', v_limit, 'used', v_used + 1,
                              'remaining', case when v_unlimited then null else greatest(v_limit - v_used - 1, 0) end, 'resets_at', v_resets);
  end if;
  if not v_unlimited and v_used >= v_limit then
    select plan, per_month into v_next, v_next_limit from public.plan_scan_allowance
     where public.mpt_tier_rank(plan) = public.mpt_tier_rank(v_plan) + 1;
    return jsonb_build_object('allowed', false, 'plan', v_plan, 'limit', v_limit, 'used', v_used, 'remaining', 0, 'resets_at', v_resets,
                              'upgrade', case when v_next is null then null else jsonb_build_object('plan', v_next, 'per_month', v_next_limit, 'unlimited', v_next_limit is null) end);
  end if;
  insert into public.scan_consumption (scan_id, subject_key, plan, period_start, confirmed_at)
  values (p_scan, v_key, v_plan, v_period, case when p_confirmed then now() end) on conflict (scan_id) do nothing;
  return jsonb_build_object('allowed', true, 'already', false, 'plan', v_plan, 'limit', v_limit, 'used', v_used + 1,
                            'remaining', case when v_unlimited then null else v_limit - v_used - 1 end, 'resets_at', v_resets);
end $$;


ALTER FUNCTION "public"."mpt_consume_scan"("p_scan" "uuid", "p_email" "text", "p_confirmed" boolean, "p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_count_scan_hourly"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.scan_hourly_counts (hour, scans_created) values (date_trunc('hour', new.created_at), 1)
  on conflict (hour) do update set scans_created = public.scan_hourly_counts.scans_created + 1;
  return new;
end $$;


ALTER FUNCTION "public"."mpt_count_scan_hourly"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_country_bucket"("p_country" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when upper(coalesce(p_country, '')) = 'HK' then 'hk'
    when upper(coalesce(p_country, '')) = 'GB' then 'uk'
    when upper(coalesce(p_country, '')) in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE') then 'eu'
    when upper(coalesce(p_country, '')) in ('US','CA') then 'north_america'
    else 'other'
  end;
$$;


ALTER FUNCTION "public"."mpt_country_bucket"("p_country" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_cut_edge_visit_ips"("p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare d int; n int := 0;
begin
  select ip_days into d from public.edge_visit_retention where id;
  if d is null then d := 30; end if;
  if p_dry_run then
    select count(*) into n from public.edge_visits
     where ip is not null and class in ('person', 'unknown') and seen_at < now() - make_interval(days => d);
  else
    update public.edge_visits set ip = null, ip_cut_at = now()
     where ip is not null and class in ('person', 'unknown') and seen_at < now() - make_interval(days => d);
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'ip_days', d, 'ips_cut', n, 'ran_at', now());
end $$;


ALTER FUNCTION "public"."mpt_cut_edge_visit_ips"("p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_cut_edge_visit_ips"("p_dry_run" boolean) IS 'MPC-7490. Nulls ip on person/unknown edge visits older than edge_visit_retention.ip_days. Bot and ai rows untouched. p_dry_run counts only. Returns counts, no data. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_deep_challenge_create"("p_subject_hash" "text", "p_channel" "text", "p_code_hash" "text", "p_ttl_seconds" integer DEFAULT 600) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare new_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 900 then
    raise exception 'ttl_out_of_range' using errcode = 'MPT04';
  end if;
  if (select count(*) from public.deep_research_challenges
       where subject_hash = p_subject_hash and channel = p_channel and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited' using errcode = 'MPT01';
  end if;
  if p_channel = 'sms' and not exists (
       select 1 from public.deep_research_challenges
        where subject_hash = p_subject_hash and channel = 'email' and verified_at is not null and verified_at > now() - interval '24 hours') then
    raise exception 'gate_1_required' using errcode = 'MPT02';
  end if;
  insert into public.deep_research_challenges (subject_hash, channel, code_hash, expires_at)
  values (p_subject_hash, p_channel, p_code_hash, now() + make_interval(secs => p_ttl_seconds))
  returning id into new_id;
  return new_id;
end $$;


ALTER FUNCTION "public"."mpt_deep_challenge_create"("p_subject_hash" "text", "p_channel" "text", "p_code_hash" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_deep_challenge_verify"("p_id" "uuid", "p_code_hash" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare c public.deep_research_challenges%rowtype;
begin
  select * into c from public.deep_research_challenges where id = p_id for update;
  if not found then return 'unknown'; end if;
  if c.verified_at is not null then return 'already_verified'; end if;
  if c.expires_at < now() then return 'expired'; end if;
  if c.attempts >= c.max_attempts then return 'locked'; end if;
  update public.deep_research_challenges set attempts = attempts + 1 where id = p_id;
  if c.code_hash = p_code_hash then
    update public.deep_research_challenges set verified_at = now() where id = p_id;
    return 'verified';
  end if;
  return 'wrong';
end $$;


ALTER FUNCTION "public"."mpt_deep_challenge_verify"("p_id" "uuid", "p_code_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_deep_delete_subject"("p_subject_hash" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare a integer; b integer;
begin
  delete from public.hexagon_findings where subject_hash = p_subject_hash;
  get diagnostics a = row_count;
  delete from public.deep_research_challenges where subject_hash = p_subject_hash;
  get diagnostics b = row_count;
  return a + b;
end $$;


ALTER FUNCTION "public"."mpt_deep_delete_subject"("p_subject_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_deep_is_verified"("p_subject_hash" "text", "p_channel" "text", "p_window_seconds" integer DEFAULT 3600) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.deep_research_challenges
     where subject_hash = p_subject_hash and channel = p_channel
       and verified_at is not null and verified_at > now() - make_interval(secs => p_window_seconds)
  )
$$;


ALTER FUNCTION "public"."mpt_deep_is_verified"("p_subject_hash" "text", "p_channel" "text", "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_deep_purge_expired"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare a integer; b integer;
begin
  delete from public.hexagon_findings where expires_at < now();
  get diagnostics a = row_count;
  delete from public.deep_research_challenges where expires_at < now() - interval '1 day';
  get diagnostics b = row_count;
  return a + b;
end $$;


ALTER FUNCTION "public"."mpt_deep_purge_expired"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_deep_record_finding"("p_subject_hash" "text", "p_hexagon_id" "text", "p_finding_type" "text", "p_confidence" integer, "p_encrypted_evidence" "text", "p_remediation_link" "text", "p_needs_human_review" boolean, "p_expires_at" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare ch text; new_id uuid;
begin
  foreach ch in array public.mpt_deep_required_channels(p_hexagon_id) loop
    if not public.mpt_deep_is_verified(p_subject_hash, ch, 3600) then
      raise exception 'subject_not_verified' using errcode = 'MPT03';
    end if;
  end loop;
  insert into public.hexagon_findings (subject_hash, hexagon_id, finding_type, confidence_score, encrypted_evidence, remediation_link, needs_human_review, expires_at)
  values (p_subject_hash, p_hexagon_id, p_finding_type, p_confidence, p_encrypted_evidence, p_remediation_link, coalesce(p_needs_human_review, false), p_expires_at)
  returning id into new_id;
  return new_id;
end $$;


ALTER FUNCTION "public"."mpt_deep_record_finding"("p_subject_hash" "text", "p_hexagon_id" "text", "p_finding_type" "text", "p_confidence" integer, "p_encrypted_evidence" "text", "p_remediation_link" "text", "p_needs_human_review" boolean, "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_deep_required_channels"("p_hexagon_id" "text") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when p_hexagon_id in ('network_device_fp', 'crypto_asset_flow') then array['email', 'sms']
    else array['email']
  end
$$;


ALTER FUNCTION "public"."mpt_deep_required_channels"("p_hexagon_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_delete_account"("p_account" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n_web int := 0; n_scans int := 0; n_acc int := 0; ids_web uuid[]; ids_scans uuid[];
begin
  select coalesce(array_agg(web_scan_id), '{}'), coalesce(array_agg(scans_id) filter (where scans_id is not null), '{}') into ids_web, ids_scans
    from public.account_scans where account_id = p_account;
  delete from public.web_scans where id = any(ids_web);
  get diagnostics n_web = row_count;
  delete from public.scans where id = any(ids_scans);
  get diagnostics n_scans = row_count;
  delete from public.accounts where id = p_account;
  get diagnostics n_acc = row_count;
  return jsonb_build_object('account_deleted', n_acc > 0, 'web_scans_deleted', n_web, 'scans_deleted', n_scans, 'deleted_at', now());
end $$;


ALTER FUNCTION "public"."mpt_delete_account"("p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_delete_deep_data"("p_sender_id" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.deep_jobs where sender_id = p_sender_id;   -- results cascade
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_delete_deep_data"("p_sender_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_delete_hk_spam_by_email"("p_email" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  delete from public.hk_spam_registrations where lower(email) = lower(trim(p_email));
  get diagnostics n = row_count;
  insert into public.hk_spam_deletion_log (kind, rows_deleted, note) values ('by_email', n, 'deletion request');
  return n;
end $$;


ALTER FUNCTION "public"."mpt_delete_hk_spam_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_delete_profile_snapshots"("p_sender_id" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.profile_snapshots where sender_id = p_sender_id;
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_delete_profile_snapshots"("p_sender_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_delete_web_scan"("p_scan_number" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n_links int := 0; n_scans int := 0;
begin
  select count(*) into n_links from public.web_scan_contacts where web_scan_id = p_scan_number;
  delete from public.web_scans where id = p_scan_number;       -- cascades to web_scan_contacts
  get diagnostics n_scans = row_count;
  if n_scans = 0 then n_links := 0; end if;
  insert into public.web_scan_deletion_log (kind, scans_deleted, links_deleted, note)
  values ('by_scan_number', n_scans, n_links, case when n_scans = 0 then 'scan number not found' else null end);
  return jsonb_build_object('found', n_scans > 0, 'scans_deleted', n_scans, 'contact_links_deleted', n_links, 'deleted_at', now());
end $$;


ALTER FUNCTION "public"."mpt_delete_web_scan"("p_scan_number" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_delete_web_scan"("p_scan_number" "uuid") IS 'MPC-7488. Deletes one saved web scan and its contact links by scan number. Logs counts only. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_dsar_erase"("p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');
  n_users int; n_leads int; n_subs int; n_base int; n_scans int; n_web int; n_ref int;
  lp uuid[] := '{}'; p uuid; n_ledger int := 0;
begin
  select count(*) into n_scans from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e;
  -- MPC-8737 M3: find this person's ledger record(s) BEFORE the legacy rows (and so their ids) disappear.
  if to_regprocedure('ledger.erase_person(uuid)') is not null then
    select coalesce(array_agg(distinct ledger.root_person(pi.person_id)), '{}') into lp
    from ledger.person_identifier pi
    where (pi.id_type = 'email_hash' and pi.id_value = h)
       or (pi.id_type = 'user_id' and pi.id_value in (select u.id::text from public.users u where lower(u.email) = e))
       or (pi.id_type = 'lead_id' and pi.id_value in (select l.id::text from public.leads l where lower(l.email) = e))
       or (pi.id_type = 'scan_id' and pi.id_value in (select s.id::text from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e))
       or (pi.id_type = 'web_scan_id' and pi.id_value in (
            select c.web_scan_id::text from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
            where c.channel = 'email' and lower(u.email) = e));
  end if;
  -- MPC-7470: saved web scans first (web_scan_contacts.contact_id has no foreign key to scans, so deleting users does not reach them).
  -- Deleting a web_scans row cascades to its web_scan_contacts rows.
  delete from public.web_scans where id in (
    select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
    where c.channel = 'email' and lower(u.email) = e);              get diagnostics n_web   = row_count;
  -- MPC-7645: an invitation addressed to this person but never taken up has no users row, so it is found by the hash. Rows tied to a user go with the user (ON DELETE CASCADE).
  delete from public.referrals where invitee_hash = h;             get diagnostics n_ref   = row_count;
  delete from public.users where lower(email) = e;                 get diagnostics n_users = row_count;
  delete from public.leads where lower(email) = e;                 get diagnostics n_leads = row_count;
  delete from public.subscribers where lower(email) = e;           get diagnostics n_subs  = row_count;
  delete from public.mpt_score_baselines where email_hash = h;     get diagnostics n_base  = row_count;
  -- MPC-8737 M3: erase the ledger record(s) (identifiers, data points, shown events, risk decisions, render log). Raises on failure: never a silent partial erase.
  foreach p in array lp loop perform ledger.erase_person(p); n_ledger := n_ledger + 1; end loop;
  return jsonb_build_object('erased_at', now(), 'users', n_users, 'scans_cascaded', n_scans,
                            'leads', n_leads, 'subscribers', n_subs, 'score_baselines', n_base, 'web_scans', n_web, 'referral_invitations', n_ref,
                            'ledger_persons', n_ledger);
end $$;


ALTER FUNCTION "public"."mpt_dsar_erase"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_dsar_export"("p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');   -- same key the mpt-leads Worker writes
  uid uuid;
  out jsonb;
begin
  select id into uid from public.users where lower(email) = e;
  out := jsonb_build_object(
    'generated_at', now(),
    'subject_email', e,
    'users',      coalesce((select jsonb_agg(to_jsonb(u) - 'subscription_id') from public.users u where u.id = uid), '[]'),
    'leads',      coalesce((select jsonb_agg(to_jsonb(l)) from public.leads l where lower(l.email) = e), '[]'),
    'subscribers',coalesce((select jsonb_agg(to_jsonb(s)) from public.subscribers s where lower(s.email) = e), '[]'),
    'scans',      coalesce((select jsonb_agg(to_jsonb(s)) from public.scans s where s.user_id = uid), '[]'),
    'signals',    coalesce((select jsonb_agg(to_jsonb(g)) from public.signals g join public.scans s on s.id = g.scan_id where s.user_id = uid), '[]'),
    'hexagon_scores', coalesce((select jsonb_agg(to_jsonb(x)) from public.hexagon_scores x join public.scans s on s.id = x.scan_id where s.user_id = uid), '[]'),
    'removal_tasks',  coalesce((select jsonb_agg(to_jsonb(r)) from public.removal_tasks r where r.user_id = uid), '[]'),
    -- MPC-7470: saved web scans linked to this person's scan rows (web_scan_contacts.channel='email', contact_id = scans.id)
    'web_scans',  coalesce((select jsonb_agg(to_jsonb(w)) from public.web_scans w where w.id in (
                     select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
                     where c.channel = 'email' and s.user_id = uid)), '[]'),
    'score_baseline', coalesce((select jsonb_agg(to_jsonb(b) - 'email_hash') from public.mpt_score_baselines b where b.email_hash = h), '[]'),
    -- MPC-7645: referrals where this person invited someone, was invited (matched by the hash of their address) or was referred. Hashes of OTHER people are left out.
    'referrals',  coalesce((select jsonb_agg(to_jsonb(r) - 'invitee_hash') from public.referrals r where r.referrer_user_id = uid or r.referee_user_id = uid or r.invitee_hash = h), '[]')
  );
  return out;
end $$;


ALTER FUNCTION "public"."mpt_dsar_export"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_email_delivery_counts"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("email_type" "text", "sent" bigint, "delivered" bigint, "bounced" bigint, "bounced_hard" bigint, "complained" bigint, "clicked" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select s.email_type, count(*) as sent,
         count(*) filter (where s.status in ('delivered','complained')) as delivered,
         count(*) filter (where s.status in ('bounced','failed')) as bounced,
         count(*) filter (where s.status = 'bounced' and s.bounce_type = 'permanent') as bounced_hard,
         count(*) filter (where s.status = 'complained') as complained,
         count(*) filter (where s.click_count > 0) as clicked
    from public.email_sends s
   where s.sent_at >= p_from and s.sent_at < p_to and not s.is_test
   group by s.email_type order by s.email_type;
$$;


ALTER FUNCTION "public"."mpt_email_delivery_counts"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_ensure_account"("p_user" "uuid", "p_email" "text", "p_scan" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_email text := lower(trim(p_email)); v_ver text; v_at timestamptz; a public.accounts;
begin
  if p_user is null or v_email is null or v_email = '' then raise exception 'user and email required' using errcode = '22023'; end if;
  insert into public.accounts (id, email) values (p_user, v_email) on conflict (id) do nothing;
  if p_scan is not null then
    select c.save_consent_version, c.save_consent_at into v_ver, v_at
      from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
     where c.web_scan_id = p_scan and c.channel = 'email' and lower(s.email_scanned) = v_email and c.save_consent_version is not null
     limit 1;
    if v_ver is not null then
      update public.accounts
         set consent_version = v_ver, consent_at = v_at, consent_scan_id = p_scan,
             consent_hash = encode(sha256(convert_to(v_ver || '|' || v_at::text || '|' || p_scan::text, 'UTF8')), 'hex')
       where id = p_user and consent_version is null;
    end if;
  end if;
  select * into a from public.accounts where id = p_user;
  return jsonb_build_object('id', a.id, 'email', a.email, 'plan', a.plan, 'keep_scans', a.keep_scans, 'created_at', a.created_at,
                            'consent_version', a.consent_version, 'consent_at', a.consent_at);
end $$;


ALTER FUNCTION "public"."mpt_ensure_account"("p_user" "uuid", "p_email" "text", "p_scan" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_erase_chat_sender"("p_channel" "text", "p_sender_id" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer; conv text[]; cid text; p uuid; seen uuid[] := '{}';
begin
  select coalesce(array_agg(id::text), '{}') into conv from public.conversation_states where channel = p_channel and sender_id = p_sender_id;
  delete from public.conversation_states where channel = p_channel and sender_id = p_sender_id;
  get diagnostics n = row_count;
  -- MPC-8737 M3: the sender's ledger record, found by platform id (WhatsApp number or Telegram id) and by the conversation ids just deleted.
  if to_regprocedure('ledger.erase_person(uuid)') is not null then
    if p_channel = 'whatsapp' then p := ledger.resolve_person('wa_id', p_sender_id, false);
    elsif p_channel = 'telegram' then p := ledger.resolve_person('telegram_id', p_sender_id, false);
    end if;
    if p is not null then seen := seen || p; perform ledger.erase_person(p); end if;
    foreach cid in array conv loop
      p := ledger.resolve_person('conversation_id', cid, false);
      if p is not null and not (p = any (seen)) then seen := seen || p; perform ledger.erase_person(p); end if;
    end loop;
  end if;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_erase_chat_sender"("p_channel" "text", "p_sender_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_erase_social_contact"("p_platform" "text", "p_user_id" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer; p uuid;
begin
  delete from public.social_contacts where platform = p_platform and platform_user_id = p_user_id;
  get diagnostics n = row_count;
  -- MPC-8737 M3: an X contact's ledger record (identifier social_x).
  if p_platform = 'x' and to_regprocedure('ledger.erase_person(uuid)') is not null then
    p := ledger.resolve_person('social_x', p_user_id, false);
    if p is not null then perform ledger.erase_person(p); end if;
  end if;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_erase_social_contact"("p_platform" "text", "p_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_export_hk_spam_by_email"("p_email" "text") RETURNS TABLE("created_at" timestamp with time zone, "platform" "text", "language" "text", "protection_date" "date", "email" "text", "reminder_consent" boolean, "marketing_consent" boolean, "reminder_sent_at" timestamp with time zone, "utm_source" "text", "utm_medium" "text", "utm_campaign" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select created_at, platform, language, protection_date, email, reminder_consent, marketing_consent, reminder_sent_at, utm_source, utm_medium, utm_campaign
  from public.hk_spam_registrations where lower(email) = lower(trim(p_email)) order by created_at;
$$;


ALTER FUNCTION "public"."mpt_export_hk_spam_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_export_web_scan"("p_scan_number" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select jsonb_build_object('generated_at', now(), 'web_scan', to_jsonb(w),
              'contact_links', coalesce((select jsonb_agg(jsonb_build_object('channel', c.channel, 'linked_at', c.linked_at)) from public.web_scan_contacts c where c.web_scan_id = w.id), '[]'::jsonb))
       from public.web_scans w where w.id = p_scan_number),
    jsonb_build_object('generated_at', now(), 'web_scan', null, 'contact_links', '[]'::jsonb));
$$;


ALTER FUNCTION "public"."mpt_export_web_scan"("p_scan_number" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_export_web_scan"("p_scan_number" "uuid") IS 'MPC-7488. Returns the saved web scan stored under a scan number, for an access request. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_find_auth_user_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and u.email_confirmed_at is not null
    and u.deleted_at is null
  order by u.created_at
  limit 1
$$;


ALTER FUNCTION "public"."mpt_find_auth_user_by_email"("p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_find_auth_user_by_email"("p_email" "text") IS 'MPC-6971: confirmed auth user id for an email, or NULL. service_role only (OAuth Worker identity link).';



CREATE OR REPLACE FUNCTION "public"."mpt_ga4_metric"("p" "jsonb", "metric" "text") RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select nullif(p #>> array['rows', '0', 'metricValues', (h.ord - 1)::text, 'value'], '')::numeric
  from jsonb_array_elements(coalesce(p -> 'metricHeaders', '[]'::jsonb)) with ordinality as h(el, ord)
  where h.el ->> 'name' = metric
  limit 1
$$;


ALTER FUNCTION "public"."mpt_ga4_metric"("p" "jsonb", "metric" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_get_account_scan"("p_account" "uuid", "p_web_scan" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select jsonb_build_object('scan_number', w.id, 'created_at', w.created_at, 'hexagon_count', w.hexagon_count, 'results', w.results)
    from public.account_scans l join public.web_scans w on w.id = l.web_scan_id
   where l.account_id = p_account and l.web_scan_id = p_web_scan;
$$;


ALTER FUNCTION "public"."mpt_get_account_scan"("p_account" "uuid", "p_web_scan" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_get_entitlements"("p_account" "uuid" DEFAULT NULL::"uuid", "p_email" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), ''); a public.accounts; v_plan text := 'free'; v_has boolean := false;
  v_limit int; v_unlimited boolean := false; v_used int := 0; v_key text; v_period date := public.mpt_scan_period(); caps jsonb; mins jsonb;
begin
  select * into a from public.accounts where (p_account is not null and id = p_account) or (p_account is null and v_email is not null and email = v_email) limit 1;
  if a.id is not null then v_plan := a.plan; v_has := true; v_email := coalesce(v_email, a.email); end if;
  select per_month, per_month is null into v_limit, v_unlimited from public.plan_scan_allowance where plan = v_plan;
  select jsonb_object_agg(key, public.mpt_tier_rank(v_plan) >= public.mpt_tier_rank(min_tier)),
         jsonb_object_agg(key, jsonb_build_object('min_tier', min_tier, 'status', status, 'cost', cost))
    into caps, mins from public.capability_min_tier;
  if v_email is not null then
    v_key := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
    select count(*) into v_used from public.scan_consumption where subject_key = v_key and period_start = v_period and (confirmed_at is not null or consumed_at > now() - interval '24 hours');
  end if;
  return jsonb_build_object('tier', v_plan, 'has_account', v_has, 'capabilities', coalesce(caps, '{}'::jsonb), 'capability_info', coalesce(mins, '{}'::jsonb),
    'limits', jsonb_build_object('scan.per_month', v_limit),
    'scans', jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', case when v_unlimited then null else greatest(v_limit - v_used, 0) end, 'unlimited', v_unlimited,
                                'period_start', v_period, 'resets_at', ((v_period + interval '1 month')::timestamp at time zone 'UTC')));
end $$;


ALTER FUNCTION "public"."mpt_get_entitlements"("p_account" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_hexagon_events_link_answer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.event_type <> 'answer' then
    return new;
  end if;
  select s.id into new.shown_event_id
  from public.mpt_hexagon_events s
  where s.event_type = 'shown' and s.person_key = new.person_key and s.hexagon_id = new.hexagon_id
    and s.source = new.source and s.scan_window = new.scan_window
    and s.created_at <= new.created_at and s.created_at >= new.created_at - interval '24 hours'
  limit 1;
  if new.shown_event_id is null then
    raise exception 'answer has no recent shown event' using errcode = '23514';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."mpt_hexagon_events_link_answer"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_hexagon_events_link_answer"() IS 'Links an answer to the shown event it answers (same person, tile, source and scan window, within 24 hours) and refuses an answer with none.';



CREATE OR REPLACE FUNCTION "public"."mpt_hk_date"("ts" timestamp with time zone) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$ select (ts at time zone 'Asia/Hong_Kong')::date $$;


ALTER FUNCTION "public"."mpt_hk_date"("ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_hk_ts"("d" "date") RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$ select d::timestamp at time zone 'Asia/Hong_Kong' $$;


ALTER FUNCTION "public"."mpt_hk_ts"("d" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_keep_scan"("p_scans_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int;
begin
  update public.scans set kept_at = coalesce(kept_at, now()), delete_after = null where id = p_scans_id and report_sent_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('kept', n > 0);
end $$;


ALTER FUNCTION "public"."mpt_keep_scan"("p_scans_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_learning_absorb_edge_visit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare d date := (now() at time zone 'Asia/Hong_Kong')::date;
begin
  if old.class in ('bot', 'ai') then
    perform public.mpt_learning_count(d, 'bot_family', old.class || ':' || public.mpt_bot_family(old.user_agent), 1);
  else
    perform public.mpt_learning_count(d, 'country_bucket', public.mpt_country_bucket(old.country), 1);
  end if;
  return old;
end $$;


ALTER FUNCTION "public"."mpt_learning_absorb_edge_visit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_learning_absorb_web_scan"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  d date := (now() at time zone 'Asia/Hong_Kong')::date;
  r record;
begin
  perform public.mpt_learning_count(d, 'scan', 'web_scan_saved', 1);
  for r in
    select coalesce(substring(h->>'id' from '^[a-z0-9][a-z0-9_-]{0,63}$'), 'unknown') || ':' ||
           case h->>'status' when 'found' then 'found' when 'clear' then 'not_found' else 'not_checked' end as k,
           count(*) as c
      from jsonb_array_elements(case when jsonb_typeof(old.results) = 'array' then old.results else '[]'::jsonb end) h
     group by 1
  loop
    perform public.mpt_learning_count(d, 'hexagon_result', r.k, r.c);
  end loop;
  for r in select e.step as k, count(*) as c from public.web_scan_events e where e.web_scan_id = old.id and e.step <> 'results_time' group by 1 loop
    perform public.mpt_learning_count(d, 'funnel_step', r.k, r.c);
  end loop;
  return old;
end $_$;


ALTER FUNCTION "public"."mpt_learning_absorb_web_scan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_learning_aggregate_week"("p_from" "date", "p_to" "date") RETURNS TABLE("dimension" "text", "key" "text", "n" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select a.dimension, a.key, sum(a.n)::bigint from public.learning_aggregate_daily a
   where a.day between p_from and p_to group by a.dimension, a.key order by a.dimension, a.key;
$$;


ALTER FUNCTION "public"."mpt_learning_aggregate_week"("p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_learning_count"("p_day" "date", "p_dimension" "text", "p_key" "text", "p_n" bigint DEFAULT 1) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  insert into public.learning_aggregate_daily as a (day, dimension, key, n)
  values (p_day, p_dimension, p_key, p_n)
  on conflict (day, dimension, key) do update set n = a.n + p_n;
$$;


ALTER FUNCTION "public"."mpt_learning_count"("p_day" "date", "p_dimension" "text", "p_key" "text", "p_n" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_learning_count_tile_event"("p_hexagon_id" "text", "p_event" "text", "p_answer" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare k text;
begin
  if p_hexagon_id is null or p_hexagon_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'bad hexagon id' using errcode = '22023'; end if;
  k := case when p_event = 'shown' and p_answer is null then 'shown'
            when p_event = 'answer' and p_answer in ('yes_me', 'not_me', 'disputed', 'kept') then p_answer
            else null end;
  if k is null then raise exception 'bad tile event' using errcode = '22023'; end if;
  perform public.mpt_learning_count((now() at time zone 'Asia/Hong_Kong')::date, 'tile_event', p_hexagon_id || ':' || k, 1);
end $_$;


ALTER FUNCTION "public"."mpt_learning_count_tile_event"("p_hexagon_id" "text", "p_event" "text", "p_answer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_learning_loop"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_grace_hours" integer DEFAULT 24) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with base as (
    select w.id, w.created_at, w.results,
           exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id) as stayer
      from public.web_scans w
     where w.created_at >= p_from and w.created_at < p_to
  ), grp as (
    select b.*, case when b.stayer then 'stayer'
                     when b.created_at <= p_to - make_interval(hours => p_grace_hours) then 'leaver'
                     else 'pending' end as grp
      from base b
  ), last_step as (
    select g.id,
           case when exists (select 1 from public.web_scan_events e where e.web_scan_id = g.id and e.step = 'contact_step_opened') then 'contact_step_opened'
                when exists (select 1 from public.web_scan_events e where e.web_scan_id = g.id and e.step = 'results_viewed') then 'results_viewed'
                else 'scan_finished' end as step
      from grp g where g.grp = 'leaver'
  ), hex as (
    select g.grp, h->>'id' as hexagon_id, (h->>'status') = 'found' as found
      from grp g, jsonb_array_elements(g.results) h
     where g.grp in ('leaver', 'stayer')
  ), ret as (
    select r.returned_at - p.created_at as gap
      from public.web_scan_returns r join public.web_scans p on p.id = r.previous_scan_id
     where r.returned_at >= p_from and r.returned_at < p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'grace_hours', p_grace_hours,
    'finished',       (select count(*) from base),
    'contacts_given', (select count(*) from grp where grp = 'stayer'),
    'leavers',        (select count(*) from grp where grp = 'leaver'),
    'pending',        (select count(*) from grp where grp = 'pending'),
    'leavers_last_step', jsonb_build_object(
      'scan_finished',       (select count(*) from last_step where step = 'scan_finished'),
      'results_viewed',      (select count(*) from last_step where step = 'results_viewed'),
      'contact_step_opened', (select count(*) from last_step where step = 'contact_step_opened')),
    'results_seconds', jsonb_build_object(
      'leavers_n',   (select count(*) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'leaver'),
      'leavers_avg', (select round(avg(e.seconds), 1) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'leaver'),
      'stayers_n',   (select count(*) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'stayer'),
      'stayers_avg', (select round(avg(e.seconds), 1) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'stayer')),
    'hexagons', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.hexagon_id,
          'leavers_found', t.leavers_found, 'leavers_total', t.leavers_total,
          'stayers_found', t.stayers_found, 'stayers_total', t.stayers_total) order by t.hexagon_id)
        from (select hexagon_id,
                     count(*) filter (where grp = 'leaver' and found) as leavers_found,
                     count(*) filter (where grp = 'leaver') as leavers_total,
                     count(*) filter (where grp = 'stayer' and found) as stayers_found,
                     count(*) filter (where grp = 'stayer') as stayers_total
                from hex group by hexagon_id) t), '[]'::jsonb),
    'returns', jsonb_build_object(
      'returned_total', (select count(*) from ret),
      'within_7_days',  (select count(*) from ret where gap <= interval '7 days'),
      'within_30_days', (select count(*) from ret where gap <= interval '30 days'))
  );
$$;


ALTER FUNCTION "public"."mpt_learning_loop"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_grace_hours" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_learning_loop"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_grace_hours" integer) IS 'MPC-7493. Aggregate learning-loop numbers for scans created in [from, to): finished vs contact given, last step reached by leavers, hexagons shown as findings to leavers vs stayers, average time on results, returns within 7/30 days. Counts only. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_ledger_pop_bind"("p_sid" "text", "p_wa" "text", "p_bound_at_ms" bigint, "p_inbound_ts" bigint, "p_consent_v" "text", "p_consent_accepted" boolean, "p_msg" "text", "p_ttl_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'ledger', 'pg_temp'
    AS $$
declare pid uuid; bound timestamptz := to_timestamp(p_bound_at_ms / 1000.0);
begin
  if p_sid is null or char_length(p_sid) < 8 or ledger.normalise_wa_id(p_wa) is null or p_ttl_seconds is null or p_ttl_seconds <= 0 then
    raise exception 'mpt_ledger_pop_bind: bad arguments';
  end if;
  pid := ledger.resolve_person('wa_id', p_wa, true);
  -- the inbound message that carried the code is the proof the person holds the number (D1: unproven -> proven)
  perform ledger.attach_identifier(pid, 'wa_id', p_wa, 'proven', 'inbound_code');
  perform ledger.record_data_point(pid, 'phone.possession_proof', p_sid,
    jsonb_build_object('inbound_ts', p_inbound_ts, 'consent_v', coalesce(p_consent_v, ''), 'consent_accepted', coalesce(p_consent_accepted, false)),
    'found', 100::smallint, 'taken', 'whatsapp', 'webhook', 'whatsapp_inbound', p_msg, null, bound, bound + make_interval(secs => p_ttl_seconds),
    null, '{}'::jsonb, 'pop-1');
  return true;
end $$;


ALTER FUNCTION "public"."mpt_ledger_pop_bind"("p_sid" "text", "p_wa" "text", "p_bound_at_ms" bigint, "p_inbound_ts" bigint, "p_consent_v" "text", "p_consent_accepted" boolean, "p_msg" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_ledger_pop_check"("p_sid" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'ledger', 'pg_temp'
    AS $$
declare dp ledger.data_point%rowtype; wa text; rev timestamptz; root uuid;
begin
  select * into dp from ledger.data_point
   where type_code = 'phone.possession_proof' and subject_ref = p_sid and status = 'found' and (expires_at is null or expires_at > now())
   order by observed_at desc limit 1;
  if not found then return jsonb_build_object('proof', null, 'revoked_at_ms', null); end if;
  root := ledger.root_person(dp.person_id);
  select pi.id_value into wa from ledger.person_identifier pi
   where pi.id_type = 'wa_id' and pi.person_id in (select ledger.person_family(root)) order by (pi.proof_state = 'proven') desc, pi.first_seen_at limit 1;
  select max(r.observed_at) into rev from ledger.data_point r
   where r.type_code = 'phone.possession_revoked' and r.status = 'found' and (r.expires_at is null or r.expires_at > now()) and r.person_id in (select ledger.person_family(root));
  return jsonb_build_object(
    'proof', jsonb_build_object('wa', ltrim(wa, '+'), 'bound_at_ms', floor(extract(epoch from dp.observed_at) * 1000)::bigint,
                                'inbound_ts', (dp.value->>'inbound_ts')::numeric, 'consent_v', dp.value->>'consent_v', 'consent_accepted', (dp.value->>'consent_accepted')::boolean),
    'revoked_at_ms', case when rev is null then null else floor(extract(epoch from rev) * 1000)::bigint end);
end $$;


ALTER FUNCTION "public"."mpt_ledger_pop_check"("p_sid" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_ledger_pop_revoke"("p_wa" "text", "p_at_ms" bigint, "p_ttl_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'ledger', 'pg_temp'
    AS $$
declare pid uuid; at_ts timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  if ledger.normalise_wa_id(p_wa) is null or p_ttl_seconds is null or p_ttl_seconds <= 0 then raise exception 'mpt_ledger_pop_revoke: bad arguments'; end if;
  pid := ledger.resolve_person('wa_id', p_wa, false);
  if pid is null then return true; end if;
  perform ledger.record_data_point(pid, 'phone.possession_revoked', null, jsonb_build_object('via', 'stop_or_delete'), 'found', 100::smallint, 'taken', 'whatsapp', 'webhook',
    'whatsapp_inbound', null, null, at_ts, at_ts + make_interval(secs => p_ttl_seconds), null, '{}'::jsonb, 'pop-1');
  return true;
end $$;


ALTER FUNCTION "public"."mpt_ledger_pop_revoke"("p_wa" "text", "p_at_ms" bigint, "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_link_scan_to_account"("p_account" "uuid", "p_web_scan" "uuid", "p_method" "text" DEFAULT 'claim'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_email text; v_scans uuid; n int;
begin
  if p_method not in ('current', 'claim', 'confirm') then raise exception 'bad method' using errcode = '22023'; end if;
  select email into v_email from public.accounts where id = p_account;
  if v_email is null then return jsonb_build_object('linked', false, 'reason', 'no_account'); end if;
  select s.id into v_scans
    from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
   where c.web_scan_id = p_web_scan and c.channel = 'email' and lower(s.email_scanned) = v_email
   limit 1;
  if v_scans is null then return jsonb_build_object('linked', false, 'reason', 'not_your_scan'); end if;
  insert into public.account_scans (account_id, web_scan_id, scans_id, claim_method) values (p_account, p_web_scan, v_scans, p_method) on conflict do nothing;
  get diagnostics n = row_count;
  update public.scans set expires_at = null where id = v_scans and expires_at is not null;
  return jsonb_build_object('linked', true, 'already', n = 0, 'scan_number', p_web_scan);
end $$;


ALTER FUNCTION "public"."mpt_link_scan_to_account"("p_account" "uuid", "p_web_scan" "uuid", "p_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_list_account_scans"("p_account" "uuid") RETURNS TABLE("scan_number" "uuid", "created_at" timestamp with time zone, "hexagon_count" integer, "linked_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select w.id, w.created_at, w.hexagon_count, l.linked_at
    from public.account_scans l join public.web_scans w on w.id = l.web_scan_id
   where l.account_id = p_account order by w.created_at desc;
$$;


ALTER FUNCTION "public"."mpt_list_account_scans"("p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_machine_mirror_retention"("p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare d int; ips int := 0; hdr int := 0;
begin
  select ip_days into d from public.edge_visit_retention where id;
  if d is null then d := 7; end if;
  if p_dry_run then
    select count(*) into ips from public.edge_visits where ip is not null and class in ('bot', 'ai') and seen_at < now() - make_interval(days => d);
    select count(*) into hdr from public.edge_visits where (all_headers <> '{}'::jsonb or cf <> '{}'::jsonb) and class in ('bot', 'ai') and seen_at < now() - interval '30 days';
  else
    update public.edge_visits set ip = null, ip_cut_at = now()
     where ip is not null and class in ('bot', 'ai') and seen_at < now() - make_interval(days => d);
    get diagnostics ips = row_count;
    update public.edge_visits set all_headers = '{}'::jsonb, cf = '{}'::jsonb
     where (all_headers <> '{}'::jsonb or cf <> '{}'::jsonb) and class in ('bot', 'ai') and seen_at < now() - interval '30 days';
    get diagnostics hdr = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'ip_days', d, 'ips_cut', ips, 'headers_dropped', hdr, 'ran_at', now());
end $$;


ALTER FUNCTION "public"."mpt_machine_mirror_retention"("p_dry_run" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_machine_visits_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with win as (select class, user_agent, path, status, seen_at from public.edge_visits where seen_at >= p_from and seen_at < p_to),
  m as (
    select class, user_agent,
           count(*) as requests,
           min(seen_at) as first_seen,
           max(seen_at) as last_seen,
           count(*) filter (where path = '/robots.txt') as robots_fetches,
           coalesce(array_agg(distinct path) filter (where path <> '/robots.txt' and path <> '/sitemap.xml' and path not like '/api/%' and status between 200 and 399), '{}') as pages
      from win where class in ('bot', 'ai') group by class, user_agent
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total_requests', (select count(*) from win),
    'machine_requests', (select coalesce(sum(requests), 0) from m),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'class', class, 'user_agent', user_agent, 'requests', requests, 'pages', to_jsonb(pages),
        'first_seen', first_seen, 'last_seen', last_seen, 'robots_fetches', robots_fetches,
        'first_ever', (select min(e.seen_at) from public.edge_visits e where e.user_agent is not distinct from m.user_agent and e.class in ('bot', 'ai'))
      ) order by requests desc) from m), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."mpt_machine_visits_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_machine_visits_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) IS 'MPC-7492. Bot and AI edge visits aggregated per user agent for [p_from, p_to). Counts and paths only, no IP, no person or unknown rows. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_ping"() RETURNS timestamp with time zone
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ select now(); $$;


ALTER FUNCTION "public"."mpt_ping"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_alert"("p_test" boolean DEFAULT false) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'net', 'vault', 'pg_temp'
    AS $$
declare
  h record;
  v_token text;
  v_chat  text;
  v_msg   text;
begin
  select * into h from public.mpt_purge_health();
  if h.healthy and not p_test then
    return 'healthy: no alert sent';
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_alert_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_alert_chat_id';
  if v_token is null or v_chat is null then
    raise warning 'mpt_purge_alert: telegram secrets missing in Vault';
    return 'secrets missing';
  end if;

  v_msg := case when p_test then '✅ TEST: MPT purge alerting works. ' else '⚠️ MPT OSINT scan purge UNHEALTHY. ' end
        || 'healthy=' || h.healthy
        || ', last_success=' || coalesce(h.last_success::text, 'never')
        || ', failed_runs_24h=' || h.failed_runs_24h
        || ', expired_rows=' || h.expired_rows;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', v_chat, 'text', v_msg)
  );
  return 'alert queued';
end;
$$;


ALTER FUNCTION "public"."mpt_purge_alert"("p_test" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_dashboard_credentials"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare a integer; b integer;
begin
  delete from public.dashboard_sessions where expires_at < now() or revoked_at is not null;
  get diagnostics a = row_count;
  delete from public.dashboard_links where expires_at < now() - interval '1 day';
  get diagnostics b = row_count;
  return a + b;
end $$;


ALTER FUNCTION "public"."mpt_purge_dashboard_credentials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_deletion_consents"("p_dry_run" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n_completed int; n_abandoned int; n_deleted int := 0;
begin
  select count(*) into n_completed from public.deletion_consents where eradication_completed_at < now() - interval '12 months';
  select count(*) into n_abandoned from public.deletion_consents d
   where d.eradication_completed_at is null and coalesce(d.withdrawn_at, d.expires_at) < now() - interval '30 days'
     and not exists (select 1 from public.eradication_jobs j where j.consent_id = d.id and j.status in ('queued', 'running'));
  if not p_dry_run then
    delete from public.deletion_consents d
     where d.eradication_completed_at < now() - interval '12 months'
        or (d.eradication_completed_at is null and coalesce(d.withdrawn_at, d.expires_at) < now() - interval '30 days'
            and not exists (select 1 from public.eradication_jobs j where j.consent_id = d.id and j.status in ('queued', 'running')));
    get diagnostics n_deleted = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'completed_over_12_months', n_completed, 'abandoned_over_30_days', n_abandoned, 'deleted', n_deleted, 'ran_at', now());
end $$;


ALTER FUNCTION "public"."mpt_purge_deletion_consents"("p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_purge_deletion_consents"("p_dry_run" boolean) IS 'MPC-8673. Deletes consents 12 months after eradication completed, and unused (expired or withdrawn) consents 30 days after, unless a job is queued or running. Dry run by default. Counts only.';



CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_cairn_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare n integer;
begin
  delete from public.cairn_sessions where retain_until < now();
  get diagnostics n = row_count;
  return n;
end;
$$;


ALTER FUNCTION "public"."mpt_purge_expired_cairn_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_channel_probe_captures"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.channel_probe_captures where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_channel_probe_captures"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_deep_data"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.deep_jobs where expires_at < now();   -- results cascade
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_deep_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_hk_spam"("p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_days int; n_ended int := 0; n_del int := 0;
begin
  select days into v_days from public.hk_spam_retention where id;
  if v_days is null then v_days := 90; end if;

  -- An unsubscribe ends marketing consent, so the 90-day rule applies to that row again.
  if p_dry_run then
    select count(*) into n_ended from public.hk_spam_registrations r
     where r.marketing_consent and r.email is not null
       and exists (select 1 from public.email_suppressions s where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex'));
    select count(*) into n_del from public.hk_spam_registrations r
     where r.protection_date <= (now() at time zone 'Asia/Hong_Kong')::date - v_days
       and (not r.marketing_consent
            or (r.email is not null and exists (select 1 from public.email_suppressions s where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex'))));
  else
    update public.hk_spam_registrations r set marketing_consent = false
     where r.marketing_consent and r.email is not null
       and exists (select 1 from public.email_suppressions s where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex'));
    get diagnostics n_ended = row_count;
    delete from public.hk_spam_registrations r
     where r.protection_date <= (now() at time zone 'Asia/Hong_Kong')::date - v_days
       and not r.marketing_consent;
    get diagnostics n_del = row_count;
  end if;

  insert into public.hk_spam_deletion_log (kind, rows_deleted, consent_ended, note)
  values (case when p_dry_run then 'purge_dry_run' else 'purge' end, n_del, n_ended, v_days || ' days after protection_date');
  return jsonb_build_object('dry_run', p_dry_run, 'days', v_days, 'rows_deleted', n_del, 'marketing_consent_ended', n_ended);
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_hk_spam"("p_dry_run" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_interaction_log"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.interaction_log where retain_until < now();
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_interaction_log"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_profile_snapshots"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.profile_snapshots where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_profile_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_scan_results"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare n integer;
begin
  delete from public.mpt_osint_scan_results where expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;


ALTER FUNCTION "public"."mpt_purge_expired_scan_results"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_scans"("p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$ select public.mpt_purge_free_records(p_dry_run) $$;


ALTER FUNCTION "public"."mpt_purge_expired_scans"("p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_purge_expired_scans"("p_dry_run" boolean) IS 'MPC-8659. Deletes public.scans rows past expires_at (7 days for new rows), cascading to signals, hexagon_scores and removal_tasks. NEVER deletes a scan that has an open removal task (not_started / in_progress); owner decision 2026-10-27. Dry run by default. Returns counts only. Not scheduled: see the header of this file.';



CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_social_contacts"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.social_contacts where retain_until < now();
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_social_contacts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_telegram_event_log"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  delete from public.telegram_event_log where expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_telegram_event_log"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_expired_web_scans"("p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  r public.web_scan_retention;
  n_unlinked int := 0; n_old int := 0; n_links int := 0;
begin
  select * into r from public.web_scan_retention where id;
  if not found then r.months := 12; r.unlinked_days := 90; end if;

  if p_dry_run then
    if r.unlinked_days is not null then
      select count(*) into n_unlinked from public.web_scans w
       where w.created_at < now() - make_interval(days => r.unlinked_days)
         and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id);
    end if;
    select count(*) into n_old from public.web_scans w
     where w.created_at < now() - make_interval(months => r.months)
       and not (r.unlinked_days is not null and w.created_at < now() - make_interval(days => r.unlinked_days)
                and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id));
    select count(*) into n_links from public.web_scan_contacts c join public.web_scans w on w.id = c.web_scan_id
     where w.created_at < now() - make_interval(months => r.months);
  else
    if r.unlinked_days is not null then
      delete from public.web_scans w
       where w.created_at < now() - make_interval(days => r.unlinked_days)
         and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id);
      get diagnostics n_unlinked = row_count;
    end if;
    select count(*) into n_links from public.web_scan_contacts c join public.web_scans w on w.id = c.web_scan_id
     where w.created_at < now() - make_interval(months => r.months);
    delete from public.web_scans w where w.created_at < now() - make_interval(months => r.months);   -- cascades to web_scan_contacts
    get diagnostics n_old = row_count;
  end if;

  insert into public.web_scan_deletion_log (kind, scans_deleted, links_deleted, note)
  values (case when p_dry_run then 'purge_dry_run' else 'purge' end, n_unlinked + n_old, n_links,
          format('retention months=%s unlinked_days=%s', r.months, coalesce(r.unlinked_days::text, 'off')));

  return jsonb_build_object('dry_run', p_dry_run, 'months', r.months, 'unlinked_days', r.unlinked_days,
                            'unlinked_scans', n_unlinked, 'expired_scans', n_old, 'scans', n_unlinked + n_old,
                            'contact_links', n_links, 'ran_at', now());
end $$;


ALTER FUNCTION "public"."mpt_purge_expired_web_scans"("p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_purge_expired_web_scans"("p_dry_run" boolean) IS 'MPC-7488. Deletes saved web scans older than public.web_scan_retention (months; unlinked_days for never-linked scans). p_dry_run=true counts only. Logs counts in web_scan_deletion_log. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_purge_free_records"("p_dry_run" boolean DEFAULT false, "p_overdue" interval DEFAULT '00:00:00'::interval) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  ids uuid[]; webs uuid[]; users_ uuid[]; emails text[]; lp uuid[] := '{}'; p uuid;
  n_scans int := 0; n_web int := 0; n_users int := 0; n_leads int := 0; n_ledger int := 0; hashes text[];
begin
  select coalesce(array_agg(s.id), '{}'), coalesce(array_agg(distinct lower(s.email_scanned)), '{}'), coalesce(array_agg(distinct s.user_id) filter (where s.user_id is not null), '{}')
    into ids, emails, users_
    from public.scans s
   where s.delete_after is not null and s.delete_after <= now() - p_overdue and not public.mpt_scan_is_kept(s);
  select coalesce(array_agg(distinct c.web_scan_id), '{}') into webs from public.web_scan_contacts c where c.channel = 'email' and c.contact_id = any(ids);

  if p_dry_run then
    n_scans := cardinality(ids); n_web := cardinality(webs);
    select count(*) into n_users from public.users u where u.id = any(users_)
       and not exists (select 1 from public.scans s2 where s2.user_id = u.id and not (s2.id = any(ids)))
       and not exists (select 1 from public.accounts a where a.email = lower(u.email));
    insert into public.free_record_deletion_log (kind, scans_deleted, web_scans_deleted, users_deleted, note) values ('purge_dry_run', n_scans, n_web, n_users, format('N from consent, default %s', (select n_hours from public.free_record_policy where id)));
    return jsonb_build_object('dry_run', true, 'scans', n_scans, 'web_scans', n_web, 'users', n_users, 'ran_at', now());
  end if;
  if cardinality(ids) = 0 then return jsonb_build_object('dry_run', false, 'scans', 0, 'web_scans', 0, 'users', 0, 'leads', 0, 'ledger_persons', 0, 'notify', '[]'::jsonb, 'ran_at', now()); end if;

  perform public.mpt_aggregate_before_delete(webs);

  if to_regprocedure('ledger.erase_person(uuid)') is not null then
    select coalesce(array_agg(distinct encode(digest(e, 'sha256'), 'hex')), '{}') into hashes from unnest(emails) e;
    select coalesce(array_agg(distinct ledger.root_person(pi.person_id)), '{}') into lp
      from ledger.person_identifier pi
     where (pi.id_type = 'email_hash' and pi.id_value = any(hashes))
        or (pi.id_type = 'user_id' and pi.id_value in (select u.id::text from public.users u where u.id = any(users_)))
        or (pi.id_type = 'lead_id' and pi.id_value in (select l.id::text from public.leads l where l.user_id = any(users_)))
        or (pi.id_type = 'scan_id' and pi.id_value in (select unnest(ids)::text))
        or (pi.id_type = 'web_scan_id' and pi.id_value in (select unnest(webs)::text));
  end if;

  delete from public.web_scans where id = any(webs);                       get diagnostics n_web = row_count;
  delete from public.scans where id = any(ids);                            get diagnostics n_scans = row_count;
  with gone as (
    delete from public.users u where u.id = any(users_)
       and not exists (select 1 from public.scans s2 where s2.user_id = u.id)
       and not exists (select 1 from public.accounts a where a.email = lower(u.email))
    returning u.id)
  select count(*), coalesce(array_agg(id), '{}') into n_users, users_ from gone;
  delete from public.leads l where l.user_id = any(users_) or (l.user_id is null and lower(l.email) = any(emails)
       and not exists (select 1 from public.accounts a where a.email = lower(l.email)) and not exists (select 1 from public.scans s3 where lower(s3.email_scanned) = lower(l.email)));
  get diagnostics n_leads = row_count;
  foreach p in array lp loop perform ledger.erase_person(p); n_ledger := n_ledger + 1; end loop;

  insert into public.free_record_deletion_log (kind, scans_deleted, web_scans_deleted, users_deleted, leads_deleted, ledger_persons, note)
  values ('purge', n_scans, n_web, n_users, n_leads, n_ledger, format('overdue >= %s', p_overdue));
  return jsonb_build_object('dry_run', false, 'scans', n_scans, 'web_scans', n_web, 'users', n_users, 'leads', n_leads, 'ledger_persons', n_ledger,
                            'notify', to_jsonb(emails), 'ran_at', now());
end $$;


ALTER FUNCTION "public"."mpt_purge_free_records"("p_dry_run" boolean, "p_overdue" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_health"() RETURNS TABLE("healthy" boolean, "last_success" timestamp with time zone, "failed_runs_24h" bigint, "expired_rows" bigint, "checked_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'cron', 'pg_temp'
    AS $$
  with runs as (
    select d.status, d.start_time
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = 'mpt-purge-expired-scan-results'
  ), s as (
    select
      (select max(start_time) from runs where status = 'succeeded') as last_success,
      (select count(*) from runs where status <> 'succeeded' and start_time > now() - interval '24 hours') as failed_24h,
      (select count(*) from public.mpt_osint_scan_results where expires_at < now() - interval '2 hours') as stale_expired
  )
  select
    (s.last_success > now() - interval '2 hours' and s.failed_24h = 0 and s.stale_expired = 0),
    s.last_success, s.failed_24h, s.stale_expired, now()
  from s;
$$;


ALTER FUNCTION "public"."mpt_purge_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_purge_stale_channel_tokens"("p_dry_run" boolean DEFAULT true, "p_days" integer DEFAULT 90) RETURNS TABLE("provider" "text", "stale_rows" bigint, "deleted_rows" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if p_dry_run is null then raise exception 'p_dry_run must be true or false' using errcode = '22023'; end if;
  if p_days is null or p_days < 30 then raise exception 'p_days must be at least 30' using errcode = '22023'; end if;

  if p_dry_run then
    return query
      select t.provider, count(*)::bigint, 0::bigint
      from public.channel_tokens t
      where t.provider in ('github', 'reddit') and t.updated_at < now() - make_interval(days => p_days)
      group by t.provider order by t.provider;
  else
    return query
      with gone as (
        delete from public.channel_tokens t
        where t.provider in ('github', 'reddit') and t.updated_at < now() - make_interval(days => p_days)
        returning t.provider
      )
      select g.provider, count(*)::bigint, count(*)::bigint from gone g group by g.provider order by g.provider;
  end if;
end $$;


ALTER FUNCTION "public"."mpt_purge_stale_channel_tokens"("p_dry_run" boolean, "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_raw_metrics_block_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'public.mpt_raw_metrics is append-only (% blocked)', tg_op using errcode = '42501';
end $$;


ALTER FUNCTION "public"."mpt_raw_metrics_block_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_recognition_candidates"("p_hashes" "jsonb", "p_limit" integer DEFAULT 200) RETURNS TABLE("web_scan_id" "uuid", "scanned_at" timestamp with time zone, "results" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select w.id, w.created_at, w.results
    from public.web_scans w
   where jsonb_typeof(p_hashes) = 'array'
     and jsonb_array_length(p_hashes) between 1 and 4
     and exists (select 1 from public.web_scan_contacts c
                  where c.web_scan_id = w.id and c.save_consent_at is not null and c.recognise_consent_at is not null)
     and w.created_at >= now() - make_interval(months => coalesce((select r.months from public.web_scan_retention r where r.id), 12))
     and exists (select 1 from jsonb_array_elements(p_hashes) h where jsonb_typeof(h) = 'object' and w.results @> jsonb_build_array(h))
   order by w.created_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;


ALTER FUNCTION "public"."mpt_recognition_candidates"("p_hashes" "jsonb", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mpt_recognition_candidates"("p_hashes" "jsonb", "p_limit" integer) IS 'MPC-7494. Saved web scans with the specific save consent, inside retention, sharing a fingerprint hash with the given values. Read-only. No contact or user data. service_role only.';



CREATE OR REPLACE FUNCTION "public"."mpt_record_email_event"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone DEFAULT "now"(), "p_bounce_type" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare new_rank int; n int;
begin
  if p_message_id is null or length(p_message_id) = 0 or length(p_message_id) > 200 then return 0; end if;
  if p_status = 'clicked' then
    update public.email_sends s set click_count = s.click_count + 1, first_click_at = coalesce(s.first_click_at, coalesce(p_at, now()))
     where s.provider_message_id = p_message_id;
    get diagnostics n = row_count; return n;
  end if;
  new_rank := case p_status when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 end;
  if new_rank is null then raise exception 'unknown email event status %', p_status using errcode = '22023'; end if;
  if p_bounce_type is not null and p_bounce_type not in ('permanent','transient','undetermined') then raise exception 'unknown bounce type %', p_bounce_type using errcode = '22023'; end if;
  update public.email_sends s
     set status = p_status, status_at = coalesce(p_at, now()),
         bounce_type = case when p_status = 'bounced' then coalesce(p_bounce_type, s.bounce_type) else s.bounce_type end
   where s.provider_message_id = p_message_id
     and new_rank > case coalesce(s.status, '') when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 else -1 end;
  get diagnostics n = row_count; return n;
end $$;


ALTER FUNCTION "public"."mpt_record_email_event"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone, "p_bounce_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_record_email_receipt"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  new_rank int;
  n int;
begin
  new_rank := case p_status when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 end;
  if new_rank is null then raise exception 'unknown receipt status %', p_status using errcode = '22023'; end if;
  if p_message_id is null or length(p_message_id) = 0 or length(p_message_id) > 200 then return 0; end if;
  update public.scans s
     set delivery_status = p_status, delivery_status_at = coalesce(p_at, now())
   where s.resend_message_id = p_message_id
     and new_rank > case coalesce(s.delivery_status, '') when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 else -1 end;
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."mpt_record_email_receipt"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_redeem_dashboard_link"("p_token_hash" "text", "p_session_hash" "text", "p_session_minutes" integer DEFAULT 30, "p_scope" "text" DEFAULT 'dashboard'::"text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare ok boolean;
begin
  if p_session_minutes is null or p_session_minutes < 1 or p_session_minutes > 120 then
    raise exception 'session minutes must be 1-120';
  end if;
  if p_scope is null or p_scope not in ('dashboard', 'footprint') then
    raise exception 'unknown scope';
  end if;
  with l as (
    update public.dashboard_links d
       set redeemed_at = now()
     where d.token_hash = p_token_hash
       and d.scope = p_scope
       and d.redeemed_at is null
       and d.expires_at > now()
       and exists (select 1 from public.profile_snapshots s where s.id = d.snapshot_id and s.expires_at > now())
    returning d.token_hash, d.sender_id, d.snapshot_id, d.scope
  ), s as (
    insert into public.dashboard_sessions (session_hash, link_hash, sender_id, snapshot_id, scope, expires_at)
    select p_session_hash, l.token_hash, l.sender_id, l.snapshot_id, l.scope, now() + make_interval(mins => p_session_minutes) from l
    returning 1
  )
  select exists (select 1 from s) into ok;
  return coalesce(ok, false);
end $$;


ALTER FUNCTION "public"."mpt_redeem_dashboard_link"("p_token_hash" "text", "p_session_hash" "text", "p_session_minutes" integer, "p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_release_deletion_notice"("p_scans_id" "uuid", "p_stage" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  update public.scans set countdown_4h_sent_at = case when p_stage = '4h' then null else countdown_4h_sent_at end,
                          countdown_24h_sent_at = case when p_stage = '24h' then null else countdown_24h_sent_at end
   where id = p_scans_id;
$$;


ALTER FUNCTION "public"."mpt_release_deletion_notice"("p_scans_id" "uuid", "p_stage" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_request_scan"("p_user_id" "uuid", "p_email" "text", "p_request_id" "uuid" DEFAULT NULL::"uuid", "p_window" interval DEFAULT '24:00:00'::interval) RETURNS TABLE("scan_id" "uuid", "duplicate" boolean, "request_id" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
declare
  existing uuid;
  existing_request text;
  created uuid;
begin
  if p_window < interval '1 minute' or p_window > interval '7 days' then raise exception 'window out of range' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mpt_request_scan:' || p_user_id::text, 0));
  select s.id, to_jsonb(s) ->> 'request_id' into existing, existing_request
    from public.scans s where s.user_id = p_user_id and s.created_at >= now() - p_window order by s.created_at asc, s.id asc limit 1;
  if existing is not null then
    return query select existing, true, existing_request;
    return;
  end if;
  if p_request_id is null then
    insert into public.scans (user_id, email_scanned, source) values (p_user_id, p_email, 'web_scan') returning id into created;
  else
    execute 'insert into public.scans (user_id, email_scanned, source, request_id) values ($1, $2, ''web_scan'', $3) returning id' into created using p_user_id, p_email, p_request_id;
  end if;
  return query select created, false, p_request_id::text;
end $_$;


ALTER FUNCTION "public"."mpt_request_scan"("p_user_id" "uuid", "p_email" "text", "p_request_id" "uuid", "p_window" interval) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."scans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email_scanned" "text" NOT NULL,
    "privacy_score" integer,
    "scan_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_freshness" timestamp with time zone,
    "signals_found" integer DEFAULT 0 NOT NULL,
    "risk_level" "text",
    "categories_checked" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "categories_unchecked" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "source" "text" DEFAULT 'web_scan'::"text" NOT NULL,
    "confirmation_sent_at" timestamp with time zone,
    "report_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "report_due_at" timestamp with time zone DEFAULT ("now"() + '48:00:00'::interval) NOT NULL,
    "report_attempts" integer DEFAULT 0 NOT NULL,
    "report_last_error" "text",
    "report_claimed_at" timestamp with time zone,
    "report_sent_at" timestamp with time zone,
    "resend_message_id" "text",
    "mirror_report" "jsonb",
    "followup_stage" integer DEFAULT 0 NOT NULL,
    "followup_last_sent_at" timestamp with time zone,
    "request_id" "uuid",
    "fixed_at" timestamp with time zone,
    "followup_ended" "text",
    "delivery_status" "text",
    "delivery_status_at" timestamp with time zone,
    "email_confirm_required" boolean DEFAULT false NOT NULL,
    "email_confirmed_at" timestamp with time zone,
    "consent_id" "uuid",
    "delete_after" timestamp with time zone,
    "kept_at" timestamp with time zone,
    "countdown_24h_sent_at" timestamp with time zone,
    "countdown_4h_sent_at" timestamp with time zone,
    CONSTRAINT "scans_delivery_status_check" CHECK (("delivery_status" = ANY (ARRAY['sent'::"text", 'delivery_delayed'::"text", 'delivered'::"text", 'bounced'::"text", 'failed'::"text", 'complained'::"text"]))),
    CONSTRAINT "scans_email_scanned_check" CHECK (("char_length"("email_scanned") <= 255)),
    CONSTRAINT "scans_followup_ended_check" CHECK (("followup_ended" = ANY (ARRAY['fixed'::"text", 'unsubscribed'::"text"]))),
    CONSTRAINT "scans_followup_stage_check" CHECK ((("followup_stage" >= 0) AND ("followup_stage" <= 2))),
    CONSTRAINT "scans_privacy_score_check" CHECK ((("privacy_score" >= 0) AND ("privacy_score" <= 100))),
    CONSTRAINT "scans_report_status_check" CHECK (("report_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "scans_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);

ALTER TABLE ONLY "public"."scans" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scans" OWNER TO "postgres";


COMMENT ON TABLE "public"."scans" IS 'MPC-6677. One row per scan submission; also the report job queue (report_status/report_due_at). service_role only.';



COMMENT ON COLUMN "public"."scans"."mirror_report" IS 'MPC-7261. Structured Mirror Report; unchecked categories are listed as not_checked, never scored.';



COMMENT ON COLUMN "public"."scans"."request_id" IS 'MPC-7471-F3. Random per-submit key from the post-scan popup. Lets a retry of the same submit get the original outcome. No personal data.';



COMMENT ON COLUMN "public"."scans"."fixed_at" IS 'MPC-7554: the person said they fixed what the report found (signed link). Ends follow-ups for this report only.';



COMMENT ON COLUMN "public"."scans"."followup_ended" IS 'MPC-7554: follow-ups ended without being sent (fixed | unsubscribed).';



COMMENT ON COLUMN "public"."scans"."delivery_status" IS 'CK-8503: furthest provider receipt seen for the report email (Resend webhook). NULL = no receipt received (not the same as not delivered). Only set via mpt_record_email_receipt().';



COMMENT ON COLUMN "public"."scans"."delivery_status_at" IS 'CK-8503: provider timestamp of the event that set delivery_status.';



COMMENT ON COLUMN "public"."scans"."email_confirm_required" IS 'MPC-9813. true = the report and all identifier-based checks wait for the click-to-confirm (email_confirmed_at). false for every scan created before the gate existed.';



COMMENT ON COLUMN "public"."scans"."email_confirmed_at" IS 'MPC-9813. When the person opened the confirmation link and pressed the confirm button.';



COMMENT ON COLUMN "public"."scans"."delete_after" IS 'MPC-9890. When this free record is deleted: delivered receipt time (else report_sent_at) + N hours. NULL = kept, or no report sent yet.';



COMMENT ON COLUMN "public"."scans"."kept_at" IS 'MPC-9890. The person pressed Keep (one-click link in the report or countdown email). Never on the deletion path.';



CREATE OR REPLACE FUNCTION "public"."mpt_scan_is_kept"("p_scan" "public"."scans") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select p_scan.kept_at is not null
      or exists (select 1 from public.account_scans l where l.scans_id = p_scan.id)
      or exists (select 1 from public.accounts a where a.email = lower(p_scan.email_scanned));
$$;


ALTER FUNCTION "public"."mpt_scan_is_kept"("p_scan" "public"."scans") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_scan_period"() RETURNS "date"
    LANGUAGE "sql" STABLE
    AS $$ select (date_trunc('month', now() at time zone 'UTC'))::date $$;


ALTER FUNCTION "public"."mpt_scan_period"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_scan_report_alert"("p_test" boolean DEFAULT false) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'net', 'vault', 'pg_temp'
    AS $$
declare
  h record;
  st record;
  v_token text;
  v_chat  text;
  v_msg   text;
  v_send  boolean := false;
  v_recovered boolean := false;
begin
  select * into h from public.mpt_scan_report_health();
  insert into public.mpt_alert_state (name) values ('scan_report') on conflict (name) do nothing;
  select * into st from public.mpt_alert_state where name = 'scan_report' for update;

  if p_test then
    v_send := true;
  elsif not h.healthy then
    v_send := (not st.is_open) or st.last_sent_at is null or st.last_sent_at < now() - interval '1 hour';
  elsif st.is_open then
    v_send := true;
    v_recovered := true;
  end if;

  if not v_send then
    return case when h.healthy then 'healthy: no alert sent' else 'unhealthy: alert already sent within the last hour' end;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_alert_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_alert_chat_id';
  if v_token is null or v_chat is null then
    raise warning 'mpt_scan_report_alert: telegram secrets missing in Vault';
    return 'secrets missing';
  end if;

  v_msg := case when p_test then '✅ TEST: MPT scan report alerting works. '
                when v_recovered then '✅ MPT scan reports recovered. '
                else '⚠️ MPT scan reports STUCK. ' end
        || 'stuck_over_15min=' || h.stuck_count
        || ', oldest_stuck_min=' || h.oldest_stuck_minutes
        || ', failed_24h=' || h.failed_24h
        || ', no_confirmation_over_5min=' || h.unconfirmed_count;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', v_chat, 'text', v_msg)
  );

  if not p_test then
    update public.mpt_alert_state
       set is_open = not v_recovered, last_sent_at = now(), updated_at = now()
     where name = 'scan_report';
  end if;
  return 'alert queued';
end;
$$;


ALTER FUNCTION "public"."mpt_scan_report_alert"("p_test" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_scan_report_health"() RETURNS TABLE("healthy" boolean, "stuck_count" integer, "oldest_stuck_minutes" integer, "failed_24h" integer, "unconfirmed_count" integer, "checked_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with s as (
    select
      count(*) filter (where report_status in ('pending', 'processing') and created_at < now() - interval '15 minutes') as stuck,
      max(extract(epoch from (now() - created_at)) / 60) filter (where report_status in ('pending', 'processing') and created_at < now() - interval '15 minutes') as oldest,
      count(*) filter (where report_status = 'failed' and created_at > now() - interval '24 hours' and coalesce(report_last_error, '') not like 'cancelled:%') as failed,
      count(*) filter (where confirmation_sent_at is null and report_status <> 'failed' and created_at < now() - interval '5 minutes') as unconfirmed
    from public.scans
    where created_at > now() - interval '7 days'
  )
  select (stuck = 0 and failed = 0 and unconfirmed = 0), stuck::integer, coalesce(oldest, 0)::integer, failed::integer, unconfirmed::integer, now()
  from s;
$$;


ALTER FUNCTION "public"."mpt_scan_report_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_scans_delete_children"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  delete from public.scan_recipient_log where scan_id = old.id::text;
  if old.consent_id is not null then delete from public.scan_consents where id = old.consent_id; end if;
  return old;
end $$;


ALTER FUNCTION "public"."mpt_scans_delete_children"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_scans_set_delete_after"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n int; base timestamptz;
begin
  if new.kept_at is not null then new.delete_after := null; return new; end if;
  if new.report_sent_at is null then return new; end if;
  select c.n_hours into n from public.scan_consents c where c.id = new.consent_id;
  if n is null then select p.n_hours into n from public.free_record_policy p where p.id; end if;
  n := coalesce(n, 168);
  base := case when new.delivery_status = 'delivered' and new.delivery_status_at is not null then new.delivery_status_at else new.report_sent_at end;
  new.delete_after := greatest(base + make_interval(hours => n), coalesce(new.delete_after, '-infinity'::timestamptz));
  return new;
end $$;


ALTER FUNCTION "public"."mpt_scans_set_delete_after"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_set_plan"("p_account" "uuid", "p_plan" "text", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_old text;
begin
  if p_plan is null or public.mpt_tier_rank(p_plan) is null then raise exception 'unknown plan' using errcode = '22023'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  select plan into v_old from public.accounts where id = p_account for update;
  if v_old is null then return jsonb_build_object('changed', false, 'reason', 'no_account'); end if;
  if v_old = p_plan then return jsonb_build_object('changed', false, 'plan', v_old, 'reason', 'already'); end if;
  update public.accounts set plan = p_plan where id = p_account;
  insert into public.account_plan_log (account_id, old_plan, new_plan, reason) values (p_account, v_old, p_plan, left(trim(p_reason), 200));
  return jsonb_build_object('changed', true, 'old_plan', v_old, 'plan', p_plan);
end $$;


ALTER FUNCTION "public"."mpt_set_plan"("p_account" "uuid", "p_plan" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$begin new.updated_at := now(); return new; end$$;


ALTER FUNCTION "public"."mpt_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_social_record"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean DEFAULT NULL::boolean, "p_event_key" "text" DEFAULT NULL::"text", "p_occurred_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_source_ref" "text" DEFAULT NULL::"text", "p_data" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id uuid;
  v_event uuid;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_event is null or p_event not in ('dm','follow','like','share','mention','mirror_consent') then
    raise exception 'unknown social event: %', p_event using errcode = '22023';
  end if;
  -- ensure the contact exists; counters move only when an event row is actually added below
  insert into public.social_contacts (platform, platform_user_id, handle, follows_us, event_count, first_seen_at, last_seen_at)
    values (p_platform, p_user_id, nullif(p_handle, ''), p_follows_us, 0, least(v_at, now()), least(v_at, now()))
  on conflict (platform, platform_user_id) do update set platform = excluded.platform
  returning id into v_id;

  insert into public.social_events (contact_id, event_type, event_key, occurred_at, source_ref, data, created_at)
    values (v_id, p_event, p_event_key, p_occurred_at, nullif(p_source_ref, ''), p_data, now())
  on conflict (contact_id, event_key) where event_key is not null do nothing
  returning id into v_event;

  if v_event is null then
    return jsonb_build_object('contact_id', v_id, 'duplicate', true);
  end if;

  update public.social_contacts c
     set handle = coalesce(nullif(p_handle, ''), c.handle),
         follows_us = coalesce(p_follows_us, c.follows_us),
         first_seen_at = least(c.first_seen_at, v_at),
         last_seen_at = greatest(c.last_seen_at, least(v_at, now())),
         event_count = c.event_count + 1,
         retain_until = case when c.platform = 'telegram' then null else now() + interval '2 years' end,
         hubspot_synced_at = null
   where c.id = v_id;
  return jsonb_build_object('contact_id', v_id, 'duplicate', false);
end $$;


ALTER FUNCTION "public"."mpt_social_record"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean, "p_event_key" "text", "p_occurred_at" timestamp with time zone, "p_source_ref" "text", "p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_social_touch"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  if p_event is null or p_event not in ('dm','follow','like','share','mention','mirror_consent') then
    raise exception 'unknown social event: %', p_event using errcode = '22023';
  end if;
  insert into public.social_contacts (platform, platform_user_id, handle, follows_us, event_count)
    values (p_platform, p_user_id, nullif(p_handle, ''), p_follows_us, 1)
  on conflict (platform, platform_user_id) do update
    set handle = coalesce(nullif(excluded.handle, ''), public.social_contacts.handle),
        follows_us = coalesce(excluded.follows_us, public.social_contacts.follows_us),
        last_seen_at = now(),
        event_count = public.social_contacts.event_count + 1,
        retain_until = now() + interval '2 years',
        hubspot_synced_at = null
  returning id into v_id;
  insert into public.social_events (contact_id, event_type) values (v_id, p_event);
  return jsonb_build_object('contact_id', v_id);
end $$;


ALTER FUNCTION "public"."mpt_social_touch"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_tier_rank"("p_tier" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$ select case p_tier when 'free' then 0 when 'basic' then 1 when 'pro' then 2 when 'executive' then 3 else null end $$;


ALTER FUNCTION "public"."mpt_tier_rank"("p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_users_opt_out_to_suppression"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.email_opt_out_at is not null and new.email is not null then
    insert into public.email_suppressions (email_hash, source)
    values (encode(sha256(convert_to(lower(btrim(new.email)), 'UTF8')), 'hex'), 'users_opt_out')
    on conflict (email_hash) do nothing;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."mpt_users_opt_out_to_suppression"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_visit_log_policy"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('country', country, 'ip_mode', ip_mode, 'enabled', enabled) order by country), '[]'::jsonb)
    from visit_log.country_policy
$$;


ALTER FUNCTION "public"."mpt_visit_log_policy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_visit_log_purge_health"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$ select visit_log.purge_health() $$;


ALTER FUNCTION "public"."mpt_visit_log_purge_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_visit_log_record"("p_country" "text" DEFAULT NULL::"text", "p_ip" "text" DEFAULT NULL::"text", "p_referrer" "text" DEFAULT NULL::"text", "p_utm_source" "text" DEFAULT NULL::"text", "p_utm_medium" "text" DEFAULT NULL::"text", "p_utm_campaign" "text" DEFAULT NULL::"text", "p_utm_content" "text" DEFAULT NULL::"text", "p_device" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$ select visit_log.record_visit(p_country, p_ip, p_referrer, p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_device) $$;


ALTER FUNCTION "public"."mpt_visit_log_record"("p_country" "text", "p_ip" "text", "p_referrer" "text", "p_utm_source" "text", "p_utm_medium" "text", "p_utm_campaign" "text", "p_utm_content" "text", "p_device" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mpt_web_scans_delete_children"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  delete from public.scan_consents where scan_id = old.id;
  delete from public.scan_recipient_log where scan_id = old.id::text;
  return old;
end $$;


ALTER FUNCTION "public"."mpt_web_scans_delete_children"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_expired_conversation_state"() RETURNS bigint
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  with gone as (delete from public.mpt_conversation_state where expires_at < now() returning 1)
  select count(*) from gone;
$$;


ALTER FUNCTION "public"."purge_expired_conversation_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollup_and_purge_hexagon_events"("retention" interval DEFAULT '90 days'::interval) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  cutoff  timestamptz := now() - retention;
  removed bigint;
begin
  if retention < interval '1 day' then raise exception 'retention must be at least one day'; end if;
  with old as (select * from public.mpt_hexagon_events where created_at < cutoff),
  shown as (
    select created_at::date as day, hexagon_id, source, config_version, count(distinct person_key)::int as n
    from old where event_type = 'shown' group by 1, 2, 3, 4
  ),
  first_answer as (
    select distinct on (person_key, hexagon_id, source, scan_window) *
    from old where event_type = 'answer'
    order by person_key, hexagon_id, source, scan_window, created_at
  ),
  answered as (
    select created_at::date as day, hexagon_id, source, config_version,
      count(*) filter (where answer = 'yes_me')::int   as yes_me,
      count(*) filter (where answer = 'not_me')::int   as not_me,
      count(*) filter (where answer = 'disputed')::int as disputed,
      count(*) filter (where answer = 'kept')::int     as kept
    from first_answer group by 1, 2, 3, 4
  )
  insert into public.mpt_hexagon_event_rollups as r (day, hexagon_id, source, config_version, shown_people, yes_me, not_me, disputed, kept)
  select coalesce(s.day, a.day), coalesce(s.hexagon_id, a.hexagon_id), coalesce(s.source, a.source), coalesce(s.config_version, a.config_version),
         coalesce(s.n, 0), coalesce(a.yes_me, 0), coalesce(a.not_me, 0), coalesce(a.disputed, 0), coalesce(a.kept, 0)
  from shown s full join answered a on (s.day, s.hexagon_id, s.source, s.config_version) = (a.day, a.hexagon_id, a.source, a.config_version)
  on conflict (day, hexagon_id, source, config_version) do update set
    shown_people = r.shown_people + excluded.shown_people, yes_me = r.yes_me + excluded.yes_me, not_me = r.not_me + excluded.not_me,
    disputed = r.disputed + excluded.disputed, kept = r.kept + excluded.kept;
  with gone as (delete from public.mpt_hexagon_events where created_at < cutoff returning 1) select count(*) into removed from gone;
  return removed;
end $$;


ALTER FUNCTION "public"."rollup_and_purge_hexagon_events"("retention" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_append_inbound"("p_case_id" "uuid", "p_event_id" "text", "p_text" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_channel text; v_inserted integer;
begin
  select channel into v_channel from public.support_cases where id = p_case_id;
  if v_channel is null then raise exception 'no such case'; end if;
  insert into public.support_inbound_events (channel, provider_event_id, case_id) values (v_channel, p_event_id, p_case_id) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return true; end if;
  insert into public.support_messages (case_id, direction, author, provider_event_id, body) values (p_case_id, 'inbound', 'customer', p_event_id, p_text);
  return false;
end $$;


ALTER FUNCTION "public"."support_append_inbound"("p_case_id" "uuid", "p_event_id" "text", "p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_create_case_from_event"("p_channel" "text", "p_event_id" "text", "p_thread_key" "text", "p_sender" "text", "p_text" "text", "p_ref" "text", "p_policy" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_case public.support_cases; v_existing uuid; v_inserted integer;
begin
  select case_id into v_existing from public.support_inbound_events where channel = p_channel and provider_event_id = p_event_id;
  if v_existing is not null then
    select * into v_case from public.support_cases where id = v_existing;
    return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true);
  end if;
  insert into public.support_cases (ref, channel, thread_key, sender_handle, identity_level, policy_version)
  values (p_ref, p_channel, p_thread_key, p_sender, case when p_sender is null then 'anonymous' else 'channel_asserted' end, p_policy)
  returning * into v_case;
  insert into public.support_inbound_events (channel, provider_event_id, case_id) values (p_channel, p_event_id, v_case.id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    -- lost a race with a concurrent identical event: drop our case and return theirs
    delete from public.support_cases where id = v_case.id;
    select * into v_case from public.support_cases where id = (select case_id from public.support_inbound_events where channel = p_channel and provider_event_id = p_event_id);
    return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true);
  end if;
  insert into public.support_messages (case_id, direction, author, provider_event_id, body) values (v_case.id, 'inbound', 'customer', p_event_id, p_text);
  return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', false);
end $$;


ALTER FUNCTION "public"."support_create_case_from_event"("p_channel" "text", "p_event_id" "text", "p_thread_key" "text", "p_sender" "text", "p_text" "text", "p_ref" "text", "p_policy" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_issue_proof"("p_token_hash" "text", "p_subject" "text", "p_tenant" "text", "p_ttl_seconds" integer) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then raise exception 'proof ttl must be 60..3600 seconds'; end if;
  insert into public.support_proofs (token_hash, subject_id, tenant_id, expires_at)
  values (p_token_hash, p_subject, p_tenant, now() + make_interval(secs => p_ttl_seconds)) returning id into v_id;
  return v_id;
end $$;


ALTER FUNCTION "public"."support_issue_proof"("p_token_hash" "text", "p_subject" "text", "p_tenant" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_purge_expired"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_text integer; v_cases integer; v_proofs integer; v_usage integer;
begin
  update public.support_messages set body = '[removed after the 90-day retention period]'
   where created_at < now() - interval '90 days' and body <> '[removed after the 90-day retention period]';
  get diagnostics v_text = row_count;
  delete from public.support_cases where updated_at < now() - interval '6 months';
  get diagnostics v_cases = row_count;
  delete from public.support_proofs where expires_at < now() - interval '1 day';
  get diagnostics v_proofs = row_count;
  delete from public.support_usage where at < now() - interval '7 days';
  get diagnostics v_usage = row_count;
  return jsonb_build_object('message_text_removed', v_text, 'cases_deleted', v_cases, 'proofs_deleted', v_proofs, 'usage_deleted', v_usage);
end $$;


ALTER FUNCTION "public"."support_purge_expired"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_redeem_proof"("p_token_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v record;
begin
  update public.support_proofs set consumed_at = now()
   where token_hash = p_token_hash and consumed_at is null and expires_at > now()
   returning subject_id, tenant_id into v;
  if not found then return null; end if;
  return jsonb_build_object('subject_id', v.subject_id, 'tenant_id', v.tenant_id);
end $$;


ALTER FUNCTION "public"."support_redeem_proof"("p_token_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."withdraw_deletion_consent"("p_consent_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
  update public.deletion_consents set withdrawn_at = coalesce(withdrawn_at, now()) where id = p_consent_id;
  if not found then raise exception 'consent_not_found'; end if;
  update public.eradication_jobs set status = 'cancelled', finished_at = now() where consent_id = p_consent_id and status = 'queued';
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."withdraw_deletion_consent"("p_consent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "visit_log"."apply_policy"("p_country" "text", "p_dry_run" boolean DEFAULT false, "p_drop_partition" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $_$
declare def record; pol record; c text; cs text[]; changed integer := 0; deleted integer := 0; n integer; pr record; part text; dropped boolean := false;
begin
  select * into def from visit_log.country_policy where country = '*';
  if not found then raise exception 'visit_log.apply_policy: DEFAULT policy row missing'; end if;
  if p_country = '*' then
    select coalesce(array_agg(distinct v.country), '{}') into cs from visit_log.visits v where not exists (select 1 from visit_log.country_policy p where p.country = v.country);
  elsif p_country ~ '^[A-Z]{2}$' then cs := array[p_country];
  else raise exception 'visit_log.apply_policy: bad country %', p_country;
  end if;
  foreach c in array cs loop
    select * into pol from visit_log.country_policy where country = c;
    if not found then pol := def; end if;
    if not pol.enabled then
      select count(*) into n from visit_log.visits where country = c;
      deleted := deleted + n;
      if not p_dry_run then
        delete from visit_log.visits where country = c;
        part := 'visits_' || lower(c);
        if p_drop_partition and to_regclass(format('visit_log.%I', part)) is not null then execute format('drop table visit_log.%I', part); dropped := true; end if;
      end if;
      continue;
    end if;
    if pol.ip_mode = 'none' then
      select count(*) into n from visit_log.visits where country = c and ip is not null;
      if not p_dry_run then update visit_log.visits set ip = null, ip_mode = 'none' where country = c and (ip is not null or ip_mode <> 'none'); end if;
    elsif pol.ip_mode = 'truncated' then
      select count(*) into n from visit_log.visits where country = c and ip_mode = 'raw';
      if not p_dry_run then update visit_log.visits set ip = visit_log.shape_ip(host(ip), 'truncated'), ip_mode = 'truncated' where country = c and ip_mode = 'raw'; end if;
    else n := 0;
    end if;
    changed := changed + n;
    select * into pr from visit_log.purge_country(c, pol.retention_days, pol.derived_retention_days, p_dry_run);
    deleted := deleted + pr.rows_deleted;
  end loop;
  insert into visit_log.purge_log (dry_run, country, ips_nulled, rows_deleted) values (p_dry_run, p_country, changed, deleted);
  return jsonb_build_object('country', p_country, 'dry_run', p_dry_run, 'ips_reshaped', changed, 'rows_deleted', deleted, 'partition_dropped', dropped);
end $_$;


ALTER FUNCTION "visit_log"."apply_policy"("p_country" "text", "p_dry_run" boolean, "p_drop_partition" boolean) OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."country_policy_partition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $$
begin
  if new.country <> '*' then perform visit_log.ensure_partition(new.country); end if;
  return new;
end $$;


ALTER FUNCTION "visit_log"."country_policy_partition"() OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."ensure_partition"("p_country" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $_$
declare part text;
begin
  if p_country is null or p_country !~ '^[A-Z]{2}$' then raise exception 'visit_log.ensure_partition: bad country %', p_country; end if;
  part := 'visits_' || lower(p_country);
  if to_regclass(format('visit_log.%I', part)) is not null then return part; end if;
  create temp table _vl_move on commit drop as select * from visit_log.visits where country = p_country;
  delete from visit_log.visits where country = p_country;
  execute format('create table visit_log.%I partition of visit_log.visits for values in (%L)', part, p_country);
  execute format('grant select, insert, update, delete on visit_log.%I to visit_log_writer', part);
  execute format('alter table visit_log.%I enable row level security', part);
  execute format('alter table visit_log.%I force row level security', part);
  insert into visit_log.visits select * from pg_temp._vl_move;
  drop table if exists pg_temp._vl_move;
  return part;
end $_$;


ALTER FUNCTION "visit_log"."ensure_partition"("p_country" "text") OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."purge"("p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $$
declare def record; r record; n record; tot_ips integer := 0; tot_del integer := 0; countries integer := 0;
begin
  select * into def from visit_log.country_policy where country = '*';
  if not found then raise exception 'visit_log.purge: DEFAULT policy row missing'; end if;
  for r in
    select c.country, coalesce(p.retention_days, def.retention_days) as ip_days, coalesce(p.derived_retention_days, def.derived_retention_days) as derived_days
      from (select country from visit_log.country_policy where country <> '*'
            union select distinct country from visit_log.visits) c
      left join visit_log.country_policy p on p.country = c.country
  loop
    select * into n from visit_log.purge_country(r.country, r.ip_days, r.derived_days, p_dry_run);
    countries := countries + 1; tot_ips := tot_ips + n.ips_nulled; tot_del := tot_del + n.rows_deleted;
    if n.ips_nulled > 0 or n.rows_deleted > 0 then
      insert into visit_log.purge_log (dry_run, country, ips_nulled, rows_deleted) values (p_dry_run, r.country, n.ips_nulled, n.rows_deleted);
    end if;
  end loop;
  insert into visit_log.purge_log (dry_run, country, ips_nulled, rows_deleted) values (p_dry_run, '*', tot_ips, tot_del);
  return jsonb_build_object('dry_run', p_dry_run, 'countries', countries, 'ips_nulled', tot_ips, 'rows_deleted', tot_del, 'ran_at', now());
end $$;


ALTER FUNCTION "visit_log"."purge"("p_dry_run" boolean) OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."purge_country"("p_country" "text", "p_ip_days" integer, "p_derived_days" integer, "p_dry_run" boolean, OUT "ips_nulled" integer, OUT "rows_deleted" integer) RETURNS "record"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $$
begin
  if p_dry_run then
    select count(*) into ips_nulled from visit_log.visits where country = p_country and ip is not null and ts < now() - make_interval(days => p_ip_days);
    select count(*) into rows_deleted from visit_log.visits where country = p_country and ts < now() - make_interval(days => p_derived_days);
  else
    update visit_log.visits set ip = null where country = p_country and ip is not null and ts < now() - make_interval(days => p_ip_days);
    get diagnostics ips_nulled = row_count;
    delete from visit_log.visits where country = p_country and ts < now() - make_interval(days => p_derived_days);
    get diagnostics rows_deleted = row_count;
  end if;
end $$;


ALTER FUNCTION "visit_log"."purge_country"("p_country" "text", "p_ip_days" integer, "p_derived_days" integer, "p_dry_run" boolean, OUT "ips_nulled" integer, OUT "rows_deleted" integer) OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."purge_health"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $$
  select jsonb_build_object(
    'last_run', m.last_run,
    'age_hours', case when m.last_run is null then null else round((extract(epoch from now() - m.last_run) / 3600)::numeric, 1) end,
    'degraded', m.last_run is null or m.last_run < now() - interval '26 hours',
    'limit_hours', 26)
  from (select max(run_at) as last_run from visit_log.purge_log where country = '*' and not dry_run) m
$$;


ALTER FUNCTION "visit_log"."purge_health"() OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."record_visit"("p_country" "text", "p_ip" "text", "p_referrer" "text", "p_utm_source" "text", "p_utm_medium" "text", "p_utm_campaign" "text", "p_utm_content" "text", "p_device" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'visit_log'
    AS $_$
declare c text; pol record;
begin
  c := upper(coalesce(nullif(p_country, ''), 'XX'));
  if c !~ '^[A-Z]{2}$' then c := 'XX'; end if;
  select * into pol from visit_log.country_policy where country = c;
  if not found then select * into pol from visit_log.country_policy where country = '*'; end if;
  if not found then return false; end if;
  if not pol.enabled then return false; end if;
  insert into visit_log.visits (country, ip, ip_mode, referrer, utm_source, utm_medium, utm_campaign, utm_content, device)
  values (c, visit_log.shape_ip(p_ip, pol.ip_mode), pol.ip_mode, left(p_referrer, 512), left(p_utm_source, 128), left(p_utm_medium, 128),
          left(p_utm_campaign, 128), left(p_utm_content, 128),
          case when p_device in ('mobile', 'desktop', 'tablet') then p_device else 'unknown' end);
  return true;
end $_$;


ALTER FUNCTION "visit_log"."record_visit"("p_country" "text", "p_ip" "text", "p_referrer" "text", "p_utm_source" "text", "p_utm_medium" "text", "p_utm_campaign" "text", "p_utm_content" "text", "p_device" "text") OWNER TO "visit_log_writer";


CREATE OR REPLACE FUNCTION "visit_log"."shape_ip"("p_ip" "text", "p_mode" "text") RETURNS "inet"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog'
    AS $$
declare a inet;
begin
  if p_ip is null or p_mode = 'none' then return null; end if;
  begin a := p_ip::inet; exception when others then return null; end;
  if p_mode = 'raw' then return host(a)::inet; end if;
  return host(network(set_masklen(a, case family(a) when 4 then 24 else 48 end)))::inet;
end $$;


ALTER FUNCTION "visit_log"."shape_ip"("p_ip" "text", "p_mode" "text") OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "ledger"."backfill_batch" (
    "backfill_batch_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_name" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "ledger"."backfill_batch" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."backfill_batch" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."data_point" (
    "data_point_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "type_code" "text" NOT NULL,
    "subject_ref" "text",
    "value" "jsonb",
    "status" "text" NOT NULL,
    "confidence" smallint,
    "source" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "method" "text" NOT NULL,
    "source_name" "text",
    "input_ref" "text",
    "collector_version" "text",
    "provenance_extra" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "locale" "text",
    "observed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "supersedes_id" "uuid",
    "retain_until" timestamp with time zone,
    "legacy_ref" "text",
    "backfill_batch_id" "uuid",
    CONSTRAINT "data_point_backfill_tag" CHECK ((("legacy_ref" IS NULL) = ("backfill_batch_id" IS NULL))),
    CONSTRAINT "data_point_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "data_point_confidence_check" CHECK ((("confidence" >= 0) AND ("confidence" <= 100))),
    CONSTRAINT "data_point_expiry_after_observation" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "observed_at"))),
    CONSTRAINT "data_point_h10_hundred_is_earned" CHECK ((("confidence" IS DISTINCT FROM 100) OR (("source" = 'checked'::"text") AND ("method" = 'exact_lookup'::"text")) OR (("source" = 'taken'::"text") AND ("method" = 'webhook'::"text")))),
    CONSTRAINT "data_point_h2_honest_unknown" CHECK (((("status" = ANY (ARRAY['not_checked'::"text", 'check_failed'::"text"])) AND ("confidence" IS NULL) AND ("value" IS NULL)) OR (("status" = ANY (ARRAY['found'::"text", 'clear'::"text"])) AND ("confidence" IS NOT NULL) AND ("value" IS NOT NULL)))),
    CONSTRAINT "data_point_h4_provenance" CHECK (((("source" <> 'checked'::"text") OR (NULLIF("btrim"("source_name"), ''::"text") IS NOT NULL)) AND (("source" <> 'given'::"text") OR (NULLIF("btrim"("input_ref"), ''::"text") IS NOT NULL)))),
    CONSTRAINT "data_point_locale_check" CHECK ((("locale" IS NULL) OR ("locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text"))),
    CONSTRAINT "data_point_method_check" CHECK (("method" = ANY (ARRAY['webhook'::"text", 'button_tap'::"text", 'free_text'::"text", 'exact_lookup'::"text", 'heuristic'::"text", 'estimate'::"text", 'scrape'::"text", 'local_analysis'::"text", 'mpt_score'::"text", 'legacy_import'::"text"]))),
    CONSTRAINT "data_point_source_check" CHECK (("source" = ANY (ARRAY['taken'::"text", 'given'::"text", 'checked'::"text"]))),
    CONSTRAINT "data_point_status_check" CHECK (("status" = ANY (ARRAY['found'::"text", 'clear'::"text", 'not_checked'::"text", 'check_failed'::"text"]))),
    CONSTRAINT "data_point_subject_ref_check" CHECK ((("subject_ref" IS NULL) OR ("char_length"("subject_ref") <= 200)))
);

ALTER TABLE ONLY "ledger"."data_point" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."data_point" OWNER TO "postgres";


COMMENT ON TABLE "ledger"."data_point" IS 'One observation of one claim by one source. Append-only (H5). Class (Verified / Self-attested / Inferred / Unknown) is never stored; the guard computes it.';



COMMENT ON COLUMN "ledger"."data_point"."retain_until" IS 'Reserved and left unpopulated: retention policy is deferred (design Part 11).';



CREATE TABLE IF NOT EXISTS "ledger"."data_point_type" (
    "code" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "value_schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sensitivity" "text" DEFAULT 'medium'::"text" NOT NULL,
    "max_age" interval,
    "default_check_confidence" smallint,
    "clean_phrase_allowed" boolean DEFAULT false NOT NULL,
    "phrase_key_base" "text" NOT NULL,
    "untyped" boolean DEFAULT false NOT NULL,
    "note" "text",
    "hexagon_id" "text",
    "channel" "text",
    "channel_group" "text",
    "arrival" "text",
    "risk_tier" "text",
    "build_state" "text",
    "access_class" "text",
    "risk_applicable" boolean DEFAULT false NOT NULL,
    "consequence_key_base" "text",
    "consequence_version" integer,
    "catalogue_version" "text",
    "claim_group" "text",
    CONSTRAINT "data_point_type_code_check" CHECK (("code" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'::"text")),
    CONSTRAINT "data_point_type_consequence_key_shape" CHECK ((("consequence_key_base" IS NULL) OR ("consequence_key_base" ~ '^[a-z0-9_.]+$'::"text"))),
    CONSTRAINT "data_point_type_consequence_pair" CHECK ((("consequence_key_base" IS NULL) = ("consequence_version" IS NULL))),
    CONSTRAINT "data_point_type_default_check_confidence_check" CHECK ((("default_check_confidence" IS NULL) OR (("default_check_confidence" >= 0) AND ("default_check_confidence" <= 100)))),
    CONSTRAINT "data_point_type_hexagon_shape" CHECK (((("hexagon_id" IS NULL) AND (NOT "risk_applicable")) OR (("hexagon_id" IS NOT NULL) AND ("channel" IS NOT NULL) AND ("channel_group" IS NOT NULL) AND ("arrival" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text"])) AND ("risk_tier" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])) AND ("build_state" = ANY (ARRAY['built'::"text", 'not_built'::"text"])) AND ("access_class" = ANY (ARRAY['ok'::"text", 'off'::"text", 'verify'::"text", 'signin'::"text", 'paid'::"text", 'partner'::"text", 'owner_decision'::"text", 'not_allowed'::"text"]))))),
    CONSTRAINT "data_point_type_max_age_check" CHECK ((("max_age" IS NULL) OR ("max_age" > '00:00:00'::interval))),
    CONSTRAINT "data_point_type_phrase_key_base_check" CHECK (("phrase_key_base" ~ '^[a-z0-9_]+$'::"text")),
    CONSTRAINT "data_point_type_scope_check" CHECK (("scope" = ANY (ARRAY['number'::"text", 'person'::"text", 'device'::"text", 'account'::"text", 'scan'::"text"]))),
    CONSTRAINT "data_point_type_sensitivity_check" CHECK (("sensitivity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);

ALTER TABLE ONLY "ledger"."data_point_type" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."data_point_type" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."domain_map" (
    "taxonomy" "text" NOT NULL,
    "source_category" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "map_state" "text" DEFAULT 'proposed'::"text" NOT NULL,
    CONSTRAINT "domain_map_map_state_check" CHECK (("map_state" = ANY (ARRAY['proposed'::"text", 'approved'::"text"])))
);

ALTER TABLE ONLY "ledger"."domain_map" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."domain_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."identity_link" (
    "link_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_a" "uuid" NOT NULL,
    "person_b" "uuid" NOT NULL,
    "confidence" smallint NOT NULL,
    "basis" "text" NOT NULL,
    "state" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    CONSTRAINT "identity_link_check" CHECK (("person_a" <> "person_b")),
    CONSTRAINT "identity_link_confidence_check" CHECK ((("confidence" >= 0) AND ("confidence" <= 100))),
    CONSTRAINT "identity_link_state_check" CHECK (("state" = ANY (ARRAY['proposed'::"text", 'confirmed'::"text", 'rejected'::"text"])))
);

ALTER TABLE ONLY "ledger"."identity_link" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."identity_link" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."person" (
    "person_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'provisional'::"text" NOT NULL,
    "merged_into" "uuid",
    "primary_locale" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "person_check" CHECK ((("status" = 'merged'::"text") = ("merged_into" IS NOT NULL))),
    CONSTRAINT "person_check1" CHECK (("merged_into" IS DISTINCT FROM "person_id")),
    CONSTRAINT "person_primary_locale_check" CHECK ((("primary_locale" IS NULL) OR ("primary_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text"))),
    CONSTRAINT "person_status_check" CHECK (("status" = ANY (ARRAY['provisional'::"text", 'active'::"text", 'merged'::"text", 'erased'::"text"])))
);

ALTER TABLE ONLY "ledger"."person" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."person" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."person_identifier" (
    "identifier_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "id_type" "text" NOT NULL,
    "id_value" "text" NOT NULL,
    "proof_state" "text" DEFAULT 'unproven'::"text" NOT NULL,
    "proven_at" timestamp with time zone,
    "proof_method" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "person_identifier_check" CHECK ((("proof_state" <> 'proven'::"text") OR (("proven_at" IS NOT NULL) AND ("proof_method" IS NOT NULL)))),
    CONSTRAINT "person_identifier_check1" CHECK ((("id_type" <> 'wa_id'::"text") OR ("id_value" ~ '^\+[1-9][0-9]{5,14}$'::"text"))),
    CONSTRAINT "person_identifier_check2" CHECK ((("id_type" <> 'email_hash'::"text") OR ("id_value" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "person_identifier_check3" CHECK ((("id_type" <> 'telegram_id'::"text") OR ("id_value" ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'::"text"))),
    CONSTRAINT "person_identifier_id_type_check" CHECK (("id_type" = ANY (ARRAY['wa_id'::"text", 'telegram_id'::"text", 'email_hash'::"text", 'lead_id'::"text", 'conversation_id'::"text", 'web_scan_id'::"text", 'scan_id'::"text", 'session_id'::"text", 'user_id'::"text", 'social_x'::"text"]))),
    CONSTRAINT "person_identifier_id_value_check" CHECK ((("char_length"("id_value") >= 1) AND ("char_length"("id_value") <= 200))),
    CONSTRAINT "person_identifier_proof_state_check" CHECK (("proof_state" = ANY (ARRAY['unproven'::"text", 'claimed'::"text", 'proven'::"text"])))
);

ALTER TABLE ONLY "ledger"."person_identifier" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."person_identifier" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."render_log" (
    "render_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid",
    "kind" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "locale" "text",
    "type_code" "text",
    "subject_ref" "text",
    "class" "text" NOT NULL,
    "phrase_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "data_point_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "guard_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "render_log_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "render_log_class_check" CHECK (("class" = ANY (ARRAY['verified'::"text", 'self_attested'::"text", 'inferred'::"text", 'unknown'::"text"]))),
    CONSTRAINT "render_log_kind_check" CHECK (("kind" = ANY (ARRAY['claim'::"text", 'progress'::"text", 'consequence'::"text"])))
);

ALTER TABLE ONLY "ledger"."render_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."render_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."report_profile" (
    "profile" "text" NOT NULL,
    "description" "text" NOT NULL,
    "defined" boolean DEFAULT true NOT NULL,
    CONSTRAINT "report_profile_profile_check" CHECK (("profile" ~ '^[a-z0-9_]+$'::"text"))
);

ALTER TABLE ONLY "ledger"."report_profile" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."report_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."report_profile_item" (
    "profile" "text" NOT NULL,
    "type_code" "text" NOT NULL,
    "subject_ref" "text" DEFAULT ''::"text" NOT NULL
);

ALTER TABLE ONLY "ledger"."report_profile_item" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."report_profile_item" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ledger"."risk_decision_event" (
    "decision_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "type_code" "text" NOT NULL,
    "subject_key" "text" DEFAULT ''::"text" NOT NULL,
    "scan_key" "text" NOT NULL,
    "data_point_id" "uuid" NOT NULL,
    "value_hash" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "from_state" "text" NOT NULL,
    "to_state" "text" NOT NULL,
    "basis" "text" NOT NULL,
    "education_id" "uuid",
    "input_ref" "text",
    "evidence_data_point_id" "uuid",
    "render_id" "uuid",
    "channel" "text" NOT NULL,
    "locale" "text",
    "decided_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "risk_decision_accept_from_educated" CHECK ((("kind" <> 'accepted'::"text") OR ("from_state" = 'educated'::"text"))),
    CONSTRAINT "risk_decision_event_basis_check" CHECK (("basis" = ANY (ARRAY['checked'::"text", 'given'::"text", 'accepted'::"text"]))),
    CONSTRAINT "risk_decision_event_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "risk_decision_event_from_state_check" CHECK (("from_state" = ANY (ARRAY['unknown'::"text", 'educated'::"text"]))),
    CONSTRAINT "risk_decision_event_kind_check" CHECK (("kind" = ANY (ARRAY['accepted'::"text", 'removed'::"text"]))),
    CONSTRAINT "risk_decision_event_locale_check" CHECK ((("locale" IS NULL) OR ("locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text"))),
    CONSTRAINT "risk_decision_event_scan_key_check" CHECK ((("char_length"("scan_key") >= 1) AND ("char_length"("scan_key") <= 200))),
    CONSTRAINT "risk_decision_event_subject_key_check" CHECK (("char_length"("subject_key") <= 200)),
    CONSTRAINT "risk_decision_event_to_state_check" CHECK (("to_state" = ANY (ARRAY['accepted'::"text", 'removed'::"text"]))),
    CONSTRAINT "risk_decision_event_value_hash_check" CHECK (("value_hash" ~ '^[0-9a-f]{32}$'::"text")),
    CONSTRAINT "risk_decision_h12_education" CHECK ((("kind" = 'accepted'::"text") = ("education_id" IS NOT NULL))),
    CONSTRAINT "risk_decision_h14_basis" CHECK (((("kind" = 'accepted'::"text") AND ("basis" = 'accepted'::"text")) OR (("kind" = 'removed'::"text") AND ("basis" = ANY (ARRAY['checked'::"text", 'given'::"text"]))))),
    CONSTRAINT "risk_decision_h14_evidence" CHECK (((NOT (("kind" = 'removed'::"text") AND ("basis" = 'checked'::"text"))) OR ("evidence_data_point_id" IS NOT NULL))),
    CONSTRAINT "risk_decision_h14_input" CHECK ((("basis" <> ALL (ARRAY['given'::"text", 'accepted'::"text"])) OR ((NULLIF("btrim"("input_ref"), ''::"text") IS NOT NULL) AND ("render_id" IS NOT NULL)))),
    CONSTRAINT "risk_decision_kind_state" CHECK (("kind" = "to_state"))
);

ALTER TABLE ONLY "ledger"."risk_decision_event" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."risk_decision_event" OWNER TO "postgres";


COMMENT ON TABLE "ledger"."risk_decision_event" IS 'MPC-8753 A3: accepted (needs a prior education) or removed. Risk state is derived (ledger._risk_eval), never stored. Append-only.';



CREATE TABLE IF NOT EXISTS "ledger"."risk_education_event" (
    "education_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "type_code" "text" NOT NULL,
    "subject_key" "text" DEFAULT ''::"text" NOT NULL,
    "scan_key" "text" NOT NULL,
    "data_point_id" "uuid" NOT NULL,
    "value_hash" "text" NOT NULL,
    "consequence_key" "text" NOT NULL,
    "consequence_version" integer NOT NULL,
    "render_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "locale" "text",
    "shown_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "visible_ms" integer,
    "provenance" "text" DEFAULT 'shown_by_us'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "risk_education_event_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "risk_education_event_locale_check" CHECK ((("locale" IS NULL) OR ("locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text"))),
    CONSTRAINT "risk_education_event_provenance_check" CHECK (("provenance" = 'shown_by_us'::"text")),
    CONSTRAINT "risk_education_event_scan_key_check" CHECK ((("char_length"("scan_key") >= 1) AND ("char_length"("scan_key") <= 200))),
    CONSTRAINT "risk_education_event_subject_key_check" CHECK (("char_length"("subject_key") <= 200)),
    CONSTRAINT "risk_education_event_value_hash_check" CHECK (("value_hash" ~ '^[0-9a-f]{32}$'::"text")),
    CONSTRAINT "risk_education_event_visible_ms_check" CHECK ((("visible_ms" IS NULL) OR ("visible_ms" >= 0)))
);

ALTER TABLE ONLY "ledger"."risk_education_event" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."risk_education_event" OWNER TO "postgres";


COMMENT ON TABLE "ledger"."risk_education_event" IS 'MPC-8753 A3: the person was shown what this data point enables, in a guard render. Valid only for the same scan and the same value hash. Append-only.';



CREATE TABLE IF NOT EXISTS "ledger"."shown_event" (
    "shown_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "type_code" "text" NOT NULL,
    "subject_ref" "text",
    "confidence_at_display" smallint NOT NULL,
    "response" "text" NOT NULL,
    "latency_ms" integer,
    "channel" "text" NOT NULL,
    "shown_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_point_id" "uuid",
    CONSTRAINT "shown_event_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "shown_event_check" CHECK ((("response" <> 'no_response'::"text") OR (("latency_ms" IS NULL) AND ("data_point_id" IS NULL)))),
    CONSTRAINT "shown_event_check1" CHECK ((("response" = 'no_response'::"text") OR ("data_point_id" IS NOT NULL))),
    CONSTRAINT "shown_event_confidence_at_display_check" CHECK ((("confidence_at_display" >= 0) AND ("confidence_at_display" <= 100))),
    CONSTRAINT "shown_event_latency_ms_check" CHECK ((("latency_ms" IS NULL) OR ("latency_ms" >= 0))),
    CONSTRAINT "shown_event_response_check" CHECK (("response" = ANY (ARRAY['confirmed'::"text", 'not_me'::"text", 'disputed'::"text", 'no_response'::"text"]))),
    CONSTRAINT "shown_event_subject_ref_check" CHECK ((("subject_ref" IS NULL) OR ("char_length"("subject_ref") <= 200)))
);

ALTER TABLE ONLY "ledger"."shown_event" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."shown_event" OWNER TO "postgres";


CREATE OR REPLACE VIEW "ledger"."v_data_point_current" AS
 SELECT DISTINCT ON (("ledger"."root_person"("person_id")), "type_code", COALESCE("subject_ref", ''::"text"), "source") "data_point_id",
    "person_id",
    "type_code",
    "subject_ref",
    "value",
    "status",
    "confidence",
    "source",
    "channel",
    "method",
    "source_name",
    "input_ref",
    "collector_version",
    "provenance_extra",
    "locale",
    "observed_at",
    "created_at",
    "expires_at",
    "supersedes_id",
    "retain_until",
    "legacy_ref",
    "backfill_batch_id",
    "ledger"."root_person"("person_id") AS "root_person_id"
   FROM "ledger"."data_point" "d"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "ledger"."data_point" "s"
          WHERE ("s"."supersedes_id" = "d"."data_point_id"))))
  ORDER BY ("ledger"."root_person"("person_id")), "type_code", COALESCE("subject_ref", ''::"text"), "source", "observed_at" DESC, "created_at" DESC;


ALTER VIEW "ledger"."v_data_point_current" OWNER TO "postgres";


CREATE OR REPLACE VIEW "ledger"."v_disagreement" AS
 SELECT "g"."root_person_id",
    "g"."type_code",
    "g"."subject_ref",
    "g"."data_point_id" AS "given_id",
    "c"."data_point_id" AS "other_id",
    "c"."source" AS "other_source",
    "g"."value" AS "given_value",
    "c"."value" AS "other_value",
    "g"."observed_at" AS "given_at",
    "c"."observed_at" AS "other_at"
   FROM ("ledger"."v_data_point_current" "g"
     JOIN "ledger"."v_data_point_current" "c" ON ((("c"."root_person_id" = "g"."root_person_id") AND ("c"."type_code" = "g"."type_code") AND (COALESCE("c"."subject_ref", ''::"text") = COALESCE("g"."subject_ref", ''::"text")) AND ("c"."source" = ANY (ARRAY['checked'::"text", 'taken'::"text"])))))
  WHERE (("g"."source" = 'given'::"text") AND ("g"."status" = ANY (ARRAY['found'::"text", 'clear'::"text"])) AND ("c"."status" = ANY (ARRAY['found'::"text", 'clear'::"text"])) AND "ledger"."values_disagree"("g"."value", "c"."value"));


ALTER VIEW "ledger"."v_disagreement" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_plan_log" (
    "id" bigint NOT NULL,
    "account_id" "uuid" NOT NULL,
    "old_plan" "text" NOT NULL,
    "new_plan" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_plan_log_reason_check" CHECK ((("char_length"("reason") >= 3) AND ("char_length"("reason") <= 200)))
);

ALTER TABLE ONLY "public"."account_plan_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_plan_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."account_plan_log" IS 'MPC-9818. Every plan change made through mpt_set_plan (manual grant, or the Stripe webhook in MPC-9819). Deleted with the account. No IP, no payment data.';



CREATE SEQUENCE IF NOT EXISTS "public"."account_plan_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."account_plan_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."account_plan_log_id_seq" OWNED BY "public"."account_plan_log"."id";



CREATE TABLE IF NOT EXISTS "public"."account_scans" (
    "account_id" "uuid" NOT NULL,
    "web_scan_id" "uuid" NOT NULL,
    "scans_id" "uuid",
    "claim_method" "text" NOT NULL,
    "linked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_scans_claim_method_check" CHECK (("claim_method" = ANY (ARRAY['current'::"text", 'claim'::"text", 'confirm'::"text"])))
);

ALTER TABLE ONLY "public"."account_scans" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_scans" OWNER TO "postgres";


COMMENT ON TABLE "public"."account_scans" IS 'MPC-9817. Which saved scans (web_scans.id = scan number) belong to which account. claim_method: current = attached at sign-in, claim = typed scan number + signed-in email, confirm = the one-step tick at report time. No IP. Cascades from the account and from the saved scan.';



CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "keep_scans" boolean DEFAULT true NOT NULL,
    "consent_version" "text",
    "consent_at" timestamp with time zone,
    "consent_scan_id" "uuid",
    "consent_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "accounts_consent_hash_check" CHECK ((("consent_hash" IS NULL) OR ("consent_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "accounts_consent_version_check" CHECK ((("consent_version" IS NULL) OR ("consent_version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'::"text"))),
    CONSTRAINT "accounts_email_check" CHECK (((("char_length"("email") >= 3) AND ("char_length"("email") <= 255)) AND ("email" = "lower"("email")))),
    CONSTRAINT "accounts_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'basic'::"text", 'pro'::"text", 'executive'::"text"])))
);

ALTER TABLE ONLY "public"."accounts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."accounts" IS 'MPC-9817. One row per signed-in person (Supabase Auth user). plan defaults to free; MPC-9818/9819 change it. consent_* is the scan-time consent carried on sign-up. NO IP address column, by decision. Deleted with the auth user and by mpt_delete_account. Read: own row only (authenticated) or service_role.';



COMMENT ON COLUMN "public"."accounts"."keep_scans" IS 'MPC-9817. true = this person is signed up, so their scans are kept (they are not on the free 7-day deletion path).';



CREATE TABLE IF NOT EXISTS "public"."cairn_facts" (
    "id" bigint NOT NULL,
    "fact_id" "text" NOT NULL,
    "session_id" bigint NOT NULL,
    "description" "text" NOT NULL,
    "fact_type" "text",
    "fact_value" "text",
    "confidence_score" numeric(3,2) DEFAULT 0.50 NOT NULL,
    "source_name" "text",
    "source_url" "text",
    "extracted_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "discovered_from_intent_id" "text",
    "discovery_chain" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_hashed" boolean DEFAULT false NOT NULL,
    "hash_algorithm" "text",
    "data_classification" "text" DEFAULT 'sensitive'::"text" NOT NULL,
    CONSTRAINT "cairn_facts_classification_valid" CHECK (("data_classification" = ANY (ARRAY['sensitive'::"text", 'public'::"text", 'internal'::"text"]))),
    CONSTRAINT "cairn_facts_confidence_range" CHECK ((("confidence_score" >= 0.0) AND ("confidence_score" <= 1.0))),
    CONSTRAINT "cairn_facts_fact_id_format" CHECK (("fact_id" ~ '^cairn-fact-[A-Za-z0-9_-]{3,64}$'::"text")),
    CONSTRAINT "cairn_facts_hash_algorithm_valid" CHECK ((("hash_algorithm" IS NULL) OR ("hash_algorithm" = ANY (ARRAY['bcrypt'::"text", 'sha256'::"text", 'sha512'::"text", 'hmac-sha256'::"text"])))),
    CONSTRAINT "cairn_facts_hash_consistent" CHECK (((NOT "is_hashed") OR ("hash_algorithm" IS NOT NULL)))
);

ALTER TABLE ONLY "public"."cairn_facts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cairn_facts" OWNER TO "postgres";


COMMENT ON TABLE "public"."cairn_facts" IS 'MPC-8413 / spec MPC-8401. Facts Cairn discovered about the seed. Sensitive types (phone, etc.) must arrive hashed (is_hashed + hash_algorithm); never dehash. Cascades with the session. Writes via service_role only.';



CREATE SEQUENCE IF NOT EXISTS "public"."cairn_facts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cairn_facts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cairn_facts_id_seq" OWNED BY "public"."cairn_facts"."id";



CREATE TABLE IF NOT EXISTS "public"."cairn_intents" (
    "id" bigint NOT NULL,
    "intent_id" "text" NOT NULL,
    "session_id" bigint NOT NULL,
    "description" "text" NOT NULL,
    "intent_type" "text",
    "from_fact_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "target_fact_id" "text",
    "creator" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "worker_assigned" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "timeout_seconds" integer DEFAULT 60 NOT NULL,
    "result_summary" "text",
    "error_message" "text",
    "execution_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "max_retries" integer DEFAULT 3 NOT NULL,
    "human_hint" "text",
    "is_paused" boolean DEFAULT false NOT NULL,
    "pause_reason" "text",
    CONSTRAINT "cairn_intents_intent_id_format" CHECK (("intent_id" ~ '^cairn-intent-[A-Za-z0-9_-]{3,64}$'::"text")),
    CONSTRAINT "cairn_intents_status_valid" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'failed'::"text", 'blocked'::"text"])))
);

ALTER TABLE ONLY "public"."cairn_intents" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cairn_intents" OWNER TO "postgres";


COMMENT ON TABLE "public"."cairn_intents" IS 'MPC-8413 / spec MPC-8401. Cairn investigation-direction queue and audit trail. Cascades with the session. Writes via service_role only.';



CREATE SEQUENCE IF NOT EXISTS "public"."cairn_intents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cairn_intents_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cairn_intents_id_seq" OWNED BY "public"."cairn_intents"."id";



CREATE TABLE IF NOT EXISTS "public"."cairn_sessions" (
    "id" bigint NOT NULL,
    "session_id" "text" NOT NULL,
    "user_id" "uuid",
    "seed_email" "text" NOT NULL,
    "seed_username" "text",
    "investigation_goal" "text",
    "allowed_domains" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "excluded_domains" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "max_depth" integer DEFAULT 3 NOT NULL,
    "max_facts" integer DEFAULT 100 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "status_reason" "text",
    "facts_discovered" integer DEFAULT 0 NOT NULL,
    "intents_generated" integer DEFAULT 0 NOT NULL,
    "intents_completed" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "concluded_at" timestamp with time zone,
    "timeout_seconds" integer DEFAULT 300 NOT NULL,
    "retain_until" timestamp with time zone DEFAULT ("now"() + '72:00:00'::interval) NOT NULL,
    "cairn_project_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "cairn_sessions_session_id_format" CHECK (("session_id" ~ '^mpt-cairn-[0-9]{10,}$'::"text")),
    CONSTRAINT "cairn_sessions_status_valid" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."cairn_sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cairn_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."cairn_sessions" IS 'MPC-8413 / spec MPC-8401. One row per Cairn OSINT deep-scan run. Holds the seed email, so it is personal data. 72h retention (retain_until; purge job mpt-purge-expired-cairn-sessions); facts and intents cascade. Deletion on request removes the row. Writes via service_role only; authenticated may read own rows.';



CREATE SEQUENCE IF NOT EXISTS "public"."cairn_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cairn_sessions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cairn_sessions_id_seq" OWNED BY "public"."cairn_sessions"."id";



CREATE TABLE IF NOT EXISTS "public"."capability_min_tier" (
    "key" "text" NOT NULL,
    "min_tier" "text" NOT NULL,
    "cost" "text",
    "status" "text",
    "note" "text",
    CONSTRAINT "capability_min_tier_cost_check" CHECK ((("cost" IS NULL) OR ("cost" = ANY (ARRAY['none'::"text", 'third_party'::"text"])))),
    CONSTRAINT "capability_min_tier_key_check" CHECK (("key" ~ '^[a-z][a-z0-9_.]{0,63}$'::"text")),
    CONSTRAINT "capability_min_tier_min_tier_check" CHECK (("min_tier" = ANY (ARRAY['free'::"text", 'basic'::"text", 'pro'::"text", 'executive'::"text"]))),
    CONSTRAINT "capability_min_tier_status_check" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['live'::"text", 'planned'::"text"])))),
    CONSTRAINT "capability_third_party_not_free" CHECK ((("cost" IS DISTINCT FROM 'third_party'::"text") OR ("min_tier" <> 'free'::"text")))
);

ALTER TABLE ONLY "public"."capability_min_tier" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."capability_min_tier" OWNER TO "postgres";


COMMENT ON TABLE "public"."capability_min_tier" IS 'MPC-9817/9818. Entitlement data from the Paid Exposure Report spec section 3: one row per capability, the lowest tier that has it (order free < basic < pro < executive). 20 rows. Changing a threshold is a data change, not a deploy. Unknown keys are denied by mpt_can. A third_party-cost row can never be free (check constraint).';



CREATE TABLE IF NOT EXISTS "public"."channel_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "opted_in" boolean DEFAULT false NOT NULL,
    "opted_in_at" timestamp with time zone,
    "opted_out_at" timestamp with time zone,
    "consent_source" "text",
    "is_preferred" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "channel_preferences_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'sms'::"text", 'whatsapp'::"text", 'telegram'::"text"]))),
    CONSTRAINT "channel_preferences_consent_source_check" CHECK (("char_length"("consent_source") <= 100))
);

ALTER TABLE ONLY "public"."channel_preferences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."channel_preferences" IS 'CK-006. Per-lead channel opt-in/out with consent evidence (WhatsApp/SMS need an explicit opt-in). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."channel_probe_captures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform" "text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    CONSTRAINT "channel_probe_captures_kind_check" CHECK ((("char_length"("kind") >= 1) AND ("char_length"("kind") <= 64))),
    CONSTRAINT "channel_probe_captures_platform_check" CHECK (("platform" ~ '^[a-z][a-z0-9_]{0,31}$'::"text")),
    CONSTRAINT "channel_probe_captures_sender_id_check" CHECK ((("char_length"("sender_id") >= 1) AND ("char_length"("sender_id") <= 64)))
);

ALTER TABLE ONLY "public"."channel_probe_captures" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_probe_captures" OWNER TO "postgres";


COMMENT ON TABLE "public"."channel_probe_captures" IS 'Channel probe reader. Raw platform payloads and public-lookup results. PROBE_MODE=on: allow-listed TEST accounts only, 7 day expiry. PROBE_MODE=all: REAL-USER Telegram data (PII), expires_at per PROBE_RETENTION_DAYS (default 90). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."channel_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "access_token_enc" "text" NOT NULL,
    "refresh_token_enc" "text",
    "scope" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "key_version" integer DEFAULT 1 NOT NULL,
    "consented_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "channel_tokens_access_token_enc_ciphertext" CHECK (("access_token_enc" ~ '^v[0-9]+\.'::"text")),
    CONSTRAINT "channel_tokens_key_version_check" CHECK (("key_version" >= 1)),
    CONSTRAINT "channel_tokens_refresh_token_enc_ciphertext" CHECK ((("refresh_token_enc" IS NULL) OR ("refresh_token_enc" ~ '^v[0-9]+\.'::"text")))
);

ALTER TABLE ONLY "public"."channel_tokens" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."channel_tokens" IS 'MPC-115. AES-256-GCM ciphertext OAuth tokens for channel integrations. RLS on, no policies: service_role only.';



COMMENT ON COLUMN "public"."channel_tokens"."consented_at" IS 'MPC-10833: when the person last went through the provider consent screen. Not changed by a token refresh. The Worker refuses the token 90 days after this.';



CREATE TABLE IF NOT EXISTS "public"."confidence_config" (
    "version" integer NOT NULL,
    "confidences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "created_by" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "confidence_config_version_check" CHECK (("version" >= 0))
);

ALTER TABLE ONLY "public"."confidence_config" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."confidence_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."confidence_config" IS 'Versioned confidence in force (hexagon id -> 0..1). Version 0 is empty: use the registry''s fixed numbers. Exactly one row is active; switching it back is the rollback.';



CREATE TABLE IF NOT EXISTS "public"."confidence_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hexagon_id" character varying(64) NOT NULL,
    "source" character varying(64) NOT NULL,
    "basis" character varying(12) NOT NULL,
    "current_value" double precision NOT NULL,
    "proposed_value" double precision NOT NULL,
    "interval_low" double precision NOT NULL,
    "interval_high" double precision NOT NULL,
    "responders" integer NOT NULL,
    "response_rate" double precision NOT NULL,
    "config_version" integer NOT NULL,
    "status" character varying(10) DEFAULT 'proposed'::character varying NOT NULL,
    "decided_by" "text",
    "decided_at" timestamp with time zone,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "confidence_proposals_basis_check" CHECK ((("basis")::"text" = ANY ((ARRAY['accuracy'::character varying, 'dispute'::character varying])::"text"[]))),
    CONSTRAINT "confidence_proposals_check" CHECK (("interval_low" <= "interval_high")),
    CONSTRAINT "confidence_proposals_check1" CHECK (((("status")::"text" = 'proposed'::"text") OR (("decided_by" IS NOT NULL) AND ("decided_at" IS NOT NULL)))),
    CONSTRAINT "confidence_proposals_config_version_check" CHECK (("config_version" >= 0)),
    CONSTRAINT "confidence_proposals_current_value_check" CHECK ((("current_value" >= (0)::double precision) AND ("current_value" <= (1)::double precision))),
    CONSTRAINT "confidence_proposals_interval_high_check" CHECK ((("interval_high" >= (0)::double precision) AND ("interval_high" <= (1)::double precision))),
    CONSTRAINT "confidence_proposals_interval_low_check" CHECK ((("interval_low" >= (0)::double precision) AND ("interval_low" <= (1)::double precision))),
    CONSTRAINT "confidence_proposals_proposed_value_check" CHECK ((("proposed_value" >= (0)::double precision) AND ("proposed_value" <= (1)::double precision))),
    CONSTRAINT "confidence_proposals_responders_check" CHECK (("responders" >= 30)),
    CONSTRAINT "confidence_proposals_response_rate_check" CHECK ((("response_rate" >= (0)::double precision) AND ("response_rate" <= (1)::double precision))),
    CONSTRAINT "confidence_proposals_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['proposed'::character varying, 'approved'::character varying, 'rejected'::character varying, 'superseded'::character varying])::"text"[])))
);

ALTER TABLE ONLY "public"."confidence_proposals" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."confidence_proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."confidence_proposals" IS 'What visitors'' answers suggest about a tile''s confidence. Never applied automatically: a human approves or rejects and is named. responders is never below 30 (the agreed minimum).';



CREATE TABLE IF NOT EXISTS "public"."conversation_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "channel" "text" NOT NULL,
    "trust_level" smallint DEFAULT 0 NOT NULL,
    "state" "text" DEFAULT 'new'::"text" NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sender_id" "text",
    CONSTRAINT "conversation_states_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'sms'::"text", 'whatsapp'::"text", 'telegram'::"text"]))),
    CONSTRAINT "conversation_states_has_owner" CHECK ((("lead_id" IS NOT NULL) OR ("sender_id" IS NOT NULL))),
    CONSTRAINT "conversation_states_sender_id_len" CHECK ((("sender_id" IS NULL) OR (("char_length"("sender_id") >= 1) AND ("char_length"("sender_id") <= 128)))),
    CONSTRAINT "conversation_states_trust_level_check" CHECK ((("trust_level" >= 0) AND ("trust_level" <= 5)))
);

ALTER TABLE ONLY "public"."conversation_states" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_states" OWNER TO "postgres";


COMMENT ON TABLE "public"."conversation_states" IS 'CK-006. Microdrama (MPT) Progressive Trust: one row per lead per channel holding trust_level and conversation state. service_role only.';



COMMENT ON COLUMN "public"."conversation_states"."sender_id" IS 'MPC-8601. The platform''s sender id as text (Telegram chat id, WhatsApp number, ...). PII: erase with public.mpt_erase_chat_sender() or with the lead. A row has a sender_id, a lead_id, or both.';



CREATE TABLE IF NOT EXISTS "public"."dashboard_links" (
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sender_id" "text" NOT NULL,
    "snapshot_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "redeemed_at" timestamp with time zone,
    "scope" "text" DEFAULT 'dashboard'::"text" NOT NULL,
    CONSTRAINT "dashboard_links_max_15_minutes" CHECK ((("expires_at" > "created_at") AND ("expires_at" <= ("created_at" + '00:15:00'::interval)))),
    CONSTRAINT "dashboard_links_scope_check" CHECK (("scope" = ANY (ARRAY['dashboard'::"text", 'footprint'::"text"]))),
    CONSTRAINT "dashboard_links_sender_id_check" CHECK (("sender_id" ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'::"text")),
    CONSTRAINT "dashboard_links_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."dashboard_links" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_links" OWNER TO "postgres";


COMMENT ON TABLE "public"."dashboard_links" IS 'MPC-7893 one-time dashboard links: SHA-256 of a random UUID, scoped to one Telegram sender and snapshot, 15 minute expiry, single use. Credential material (hashed). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."dashboard_sessions" (
    "session_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "link_hash" "text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "snapshot_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "scope" "text" DEFAULT 'dashboard'::"text" NOT NULL,
    CONSTRAINT "dashboard_sessions_max_2_hours" CHECK ((("expires_at" > "created_at") AND ("expires_at" <= ("created_at" + '02:00:00'::interval)))),
    CONSTRAINT "dashboard_sessions_scope_check" CHECK (("scope" = ANY (ARRAY['dashboard'::"text", 'footprint'::"text"]))),
    CONSTRAINT "dashboard_sessions_sender_id_check" CHECK (("sender_id" ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'::"text")),
    CONSTRAINT "dashboard_sessions_session_hash_check" CHECK (("session_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."dashboard_sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."dashboard_sessions" IS 'MPC-7893 restricted dashboard sessions created by redeeming a link: SHA-256 of an opaque cookie value, scoped to one sender and snapshot. Credential material (hashed). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."deep_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "platform" "text" DEFAULT 'telegram'::"text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "status" "text" NOT NULL,
    "query_username" "text" NOT NULL,
    "consent" "jsonb",
    "consent_at" timestamp with time zone,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "detector_version" "text" NOT NULL,
    "started_at" timestamp with time zone,
    "heartbeat_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "deep_jobs_detector_version_check" CHECK ((("char_length"("detector_version") >= 1) AND ("char_length"("detector_version") <= 40))),
    CONSTRAINT "deep_jobs_idempotency_key_check" CHECK ((("char_length"("idempotency_key") >= 1) AND ("char_length"("idempotency_key") <= 80))),
    CONSTRAINT "deep_jobs_platform_check" CHECK (("platform" ~ '^[a-z][a-z0-9_]{0,31}$'::"text")),
    CONSTRAINT "deep_jobs_query_username_check" CHECK (("query_username" ~ '^[A-Za-z0-9_]{5,32}$'::"text")),
    CONSTRAINT "deep_jobs_sender_id_check" CHECK (("sender_id" ~ '^[0-9]{1,20}$'::"text")),
    CONSTRAINT "deep_jobs_status_check" CHECK (("status" = ANY (ARRAY['awaiting_consent'::"text", 'running'::"text", 'complete'::"text", 'partial'::"text", 'failed'::"text", 'cancelled'::"text", 'expired'::"text", 'interrupted'::"text"])))
);

ALTER TABLE ONLY "public"."deep_jobs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."deep_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."deep_jobs" IS 'MPC-7892 DEEP jobs for allow-listed Telegram test accounts: consent link, status, versions. Personal data. service_role only. Expires per expires_at.';



CREATE TABLE IF NOT EXISTS "public"."deep_osint_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "site_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "http_status" integer DEFAULT 0 NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "detector_version" "text" NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "limitation" "text" NOT NULL,
    CONSTRAINT "deep_osint_results_source_check" CHECK ((("char_length"("source") >= 1) AND ("char_length"("source") <= 40))),
    CONSTRAINT "deep_osint_results_status_check" CHECK (("status" = ANY (ARRAY['found'::"text", 'not_found'::"text", 'unavailable'::"text", 'blocked'::"text", 'error'::"text"])))
);

ALTER TABLE ONLY "public"."deep_osint_results" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."deep_osint_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."deep_osint_results" IS 'MPC-7892 per-site username check results (observation, detector version, status, limitation). Personal data. service_role only. Deleted with its job.';



CREATE TABLE IF NOT EXISTS "public"."deep_research_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_hash" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 5 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "verified_at" timestamp with time zone,
    CONSTRAINT "deep_research_challenges_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "deep_research_challenges_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'sms'::"text", 'domain_txt'::"text"]))),
    CONSTRAINT "deep_research_challenges_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "deep_research_challenges_code_hash_check" CHECK (("code_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "deep_research_challenges_max_attempts_check" CHECK ((("max_attempts" >= 1) AND ("max_attempts" <= 10))),
    CONSTRAINT "deep_research_challenges_subject_hash_check" CHECK (("subject_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."deep_research_challenges" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."deep_research_challenges" OWNER TO "postgres";


COMMENT ON TABLE "public"."deep_research_challenges" IS 'MPC-9549 Deep Research ownership challenges. Code hash only, attempts capped, short expiry.';



CREATE TABLE IF NOT EXISTS "public"."deletion_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_ref" "uuid" NOT NULL,
    "categories" "text"[] NOT NULL,
    "irreversible" boolean DEFAULT false NOT NULL,
    "irreversible_ack" boolean DEFAULT false NOT NULL,
    "price_cents" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    "withdrawn_at" timestamp with time zone,
    "eradication_completed_at" timestamp with time zone,
    CONSTRAINT "deletion_consents_categories_check" CHECK ((("cardinality"("categories") >= 1) AND ("cardinality"("categories") <= 8))),
    CONSTRAINT "deletion_consents_categories_check1" CHECK (("categories" <@ ARRAY['broker'::"text", 'search'::"text", 'social'::"text", 'email'::"text", 'device'::"text", 'network'::"text", 'professional'::"text", 'ai_threat'::"text"])),
    CONSTRAINT "deletion_consents_check" CHECK (((NOT "irreversible") OR "irreversible_ack")),
    CONSTRAINT "deletion_consents_check1" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "deletion_consents_price_cents_check" CHECK (("price_cents" >= 0))
);

ALTER TABLE ONLY "public"."deletion_consents" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."deletion_consents" OWNER TO "postgres";


COMMENT ON TABLE "public"."deletion_consents" IS 'MPC-8673. One row per Flip Point consent. No item content. scan_ref has no foreign key on purpose. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."edge_visit_retention" (
    "id" boolean DEFAULT true NOT NULL,
    "ip_days" integer DEFAULT 30 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "edge_visit_retention_id_check" CHECK ("id"),
    CONSTRAINT "edge_visit_retention_ip_days_check" CHECK ((("ip_days" >= 1) AND ("ip_days" <= 3650)))
);

ALTER TABLE ONLY "public"."edge_visit_retention" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_visit_retention" OWNER TO "postgres";


COMMENT ON TABLE "public"."edge_visit_retention" IS 'MPC-7490. Single row: days a person/unknown edge visit keeps its IP address before it is cut. Proposed 30; Chris confirms in MPC-7491.';



CREATE TABLE IF NOT EXISTS "public"."edge_visits" (
    "id" bigint NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "host" "text",
    "path" "text" NOT NULL,
    "method" "text" NOT NULL,
    "status" smallint,
    "user_agent" "text",
    "ip" "text",
    "ip_cut_at" timestamp with time zone,
    "country" "text",
    "asn" integer,
    "network" "text",
    "colo" "text",
    "referrer" "text",
    "headers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "class" "text" NOT NULL,
    "rule" "text" NOT NULL,
    "ruleset_version" "text" NOT NULL,
    "query" "text",
    "ip_version" smallint,
    "cf" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "all_headers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "edge_visits_class_check" CHECK (("class" = ANY (ARRAY['person'::"text", 'bot'::"text", 'ai'::"text", 'unknown'::"text"]))),
    CONSTRAINT "edge_visits_country_check" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "edge_visits_ip_version_check" CHECK ((("ip_version" IS NULL) OR ("ip_version" = ANY (ARRAY[4, 6]))))
);

ALTER TABLE ONLY "public"."edge_visits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_visits" OWNER TO "postgres";


COMMENT ON TABLE "public"."edge_visits" IS 'MPC-7490. Raw request facts from the edge, plus the class, deciding rule and rule-set version. Path only (no query string); referrer reduced to origin+path; no cookies or credentials. ip is nulled after edge_visit_retention.ip_days for class person/unknown; bot and ai rows are kept in full. service_role only.';



COMMENT ON COLUMN "public"."edge_visits"."ip" IS 'Connecting IP. Personal data for person/unknown rows: cut to null by mpt_cut_edge_visit_ips after the retention period.';



COMMENT ON COLUMN "public"."edge_visits"."query" IS 'Decision D-A. Query string, values redacted where the key looks like a token, key, secret, code, session, signature or email.';



COMMENT ON COLUMN "public"."edge_visits"."cf" IS 'Decision D-A. Everything Cloudflare attached to the request (request.cf), as received. May include city, coordinates and postal code: personal data, same handling as ip.';



COMMENT ON COLUMN "public"."edge_visits"."all_headers" IS 'Decision D-A. Every request header except credential-bearing ones (cookie, authorization, names containing token/secret/key/session).';



ALTER TABLE "public"."edge_visits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."edge_visits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."email_sends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_message_id" "text" NOT NULL,
    "email_type" "text" NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text",
    "status_at" timestamp with time zone,
    "bounce_type" "text",
    "click_count" integer DEFAULT 0 NOT NULL,
    "first_click_at" timestamp with time zone,
    "email_id" "text",
    "channel" "text",
    CONSTRAINT "email_sends_bounce_type_check" CHECK (("bounce_type" = ANY (ARRAY['permanent'::"text", 'transient'::"text", 'undetermined'::"text"]))),
    CONSTRAINT "email_sends_channel_check" CHECK (("channel" = ANY (ARRAY['web-scan'::"text", 'lead-form'::"text", 'web-newsletter'::"text", 'referral'::"text", 'hk-spam'::"text", 'support-inbox'::"text", 'whatsapp'::"text", 'telegram'::"text", 'discord'::"text", 'any'::"text"]))),
    CONSTRAINT "email_sends_click_count_check" CHECK (("click_count" >= 0)),
    CONSTRAINT "email_sends_email_id_check" CHECK (("email_id" ~ '^[A-Z]{2,5}-[a-z0-9-]{1,60}$'::"text")),
    CONSTRAINT "email_sends_email_type_check" CHECK (("email_type" ~ '^[a-z0-9-]{1,40}$'::"text")),
    CONSTRAINT "email_sends_provider_message_id_check" CHECK ((("char_length"("provider_message_id") >= 1) AND ("char_length"("provider_message_id") <= 200))),
    CONSTRAINT "email_sends_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'delivery_delayed'::"text", 'delivered'::"text", 'bounced'::"text", 'failed'::"text", 'complained'::"text"])))
);

ALTER TABLE ONLY "public"."email_sends" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_sends" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_sends" IS 'MPC-7556. One row per email the provider accepted. No address, subject or body. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."email_suppressions" (
    "email_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text",
    CONSTRAINT "email_suppressions_email_hash_check" CHECK (("email_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "email_suppressions_source_check" CHECK ((("source" IS NULL) OR ("char_length"("source") <= 64)))
);

ALTER TABLE ONLY "public"."email_suppressions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_suppressions" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_suppressions" IS 'MPC-7448. Marketing-email opt-outs by SHA-256(lower(email)). For people with no users row (e.g. hk_spam_registrations). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."eradication_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "consent_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    CONSTRAINT "eradication_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'failed'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."eradication_jobs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."eradication_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."eradication_jobs" IS 'MPC-8673. One job per consented category. Counts and states only. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."fix_wizard_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sender_id" "text" NOT NULL,
    "baseline_snapshot_id" "uuid" NOT NULL,
    "issue_id" "text" NOT NULL,
    "intention" "text",
    "context_answer" "text",
    "self_confirmed_at" timestamp with time zone,
    "recheck_snapshot_id" "uuid",
    "recheck_outcome" "text",
    "recheck_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "fix_wizard_items_context_answer_check" CHECK (("context_answer" = ANY (ARRAY['a'::"text", 'b'::"text"]))),
    CONSTRAINT "fix_wizard_items_intention_check" CHECK (("intention" = ANY (ARRAY['keep'::"text", 'change'::"text", 'skip'::"text"]))),
    CONSTRAINT "fix_wizard_items_issue_id_check" CHECK (("issue_id" ~ '^[a-z]{2,12}$'::"text")),
    CONSTRAINT "fix_wizard_items_recheck_outcome_check" CHECK (("recheck_outcome" = ANY (ARRAY['verified_change'::"text", 'no_change'::"text", 'not_in_baseline'::"text", 'new_exposure'::"text", 'unavailable'::"text", 'incomparable'::"text", 'partial'::"text"]))),
    CONSTRAINT "fix_wizard_items_sender_id_check" CHECK (("sender_id" ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'::"text"))
);

ALTER TABLE ONLY "public"."fix_wizard_items" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."fix_wizard_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."fix_wizard_items" IS 'MPC-7894 Telegram fix wizard state for allow-listed test accounts: intention, self-report and re-check outcome per issue, kept separate. Personal data. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."free_record_deletion_log" (
    "id" bigint NOT NULL,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" NOT NULL,
    "scans_deleted" integer NOT NULL,
    "web_scans_deleted" integer DEFAULT 0 NOT NULL,
    "users_deleted" integer DEFAULT 0 NOT NULL,
    "leads_deleted" integer DEFAULT 0 NOT NULL,
    "ledger_persons" integer DEFAULT 0 NOT NULL,
    "note" "text",
    CONSTRAINT "free_record_deletion_log_kind_check" CHECK (("kind" = ANY (ARRAY['purge'::"text", 'purge_dry_run'::"text"]))),
    CONSTRAINT "free_record_deletion_log_scans_deleted_check" CHECK (("scans_deleted" >= 0))
);

ALTER TABLE ONLY "public"."free_record_deletion_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."free_record_deletion_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."free_record_deletion_log" IS 'MPC-9890. One row per free-record purge run. Counts only: no address, scan number or value.';



ALTER TABLE "public"."free_record_deletion_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."free_record_deletion_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."free_record_policy" (
    "id" boolean DEFAULT true NOT NULL,
    "n_hours" integer DEFAULT 168 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "free_record_policy_id_check" CHECK ("id"),
    CONSTRAINT "free_record_policy_n_hours_check" CHECK ((("n_hours" >= 1) AND ("n_hours" <= 8760)))
);

ALTER TABLE ONLY "public"."free_record_policy" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."free_record_policy" OWNER TO "postgres";


COMMENT ON TABLE "public"."free_record_policy" IS 'MPC-9890. Single row: N hours from report delivery to deletion of a free user''s record, used when a scan has no stored consent. Must equal CONSENT_CONFIG.n_hours (shared/recipients/consent-config.ts); a test pins it.';



CREATE TABLE IF NOT EXISTS "public"."hexagon_catalogue" (
    "id" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "channel_group" "text" NOT NULL,
    "code" "text" NOT NULL,
    "arrival" "text" NOT NULL,
    "risk" "text" NOT NULL,
    "label" "text" NOT NULL,
    "reveals" "text" DEFAULT ''::"text" NOT NULL,
    "field" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" NOT NULL,
    "access" "text" DEFAULT ''::"text" NOT NULL,
    "source_url" "text" DEFAULT ''::"text" NOT NULL,
    "code_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "catalogue_version" "text" DEFAULT '2026-10-28'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "hexagon_catalogue_arrival_check" CHECK (("arrival" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text"]))),
    CONSTRAINT "hexagon_catalogue_risk_check" CHECK (("risk" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "hexagon_catalogue_status_check" CHECK (("status" = ANY (ARRAY['defined'::"text", 'new'::"text"])))
);


ALTER TABLE "public"."hexagon_catalogue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hexagon_findings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_hash" "text" NOT NULL,
    "hexagon_id" "text" NOT NULL,
    "finding_type" "text" NOT NULL,
    "confidence_score" smallint NOT NULL,
    "encrypted_evidence" "text",
    "remediation_link" "text",
    "needs_human_review" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "hexagon_findings_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "hexagon_findings_confidence_score_check" CHECK ((("confidence_score" >= 0) AND ("confidence_score" <= 100))),
    CONSTRAINT "hexagon_findings_finding_type_check" CHECK ((("char_length"("finding_type") >= 1) AND ("char_length"("finding_type") <= 64))),
    CONSTRAINT "hexagon_findings_hexagon_id_check" CHECK (("hexagon_id" = ANY (ARRAY['cred_leak_trace'::"text", 'darkweb_breach_map'::"text", 'osint_social_graph'::"text", 'network_device_fp'::"text", 'crypto_asset_flow'::"text"]))),
    CONSTRAINT "hexagon_findings_remediation_link_check" CHECK ((("remediation_link" IS NULL) OR ("remediation_link" ~ '^https://'::"text"))),
    CONSTRAINT "hexagon_findings_subject_hash_check" CHECK (("subject_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."hexagon_findings" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."hexagon_findings" OWNER TO "postgres";


COMMENT ON TABLE "public"."hexagon_findings" IS 'MPC-9549 Deep Research findings for a verified subject (hash, never raw identifier). Evidence is ciphertext.';



CREATE TABLE IF NOT EXISTS "public"."hexagon_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "score" integer,
    "signals_count" integer DEFAULT 0 NOT NULL,
    "risk_multiplier" numeric(2,1) NOT NULL,
    "color" character varying(6) NOT NULL,
    "checked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "hexagon_scores_category_check" CHECK (("category" = ANY (ARRAY['broker'::"text", 'search'::"text", 'social'::"text", 'email'::"text", 'device'::"text", 'network'::"text", 'professional'::"text", 'ai_threat'::"text"]))),
    CONSTRAINT "hexagon_scores_risk_multiplier_check" CHECK ((("risk_multiplier" >= 1.0) AND ("risk_multiplier" <= 2.0))),
    CONSTRAINT "hexagon_scores_score_check" CHECK ((("score" >= 0) AND ("score" <= 100)))
);

ALTER TABLE ONLY "public"."hexagon_scores" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."hexagon_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."hexagon_scores" IS 'MPC-6677. Per-category score; score is null when the category was not checked. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."hk_shield_waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "language" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "email" "text" NOT NULL,
    "consent" boolean NOT NULL,
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "source_page" "text",
    CONSTRAINT "hk_shield_waitlist_consent_check" CHECK (("consent" = true)),
    CONSTRAINT "hk_shield_waitlist_email_check" CHECK ((("char_length"("email") <= 254) AND ("email" ~~ '%_@_%.__%'::"text"))),
    CONSTRAINT "hk_shield_waitlist_language_check" CHECK (("language" = ANY (ARRAY['en'::"text", 'yue'::"text"]))),
    CONSTRAINT "hk_shield_waitlist_platform_check" CHECK (("platform" = ANY (ARRAY['android'::"text", 'ios'::"text", 'other'::"text"]))),
    CONSTRAINT "hk_shield_waitlist_source_page_check" CHECK (("char_length"("source_page") <= 200)),
    CONSTRAINT "hk_shield_waitlist_utm_campaign_check" CHECK (("char_length"("utm_campaign") <= 100)),
    CONSTRAINT "hk_shield_waitlist_utm_medium_check" CHECK (("char_length"("utm_medium") <= 100)),
    CONSTRAINT "hk_shield_waitlist_utm_source_check" CHECK (("char_length"("utm_source") <= 100))
);

ALTER TABLE ONLY "public"."hk_shield_waitlist" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_shield_waitlist" OWNER TO "postgres";


COMMENT ON TABLE "public"."hk_shield_waitlist" IS 'CK-11387. Spam Shield waitlist from /HongKongSpam. Interest only, nothing is for sale. No phone number. anon insert-only. Count = demand signal for MPC-7647-A1.';



CREATE TABLE IF NOT EXISTS "public"."hk_spam_deletion_log" (
    "id" bigint NOT NULL,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" NOT NULL,
    "rows_deleted" integer NOT NULL,
    "consent_ended" integer DEFAULT 0 NOT NULL,
    "note" "text",
    CONSTRAINT "hk_spam_deletion_log_consent_ended_check" CHECK (("consent_ended" >= 0)),
    CONSTRAINT "hk_spam_deletion_log_kind_check" CHECK (("kind" = ANY (ARRAY['purge'::"text", 'purge_dry_run'::"text", 'by_email'::"text"]))),
    CONSTRAINT "hk_spam_deletion_log_rows_deleted_check" CHECK (("rows_deleted" >= 0))
);

ALTER TABLE ONLY "public"."hk_spam_deletion_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_spam_deletion_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."hk_spam_deletion_log" IS 'MPC-7538. One row per run. Counts only: no email address is ever written here.';



ALTER TABLE "public"."hk_spam_deletion_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."hk_spam_deletion_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."hk_spam_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "platform" "text" NOT NULL,
    "language" "text" NOT NULL,
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "protection_date" "date" NOT NULL,
    "email" "text",
    "reminder_consent" boolean DEFAULT false NOT NULL,
    "source_page" "text",
    "reminder_sent_at" timestamp with time zone,
    "marketing_consent" boolean DEFAULT false NOT NULL,
    CONSTRAINT "hk_spam_registrations_check" CHECK ((("email" IS NOT NULL) OR ("reminder_consent" = false))),
    CONSTRAINT "hk_spam_registrations_email_check" CHECK ((("email" IS NULL) OR (("char_length"("email") <= 254) AND ("email" ~~ '%_@_%.__%'::"text")))),
    CONSTRAINT "hk_spam_registrations_language_check" CHECK (("language" = ANY (ARRAY['en'::"text", 'yue'::"text"]))),
    CONSTRAINT "hk_spam_registrations_marketing_needs_email" CHECK ((("email" IS NOT NULL) OR ("marketing_consent" = false))),
    CONSTRAINT "hk_spam_registrations_platform_check" CHECK (("platform" = ANY (ARRAY['android'::"text", 'ios'::"text", 'other'::"text"]))),
    CONSTRAINT "hk_spam_registrations_source_page_check" CHECK (("char_length"("source_page") <= 200)),
    CONSTRAINT "hk_spam_registrations_utm_campaign_check" CHECK (("char_length"("utm_campaign") <= 100)),
    CONSTRAINT "hk_spam_registrations_utm_medium_check" CHECK (("char_length"("utm_medium") <= 100)),
    CONSTRAINT "hk_spam_registrations_utm_source_check" CHECK (("char_length"("utm_source") <= 100))
);

ALTER TABLE ONLY "public"."hk_spam_registrations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_spam_registrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."hk_spam_registrations" IS 'MPC-7450. HK DNC registrations. No phone number by design. anon insert-only.';



COMMENT ON COLUMN "public"."hk_spam_registrations"."protection_date" IS 'First protected day: 10th HK working day after registration (src/lib/hkWorkingDays.ts). Weather days are adjusted manually.';



COMMENT ON COLUMN "public"."hk_spam_registrations"."reminder_sent_at" IS 'MPC-7448. Set by the Worker (service_role) when it claims the day-10 email for sending; null = not sent. At-most-once guard.';



COMMENT ON COLUMN "public"."hk_spam_registrations"."marketing_consent" IS 'MPC-7538. Ticked "Send me MyPrivacyTOOL privacy tips" box, unticked by default. No marketing email goes out unless true (read hk_spam_marketing_recipients). Rows with true are kept past the 90 days until unsubscribe or deletion.';



CREATE OR REPLACE VIEW "public"."hk_spam_due_reminders" WITH ("security_invoker"='true') AS
 SELECT "id",
    "email",
    "language",
    "platform",
    "protection_date",
    "utm_source",
    "utm_medium",
    "utm_campaign"
   FROM "public"."hk_spam_registrations"
  WHERE (("protection_date" = (("now"() AT TIME ZONE 'Asia/Hong_Kong'::"text"))::"date") AND ("email" IS NOT NULL) AND ("reminder_consent" = true) AND ("reminder_sent_at" IS NULL));


ALTER VIEW "public"."hk_spam_due_reminders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."hk_spam_marketing_recipients" WITH ("security_invoker"='true') AS
 SELECT "id",
    "email",
    "language",
    "platform",
    "created_at"
   FROM "public"."hk_spam_registrations" "r"
  WHERE (("marketing_consent" = true) AND ("email" IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."email_suppressions" "s"
          WHERE ("s"."email_hash" = "encode"("sha256"("convert_to"("lower"("r"."email"), 'UTF8'::"name")), 'hex'::"text"))))));


ALTER VIEW "public"."hk_spam_marketing_recipients" OWNER TO "postgres";


COMMENT ON VIEW "public"."hk_spam_marketing_recipients" IS 'MPC-7538. The only list a marketing send may use: marketing_consent = true and not unsubscribed.';



CREATE TABLE IF NOT EXISTS "public"."hk_spam_retention" (
    "id" boolean DEFAULT true NOT NULL,
    "days" integer DEFAULT 90 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "hk_spam_retention_days_check" CHECK ((("days" >= 1) AND ("days" <= 3650))),
    CONSTRAINT "hk_spam_retention_id_check" CHECK ("id")
);

ALTER TABLE ONLY "public"."hk_spam_retention" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_spam_retention" OWNER TO "postgres";


COMMENT ON TABLE "public"."hk_spam_retention" IS 'MPC-7538. Single row: days after protection_date that an HK Stop Spam row (email and row) is deleted unless marketing_consent is true.';



CREATE TABLE IF NOT EXISTS "public"."interaction_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_state_id" "uuid",
    "channel" "text" NOT NULL,
    "intent" "text" NOT NULL,
    "intent_source" "text" NOT NULL,
    "response_key" "text" NOT NULL,
    "state_before" "text" NOT NULL,
    "state_after" "text" NOT NULL,
    "trust_before" smallint NOT NULL,
    "trust_after" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retain_until" timestamp with time zone DEFAULT ("now"() + '90 days'::interval) NOT NULL,
    CONSTRAINT "interaction_log_channel_check" CHECK ((("char_length"("channel") >= 1) AND ("char_length"("channel") <= 32))),
    CONSTRAINT "interaction_log_intent_check" CHECK (("intent" = ANY (ARRAY['scan'::"text", 'help'::"text", 'verify'::"text", 'unknown'::"text"]))),
    CONSTRAINT "interaction_log_intent_source_check" CHECK (("intent_source" = ANY (ARRAY['qwen'::"text", 'rules'::"text"]))),
    CONSTRAINT "interaction_log_response_key_check" CHECK ((("char_length"("response_key") >= 1) AND ("char_length"("response_key") <= 100))),
    CONSTRAINT "interaction_log_trust_after_check" CHECK ((("trust_after" >= 0) AND ("trust_after" <= 5))),
    CONSTRAINT "interaction_log_trust_before_check" CHECK ((("trust_before" >= 0) AND ("trust_before" <= 5)))
);

ALTER TABLE ONLY "public"."interaction_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."interaction_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."interaction_log" IS 'MPC-8601. Audit/analytics trail of core-brain routing: intent, response key and state/trust transitions. No message text and no sender id. 90 day default retention (retain_until; purge with public.mpt_purge_expired_interaction_log()). Rows go with their conversation_states row. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "user_id" "uuid",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "utm_referrer" "text",
    "consent_given_at" timestamp with time zone,
    "consent_source" "text",
    "ip_address" "inet",
    "retain_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "converted_to_user" boolean DEFAULT false NOT NULL,
    "converted_at" timestamp with time zone,
    "phone_number" "text",
    "whatsapp_opt_in" boolean DEFAULT false NOT NULL,
    "locale_code" "text",
    "confidence_score" numeric(4,3),
    CONSTRAINT "leads_confidence_score_range" CHECK ((("confidence_score" IS NULL) OR (("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (1)::numeric)))),
    CONSTRAINT "leads_email_check" CHECK (("char_length"("email") <= 255)),
    CONSTRAINT "leads_locale_code_format" CHECK ((("locale_code" IS NULL) OR ("locale_code" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text"))),
    CONSTRAINT "leads_phone_number_e164" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~ '^\+[1-9][0-9]{6,14}$'::"text"))),
    CONSTRAINT "leads_utm_campaign_check" CHECK (("char_length"("utm_campaign") <= 100)),
    CONSTRAINT "leads_utm_content_check" CHECK (("char_length"("utm_content") <= 100)),
    CONSTRAINT "leads_utm_medium_check" CHECK (("char_length"("utm_medium") <= 100)),
    CONSTRAINT "leads_utm_referrer_check" CHECK (("char_length"("utm_referrer") <= 500)),
    CONSTRAINT "leads_utm_source_check" CHECK (("char_length"("utm_source") <= 100))
);

ALTER TABLE ONLY "public"."leads" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" OWNER TO "postgres";


COMMENT ON TABLE "public"."leads" IS 'MPC-6677. UTM attribution + consent evidence per lead, deduped on lower(email). service_role only.';



COMMENT ON COLUMN "public"."leads"."phone_number" IS 'CK-006. E.164 (+15551234567). PII: collected only with consent; erase with the lead.';



COMMENT ON COLUMN "public"."leads"."whatsapp_opt_in" IS 'CK-006. True only after an explicit WhatsApp opt-in; never infer it. Evidence lives in channel_preferences.';



COMMENT ON COLUMN "public"."leads"."locale_code" IS 'CK-006. BCP 47 language tag (en, pt-BR) used to pick message/translation locale.';



COMMENT ON COLUMN "public"."leads"."confidence_score" IS 'CK-006. 0..1 identity/trust confidence for Progressive Trust; null = not scored.';



CREATE TABLE IF NOT EXISTS "public"."learning_aggregate_daily" (
    "day" "date" NOT NULL,
    "dimension" "text" NOT NULL,
    "key" "text" NOT NULL,
    "n" bigint NOT NULL,
    CONSTRAINT "learning_aggregate_daily_dimension_check" CHECK (("dimension" = ANY (ARRAY['scan'::"text", 'hexagon_result'::"text", 'funnel_step'::"text", 'bot_family'::"text", 'country_bucket'::"text", 'tile_event'::"text"]))),
    CONSTRAINT "learning_aggregate_daily_key_check" CHECK (("key" ~ '^[a-z0-9][a-z0-9_.:-]{0,95}$'::"text")),
    CONSTRAINT "learning_aggregate_daily_n_check" CHECK (("n" >= 0))
);

ALTER TABLE ONLY "public"."learning_aggregate_daily" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_aggregate_daily" OWNER TO "postgres";


COMMENT ON TABLE "public"."learning_aggregate_daily" IS 'MPC-9892. Anonymised learning aggregate: a counter per day, dimension and key. Holds no scan id, email, hash, IP, user agent, person key, fingerprint hash or free text, and nothing finer than a day. Written only by mpt_learning_count (INSERT ... ON CONFLICT n = n + p_n). Cells under 5 are shown as "<5" when published. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."localization" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "locale" "text" NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."localization" OWNER TO "postgres";


ALTER TABLE "public"."localization" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."localization_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."mpt_alert_state" (
    "name" "text" NOT NULL,
    "is_open" boolean DEFAULT false NOT NULL,
    "last_sent_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."mpt_alert_state" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_alert_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpt_api_rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "calls_made" integer DEFAULT 0 NOT NULL,
    "call_limit" integer NOT NULL,
    "reset_time" timestamp with time zone,
    "last_checked" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mpt_api_rate_limits_call_limit_check" CHECK (("call_limit" >= 0)),
    CONSTRAINT "mpt_api_rate_limits_calls_made_check" CHECK (("calls_made" >= 0))
);

ALTER TABLE ONLY "public"."mpt_api_rate_limits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_api_rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_api_rate_limits" IS 'Operational rate-limit counters. service_role only; no user-facing access.';



CREATE TABLE IF NOT EXISTS "public"."mpt_business_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token_expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    "responded_at" timestamp with time zone,
    "consent_version" "text",
    "consent_at" timestamp with time zone,
    "share_detail" boolean DEFAULT false NOT NULL,
    "results" "jsonb",
    "checked_at" timestamp with time zone,
    CONSTRAINT "business_member_data_only_when_authorised" CHECK ((("status" = 'authorised'::"text") OR (("results" IS NULL) AND ("checked_at" IS NULL) AND ("share_detail" = false)))),
    CONSTRAINT "mpt_business_members_consent_version_check" CHECK ((("consent_version" IS NULL) OR ("consent_version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'::"text"))),
    CONSTRAINT "mpt_business_members_email_check" CHECK (((("char_length"("email") >= 3) AND ("char_length"("email") <= 254)) AND ("email" = "lower"("email")))),
    CONSTRAINT "mpt_business_members_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'authorised'::"text", 'declined'::"text", 'revoked'::"text"]))),
    CONSTRAINT "mpt_business_members_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."mpt_business_members" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_business_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpt_business_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ref" "text" NOT NULL,
    "status" "text" DEFAULT 'New'::"text" NOT NULL,
    "contact_name" "text",
    "contact_email" "text" NOT NULL,
    "company" "text" NOT NULL,
    "team_size" "text",
    "consent_source" "text" DEFAULT 'business_page'::"text" NOT NULL,
    "source" "text" DEFAULT 'business_form'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "due_at" timestamp with time zone DEFAULT ("now"() + '48:00:00'::interval) NOT NULL,
    "reviewed_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "late_notified_at" timestamp with time zone,
    "delay_notice_sent_at" timestamp with time zone,
    "notes" "text",
    CONSTRAINT "mpt_business_requests_company_check" CHECK ((("char_length"("company") >= 1) AND ("char_length"("company") <= 200))),
    CONSTRAINT "mpt_business_requests_contact_email_check" CHECK (("char_length"("contact_email") <= 254)),
    CONSTRAINT "mpt_business_requests_contact_name_check" CHECK ((("contact_name" IS NULL) OR ("char_length"("contact_name") <= 100))),
    CONSTRAINT "mpt_business_requests_notes_check" CHECK ((("notes" IS NULL) OR ("char_length"("notes") <= 4000))),
    CONSTRAINT "mpt_business_requests_ref_check" CHECK (("ref" ~ '^BIZ-[A-Z2-9]{8}$'::"text")),
    CONSTRAINT "mpt_business_requests_status_check" CHECK (("status" = ANY (ARRAY['New'::"text", 'In review'::"text", 'Approved'::"text", 'Sent'::"text", 'Late'::"text"]))),
    CONSTRAINT "mpt_business_requests_team_size_check" CHECK ((("team_size" IS NULL) OR ("team_size" = ANY (ARRAY['1-10'::"text", '11-50'::"text", '51-200'::"text", '200+'::"text"]))))
);

ALTER TABLE ONLY "public"."mpt_business_requests" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_business_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_business_requests" IS 'MPC-9825. Staffed Business 48-hour results queue. created_at starts the clock, due_at = created_at + 48h (calendar hours, weekends count).';



CREATE TABLE IF NOT EXISTS "public"."mpt_business_teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_account_id" "uuid" NOT NULL,
    "company" "text" NOT NULL,
    "request_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mpt_business_teams_company_check" CHECK ((("char_length"("company") >= 1) AND ("char_length"("company") <= 200)))
);

ALTER TABLE ONLY "public"."mpt_business_teams" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_business_teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpt_channel_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform" "text" NOT NULL,
    "metric_date" "date" NOT NULL,
    "dms_sent" integer DEFAULT 0 NOT NULL,
    "responses_received" integer DEFAULT 0 NOT NULL,
    "conversion_rate" numeric(5,4),
    CONSTRAINT "mpt_channel_metrics_conversion_rate_check" CHECK ((("conversion_rate" >= (0)::numeric) AND ("conversion_rate" <= (1)::numeric))),
    CONSTRAINT "mpt_channel_metrics_dms_sent_check" CHECK (("dms_sent" >= 0)),
    CONSTRAINT "mpt_channel_metrics_responses_received_check" CHECK (("responses_received" >= 0))
);

ALTER TABLE ONLY "public"."mpt_channel_metrics" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_channel_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_channel_metrics" IS 'Aggregate channel performance. service_role only; no user-facing access.';



CREATE TABLE IF NOT EXISTS "public"."mpt_raw_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "report" "text" NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "period_start" timestamp with time zone,
    "period_end" timestamp with time zone,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "collector_version" "text" NOT NULL,
    "status" "text" DEFAULT 'ok'::"text" NOT NULL,
    "error" "text",
    CONSTRAINT "mpt_raw_metrics_check" CHECK ((("period_end" IS NULL) OR ("period_start" IS NULL) OR ("period_end" >= "period_start"))),
    CONSTRAINT "mpt_raw_metrics_check1" CHECK ((("status" <> 'error'::"text") OR ("error" IS NOT NULL))),
    CONSTRAINT "mpt_raw_metrics_collector_version_check" CHECK ((("char_length"("collector_version") >= 1) AND ("char_length"("collector_version") <= 64))),
    CONSTRAINT "mpt_raw_metrics_payload_check" CHECK ((("payload")::"text" !~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'::"text")),
    CONSTRAINT "mpt_raw_metrics_report_check" CHECK ((("char_length"("report") >= 1) AND ("char_length"("report") <= 128))),
    CONSTRAINT "mpt_raw_metrics_source_check" CHECK ((("char_length"("source") >= 1) AND ("char_length"("source") <= 64))),
    CONSTRAINT "mpt_raw_metrics_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'partial'::"text", 'error'::"text"])))
);

ALTER TABLE ONLY "public"."mpt_raw_metrics" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_raw_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_raw_metrics" IS 'MPC-7376. Append-only raw metric pulls: one row per source per pull, API response kept untouched in payload. Aggregates only, no e-mail/IP/person-level data. service_role only; views mpt_daily_metrics / mpt_weekly_metrics read it.';



COMMENT ON COLUMN "public"."mpt_raw_metrics"."source" IS 'ga4, hubspot, x, youtube, cloudflare, supabase, ... (open set; new collectors add values).';



COMMENT ON COLUMN "public"."mpt_raw_metrics"."report" IS 'Which API report or query produced the payload, e.g. ga4 daily_overview.';



COMMENT ON COLUMN "public"."mpt_raw_metrics"."period_start" IS 'Start of the period the payload covers (UTC). Views join on its UTC date.';



CREATE OR REPLACE VIEW "public"."mpt_cloudflare_daily" WITH ("security_invoker"='true') AS
 WITH "latest" AS (
         SELECT DISTINCT ON ((("mpt_raw_metrics"."payload" ->> 'day'::"text"))::"date") (("mpt_raw_metrics"."payload" ->> 'day'::"text"))::"date" AS "metric_date",
            "mpt_raw_metrics"."payload"
           FROM "public"."mpt_raw_metrics"
          WHERE (("mpt_raw_metrics"."source" = 'cloudflare'::"text") AND ("mpt_raw_metrics"."status" = 'ok'::"text"))
          ORDER BY (("mpt_raw_metrics"."payload" ->> 'day'::"text"))::"date", "mpt_raw_metrics"."captured_at" DESC
        )
 SELECT "l"."metric_date",
    (("l"."payload" #>> '{zone,data,viewer,zones,0,httpRequests1dGroups,0,uniq,uniques}'::"text"[]))::bigint AS "cloudflare_visitors",
    (("l"."payload" #>> '{zone,data,viewer,zones,0,httpRequests1dGroups,0,sum,requests}'::"text"[]))::bigint AS "cloudflare_requests",
    "w"."script_name",
    "w"."requests" AS "worker_invocations",
    "w"."errors" AS "worker_errors",
    (("zz"."z" #>> '{sum,bytes}'::"text"[]))::bigint AS "cloudflare_bandwidth_bytes",
    (("zz"."z" #>> '{sum,cachedRequests}'::"text"[]))::bigint AS "cloudflare_cached_requests",
        CASE
            WHEN ((("zz"."z" #>> '{sum,requests}'::"text"[]))::numeric > (0)::numeric) THEN "round"(((("zz"."z" #>> '{sum,cachedRequests}'::"text"[]))::numeric / (("zz"."z" #>> '{sum,requests}'::"text"[]))::numeric), 4)
            ELSE NULL::numeric
        END AS "cloudflare_cache_hit_ratio",
    ( SELECT "sum"((("e"."value" ->> 'requests'::"text"))::bigint) AS "sum"
           FROM "jsonb_array_elements"(COALESCE(("zz"."z" #> '{sum,responseStatusMap}'::"text"[]), '[]'::"jsonb")) "e"("value")
          WHERE (((("e"."value" ->> 'edgeResponseStatus'::"text"))::integer >= 400) AND ((("e"."value" ->> 'edgeResponseStatus'::"text"))::integer <= 499))) AS "cloudflare_error_4xx",
    ( SELECT "sum"((("e"."value" ->> 'requests'::"text"))::bigint) AS "sum"
           FROM "jsonb_array_elements"(COALESCE(("zz"."z" #> '{sum,responseStatusMap}'::"text"[]), '[]'::"jsonb")) "e"("value")
          WHERE (((("e"."value" ->> 'edgeResponseStatus'::"text"))::integer >= 500) AND ((("e"."value" ->> 'edgeResponseStatus'::"text"))::integer <= 599))) AS "cloudflare_error_5xx",
    COALESCE((("l"."payload" #>> '{firewall,data,viewer,zones,0,firewallEventsAdaptiveGroups,0,count}'::"text"[]))::bigint, (("zz"."z" #>> '{sum,threats}'::"text"[]))::bigint) AS "cloudflare_threats_blocked"
   FROM (("latest" "l"
     CROSS JOIN LATERAL ( SELECT ("l"."payload" #> '{zone,data,viewer,zones,0,httpRequests1dGroups,0}'::"text"[]) AS "z") "zz")
     LEFT JOIN LATERAL ( SELECT (("e"."value" -> 'dimensions'::"text") ->> 'scriptName'::"text") AS "script_name",
            ((("e"."value" -> 'sum'::"text") ->> 'requests'::"text"))::bigint AS "requests",
            ((("e"."value" -> 'sum'::"text") ->> 'errors'::"text"))::bigint AS "errors"
           FROM "jsonb_array_elements"(COALESCE(("l"."payload" #> '{workers,data,viewer,accounts,0,workersInvocationsAdaptive}'::"text"[]), '[]'::"jsonb")) "e"("value")) "w" ON (true));


ALTER VIEW "public"."mpt_cloudflare_daily" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."mpt_cloudflare_day" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("metric_date") "metric_date",
    "cloudflare_visitors",
    "cloudflare_requests",
    "cloudflare_bandwidth_bytes",
    "cloudflare_cached_requests",
    "cloudflare_cache_hit_ratio",
    "cloudflare_error_4xx",
    "cloudflare_error_5xx",
    "cloudflare_threats_blocked"
   FROM "public"."mpt_cloudflare_daily"
  ORDER BY "metric_date";


ALTER VIEW "public"."mpt_cloudflare_day" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpt_conversation_state" (
    "key" "text" NOT NULL,
    "state" "jsonb" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mpt_conversation_state_key_check" CHECK ((("char_length"("key") >= 1) AND ("char_length"("key") <= 200)))
);

ALTER TABLE ONLY "public"."mpt_conversation_state" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_conversation_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_conversation_state" IS 'Short-lived WhatsApp scan and conversation state. Every row expires within 24 h and is purged. Holds a wa_id inside state for the lifetime of the row only.';



CREATE OR REPLACE VIEW "public"."mpt_hubspot_daily" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ((("payload" ->> 'day'::"text"))::"date") (("payload" ->> 'day'::"text"))::"date" AS "metric_date",
    (NULLIF(("payload" #>> '{contacts,total}'::"text"[]), ''::"text"))::bigint AS "hubspot_total_contacts",
    (NULLIF(("payload" #>> '{contacts,created_on_day}'::"text"[]), ''::"text"))::bigint AS "hubspot_new_contacts"
   FROM "public"."mpt_raw_metrics"
  WHERE (("source" = 'hubspot'::"text") AND ("report" = 'portal_daily'::"text") AND (("payload" #>> '{contacts,total}'::"text"[]) IS NOT NULL) AND (("payload" #>> '{guard,ok}'::"text"[]) = 'true'::"text") AND (("payload" #>> '{portal_id}'::"text"[]) = '246502821'::"text"))
  ORDER BY (("payload" ->> 'day'::"text"))::"date", "captured_at" DESC;


ALTER VIEW "public"."mpt_hubspot_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpt_user_engagement" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "text" NOT NULL,
    "user_id" "uuid",
    "bridge_clicked" boolean DEFAULT false NOT NULL,
    "email_confirmed" boolean DEFAULT false NOT NULL,
    "mobile_confirmed" boolean DEFAULT false NOT NULL,
    "full_scan_completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "channel" "text",
    "whatsapp_notify_message_id" "text",
    "whatsapp_notify_error" "text",
    "whatsapp_notified_at" timestamp with time zone,
    CONSTRAINT "mpt_user_engagement_whatsapp_notify_error_check" CHECK ((("whatsapp_notify_error" IS NULL) OR ("char_length"("whatsapp_notify_error") <= 300)))
);

ALTER TABLE ONLY "public"."mpt_user_engagement" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_user_engagement" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_user_engagement" IS 'Per-session engagement funnel. Owner-read only; writes via service_role.';



COMMENT ON COLUMN "public"."mpt_user_engagement"."channel" IS 'Channel the session came from (e.g. whatsapp). Written by the webhook Worker when a deep dive is finalized. Never holds a phone number.';



CREATE OR REPLACE VIEW "public"."mpt_youtube_daily" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ((("payload" ->> 'day'::"text"))::"date") (("payload" ->> 'day'::"text"))::"date" AS "metric_date",
    (NULLIF(("payload" #>> '{summary,subscribers}'::"text"[]), ''::"text"))::bigint AS "youtube_subscribers",
    (NULLIF(("payload" #>> '{summary,total_views}'::"text"[]), ''::"text"))::bigint AS "youtube_total_views",
    (NULLIF(("payload" #>> '{summary,total_videos}'::"text"[]), ''::"text"))::bigint AS "youtube_total_videos",
    (NULLIF(("payload" #>> '{summary,videos_published_on_day}'::"text"[]), ''::"text"))::bigint AS "youtube_videos_published"
   FROM "public"."mpt_raw_metrics"
  WHERE (("source" = 'youtube'::"text") AND ("report" = 'channel_daily'::"text") AND ("status" = 'ok'::"text"))
  ORDER BY (("payload" ->> 'day'::"text"))::"date", "captured_at" DESC;


ALTER VIEW "public"."mpt_youtube_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scan_hourly_counts" (
    "hour" timestamp with time zone NOT NULL,
    "scans_created" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "scan_hourly_counts_scans_created_check" CHECK (("scans_created" >= 0))
);

ALTER TABLE ONLY "public"."scan_hourly_counts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_hourly_counts" OWNER TO "postgres";


COMMENT ON TABLE "public"."scan_hourly_counts" IS 'MPC-8659. Number of scans created per hour. Counts only: no user, email or scan reference. Kept after public.scans rows are purged so cumulative scan KPIs stay correct. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."subscribers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "source" "text",
    "scan_completed" boolean DEFAULT false,
    "risk_score" integer,
    "confirmed_count" integer,
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "consent_given_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "consent_source" "text",
    "ip_address" "text"
);

ALTER TABLE ONLY "public"."subscribers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscribers" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscribers" IS 'MyPrivacyTOOL lead capture + newsletter subscribers. System of record as of
   2026-08-02 (supersedes the Notion "MPT Leads" pipeline described in MPC-043).
   RLS is deny-by-default: writes require the service-role key, the anon key
   cannot read or write. Retention: 3 years from consent_given_at per MPC-043
   Phase 3; deletion-on-request must remove the row outright, not just flag it.';



COMMENT ON COLUMN "public"."subscribers"."consent_given_at" IS 'When consent was given. Defaults to row creation -- form submission IS the
   consent act, so this cannot be silently omitted by a caller.';



COMMENT ON COLUMN "public"."subscribers"."consent_source" IS 'Which form/version captured consent, e.g. scan_modal_v1, footer_form_v1.
   Carries the consent version so it is provable WHAT the subscriber agreed to,
   not merely that they did.';



COMMENT ON COLUMN "public"."subscribers"."ip_address" IS 'IP at time of consent -- evidence of consent under GDPR/PDPO. Is itself PII:
   covered by the retention policy below, not kept indefinitely.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "email_verified" boolean DEFAULT false NOT NULL,
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "subscription_id" "text",
    "payment_status" "text",
    "consent_given_at" timestamp with time zone,
    "consent_source" "text",
    "ip_address" "inet",
    "retain_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cohort_number" integer,
    "email_opt_out_at" timestamp with time zone,
    "referral_code" "text",
    "pro_months_earned" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "users_cohort_number_check" CHECK ((("cohort_number" >= 1) AND ("cohort_number" <= 100))),
    CONSTRAINT "users_email_check" CHECK (("char_length"("email") <= 255)),
    CONSTRAINT "users_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['active'::"text", 'cancelled'::"text", 'past_due'::"text"]))),
    CONSTRAINT "users_pro_months_earned_check" CHECK ((("pro_months_earned" >= 0) AND ("pro_months_earned" <= 12))),
    CONSTRAINT "users_referral_code_check" CHECK (("referral_code" ~ '^[A-HJ-NP-Z2-9]{8}$'::"text")),
    CONSTRAINT "users_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'basic'::"text", 'pro'::"text", 'executive'::"text"])))
);

ALTER TABLE ONLY "public"."users" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'MPC-6677 / MPC-076 5.1. service_role only. Retention: 3 years from consent_given_at; deletion on request removes the row.';



COMMENT ON COLUMN "public"."users"."cohort_number" IS 'MPC-7261. 1..100 = first-100 onboarding cohort, assigned when the first report is delivered.';



COMMENT ON COLUMN "public"."users"."email_opt_out_at" IS 'MPC-7261. Set by the signed unsubscribe link; follow-up emails never go to these users.';



COMMENT ON COLUMN "public"."users"."referral_code" IS 'MPC-7645. Public code in the share link /invite?ref=CODE. Not a secret: sending invites needs the signed manage token as well.';



COMMENT ON COLUMN "public"."users"."pro_months_earned" IS 'MPC-7645. Free Pro months earned from completed referrals (max 12). A ledger: billing applies it when Pro opens.';



CREATE OR REPLACE VIEW "public"."mpt_daily_metrics" WITH ("security_invoker"='true') AS
 WITH "bounds" AS (
         SELECT LEAST(COALESCE(( SELECT "public"."mpt_hk_date"("min"("scan_hourly_counts"."hour")) AS "mpt_hk_date"
                   FROM "public"."scan_hourly_counts"), "public"."mpt_hk_date"("now"())), COALESCE(( SELECT "public"."mpt_hk_date"("min"("mpt_raw_metrics"."period_start")) AS "mpt_hk_date"
                   FROM "public"."mpt_raw_metrics"), "public"."mpt_hk_date"("now"()))) AS "first_day"
        ), "days" AS (
         SELECT ("d"."d")::"date" AS "day"
           FROM "bounds",
            LATERAL "generate_series"(("bounds"."first_day")::timestamp without time zone, ("public"."mpt_hk_date"("now"()))::timestamp without time zone, '1 day'::interval) "d"("d")
        ), "scan_n" AS (
         SELECT "public"."mpt_hk_date"("scan_hourly_counts"."hour") AS "day",
            "sum"("scan_hourly_counts"."scans_created") AS "n"
           FROM "public"."scan_hourly_counts"
          GROUP BY ("public"."mpt_hk_date"("scan_hourly_counts"."hour"))
        ), "eng_n" AS (
         SELECT "public"."mpt_hk_date"("mpt_user_engagement"."created_at") AS "day",
            "count"(*) AS "sessions",
            "count"(*) FILTER (WHERE "mpt_user_engagement"."full_scan_completed") AS "full_scans"
           FROM "public"."mpt_user_engagement"
          GROUP BY ("public"."mpt_hk_date"("mpt_user_engagement"."created_at"))
        ), "lead_n" AS (
         SELECT "public"."mpt_hk_date"("leads"."created_at") AS "day",
            "count"(*) AS "n"
           FROM "public"."leads"
          GROUP BY ("public"."mpt_hk_date"("leads"."created_at"))
        ), "sub_n" AS (
         SELECT "public"."mpt_hk_date"("subscribers"."created_at") AS "day",
            "count"(*) AS "n"
           FROM "public"."subscribers"
          GROUP BY ("public"."mpt_hk_date"("subscribers"."created_at"))
        ), "user_n" AS (
         SELECT "public"."mpt_hk_date"("users"."created_at") AS "day",
            "count"(*) AS "n"
           FROM "public"."users"
          GROUP BY ("public"."mpt_hk_date"("users"."created_at"))
        ), "raw_n" AS (
         SELECT "public"."mpt_hk_date"("mpt_raw_metrics"."captured_at") AS "day",
            "count"(*) AS "n",
            "count"(*) FILTER (WHERE ("mpt_raw_metrics"."status" = 'error'::"text")) AS "failed"
           FROM "public"."mpt_raw_metrics"
          GROUP BY ("public"."mpt_hk_date"("mpt_raw_metrics"."captured_at"))
        ), "ga_overview" AS (
         SELECT DISTINCT ON (("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))) "public"."mpt_hk_date"("mpt_raw_metrics"."period_start") AS "day",
            "mpt_raw_metrics"."payload"
           FROM "public"."mpt_raw_metrics"
          WHERE (("mpt_raw_metrics"."source" = 'ga4'::"text") AND ("mpt_raw_metrics"."report" = 'daily_overview'::"text") AND ("mpt_raw_metrics"."status" = ANY (ARRAY['ok'::"text", 'partial'::"text"])) AND ("mpt_raw_metrics"."period_start" IS NOT NULL))
          ORDER BY ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start")), "mpt_raw_metrics"."captured_at" DESC
        ), "ga_events" AS (
         SELECT DISTINCT ON (("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))) "public"."mpt_hk_date"("mpt_raw_metrics"."period_start") AS "day",
            ( SELECT COALESCE("sum"((NULLIF(((("r"."value" -> 'metricValues'::"text") -> 0) ->> 'value'::"text"), ''::"text"))::numeric), (0)::numeric) AS "coalesce"
                   FROM "jsonb_array_elements"(COALESCE(("mpt_raw_metrics"."payload" -> 'rows'::"text"), '[]'::"jsonb")) "r"("value")
                  WHERE (((("r"."value" -> 'dimensionValues'::"text") -> 0) ->> 'value'::"text") ~~* '%scan%'::"text")) AS "scan_events"
           FROM "public"."mpt_raw_metrics"
          WHERE (("mpt_raw_metrics"."source" = 'ga4'::"text") AND ("mpt_raw_metrics"."report" = 'daily_events'::"text") AND ("mpt_raw_metrics"."status" = ANY (ARRAY['ok'::"text", 'partial'::"text"])) AND ("mpt_raw_metrics"."period_start" IS NOT NULL))
          ORDER BY ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start")), "mpt_raw_metrics"."captured_at" DESC
        )
 SELECT "days"."day",
    (( SELECT COALESCE("sum"("h"."scans_created"), (0)::numeric) AS "coalesce"
           FROM "public"."scan_hourly_counts" "h"
          WHERE ("h"."hour" < "public"."mpt_hk_ts"(("days"."day" + 1)))))::bigint AS "cumulative_scans",
    (COALESCE("scan_n"."n", (0)::numeric))::bigint AS "new_scans",
    COALESCE("eng_n"."sessions", (0)::bigint) AS "engagement_sessions",
    COALESCE("eng_n"."full_scans", (0)::bigint) AS "engagement_full_scans",
    "public"."mpt_ga4_metric"("ga_overview"."payload", 'sessions'::"text") AS "ga4_sessions",
    "public"."mpt_ga4_metric"("ga_overview"."payload", 'activeUsers'::"text") AS "ga4_active_users",
    "ga_events"."scan_events" AS "ga4_scan_events",
    COALESCE("lead_n"."n", (0)::bigint) AS "new_leads",
    COALESCE("sub_n"."n", (0)::bigint) AS "new_subscribers",
    COALESCE("user_n"."n", (0)::bigint) AS "new_users",
    COALESCE("raw_n"."n", (0)::bigint) AS "raw_rows_captured",
    COALESCE("raw_n"."failed", (0)::bigint) AS "raw_pulls_failed",
    "yt"."youtube_subscribers",
    "yt"."youtube_videos_published",
    "hs"."hubspot_total_contacts",
    "hs"."hubspot_new_contacts",
    "cf"."cloudflare_visitors",
    "cf"."cloudflare_requests",
    "cf"."cloudflare_bandwidth_bytes",
    "cf"."cloudflare_cache_hit_ratio",
    "cf"."cloudflare_error_4xx",
    "cf"."cloudflare_error_5xx",
    "cf"."cloudflare_threats_blocked"
   FROM ((((((((((("days"
     LEFT JOIN "scan_n" ON (("scan_n"."day" = "days"."day")))
     LEFT JOIN "eng_n" ON (("eng_n"."day" = "days"."day")))
     LEFT JOIN "lead_n" ON (("lead_n"."day" = "days"."day")))
     LEFT JOIN "sub_n" ON (("sub_n"."day" = "days"."day")))
     LEFT JOIN "user_n" ON (("user_n"."day" = "days"."day")))
     LEFT JOIN "raw_n" ON (("raw_n"."day" = "days"."day")))
     LEFT JOIN "ga_overview" ON (("ga_overview"."day" = "days"."day")))
     LEFT JOIN "ga_events" ON (("ga_events"."day" = "days"."day")))
     LEFT JOIN "public"."mpt_youtube_daily" "yt" ON (("yt"."metric_date" = "days"."day")))
     LEFT JOIN "public"."mpt_hubspot_daily" "hs" ON (("hs"."metric_date" = "days"."day")))
     LEFT JOIN "public"."mpt_cloudflare_day" "cf" ON (("cf"."metric_date" = "days"."day")));


ALTER VIEW "public"."mpt_daily_metrics" OWNER TO "postgres";


COMMENT ON VIEW "public"."mpt_daily_metrics" IS 'MPC-7376 / HKT follow-up. One row per Hong Kong day (00:00-24:00 HKT). cumulative_scans = rows in public.scans (D5). engagement_* and ga4_scan_events are separate signals, never merged. NULL = not collected, never an estimate. Counts only, no personal data. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."mpt_hexagon_event_rollups" (
    "day" "date" NOT NULL,
    "hexagon_id" character varying(64) NOT NULL,
    "source" character varying(64) NOT NULL,
    "config_version" integer NOT NULL,
    "shown_people" integer DEFAULT 0 NOT NULL,
    "yes_me" integer DEFAULT 0 NOT NULL,
    "not_me" integer DEFAULT 0 NOT NULL,
    "disputed" integer DEFAULT 0 NOT NULL,
    "kept" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "mpt_hexagon_event_rollups_disputed_check" CHECK (("disputed" >= 0)),
    CONSTRAINT "mpt_hexagon_event_rollups_kept_check" CHECK (("kept" >= 0)),
    CONSTRAINT "mpt_hexagon_event_rollups_not_me_check" CHECK (("not_me" >= 0)),
    CONSTRAINT "mpt_hexagon_event_rollups_shown_people_check" CHECK (("shown_people" >= 0)),
    CONSTRAINT "mpt_hexagon_event_rollups_yes_me_check" CHECK (("yes_me" >= 0))
);

ALTER TABLE ONLY "public"."mpt_hexagon_event_rollups" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_hexagon_event_rollups" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_hexagon_event_rollups" IS 'Counts left after raw events pass retention. Each person''s first answer per tile and scan window is counted once.';



CREATE TABLE IF NOT EXISTS "public"."mpt_hexagon_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" character varying(8) NOT NULL,
    "person_key" character varying(64) NOT NULL,
    "scan_window" character varying(32) NOT NULL,
    "hexagon_id" character varying(64) NOT NULL,
    "source" character varying(64) DEFAULT 'web-scan'::character varying NOT NULL,
    "tile_kind" character varying(32),
    "confidence_at_display" double precision,
    "config_version" integer DEFAULT 0 NOT NULL,
    "answer" character varying(16),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shown_event_id" "uuid",
    CONSTRAINT "mpt_hexagon_events_answer_check" CHECK ((("answer" IS NULL) OR (("answer")::"text" = ANY ((ARRAY['yes_me'::character varying, 'not_me'::character varying, 'disputed'::character varying, 'kept'::character varying])::"text"[])))),
    CONSTRAINT "mpt_hexagon_events_check" CHECK (((("event_type")::"text" = 'answer'::"text") = ("answer" IS NOT NULL))),
    CONSTRAINT "mpt_hexagon_events_confidence_at_display_check" CHECK ((("confidence_at_display" IS NULL) OR (("confidence_at_display" >= (0)::double precision) AND ("confidence_at_display" <= (1)::double precision)))),
    CONSTRAINT "mpt_hexagon_events_config_version_check" CHECK (("config_version" >= 0)),
    CONSTRAINT "mpt_hexagon_events_event_type_check" CHECK ((("event_type")::"text" = ANY ((ARRAY['shown'::character varying, 'answer'::character varying])::"text"[]))),
    CONSTRAINT "mpt_hexagon_events_person_key_check" CHECK ((("person_key")::"text" ~ '^[A-Za-z0-9_-]{16,64}$'::"text")),
    CONSTRAINT "mpt_hexagon_events_scan_window_check" CHECK ((("char_length"(("scan_window")::"text") >= 1) AND ("char_length"(("scan_window")::"text") <= 32)))
);

ALTER TABLE ONLY "public"."mpt_hexagon_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_hexagon_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_hexagon_events" IS 'Visitors'' answers about a tile, append-only. No finding value, no account, phone or email: person_key is a random browser-made id. Raw rows are rolled up and deleted after about 90 days.';



CREATE TABLE IF NOT EXISTS "public"."mpt_hexagon_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" character varying(64) NOT NULL,
    "hexagon_id" character varying(64) NOT NULL,
    "user_action" character varying(16) NOT NULL,
    "original_confidence_score" double precision,
    "osint_source" character varying(64),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mpt_hexagon_interactions_original_confidence_score_check" CHECK ((("original_confidence_score" IS NULL) OR (("original_confidence_score" >= (0)::double precision) AND ("original_confidence_score" <= (1)::double precision)))),
    CONSTRAINT "mpt_hexagon_interactions_user_action_check" CHECK ((("user_action")::"text" = ANY ((ARRAY['confirmed'::character varying, 'rejected'::character varying, 'disputed'::character varying])::"text"[])))
);

ALTER TABLE ONLY "public"."mpt_hexagon_interactions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_hexagon_interactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_hexagon_interactions" IS 'HITL answers on deep-dive findings. Append-only. confirmed counts toward the verified risk score; rejected (false_positive) and disputed never do.';



CREATE TABLE IF NOT EXISTS "public"."mpt_osint_scan_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "text" NOT NULL,
    "user_id" "uuid",
    "platform" "text" NOT NULL,
    "user_handle" "text" NOT NULL,
    "data_points_found" integer DEFAULT 0 NOT NULL,
    "confidence_score" numeric(4,3),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    CONSTRAINT "mpt_osint_scan_results_confidence_score_check" CHECK ((("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (1)::numeric))),
    CONSTRAINT "mpt_osint_scan_results_data_points_found_check" CHECK (("data_points_found" >= 0))
);

ALTER TABLE ONLY "public"."mpt_osint_scan_results" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_osint_scan_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_osint_scan_results" IS 'Per-session OSINT scan results, 24h TTL via expires_at (purge job: MPC-6957). Owner-read only; writes via service_role.';



CREATE TABLE IF NOT EXISTS "public"."mpt_score_baselines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email_hash" "text" NOT NULL,
    "overall_score" integer NOT NULL,
    "category_scores" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "score_version" "text" DEFAULT 'legacy'::"text" NOT NULL,
    CONSTRAINT "mpt_score_baselines_email_hash_check" CHECK (("email_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "mpt_score_baselines_overall_score_check" CHECK ((("overall_score" >= 0) AND ("overall_score" <= 100))),
    CONSTRAINT "mpt_score_baselines_score_version_check" CHECK ((("score_version" = 'legacy'::"text") OR ("score_version" ~ '^[a-z]+-v[0-9]{1,3}$'::"text")))
);

ALTER TABLE ONLY "public"."mpt_score_baselines" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_score_baselines" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_score_baselines" IS 'Dated baseline privacy risk score (0-100, higher = more exposed) per hashed email. One row per user, first scan wins. service_role only; no user-facing access.';



COMMENT ON COLUMN "public"."mpt_score_baselines"."score_version" IS 'MPC-7471-F4. The scoring contract that produced overall_score/category_scores. ''legacy'' = saved before the shared contract (two different old formulas); never compare across versions.';



CREATE OR REPLACE VIEW "public"."mpt_weekly_metrics" WITH ("security_invoker"='true') AS
 WITH "bounds" AS (
         SELECT ("date_trunc"('week'::"text", ("min"("mpt_daily_metrics"."day"))::timestamp without time zone))::"date" AS "first_week"
           FROM "public"."mpt_daily_metrics"
        ), "weeks" AS (
         SELECT ("w"."w")::"date" AS "week_of"
           FROM "bounds",
            LATERAL "generate_series"(("bounds"."first_week")::timestamp without time zone, "date_trunc"('week'::"text", ("public"."mpt_hk_date"("now"()))::timestamp without time zone), '7 days'::interval) "w"("w")
        ), "paid" AS (
         SELECT "count"(*) FILTER (WHERE (("users"."payment_status" = 'active'::"text") AND ("users"."tier" <> 'free'::"text"))) AS "paid_users"
           FROM "public"."users"
        ), "latest_week_count" AS (
         SELECT DISTINCT ON ("mpt_raw_metrics"."source", ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))) "mpt_raw_metrics"."source",
            "public"."mpt_hk_date"("mpt_raw_metrics"."period_start") AS "week_of",
            (NULLIF(("mpt_raw_metrics"."payload" ->> 'count'::"text"), ''::"text"))::numeric AS "n"
           FROM "public"."mpt_raw_metrics"
          WHERE (((("mpt_raw_metrics"."source" = 'blog'::"text") AND ("mpt_raw_metrics"."report" = 'posts_published'::"text")) OR (("mpt_raw_metrics"."source" = 'x'::"text") AND ("mpt_raw_metrics"."report" = 'threads_posted'::"text"))) AND ("mpt_raw_metrics"."status" = ANY (ARRAY['ok'::"text", 'partial'::"text"])) AND ("mpt_raw_metrics"."period_start" IS NOT NULL))
          ORDER BY "mpt_raw_metrics"."source", ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start")), "mpt_raw_metrics"."captured_at" DESC
        ), "ga_week" AS (
         SELECT DISTINCT ON (("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))) "public"."mpt_hk_date"("mpt_raw_metrics"."period_start") AS "week_of",
            "mpt_raw_metrics"."payload"
           FROM "public"."mpt_raw_metrics"
          WHERE (("mpt_raw_metrics"."source" = 'ga4'::"text") AND ("mpt_raw_metrics"."report" = 'weekly_overview'::"text") AND ("mpt_raw_metrics"."status" = ANY (ARRAY['ok'::"text", 'partial'::"text"])) AND ("mpt_raw_metrics"."period_start" IS NOT NULL))
          ORDER BY ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start")), "mpt_raw_metrics"."captured_at" DESC
        ), "mrr" AS (
         SELECT DISTINCT ON ((("date_trunc"('week'::"text", ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))::timestamp without time zone))::"date")) ("date_trunc"('week'::"text", ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))::timestamp without time zone))::"date" AS "week_of",
            (NULLIF(("mpt_raw_metrics"."payload" ->> 'mrr_usd'::"text"), ''::"text"))::numeric AS "mrr"
           FROM "public"."mpt_raw_metrics"
          WHERE (("mpt_raw_metrics"."source" = 'revenue'::"text") AND ("mpt_raw_metrics"."report" = 'mrr'::"text") AND ("mpt_raw_metrics"."status" = ANY (ARRAY['ok'::"text", 'partial'::"text"])) AND ("mpt_raw_metrics"."period_start" IS NOT NULL))
          ORDER BY (("date_trunc"('week'::"text", ("public"."mpt_hk_date"("mpt_raw_metrics"."period_start"))::timestamp without time zone))::"date"), "mpt_raw_metrics"."period_start" DESC, "mpt_raw_metrics"."captured_at" DESC
        )
 SELECT "weeks"."week_of",
    (( SELECT COALESCE("sum"("h"."scans_created"), (0)::numeric) AS "coalesce"
           FROM "public"."scan_hourly_counts" "h"
          WHERE ("h"."hour" < LEAST("public"."mpt_hk_ts"(("weeks"."week_of" + 7)), "public"."mpt_hk_ts"(("public"."mpt_hk_date"("now"()) + 1))))))::bigint AS "cumulative_scans",
    (( SELECT COALESCE("sum"("h"."scans_created"), (0)::numeric) AS "coalesce"
           FROM "public"."scan_hourly_counts" "h"
          WHERE (("h"."hour" >= "public"."mpt_hk_ts"("weeks"."week_of")) AND ("h"."hour" < "public"."mpt_hk_ts"(("weeks"."week_of" + 7))))))::bigint AS "weekly_new_scans",
        CASE
            WHEN (("weeks"."week_of" = ("date_trunc"('week'::"text", ("public"."mpt_hk_date"("now"()))::timestamp without time zone))::"date") AND (( SELECT COALESCE("sum"("scan_hourly_counts"."scans_created"), (0)::numeric) AS "coalesce"
               FROM "public"."scan_hourly_counts") > (0)::numeric)) THEN "round"(((100.0 * ("paid"."paid_users")::numeric) / ( SELECT "sum"("scan_hourly_counts"."scans_created") AS "sum"
               FROM "public"."scan_hourly_counts")), 2)
            ELSE NULL::numeric
        END AS "conversion_rate_pct",
    "mrr"."mrr" AS "current_mrr",
    "public"."mpt_ga4_metric"("ga_week"."payload", 'activeUsers'::"text") AS "ga4_active_users",
    "blog"."n" AS "blog_posts_published",
    "xt"."n" AS "x_threads_posted",
    (( SELECT COALESCE("sum"("d"."engagement_sessions"), (0)::numeric) AS "coalesce"
           FROM "public"."mpt_daily_metrics" "d"
          WHERE (("d"."day" >= "weeks"."week_of") AND ("d"."day" < ("weeks"."week_of" + 7)))))::bigint AS "engagement_sessions",
    (( SELECT COALESCE("sum"("d"."engagement_full_scans"), (0)::numeric) AS "coalesce"
           FROM "public"."mpt_daily_metrics" "d"
          WHERE (("d"."day" >= "weeks"."week_of") AND ("d"."day" < ("weeks"."week_of" + 7)))))::bigint AS "engagement_full_scans",
    ( SELECT "sum"("d"."ga4_scan_events") AS "sum"
           FROM "public"."mpt_daily_metrics" "d"
          WHERE (("d"."day" >= "weeks"."week_of") AND ("d"."day" < ("weeks"."week_of" + 7)))) AS "ga4_scan_events"
   FROM ((((("weeks"
     CROSS JOIN "paid")
     LEFT JOIN "mrr" ON (("mrr"."week_of" = "weeks"."week_of")))
     LEFT JOIN "ga_week" ON (("ga_week"."week_of" = "weeks"."week_of")))
     LEFT JOIN "latest_week_count" "blog" ON ((("blog"."source" = 'blog'::"text") AND ("blog"."week_of" = "weeks"."week_of"))))
     LEFT JOIN "latest_week_count" "xt" ON ((("xt"."source" = 'x'::"text") AND ("xt"."week_of" = "weeks"."week_of"))));


ALTER VIEW "public"."mpt_weekly_metrics" OWNER TO "postgres";


COMMENT ON VIEW "public"."mpt_weekly_metrics" IS 'MPC-7376 / HKT follow-up. One row per Monday-start Hong Kong week. Notion tracker mapping: week_of=Week Of, cumulative_scans=Cumulative Scans, weekly_new_scans=Weekly New Scans, conversion_rate_pct=Conversion Rate %, current_mrr=Current MRR, ga4_active_users=GA4 Active Users, blog_posts_published=Blog Posts Published, x_threads_posted=X Threads Posted. cumulative_scans = scans created as of week end, from public.scan_hourly_counts (MPC-8671) (or now) per D5. engagement_* and ga4_scan_events are separate signals. NULL = not collected. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."mpt_x_oauth_tokens" (
    "id" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mpt_x_oauth_tokens_id_check" CHECK ((("char_length"("id") >= 1) AND ("char_length"("id") <= 32)))
);

ALTER TABLE ONLY "public"."mpt_x_oauth_tokens" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_x_oauth_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."mpt_x_oauth_tokens" IS 'MPC-7628: rotating X OAuth 2.0 access/refresh token for the Mirror bot. Credentials. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."osint_engine_tuning_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hexagon_id" character varying(64) NOT NULL,
    "osint_source" character varying(64) NOT NULL,
    "action_type" character varying(24) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "osint_engine_tuning_log_action_type_check" CHECK ((("action_type")::"text" = ANY ((ARRAY['false_positive_rate'::character varying, 'dispute_rate'::character varying])::"text"[])))
);

ALTER TABLE ONLY "public"."osint_engine_tuning_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."osint_engine_tuning_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."osint_engine_tuning_log" IS 'Learning loop. rejected -> false_positive_rate, disputed -> dispute_rate. Read by the OSINT engine to lower confidence per provider.';



CREATE TABLE IF NOT EXISTS "public"."osint_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "query_type" "text" NOT NULL,
    "status" "text" DEFAULT 'found'::"text" NOT NULL,
    "result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidence_score" numeric(4,3),
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retain_until" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "osint_results_confidence_score_check" CHECK ((("confidence_score" IS NULL) OR (("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (1)::numeric)))),
    CONSTRAINT "osint_results_query_type_check" CHECK ((("char_length"("query_type") >= 1) AND ("char_length"("query_type") <= 100))),
    CONSTRAINT "osint_results_source_check" CHECK ((("char_length"("source") >= 1) AND ("char_length"("source") <= 100))),
    CONSTRAINT "osint_results_status_check" CHECK (("status" = ANY (ARRAY['found'::"text", 'not_found'::"text", 'not_checked'::"text", 'error'::"text"])))
);

ALTER TABLE ONLY "public"."osint_results" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."osint_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."osint_results" IS 'CK-006. Microdrama (MPT) OSINT findings per lead; status=not_checked records sources we could not check, never a guess. 24h default retention (retain_until). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."plan_scan_allowance" (
    "plan" "text" NOT NULL,
    "per_month" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plan_scan_allowance_per_month_check" CHECK ((("per_month" IS NULL) OR ("per_month" > 0))),
    CONSTRAINT "plan_scan_allowance_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'basic'::"text", 'pro'::"text", 'executive'::"text"])))
);

ALTER TABLE ONLY "public"."plan_scan_allowance" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_scan_allowance" OWNER TO "postgres";


COMMENT ON TABLE "public"."plan_scan_allowance" IS 'MPC-9818. Scans per calendar month (UTC) per plan; NULL = unlimited. Decided by Chris 2026-11-07: Free 1, Basic 5, Pro 25, Executive unlimited. /pricing and enforcement read the same numbers.';



CREATE TABLE IF NOT EXISTS "public"."profile_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "platform" "text" DEFAULT 'telegram'::"text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "update_id" bigint NOT NULL,
    "status" "text" NOT NULL,
    "scan_version" "text" NOT NULL,
    "risk_version" "text" NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "score" numeric(3,1),
    "consent" "jsonb" NOT NULL,
    "consent_at" timestamp with time zone,
    "get_chat" "jsonb" NOT NULL,
    "photos" "jsonb" NOT NULL,
    "report" "jsonb",
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "profile_snapshots_platform_check" CHECK (("platform" ~ '^[a-z][a-z0-9_]{0,31}$'::"text")),
    CONSTRAINT "profile_snapshots_risk_version_check" CHECK ((("char_length"("risk_version") >= 1) AND ("char_length"("risk_version") <= 40))),
    CONSTRAINT "profile_snapshots_scan_version_check" CHECK ((("char_length"("scan_version") >= 1) AND ("char_length"("scan_version") <= 40))),
    CONSTRAINT "profile_snapshots_score_check" CHECK ((("score" >= (0)::numeric) AND ("score" <= (10)::numeric))),
    CONSTRAINT "profile_snapshots_sender_id_check" CHECK (("sender_id" ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'::"text")),
    CONSTRAINT "profile_snapshots_status_check" CHECK (("status" = ANY (ARRAY['complete'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."profile_snapshots" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_snapshots" IS 'MPC-7891 Telegram baseline scan snapshots for allow-listed test accounts: getChat + getUserProfilePhotos answers (bot-specific file ids removed), score, scan/risk versions, consent link. Personal data. service_role only. Expires per expires_at.';



CREATE TABLE IF NOT EXISTS "public"."recipients_registry" (
    "key" "text" NOT NULL,
    "body" "jsonb" NOT NULL,
    "registry_hash" "text" NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recipients_registry_key_check" CHECK (("key" ~ '^[a-z0-9][a-z0-9-]*$'::"text")),
    CONSTRAINT "recipients_registry_registry_hash_check" CHECK (("registry_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."recipients_registry" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipients_registry" OWNER TO "postgres";


COMMENT ON TABLE "public"."recipients_registry" IS 'MPC-9883. Mirror of shared/recipients/recipients.json (one row per recipient). The file is authoritative; never edit rows by hand.';



CREATE OR REPLACE VIEW "public"."recipients_registry_public" AS
 SELECT "key",
    "body",
    "registry_hash",
    "synced_at"
   FROM "public"."recipients_registry";


ALTER VIEW "public"."recipients_registry_public" OWNER TO "postgres";


COMMENT ON VIEW "public"."recipients_registry_public" IS 'MPC-9883. Read-only public list of recipients (what /what-we-see and the app read). Select only.';



CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_user_id" "uuid" NOT NULL,
    "referee_user_id" "uuid",
    "invitee_hash" "text",
    "source" "text" DEFAULT 'link'::"text" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "invite_email_sent_at" timestamp with time zone,
    "signed_up_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "rewarded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "referrals_check" CHECK (("referee_user_id" IS DISTINCT FROM "referrer_user_id")),
    CONSTRAINT "referrals_check1" CHECK ((("status" = 'invited'::"text") OR ("referee_user_id" IS NOT NULL))),
    CONSTRAINT "referrals_invitee_hash_check" CHECK (("invitee_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "referrals_source_check" CHECK (("source" = ANY (ARRAY['link'::"text", 'invite_email'::"text"]))),
    CONSTRAINT "referrals_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'signed_up'::"text", 'completed'::"text"])))
);

ALTER TABLE ONLY "public"."referrals" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" OWNER TO "postgres";


COMMENT ON TABLE "public"."referrals" IS 'MPC-7645. One row per referred or invited friend. No readable invitee address: invitee_hash only.';



CREATE TABLE IF NOT EXISTS "public"."removal_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "signal_id" "uuid" NOT NULL,
    "broker_name" "text" NOT NULL,
    "status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "manual_confirmation" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "removal_tasks_broker_name_check" CHECK (("char_length"("broker_name") <= 100)),
    CONSTRAINT "removal_tasks_status_check" CHECK (("status" = ANY (ARRAY['not_started'::"text", 'in_progress'::"text", 'completed'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."removal_tasks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."removal_tasks" OWNER TO "postgres";


COMMENT ON TABLE "public"."removal_tasks" IS 'MPC-6677. Manual removal tracking per found broker signal. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."scan_consent_counts" (
    "consent_version" "text" NOT NULL,
    "deleted_n" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scan_consent_counts_consent_version_check" CHECK (("consent_version" ~ '^[0-9]{4}-[0-9]{2}-v[0-9]{1,3}$'::"text")),
    CONSTRAINT "scan_consent_counts_deleted_n_check" CHECK (("deleted_n" >= 0))
);

ALTER TABLE ONLY "public"."scan_consent_counts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_consent_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scan_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_id" "uuid" NOT NULL,
    "consent_version" "text" NOT NULL,
    "consent_text_sha256" "text" NOT NULL,
    "locale" "text" NOT NULL,
    "registry_hash" "text" NOT NULL,
    "n_hours" integer NOT NULL,
    "consented_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scan_consents_consent_text_sha256_check" CHECK (("consent_text_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "scan_consents_consent_version_check" CHECK (("consent_version" ~ '^[0-9]{4}-[0-9]{2}-v[0-9]{1,3}$'::"text")),
    CONSTRAINT "scan_consents_locale_check" CHECK (("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'::"text")),
    CONSTRAINT "scan_consents_n_hours_check" CHECK ((("n_hours" >= 1) AND ("n_hours" <= 8760))),
    CONSTRAINT "scan_consents_registry_hash_check" CHECK (("registry_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."scan_consents" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_consents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scan_consumption" (
    "scan_id" "uuid" NOT NULL,
    "subject_key" "text" NOT NULL,
    "plan" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "consumed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    CONSTRAINT "scan_consumption_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'basic'::"text", 'pro'::"text", 'executive'::"text"]))),
    CONSTRAINT "scan_consumption_subject_key_check" CHECK (("subject_key" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."scan_consumption" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_consumption" OWNER TO "postgres";


COMMENT ON TABLE "public"."scan_consumption" IS 'MPC-9818. One row per scan counted against a monthly allowance. subject_key is a hash of the lower-cased email, so typing someone else''s address cannot use up their allowance for more than 24 hours (an unconfirmed scan stops counting then). No email, no IP. Rows older than 100 days are purged by mpt_consume_scan.';



CREATE TABLE IF NOT EXISTS "public"."scan_recipient_log" (
    "id" bigint NOT NULL,
    "scan_id" "text" NOT NULL,
    "recipient_key" "text" NOT NULL,
    "items" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" NOT NULL,
    "http_status" integer,
    "code" "text",
    "at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scan_recipient_log_code_check" CHECK ((("code" IS NULL) OR ("code" ~ '^[A-Z_]{3,40}$'::"text"))),
    CONSTRAINT "scan_recipient_log_http_status_check" CHECK ((("http_status" IS NULL) OR (("http_status" >= 100) AND ("http_status" <= 599)))),
    CONSTRAINT "scan_recipient_log_items_vocab" CHECK (("items" <@ ARRAY['ip'::"text", 'user_agent'::"text", 'email'::"text", 'email_hash'::"text", 'email_domain'::"text", 'name'::"text", 'phone'::"text", 'username'::"text", 'country'::"text", 'city'::"text", 'device_profile'::"text", 'utm'::"text", 'referrer'::"text", 'scan_result'::"text", 'message_text'::"text", 'plan_name'::"text", 'password_hash_prefix'::"text", 'page_load'::"text"])),
    CONSTRAINT "scan_recipient_log_scan_id_check" CHECK ((("length"("scan_id") >= 1) AND ("length"("scan_id") <= 64))),
    CONSTRAINT "scan_recipient_log_status_check" CHECK (("status" = ANY (ARRAY['ran'::"text", 'failed'::"text", 'skipped_disabled'::"text", 'skipped_country'::"text", 'refused'::"text"])))
);

ALTER TABLE ONLY "public"."scan_recipient_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_recipient_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."scan_recipient_log" IS 'MPC-9885. Per-scan record of outbound calls: recipient key, data item NAMES, time, status. Never values.';



ALTER TABLE "public"."scan_recipient_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."scan_recipient_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."scans_deletion_log" (
    "id" bigint NOT NULL,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" NOT NULL,
    "scans_deleted" integer NOT NULL,
    "note" "text",
    CONSTRAINT "scans_deletion_log_kind_check" CHECK (("kind" = ANY (ARRAY['purge'::"text", 'purge_dry_run'::"text"]))),
    CONSTRAINT "scans_deletion_log_scans_deleted_check" CHECK (("scans_deleted" >= 0))
);

ALTER TABLE ONLY "public"."scans_deletion_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."scans_deletion_log" OWNER TO "postgres";


ALTER TABLE "public"."scans_deletion_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."scans_deletion_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "signal_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "data_source" "text" NOT NULL,
    "check_status" "text" DEFAULT 'found'::"text" NOT NULL,
    "details" "text",
    "removal_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "removal_url" "text",
    "removal_instructions" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "signals_category_check" CHECK (("category" = ANY (ARRAY['broker'::"text", 'search'::"text", 'social'::"text", 'email'::"text", 'device'::"text", 'network'::"text", 'professional'::"text", 'ai_threat'::"text"]))),
    CONSTRAINT "signals_check_status_check" CHECK (("check_status" = ANY (ARRAY['found'::"text", 'clear'::"text", 'not_checked'::"text"]))),
    CONSTRAINT "signals_data_source_check" CHECK (("char_length"("data_source") <= 100)),
    CONSTRAINT "signals_removal_status_check" CHECK (("removal_status" = ANY (ARRAY['not_started'::"text", 'in_progress'::"text", 'removed'::"text", 'manual_only'::"text"]))),
    CONSTRAINT "signals_removal_url_check" CHECK (("char_length"("removal_url") <= 500)),
    CONSTRAINT "signals_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "signals_signal_type_check" CHECK (("char_length"("signal_type") <= 100))
);

ALTER TABLE ONLY "public"."signals" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."signals" OWNER TO "postgres";


COMMENT ON TABLE "public"."signals" IS 'MPC-6677. Per-scan findings; check_status=not_checked records sources we could not check, never a guess. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."social_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform" "text" NOT NULL,
    "platform_user_id" "text" NOT NULL,
    "handle" "text",
    "follows_us" boolean,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_count" integer DEFAULT 0 NOT NULL,
    "hubspot_synced_at" timestamp with time zone,
    "retain_until" timestamp with time zone DEFAULT ("now"() + '2 years'::interval),
    CONSTRAINT "social_contacts_event_count_check" CHECK (("event_count" >= 0)),
    CONSTRAINT "social_contacts_handle_check" CHECK ((("char_length"("handle") >= 1) AND ("char_length"("handle") <= 64))),
    CONSTRAINT "social_contacts_platform_check" CHECK (("platform" ~ '^[a-z][a-z0-9_]{0,31}$'::"text")),
    CONSTRAINT "social_contacts_platform_user_id_check" CHECK ((("char_length"("platform_user_id") >= 1) AND ("char_length"("platform_user_id") <= 64)))
);

ALTER TABLE ONLY "public"."social_contacts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_contacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."social_contacts" IS 'MPC-7628. One row per platform user who followed, messaged, liked, shared or mentioned us. Public @handle + platform id only, no message text. Feeds HubSpot (the CRM). 2 year retention (retain_until). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."social_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_key" "text",
    "occurred_at" timestamp with time zone,
    "source_ref" "text",
    "data" "jsonb",
    CONSTRAINT "social_events_data_check" CHECK ((("data" IS NULL) OR (("jsonb_typeof"("data") = 'object'::"text") AND ("pg_column_size"("data") <= 4096)))),
    CONSTRAINT "social_events_event_key_check" CHECK ((("event_key" IS NULL) OR (("char_length"("event_key") >= 1) AND ("char_length"("event_key") <= 200)))),
    CONSTRAINT "social_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['dm'::"text", 'follow'::"text", 'like'::"text", 'share'::"text", 'mention'::"text", 'mirror_consent'::"text"]))),
    CONSTRAINT "social_events_source_ref_check" CHECK ((("source_ref" IS NULL) OR (("char_length"("source_ref") >= 1) AND ("char_length"("source_ref") <= 64))))
);

ALTER TABLE ONLY "public"."social_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."social_events" IS 'MPC-7628. One row per activity (dm, follow, like, share, mention, mirror_consent). Type and time only, no text. Cascades with the contact. service_role only.';



COMMENT ON COLUMN "public"."social_events"."event_key" IS 'CK-8502: the platform''s own id for this event (or a key built from its fields). Unique per contact: a redelivery is a no-op.';



COMMENT ON COLUMN "public"."social_events"."occurred_at" IS 'CK-8502: platform timestamp of the event (not our receive time).';



COMMENT ON COLUMN "public"."social_events"."source_ref" IS 'CK-8502: platform id of the public post the event relates to (content correlation). An id only, never text.';



COMMENT ON COLUMN "public"."social_events"."data" IS 'CK-8502: hexagon values sent with this event, keyed by hexagon id. Written only with the Worker flags X_CAPTURE_HEXAGONS / TELEGRAM_CAPTURE_HEXAGONS=on. Removed with the contact.';



CREATE TABLE IF NOT EXISTS "public"."support_action_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "tool" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "policy_version" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "detail" "text",
    "cost_units" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_action_receipts_cost_units_check" CHECK (("cost_units" >= 0)),
    CONSTRAINT "support_action_receipts_outcome_check" CHECK (("outcome" = ANY (ARRAY['success'::"text", 'denied'::"text", 'failed'::"text", 'unknown'::"text", 'rate_limited'::"text", 'disabled'::"text"])))
);

ALTER TABLE ONLY "public"."support_action_receipts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_action_receipts" OWNER TO "postgres";


COMMENT ON TABLE "public"."support_action_receipts" IS 'MPC-8528 proposed. Audit receipt for every tool call including denied/disabled. outcome=unknown means a side-effecting tool may have written and must not be retried or reported as success.';



CREATE TABLE IF NOT EXISTS "public"."support_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ref" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "thread_key" "text",
    "sender_handle" "text",
    "state" "text" DEFAULT 'new'::"text" NOT NULL,
    "state_reason" "text",
    "identity_level" "text" DEFAULT 'anonymous'::"text" NOT NULL,
    "linked_subject_id" "text",
    "tenant_id" "text",
    "policy_version" "text" NOT NULL,
    "knowledge_version" "text",
    "reopen_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "triage_category" "text",
    "triage_kind" "text",
    "triage_queue" "text",
    "triage_urgency" "text",
    "triage_owner" "text",
    "triage_at" timestamp with time zone,
    CONSTRAINT "support_cases_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text", 'social'::"text", 'voice'::"text"]))),
    CONSTRAINT "support_cases_check" CHECK ((("identity_level" <> 'verified'::"text") OR (("linked_subject_id" IS NOT NULL) AND ("tenant_id" IS NOT NULL)))),
    CONSTRAINT "support_cases_identity_level_check" CHECK (("identity_level" = ANY (ARRAY['anonymous'::"text", 'channel_asserted'::"text", 'verified'::"text"]))),
    CONSTRAINT "support_cases_ref_check" CHECK (("ref" ~ '^SUP-[A-Z2-9]{8}$'::"text")),
    CONSTRAINT "support_cases_reopen_count_check" CHECK (("reopen_count" >= 0)),
    CONSTRAINT "support_cases_state_check" CHECK (("state" = ANY (ARRAY['new'::"text", 'triage'::"text", 'diagnosing'::"text", 'action_running'::"text", 'waiting_customer'::"text", 'waiting_system'::"text", 'resolved'::"text", 'closed'::"text", 'reopened'::"text", 'blocked'::"text"]))),
    CONSTRAINT "support_cases_triage_category_check" CHECK (("triage_category" = ANY (ARRAY['support'::"text", 'complaint'::"text", 'unsubscribe_by_reply'::"text", 'partner'::"text", 'sales_reply'::"text", 'data_request'::"text", 'spam'::"text", 'unclassified'::"text"]))),
    CONSTRAINT "support_cases_triage_kind_check" CHECK (("triage_kind" = ANY (ARRAY['opt_out'::"text", 'data_request'::"text", 'possible_opt_out_or_data_request'::"text"]))),
    CONSTRAINT "support_cases_triage_owner_check" CHECK (("char_length"("triage_owner") <= 40)),
    CONSTRAINT "support_cases_triage_queue_check" CHECK (("triage_queue" = ANY (ARRAY['priority'::"text", 'normal'::"text", 'low_priority'::"text"]))),
    CONSTRAINT "support_cases_triage_urgency_check" CHECK (("triage_urgency" = ANY (ARRAY['high'::"text", 'normal'::"text", 'low'::"text"])))
);

ALTER TABLE ONLY "public"."support_cases" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_cases" OWNER TO "postgres";


COMMENT ON TABLE "public"."support_cases" IS 'MPC-8528 proposed. One durable support case per thread. A row exists only after intake succeeded; the reference is returned to the customer only after this insert commits. No staff-assignment or founder-escalation column by design.';



CREATE TABLE IF NOT EXISTS "public"."support_inbound_events" (
    "channel" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_inbound_events_channel_check" CHECK (("channel" = ANY (ARRAY['web'::"text", 'email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text", 'social'::"text", 'voice'::"text"]))),
    CONSTRAINT "support_inbound_events_provider_event_id_check" CHECK ((("char_length"("provider_event_id") >= 1) AND ("char_length"("provider_event_id") <= 512)))
);

ALTER TABLE ONLY "public"."support_inbound_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_inbound_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "author" "text" NOT NULL,
    "provider_event_id" "text",
    "body" "text" NOT NULL,
    "delivery" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_messages_author_check" CHECK (("author" = ANY (ARRAY['customer'::"text", 'ai'::"text", 'system'::"text"]))),
    CONSTRAINT "support_messages_body_check" CHECK (("char_length"("body") <= 20000)),
    CONSTRAINT "support_messages_check" CHECK ((("direction" <> 'inbound'::"text") OR ("provider_event_id" IS NOT NULL))),
    CONSTRAINT "support_messages_delivery_check" CHECK (("delivery" = ANY (ARRAY['queued'::"text", 'sent'::"text", 'failed'::"text", 'unknown'::"text"]))),
    CONSTRAINT "support_messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);

ALTER TABLE ONLY "public"."support_messages" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_proofs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "subject_id" "text" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    CONSTRAINT "support_proofs_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "support_proofs_subject_id_check" CHECK ((("char_length"("subject_id") >= 1) AND ("char_length"("subject_id") <= 128))),
    CONSTRAINT "support_proofs_tenant_id_check" CHECK ((("char_length"("tenant_id") >= 1) AND ("char_length"("tenant_id") <= 128))),
    CONSTRAINT "support_proofs_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE ONLY "public"."support_proofs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_proofs" OWNER TO "postgres";


COMMENT ON TABLE "public"."support_proofs" IS 'MPC-8528 proposed. Hashed single-use identity proofs. Never stores the token itself.';



CREATE TABLE IF NOT EXISTS "public"."support_usage" (
    "id" bigint NOT NULL,
    "usage_key" "text" NOT NULL,
    "cost_units" integer DEFAULT 0 NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_usage_cost_units_check" CHECK (("cost_units" >= 0))
);

ALTER TABLE ONLY "public"."support_usage" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_usage" OWNER TO "postgres";


ALTER TABLE "public"."support_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."support_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."telegram_event_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "platform" "text" DEFAULT 'telegram'::"text" NOT NULL,
    "direction" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "chat_id" "text" NOT NULL,
    "update_id" bigint,
    "session_id" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "expires_at" timestamp with time zone,
    CONSTRAINT "telegram_event_log_chat_id_check" CHECK ((("char_length"("chat_id") >= 1) AND ("char_length"("chat_id") <= 64))),
    CONSTRAINT "telegram_event_log_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text", 'brain'::"text"]))),
    CONSTRAINT "telegram_event_log_kind_check" CHECK ((("char_length"("kind") >= 1) AND ("char_length"("kind") <= 96))),
    CONSTRAINT "telegram_event_log_platform_check" CHECK (("platform" ~ '^[a-z][a-z0-9_]{0,31}$'::"text")),
    CONSTRAINT "telegram_event_log_sender_id_check" CHECK ((("char_length"("sender_id") >= 1) AND ("char_length"("sender_id") <= 64))),
    CONSTRAINT "telegram_event_log_session_id_check" CHECK ((("char_length"("session_id") >= 1) AND ("char_length"("session_id") <= 160)))
);

ALTER TABLE ONLY "public"."telegram_event_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_event_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."telegram_event_log" IS 'Full Telegram event log for allow-listed (PROBE_TELEGRAM_IDS) or opted-in (PROBE_LOG_OPTIN_IDS) accounts only, written when PROBE_MODE=on. direction in = raw update untrimmed; out = Bot API call {method, request, status, response} (never the bot token); brain = core-brain answer used to pick the reply. Linked by update_id; grouped by session_id (new session after 30 minutes of silence). expires_at per PROBE_LOG_RETENTION_DAYS (default 90, 1-365, or null for "forever"). Contains personal data. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."translation_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "source_text" "text" NOT NULL,
    "source_locale" "text" NOT NULL,
    "target_locale" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "translated_text" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "translation_queue_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "translation_queue_source_locale_check" CHECK (("source_locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text")),
    CONSTRAINT "translation_queue_source_text_check" CHECK (("char_length"("source_text") <= 10000)),
    CONSTRAINT "translation_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "translation_queue_target_locale_check" CHECK (("target_locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text"))
);

ALTER TABLE ONLY "public"."translation_queue" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."translation_queue" OWNER TO "postgres";


COMMENT ON TABLE "public"."translation_queue" IS 'CK-006. Pending machine-translation jobs (Qwen) for outbound messages by locale. service_role only.';



CREATE TABLE IF NOT EXISTS "public"."web_scan_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "web_scan_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "linked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "save_consent_at" timestamp with time zone,
    "save_consent_version" "text",
    "recognise_consent_at" timestamp with time zone,
    "recognise_consent_version" "text",
    "account_requested_at" timestamp with time zone,
    CONSTRAINT "web_scan_contacts_channel_check" CHECK (("channel" ~ '^[a-z][a-z0-9_]{1,31}$'::"text")),
    CONSTRAINT "web_scan_contacts_recognise_consent_version_check" CHECK ((("recognise_consent_version" IS NULL) OR ("recognise_consent_version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'::"text"))),
    CONSTRAINT "web_scan_contacts_save_consent_version_check" CHECK ((("save_consent_version" IS NULL) OR ("save_consent_version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'::"text")))
);

ALTER TABLE ONLY "public"."web_scan_contacts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_contacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scan_contacts" IS 'MPC-7465. Links a web scan to the contact row given afterwards. channel=email -> contact_id is public.scans.id. New channels (mobile, telegram) are new channel values, not new columns.';



COMMENT ON COLUMN "public"."web_scan_contacts"."contact_id" IS 'Id of the contact row for this channel. email: public.scans.id.';



COMMENT ON COLUMN "public"."web_scan_contacts"."save_consent_at" IS 'MPC-7470. When the visitor ticked "Save my scan result with my email ..." and submitted the contact form (Worker clock). Null on links made before D12.';



COMMENT ON COLUMN "public"."web_scan_contacts"."recognise_consent_at" IS 'MPC-7494. When the visitor ticked the separate "Recognise this device?" box at the contact step (Worker clock). Null = no recognition consent: the scan is never a recognition candidate.';



COMMENT ON COLUMN "public"."web_scan_contacts"."recognise_consent_version" IS 'MPC-7494. Version of the recognition tick-box wording the visitor saw, e.g. 2026-10-12-v1.';



COMMENT ON COLUMN "public"."web_scan_contacts"."account_requested_at" IS 'MPC-9817. Set when the visitor ticked "Keep my scan and create my free account" (one step). The account is created only when the click-to-confirm email proves the inbox (MPC-9813).';



CREATE TABLE IF NOT EXISTS "public"."web_scan_deletion_log" (
    "id" bigint NOT NULL,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" NOT NULL,
    "scans_deleted" integer NOT NULL,
    "links_deleted" integer DEFAULT 0 NOT NULL,
    "note" "text",
    CONSTRAINT "web_scan_deletion_log_kind_check" CHECK (("kind" = ANY (ARRAY['purge'::"text", 'purge_dry_run'::"text", 'by_scan_number'::"text"]))),
    CONSTRAINT "web_scan_deletion_log_links_deleted_check" CHECK (("links_deleted" >= 0)),
    CONSTRAINT "web_scan_deletion_log_scans_deleted_check" CHECK (("scans_deleted" >= 0))
);

ALTER TABLE ONLY "public"."web_scan_deletion_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_deletion_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scan_deletion_log" IS 'MPC-7488. One row per deletion run. Counts only: no scan number, contact, IP or value is ever written here.';



ALTER TABLE "public"."web_scan_deletion_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."web_scan_deletion_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."web_scan_events" (
    "id" bigint NOT NULL,
    "web_scan_id" "uuid" NOT NULL,
    "step" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seconds" integer,
    CONSTRAINT "web_scan_events_check" CHECK ((("step" = 'results_time'::"text") = ("seconds" IS NOT NULL))),
    CONSTRAINT "web_scan_events_seconds_check" CHECK ((("seconds" IS NULL) OR (("seconds" >= 0) AND ("seconds" <= 3600)))),
    CONSTRAINT "web_scan_events_step_check" CHECK (("step" = ANY (ARRAY['scan_started'::"text", 'scan_finished'::"text", 'results_viewed'::"text", 'contact_step_opened'::"text", 'contact_given'::"text", 'results_time'::"text"])))
);

ALTER TABLE ONLY "public"."web_scan_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scan_events" IS 'MPC-7493. First time each funnel step happened for a saved scan (results_time keeps the longest time reported, in seconds). No other data. Cascades from web_scans. service_role only.';



ALTER TABLE "public"."web_scan_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."web_scan_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."web_scans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'web'::"text" NOT NULL,
    "hexagon_count" integer NOT NULL,
    "results" "jsonb" NOT NULL,
    "results_bytes" integer NOT NULL,
    "consent_id" "uuid",
    "consent_version" "text",
    "consent_text_sha256" "text",
    "consent_locale" "text",
    "consent_registry_hash" "text",
    "consent_n_hours" integer,
    "consented_at" timestamp with time zone,
    CONSTRAINT "web_scans_check" CHECK ((("jsonb_typeof"("results") = 'array'::"text") AND ("jsonb_array_length"("results") = "hexagon_count"))),
    CONSTRAINT "web_scans_hexagon_count_check" CHECK ((("hexagon_count" >= 1) AND ("hexagon_count" <= 100))),
    CONSTRAINT "web_scans_results_bytes_check" CHECK ((("results_bytes" >= 2) AND ("results_bytes" <= 65536))),
    CONSTRAINT "web_scans_source_check" CHECK (("source" ~ '^[a-z0-9_-]{1,32}$'::"text"))
);

ALTER TABLE ONLY "public"."web_scans" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scans" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scans" IS 'MPC-7465. One row per completed web scan. id = random scan number. results = per-hexagon {id,label,value,icon,confidence,risk,confirmed,category} as sent by the browser (untrusted text); these values include browser-reported IP addresses, so a saved scan is personal data. No email or user id column. Retention (MPC-7470): 90 days unlinked, 12 months linked; purge with public.mpt_purge_expired_web_scans(). service_role only.';



COMMENT ON COLUMN "public"."web_scans"."id" IS 'The scan number shown to the visitor and carried to the contact step. Random; anyone who holds it can ask for the scan to be deleted.';



COMMENT ON COLUMN "public"."web_scans"."results" IS 'Untrusted browser-reported values. Never render without escaping.';



CREATE OR REPLACE VIEW "public"."web_scan_funnel" WITH ("security_invoker"='true') AS
 SELECT ("date_trunc"('day'::"text", "created_at"))::"date" AS "day",
    "count"(*) AS "scans_completed",
    "count"(*) FILTER (WHERE (EXISTS ( SELECT 1
           FROM "public"."web_scan_contacts" "c"
          WHERE ("c"."web_scan_id" = "s"."id")))) AS "scans_with_contact",
    "count"(*) FILTER (WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."web_scan_contacts" "c"
          WHERE ("c"."web_scan_id" = "s"."id"))))) AS "scans_without_contact"
   FROM "public"."web_scans" "s"
  GROUP BY (("date_trunc"('day'::"text", "created_at"))::"date");


ALTER VIEW "public"."web_scan_funnel" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."web_scan_listing_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "web_scan_id" "uuid" NOT NULL,
    "scan_id" "uuid" NOT NULL,
    "full_name" "text",
    "city_region" "text",
    "country" "text",
    "phone" "text",
    "listing_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "results" "jsonb",
    "checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "web_scan_listing_checks_city_region_check" CHECK ((("city_region" IS NULL) OR ("char_length"("city_region") <= 120))),
    CONSTRAINT "web_scan_listing_checks_country_check" CHECK ((("country" IS NULL) OR ("char_length"("country") <= 2))),
    CONSTRAINT "web_scan_listing_checks_full_name_check" CHECK ((("full_name" IS NULL) OR ("char_length"("full_name") <= 120))),
    CONSTRAINT "web_scan_listing_checks_listing_urls_check" CHECK (("cardinality"("listing_urls") <= 3)),
    CONSTRAINT "web_scan_listing_checks_phone_check" CHECK ((("phone" IS NULL) OR ("char_length"("phone") <= 32)))
);

ALTER TABLE ONLY "public"."web_scan_listing_checks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_listing_checks" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scan_listing_checks" IS 'MPC-9813. Details a visitor typed about themselves for the "show us your listing" check, and the per-page results. PERSONAL DATA. Linked to the saved scan (web_scans.id); deleted with it by scan number and purged with it after the 12-month retention (MPC-7488). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."web_scan_retention" (
    "id" boolean DEFAULT true NOT NULL,
    "months" integer DEFAULT 12 NOT NULL,
    "unlinked_days" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "web_scan_retention_id_check" CHECK ("id"),
    CONSTRAINT "web_scan_retention_months_check" CHECK ((("months" >= 1) AND ("months" <= 120))),
    CONSTRAINT "web_scan_retention_unlinked_days_check" CHECK ((("unlinked_days" IS NULL) OR (("unlinked_days" >= 1) AND ("unlinked_days" <= 3650))))
);

ALTER TABLE ONLY "public"."web_scan_retention" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_retention" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scan_retention" IS 'MPC-7488. Single row: how long saved web scans are kept. months = every scan; unlinked_days = shorter period for scans never linked to a contact (null = off).';



CREATE TABLE IF NOT EXISTS "public"."web_scan_returns" (
    "web_scan_id" "uuid" NOT NULL,
    "previous_scan_id" "uuid" NOT NULL,
    "returned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "web_scan_returns_check" CHECK (("web_scan_id" <> "previous_scan_id"))
);

ALTER TABLE ONLY "public"."web_scan_returns" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_returns" OWNER TO "postgres";


COMMENT ON TABLE "public"."web_scan_returns" IS 'MPC-7493. This scan was made by a browser that still held the earlier scan number (kept by the site, MPC-7488). That is the only way a return visit is recognised: no fingerprint matching. Cascades from either scan. service_role only.';



CREATE TABLE IF NOT EXISTS "visit_log"."country_policy" (
    "country" "text" NOT NULL,
    "ip_mode" "text" NOT NULL,
    "retention_days" integer NOT NULL,
    "derived_retention_days" integer DEFAULT 730 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text",
    CONSTRAINT "country_policy_check" CHECK (("derived_retention_days" >= "retention_days")),
    CONSTRAINT "country_policy_country_check" CHECK ((("country" = '*'::"text") OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "country_policy_derived_retention_days_check" CHECK ((("derived_retention_days" >= 1) AND ("derived_retention_days" <= 3650))),
    CONSTRAINT "country_policy_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"]))),
    CONSTRAINT "country_policy_retention_days_check" CHECK ((("retention_days" >= 1) AND ("retention_days" <= 3650)))
);

ALTER TABLE ONLY "visit_log"."country_policy" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."country_policy" OWNER TO "visit_log_writer";


COMMENT ON TABLE "visit_log"."country_policy" IS 'MPC-9889. One row per country (ISO2 of the arrival country, cf.country) plus the DEFAULT row country = ''*''. ip_mode raw = log_raw_ip, truncated = log_truncated_ip (IPv4 /24, IPv6 /48), none = do_not_log (row without IP). enabled = false writes no row. retention_days = how long a stored IP is kept; derived_retention_days = how long country / source / device / ts are kept.';



CREATE TABLE IF NOT EXISTS "visit_log"."purge_log" (
    "id" bigint NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dry_run" boolean NOT NULL,
    "country" "text" NOT NULL,
    "ips_nulled" integer DEFAULT 0 NOT NULL,
    "rows_deleted" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "visit_log"."purge_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."purge_log" OWNER TO "visit_log_writer";


COMMENT ON TABLE "visit_log"."purge_log" IS 'MPC-9889. Counts only, one row per country touched plus a ''*'' total per run. Never a value.';



ALTER TABLE "visit_log"."purge_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "visit_log"."purge_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "visit_log"."visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
)
PARTITION BY LIST ("country");

ALTER TABLE ONLY "visit_log"."visits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits" OWNER TO "visit_log_writer";


COMMENT ON TABLE "visit_log"."visits" IS 'MPC-9889. Marketing visit log: ip (shaped by policy), referrer (host + path), utm tags, country, device class, ts. No session, scan, email, hash, user agent or cookie. Partitioned by ARRIVAL country (a VPN visitor is filed under the VPN country).';



CREATE TABLE IF NOT EXISTS "visit_log"."visits_at" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_at" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_at" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_be" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_be" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_be" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_bg" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_bg" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_bg" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_cy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_cy" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_cy" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_cz" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_cz" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_cz" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_de" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_de" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_de" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_default" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_default" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_default" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_dk" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_dk" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_dk" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_ee" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_ee" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_ee" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_es" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_es" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_es" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_fi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_fi" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_fi" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_fr" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_fr" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_fr" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_gb" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_gb" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_gb" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_gr" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_gr" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_gr" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_hk" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_hk" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_hk" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_hr" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_hr" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_hr" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_hu" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_hu" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_hu" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_ie" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_ie" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_ie" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_it" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_it" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_it" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_lt" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_lt" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_lt" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_lu" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_lu" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_lu" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_lv" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_lv" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_lv" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_mt" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_mt" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_mt" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_nl" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_nl" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_nl" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_pl" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_pl" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_pl" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_pt" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_pt" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_pt" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_ro" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_ro" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_ro" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_se" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_se" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_se" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_si" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_si" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_si" OWNER TO "visit_log_writer";


CREATE TABLE IF NOT EXISTS "visit_log"."visits_sk" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country" "text" NOT NULL,
    "ip" "inet",
    "ip_mode" "text" NOT NULL,
    "referrer" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "device" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "visits_device_check" CHECK (("device" = ANY (ARRAY['mobile'::"text", 'desktop'::"text", 'tablet'::"text", 'unknown'::"text"]))),
    CONSTRAINT "visits_ip_mode_check" CHECK (("ip_mode" = ANY (ARRAY['raw'::"text", 'truncated'::"text", 'none'::"text"])))
);

ALTER TABLE ONLY "visit_log"."visits_sk" FORCE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_sk" OWNER TO "visit_log_writer";


ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_at" FOR VALUES IN ('AT');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_be" FOR VALUES IN ('BE');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_bg" FOR VALUES IN ('BG');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_cy" FOR VALUES IN ('CY');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_cz" FOR VALUES IN ('CZ');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_de" FOR VALUES IN ('DE');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_default" DEFAULT;



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_dk" FOR VALUES IN ('DK');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_ee" FOR VALUES IN ('EE');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_es" FOR VALUES IN ('ES');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_fi" FOR VALUES IN ('FI');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_fr" FOR VALUES IN ('FR');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_gb" FOR VALUES IN ('GB');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_gr" FOR VALUES IN ('GR');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_hk" FOR VALUES IN ('HK');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_hr" FOR VALUES IN ('HR');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_hu" FOR VALUES IN ('HU');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_ie" FOR VALUES IN ('IE');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_it" FOR VALUES IN ('IT');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_lt" FOR VALUES IN ('LT');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_lu" FOR VALUES IN ('LU');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_lv" FOR VALUES IN ('LV');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_mt" FOR VALUES IN ('MT');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_nl" FOR VALUES IN ('NL');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_pl" FOR VALUES IN ('PL');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_pt" FOR VALUES IN ('PT');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_ro" FOR VALUES IN ('RO');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_se" FOR VALUES IN ('SE');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_si" FOR VALUES IN ('SI');



ALTER TABLE ONLY "visit_log"."visits" ATTACH PARTITION "visit_log"."visits_sk" FOR VALUES IN ('SK');



ALTER TABLE ONLY "public"."account_plan_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."account_plan_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cairn_facts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cairn_facts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cairn_intents" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cairn_intents_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cairn_sessions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cairn_sessions_id_seq"'::"regclass");



ALTER TABLE ONLY "ledger"."backfill_batch"
    ADD CONSTRAINT "backfill_batch_pkey" PRIMARY KEY ("backfill_batch_id");



ALTER TABLE ONLY "ledger"."data_point"
    ADD CONSTRAINT "data_point_pkey" PRIMARY KEY ("data_point_id");



ALTER TABLE ONLY "ledger"."data_point_type"
    ADD CONSTRAINT "data_point_type_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "ledger"."domain_map"
    ADD CONSTRAINT "domain_map_pkey" PRIMARY KEY ("taxonomy", "source_category");



ALTER TABLE ONLY "ledger"."identity_link"
    ADD CONSTRAINT "identity_link_pkey" PRIMARY KEY ("link_id");



ALTER TABLE ONLY "ledger"."person_identifier"
    ADD CONSTRAINT "person_identifier_id_type_id_value_key" UNIQUE ("id_type", "id_value");



ALTER TABLE ONLY "ledger"."person_identifier"
    ADD CONSTRAINT "person_identifier_pkey" PRIMARY KEY ("identifier_id");



ALTER TABLE ONLY "ledger"."person"
    ADD CONSTRAINT "person_pkey" PRIMARY KEY ("person_id");



ALTER TABLE ONLY "ledger"."render_log"
    ADD CONSTRAINT "render_log_pkey" PRIMARY KEY ("render_id");



ALTER TABLE ONLY "ledger"."report_profile_item"
    ADD CONSTRAINT "report_profile_item_pkey" PRIMARY KEY ("profile", "type_code", "subject_ref");



ALTER TABLE ONLY "ledger"."report_profile"
    ADD CONSTRAINT "report_profile_pkey" PRIMARY KEY ("profile");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_event_pkey" PRIMARY KEY ("decision_id");



ALTER TABLE ONLY "ledger"."risk_education_event"
    ADD CONSTRAINT "risk_education_event_education_id_type_code_subject_key_sca_key" UNIQUE ("education_id", "type_code", "subject_key", "scan_key");



ALTER TABLE ONLY "ledger"."risk_education_event"
    ADD CONSTRAINT "risk_education_event_pkey" PRIMARY KEY ("education_id");



ALTER TABLE ONLY "ledger"."shown_event"
    ADD CONSTRAINT "shown_event_pkey" PRIMARY KEY ("shown_id");



ALTER TABLE ONLY "public"."account_plan_log"
    ADD CONSTRAINT "account_plan_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_scans"
    ADD CONSTRAINT "account_scans_pkey" PRIMARY KEY ("account_id", "web_scan_id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cairn_facts"
    ADD CONSTRAINT "cairn_facts_fact_id_key" UNIQUE ("fact_id");



ALTER TABLE ONLY "public"."cairn_facts"
    ADD CONSTRAINT "cairn_facts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cairn_intents"
    ADD CONSTRAINT "cairn_intents_intent_id_key" UNIQUE ("intent_id");



ALTER TABLE ONLY "public"."cairn_intents"
    ADD CONSTRAINT "cairn_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cairn_sessions"
    ADD CONSTRAINT "cairn_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cairn_sessions"
    ADD CONSTRAINT "cairn_sessions_session_id_key" UNIQUE ("session_id");



ALTER TABLE ONLY "public"."capability_min_tier"
    ADD CONSTRAINT "capability_min_tier_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."channel_preferences"
    ADD CONSTRAINT "channel_preferences_lead_id_channel_key" UNIQUE ("lead_id", "channel");



ALTER TABLE ONLY "public"."channel_preferences"
    ADD CONSTRAINT "channel_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_probe_captures"
    ADD CONSTRAINT "channel_probe_captures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_tokens"
    ADD CONSTRAINT "channel_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_tokens"
    ADD CONSTRAINT "channel_tokens_user_id_provider_key" UNIQUE ("user_id", "provider");



ALTER TABLE ONLY "public"."confidence_config"
    ADD CONSTRAINT "confidence_config_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."confidence_proposals"
    ADD CONSTRAINT "confidence_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_states"
    ADD CONSTRAINT "conversation_states_lead_id_channel_key" UNIQUE ("lead_id", "channel");



ALTER TABLE ONLY "public"."conversation_states"
    ADD CONSTRAINT "conversation_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dashboard_links"
    ADD CONSTRAINT "dashboard_links_pkey" PRIMARY KEY ("token_hash");



ALTER TABLE ONLY "public"."dashboard_sessions"
    ADD CONSTRAINT "dashboard_sessions_link_hash_key" UNIQUE ("link_hash");



ALTER TABLE ONLY "public"."dashboard_sessions"
    ADD CONSTRAINT "dashboard_sessions_pkey" PRIMARY KEY ("session_hash");



ALTER TABLE ONLY "public"."deep_jobs"
    ADD CONSTRAINT "deep_jobs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."deep_jobs"
    ADD CONSTRAINT "deep_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deep_osint_results"
    ADD CONSTRAINT "deep_osint_results_job_id_source_key" UNIQUE ("job_id", "source");



ALTER TABLE ONLY "public"."deep_osint_results"
    ADD CONSTRAINT "deep_osint_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deep_research_challenges"
    ADD CONSTRAINT "deep_research_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deletion_consents"
    ADD CONSTRAINT "deletion_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_visit_retention"
    ADD CONSTRAINT "edge_visit_retention_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_visits"
    ADD CONSTRAINT "edge_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_sends"
    ADD CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_sends"
    ADD CONSTRAINT "email_sends_provider_message_id_key" UNIQUE ("provider_message_id");



ALTER TABLE ONLY "public"."email_suppressions"
    ADD CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email_hash");



ALTER TABLE ONLY "public"."eradication_jobs"
    ADD CONSTRAINT "eradication_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fix_wizard_items"
    ADD CONSTRAINT "fix_wizard_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."free_record_deletion_log"
    ADD CONSTRAINT "free_record_deletion_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."free_record_policy"
    ADD CONSTRAINT "free_record_policy_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hexagon_catalogue"
    ADD CONSTRAINT "hexagon_catalogue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hexagon_catalogue"
    ADD CONSTRAINT "hexagon_catalogue_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."hexagon_findings"
    ADD CONSTRAINT "hexagon_findings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hexagon_scores"
    ADD CONSTRAINT "hexagon_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hexagon_scores"
    ADD CONSTRAINT "hexagon_scores_scan_id_category_key" UNIQUE ("scan_id", "category");



ALTER TABLE ONLY "public"."hk_shield_waitlist"
    ADD CONSTRAINT "hk_shield_waitlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hk_spam_deletion_log"
    ADD CONSTRAINT "hk_spam_deletion_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hk_spam_registrations"
    ADD CONSTRAINT "hk_spam_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hk_spam_retention"
    ADD CONSTRAINT "hk_spam_retention_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interaction_log"
    ADD CONSTRAINT "interaction_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_aggregate_daily"
    ADD CONSTRAINT "learning_aggregate_daily_pkey" PRIMARY KEY ("day", "dimension", "key");



ALTER TABLE ONLY "public"."localization"
    ADD CONSTRAINT "localization_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_alert_state"
    ADD CONSTRAINT "mpt_alert_state_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."mpt_api_rate_limits"
    ADD CONSTRAINT "mpt_api_rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_api_rate_limits"
    ADD CONSTRAINT "mpt_api_rate_limits_platform_endpoint_key" UNIQUE ("platform", "endpoint");



ALTER TABLE ONLY "public"."mpt_business_members"
    ADD CONSTRAINT "mpt_business_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_business_members"
    ADD CONSTRAINT "mpt_business_members_team_id_email_key" UNIQUE ("team_id", "email");



ALTER TABLE ONLY "public"."mpt_business_members"
    ADD CONSTRAINT "mpt_business_members_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."mpt_business_requests"
    ADD CONSTRAINT "mpt_business_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_business_requests"
    ADD CONSTRAINT "mpt_business_requests_ref_key" UNIQUE ("ref");



ALTER TABLE ONLY "public"."mpt_business_teams"
    ADD CONSTRAINT "mpt_business_teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_channel_metrics"
    ADD CONSTRAINT "mpt_channel_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_channel_metrics"
    ADD CONSTRAINT "mpt_channel_metrics_platform_metric_date_key" UNIQUE ("platform", "metric_date");



ALTER TABLE ONLY "public"."mpt_conversation_state"
    ADD CONSTRAINT "mpt_conversation_state_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."mpt_hexagon_event_rollups"
    ADD CONSTRAINT "mpt_hexagon_event_rollups_pkey" PRIMARY KEY ("day", "hexagon_id", "source", "config_version");



ALTER TABLE ONLY "public"."mpt_hexagon_events"
    ADD CONSTRAINT "mpt_hexagon_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_hexagon_interactions"
    ADD CONSTRAINT "mpt_hexagon_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_osint_scan_results"
    ADD CONSTRAINT "mpt_osint_scan_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_raw_metrics"
    ADD CONSTRAINT "mpt_raw_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_score_baselines"
    ADD CONSTRAINT "mpt_score_baselines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_user_engagement"
    ADD CONSTRAINT "mpt_user_engagement_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpt_x_oauth_tokens"
    ADD CONSTRAINT "mpt_x_oauth_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."osint_engine_tuning_log"
    ADD CONSTRAINT "osint_engine_tuning_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."osint_results"
    ADD CONSTRAINT "osint_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_scan_allowance"
    ADD CONSTRAINT "plan_scan_allowance_pkey" PRIMARY KEY ("plan");



ALTER TABLE ONLY "public"."profile_snapshots"
    ADD CONSTRAINT "profile_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipients_registry"
    ADD CONSTRAINT "recipients_registry_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referee_user_id_key" UNIQUE ("referee_user_id");



ALTER TABLE ONLY "public"."removal_tasks"
    ADD CONSTRAINT "removal_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scan_consent_counts"
    ADD CONSTRAINT "scan_consent_counts_pkey" PRIMARY KEY ("consent_version");



ALTER TABLE ONLY "public"."scan_consents"
    ADD CONSTRAINT "scan_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scan_consents"
    ADD CONSTRAINT "scan_consents_scan_id_key" UNIQUE ("scan_id");



ALTER TABLE ONLY "public"."scan_consumption"
    ADD CONSTRAINT "scan_consumption_pkey" PRIMARY KEY ("scan_id");



ALTER TABLE ONLY "public"."scan_hourly_counts"
    ADD CONSTRAINT "scan_hourly_counts_pkey" PRIMARY KEY ("hour");



ALTER TABLE ONLY "public"."scan_recipient_log"
    ADD CONSTRAINT "scan_recipient_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scans_deletion_log"
    ADD CONSTRAINT "scans_deletion_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scans"
    ADD CONSTRAINT "scans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signals"
    ADD CONSTRAINT "signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_contacts"
    ADD CONSTRAINT "social_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_contacts"
    ADD CONSTRAINT "social_contacts_platform_platform_user_id_key" UNIQUE ("platform", "platform_user_id");



ALTER TABLE ONLY "public"."social_events"
    ADD CONSTRAINT "social_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscribers"
    ADD CONSTRAINT "subscribers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."subscribers"
    ADD CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_action_receipts"
    ADD CONSTRAINT "support_action_receipts_case_id_idempotency_key_key" UNIQUE ("case_id", "idempotency_key");



ALTER TABLE ONLY "public"."support_action_receipts"
    ADD CONSTRAINT "support_action_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_cases"
    ADD CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_cases"
    ADD CONSTRAINT "support_cases_ref_key" UNIQUE ("ref");



ALTER TABLE ONLY "public"."support_inbound_events"
    ADD CONSTRAINT "support_inbound_events_pkey" PRIMARY KEY ("channel", "provider_event_id");



ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_proofs"
    ADD CONSTRAINT "support_proofs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_proofs"
    ADD CONSTRAINT "support_proofs_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."support_usage"
    ADD CONSTRAINT "support_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_event_log"
    ADD CONSTRAINT "telegram_event_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translation_queue"
    ADD CONSTRAINT "translation_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_cohort_number_key" UNIQUE ("cohort_number");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."web_scan_contacts"
    ADD CONSTRAINT "web_scan_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."web_scan_contacts"
    ADD CONSTRAINT "web_scan_contacts_web_scan_id_channel_contact_id_key" UNIQUE ("web_scan_id", "channel", "contact_id");



ALTER TABLE ONLY "public"."web_scan_deletion_log"
    ADD CONSTRAINT "web_scan_deletion_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."web_scan_events"
    ADD CONSTRAINT "web_scan_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."web_scan_events"
    ADD CONSTRAINT "web_scan_events_web_scan_id_step_key" UNIQUE ("web_scan_id", "step");



ALTER TABLE ONLY "public"."web_scan_listing_checks"
    ADD CONSTRAINT "web_scan_listing_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."web_scan_listing_checks"
    ADD CONSTRAINT "web_scan_listing_checks_scan_key" UNIQUE ("scan_id");



ALTER TABLE ONLY "public"."web_scan_retention"
    ADD CONSTRAINT "web_scan_retention_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."web_scan_returns"
    ADD CONSTRAINT "web_scan_returns_pkey" PRIMARY KEY ("web_scan_id");



ALTER TABLE ONLY "public"."web_scans"
    ADD CONSTRAINT "web_scans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "visit_log"."country_policy"
    ADD CONSTRAINT "country_policy_pkey" PRIMARY KEY ("country");



ALTER TABLE ONLY "visit_log"."purge_log"
    ADD CONSTRAINT "purge_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "visit_log"."visits"
    ADD CONSTRAINT "visits_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_at"
    ADD CONSTRAINT "visits_at_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_be"
    ADD CONSTRAINT "visits_be_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_bg"
    ADD CONSTRAINT "visits_bg_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_cy"
    ADD CONSTRAINT "visits_cy_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_cz"
    ADD CONSTRAINT "visits_cz_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_de"
    ADD CONSTRAINT "visits_de_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_default"
    ADD CONSTRAINT "visits_default_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_dk"
    ADD CONSTRAINT "visits_dk_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_ee"
    ADD CONSTRAINT "visits_ee_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_es"
    ADD CONSTRAINT "visits_es_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_fi"
    ADD CONSTRAINT "visits_fi_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_fr"
    ADD CONSTRAINT "visits_fr_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_gb"
    ADD CONSTRAINT "visits_gb_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_gr"
    ADD CONSTRAINT "visits_gr_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_hk"
    ADD CONSTRAINT "visits_hk_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_hr"
    ADD CONSTRAINT "visits_hr_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_hu"
    ADD CONSTRAINT "visits_hu_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_ie"
    ADD CONSTRAINT "visits_ie_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_it"
    ADD CONSTRAINT "visits_it_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_lt"
    ADD CONSTRAINT "visits_lt_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_lu"
    ADD CONSTRAINT "visits_lu_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_lv"
    ADD CONSTRAINT "visits_lv_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_mt"
    ADD CONSTRAINT "visits_mt_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_nl"
    ADD CONSTRAINT "visits_nl_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_pl"
    ADD CONSTRAINT "visits_pl_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_pt"
    ADD CONSTRAINT "visits_pt_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_ro"
    ADD CONSTRAINT "visits_ro_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_se"
    ADD CONSTRAINT "visits_se_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_si"
    ADD CONSTRAINT "visits_si_pkey" PRIMARY KEY ("country", "id");



ALTER TABLE ONLY "visit_log"."visits_sk"
    ADD CONSTRAINT "visits_sk_pkey" PRIMARY KEY ("country", "id");



CREATE INDEX "data_point_backfill_idx" ON "ledger"."data_point" USING "btree" ("backfill_batch_id") WHERE ("backfill_batch_id" IS NOT NULL);



CREATE UNIQUE INDEX "data_point_legacy_ref_uq" ON "ledger"."data_point" USING "btree" ("legacy_ref") WHERE ("legacy_ref" IS NOT NULL);



CREATE INDEX "data_point_person_type_idx" ON "ledger"."data_point" USING "btree" ("person_id", "type_code", "observed_at" DESC);



CREATE UNIQUE INDEX "data_point_pop_proof_session_uq" ON "ledger"."data_point" USING "btree" ("subject_ref") WHERE ("type_code" = 'phone.possession_proof'::"text");



CREATE INDEX "data_point_subject_idx" ON "ledger"."data_point" USING "btree" ("type_code", "subject_ref");



CREATE INDEX "data_point_supersedes_idx" ON "ledger"."data_point" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);



CREATE UNIQUE INDEX "data_point_type_hexagon_id_uq" ON "ledger"."data_point_type" USING "btree" ("hexagon_id") WHERE ("hexagon_id" IS NOT NULL);



CREATE UNIQUE INDEX "identity_link_pair_uq" ON "ledger"."identity_link" USING "btree" ((
CASE
    WHEN ("person_a" < "person_b") THEN "person_a"
    ELSE "person_b"
END), (
CASE
    WHEN ("person_a" < "person_b") THEN "person_b"
    ELSE "person_a"
END));



CREATE INDEX "person_identifier_person_idx" ON "ledger"."person_identifier" USING "btree" ("person_id");



CREATE INDEX "render_log_person_idx" ON "ledger"."render_log" USING "btree" ("person_id", "created_at" DESC);



CREATE INDEX "risk_decision_claim_idx" ON "ledger"."risk_decision_event" USING "btree" ("type_code", "subject_key", "scan_key", "decided_at" DESC);



CREATE INDEX "risk_decision_person_idx" ON "ledger"."risk_decision_event" USING "btree" ("person_id");



CREATE INDEX "risk_education_claim_idx" ON "ledger"."risk_education_event" USING "btree" ("type_code", "subject_key", "scan_key", "shown_at" DESC);



CREATE INDEX "risk_education_person_idx" ON "ledger"."risk_education_event" USING "btree" ("person_id");



CREATE INDEX "shown_event_person_idx" ON "ledger"."shown_event" USING "btree" ("person_id", "shown_at" DESC);



CREATE INDEX "account_scans_web_scan_idx" ON "public"."account_scans" USING "btree" ("web_scan_id");



CREATE UNIQUE INDEX "accounts_email_key" ON "public"."accounts" USING "btree" ("email");



CREATE UNIQUE INDEX "channel_preferences_one_preferred_idx" ON "public"."channel_preferences" USING "btree" ("lead_id") WHERE "is_preferred";



CREATE INDEX "channel_probe_captures_expiry_idx" ON "public"."channel_probe_captures" USING "btree" ("expires_at");



CREATE INDEX "channel_probe_captures_lookup_idx" ON "public"."channel_probe_captures" USING "btree" ("platform", "sender_id", "created_at" DESC);



CREATE UNIQUE INDEX "confidence_config_one_active" ON "public"."confidence_config" USING "btree" ((true)) WHERE "active";



CREATE INDEX "confidence_proposals_status_idx" ON "public"."confidence_proposals" USING "btree" ("status", "created_at" DESC);



CREATE UNIQUE INDEX "conversation_states_channel_sender_key" ON "public"."conversation_states" USING "btree" ("channel", "sender_id") WHERE ("sender_id" IS NOT NULL);



CREATE INDEX "dashboard_links_expiry_idx" ON "public"."dashboard_links" USING "btree" ("expires_at");



CREATE INDEX "dashboard_links_snapshot_idx" ON "public"."dashboard_links" USING "btree" ("snapshot_id");



CREATE INDEX "dashboard_sessions_expiry_idx" ON "public"."dashboard_sessions" USING "btree" ("expires_at");



CREATE INDEX "deep_jobs_expiry_idx" ON "public"."deep_jobs" USING "btree" ("expires_at");



CREATE INDEX "deep_jobs_sender_idx" ON "public"."deep_jobs" USING "btree" ("sender_id", "created_at");



CREATE INDEX "deep_research_challenges_expiry_idx" ON "public"."deep_research_challenges" USING "btree" ("expires_at");



CREATE INDEX "deep_research_challenges_subject_idx" ON "public"."deep_research_challenges" USING "btree" ("subject_hash", "channel", "created_at" DESC);



CREATE INDEX "deletion_consents_completed_idx" ON "public"."deletion_consents" USING "btree" ("eradication_completed_at");



CREATE INDEX "deletion_consents_expires_idx" ON "public"."deletion_consents" USING "btree" ("expires_at");



CREATE INDEX "edge_visits_class_seen_at_idx" ON "public"."edge_visits" USING "btree" ("class", "seen_at");



CREATE INDEX "edge_visits_ip_cut_idx" ON "public"."edge_visits" USING "btree" ("seen_at") WHERE (("ip" IS NOT NULL) AND ("class" = ANY (ARRAY['person'::"text", 'unknown'::"text"])));



CREATE INDEX "edge_visits_machine_ua_idx" ON "public"."edge_visits" USING "btree" ("user_agent", "seen_at") WHERE ("class" = ANY (ARRAY['bot'::"text", 'ai'::"text"]));



CREATE INDEX "edge_visits_seen_at_idx" ON "public"."edge_visits" USING "btree" ("seen_at");



CREATE INDEX "email_sends_email_id_idx" ON "public"."email_sends" USING "btree" ("email_id", "sent_at");



CREATE INDEX "email_sends_sent_at_idx" ON "public"."email_sends" USING "btree" ("sent_at", "email_type");



CREATE UNIQUE INDEX "eradication_jobs_active_key" ON "public"."eradication_jobs" USING "btree" ("consent_id", "category") WHERE ("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text"]));



CREATE INDEX "eradication_jobs_consent_idx" ON "public"."eradication_jobs" USING "btree" ("consent_id");



CREATE INDEX "fix_wizard_items_expiry_idx" ON "public"."fix_wizard_items" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "fix_wizard_items_uniq_idx" ON "public"."fix_wizard_items" USING "btree" ("sender_id", "baseline_snapshot_id", "issue_id");



CREATE INDEX "hexagon_catalogue_channel_idx" ON "public"."hexagon_catalogue" USING "btree" ("channel");



CREATE INDEX "hexagon_catalogue_risk_idx" ON "public"."hexagon_catalogue" USING "btree" ("risk");



CREATE INDEX "hexagon_findings_expiry_idx" ON "public"."hexagon_findings" USING "btree" ("expires_at");



CREATE INDEX "hexagon_findings_subject_idx" ON "public"."hexagon_findings" USING "btree" ("subject_hash", "created_at" DESC);



CREATE INDEX "hk_shield_waitlist_created_idx" ON "public"."hk_shield_waitlist" USING "btree" ("created_at");



CREATE UNIQUE INDEX "hk_shield_waitlist_email_uidx" ON "public"."hk_shield_waitlist" USING "btree" ("lower"("email"));



CREATE INDEX "hk_spam_registrations_protection_date_idx" ON "public"."hk_spam_registrations" USING "btree" ("protection_date");



CREATE INDEX "idx_cairn_facts_confidence" ON "public"."cairn_facts" USING "btree" ("confidence_score" DESC);



CREATE INDEX "idx_cairn_facts_created_at" ON "public"."cairn_facts" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cairn_facts_description_fts" ON "public"."cairn_facts" USING "gin" ("to_tsvector"('"english"'::"regconfig", "description"));



CREATE INDEX "idx_cairn_facts_fact_type" ON "public"."cairn_facts" USING "btree" ("fact_type");



CREATE INDEX "idx_cairn_facts_session_id" ON "public"."cairn_facts" USING "btree" ("session_id");



CREATE INDEX "idx_cairn_intents_created_at" ON "public"."cairn_intents" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cairn_intents_creator" ON "public"."cairn_intents" USING "btree" ("creator");



CREATE INDEX "idx_cairn_intents_from_facts" ON "public"."cairn_intents" USING "gin" ("from_fact_ids");



CREATE INDEX "idx_cairn_intents_session_id" ON "public"."cairn_intents" USING "btree" ("session_id");



CREATE INDEX "idx_cairn_intents_status" ON "public"."cairn_intents" USING "btree" ("status");



CREATE INDEX "idx_cairn_sessions_created_at" ON "public"."cairn_sessions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cairn_sessions_retain_until" ON "public"."cairn_sessions" USING "btree" ("retain_until");



CREATE INDEX "idx_cairn_sessions_status" ON "public"."cairn_sessions" USING "btree" ("status");



CREATE INDEX "idx_cairn_sessions_user_id" ON "public"."cairn_sessions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_localization_key_locale" ON "public"."localization" USING "btree" ("key", "locale");



CREATE INDEX "interaction_log_created_idx" ON "public"."interaction_log" USING "btree" ("created_at" DESC);



CREATE INDEX "interaction_log_retain_until_idx" ON "public"."interaction_log" USING "btree" ("retain_until");



CREATE INDEX "interaction_log_state_idx" ON "public"."interaction_log" USING "btree" ("conversation_state_id", "created_at" DESC);



CREATE UNIQUE INDEX "leads_email_lower_key" ON "public"."leads" USING "btree" ("lower"("email"));



CREATE INDEX "leads_user_id_idx" ON "public"."leads" USING "btree" ("user_id");



CREATE INDEX "mpt_business_members_team_idx" ON "public"."mpt_business_members" USING "btree" ("team_id");



CREATE INDEX "mpt_business_requests_dedupe_idx" ON "public"."mpt_business_requests" USING "btree" ("contact_email", "company", "created_at");



CREATE INDEX "mpt_business_requests_open_due_idx" ON "public"."mpt_business_requests" USING "btree" ("due_at") WHERE ("status" <> 'Sent'::"text");



CREATE INDEX "mpt_business_teams_admin_idx" ON "public"."mpt_business_teams" USING "btree" ("admin_account_id");



CREATE INDEX "mpt_conversation_state_expires_idx" ON "public"."mpt_conversation_state" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "mpt_hexagon_events_answer_once" ON "public"."mpt_hexagon_events" USING "btree" ("person_key", "hexagon_id", "source", "scan_window", "answer") WHERE (("event_type")::"text" = 'answer'::"text");



CREATE INDEX "mpt_hexagon_events_created_idx" ON "public"."mpt_hexagon_events" USING "btree" ("created_at");



CREATE UNIQUE INDEX "mpt_hexagon_events_shown_once" ON "public"."mpt_hexagon_events" USING "btree" ("person_key", "hexagon_id", "source", "scan_window") WHERE (("event_type")::"text" = 'shown'::"text");



CREATE INDEX "mpt_hexagon_events_tile_idx" ON "public"."mpt_hexagon_events" USING "btree" ("hexagon_id", "source", "event_type", "created_at" DESC);



CREATE INDEX "mpt_hexagon_interactions_session_idx" ON "public"."mpt_hexagon_interactions" USING "btree" ("scan_session_id", "hexagon_id", "created_at" DESC);



CREATE INDEX "mpt_osint_scan_results_expires_at_idx" ON "public"."mpt_osint_scan_results" USING "btree" ("expires_at");



CREATE INDEX "mpt_osint_scan_results_session_id_idx" ON "public"."mpt_osint_scan_results" USING "btree" ("session_id");



CREATE INDEX "mpt_osint_scan_results_user_id_idx" ON "public"."mpt_osint_scan_results" USING "btree" ("user_id");



CREATE INDEX "mpt_raw_metrics_captured_at_idx" ON "public"."mpt_raw_metrics" USING "btree" ("captured_at" DESC);



CREATE INDEX "mpt_raw_metrics_source_report_period_idx" ON "public"."mpt_raw_metrics" USING "btree" ("source", "report", "period_start" DESC, "captured_at" DESC);



CREATE UNIQUE INDEX "mpt_score_baselines_email_version_key" ON "public"."mpt_score_baselines" USING "btree" ("email_hash", "score_version");



CREATE INDEX "mpt_user_engagement_session_id_idx" ON "public"."mpt_user_engagement" USING "btree" ("session_id");



CREATE INDEX "mpt_user_engagement_user_id_idx" ON "public"."mpt_user_engagement" USING "btree" ("user_id");



CREATE INDEX "osint_engine_tuning_log_source_idx" ON "public"."osint_engine_tuning_log" USING "btree" ("osint_source", "action_type", "created_at" DESC);



CREATE INDEX "osint_results_lead_id_idx" ON "public"."osint_results" USING "btree" ("lead_id", "fetched_at" DESC);



CREATE INDEX "osint_results_retain_until_idx" ON "public"."osint_results" USING "btree" ("retain_until");



CREATE UNIQUE INDEX "profile_snapshots_dedupe_idx" ON "public"."profile_snapshots" USING "btree" ("platform", "sender_id", "update_id");



CREATE INDEX "profile_snapshots_expiry_idx" ON "public"."profile_snapshots" USING "btree" ("expires_at");



CREATE INDEX "profile_snapshots_sender_idx" ON "public"."profile_snapshots" USING "btree" ("sender_id", "created_at");



CREATE UNIQUE INDEX "referrals_referrer_invitee_key" ON "public"."referrals" USING "btree" ("referrer_user_id", "invitee_hash") WHERE ("invitee_hash" IS NOT NULL);



CREATE INDEX "referrals_referrer_status_idx" ON "public"."referrals" USING "btree" ("referrer_user_id", "status");



CREATE INDEX "removal_tasks_signal_id_idx" ON "public"."removal_tasks" USING "btree" ("signal_id");



CREATE INDEX "removal_tasks_user_status_idx" ON "public"."removal_tasks" USING "btree" ("user_id", "status");



CREATE INDEX "scan_consumption_subject_idx" ON "public"."scan_consumption" USING "btree" ("subject_key", "period_start");



CREATE INDEX "scan_recipient_log_scan_idx" ON "public"."scan_recipient_log" USING "btree" ("scan_id", "at");



CREATE INDEX "scans_delete_after_idx" ON "public"."scans" USING "btree" ("delete_after") WHERE ("delete_after" IS NOT NULL);



CREATE INDEX "scans_followup_idx" ON "public"."scans" USING "btree" ("report_status", "followup_stage", "report_sent_at");



CREATE INDEX "scans_report_queue_idx" ON "public"."scans" USING "btree" ("report_status", "report_due_at");



CREATE UNIQUE INDEX "scans_request_id_key" ON "public"."scans" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);



CREATE INDEX "scans_resend_message_id_idx" ON "public"."scans" USING "btree" ("resend_message_id") WHERE ("resend_message_id" IS NOT NULL);



CREATE INDEX "scans_user_date_idx" ON "public"."scans" USING "btree" ("user_id", "scan_date");



CREATE INDEX "signals_removal_status_idx" ON "public"."signals" USING "btree" ("removal_status");



CREATE INDEX "signals_scan_idx" ON "public"."signals" USING "btree" ("scan_id");



CREATE INDEX "social_contacts_unsynced_idx" ON "public"."social_contacts" USING "btree" ("last_seen_at") WHERE ("hubspot_synced_at" IS NULL);



CREATE UNIQUE INDEX "social_events_contact_event_key_idx" ON "public"."social_events" USING "btree" ("contact_id", "event_key") WHERE ("event_key" IS NOT NULL);



CREATE INDEX "social_events_contact_idx" ON "public"."social_events" USING "btree" ("contact_id", "created_at" DESC);



CREATE INDEX "subscribers_consent_given_at_idx" ON "public"."subscribers" USING "btree" ("consent_given_at" DESC);



CREATE INDEX "subscribers_created_at_idx" ON "public"."subscribers" USING "btree" ("created_at" DESC);



CREATE INDEX "support_cases_state_updated_idx" ON "public"."support_cases" USING "btree" ("state", "updated_at");



CREATE UNIQUE INDEX "support_cases_thread_uq" ON "public"."support_cases" USING "btree" ("channel", "thread_key") WHERE ("thread_key" IS NOT NULL);



CREATE INDEX "support_cases_triage_queue_idx" ON "public"."support_cases" USING "btree" ("triage_queue", "created_at") WHERE ("triage_queue" IS NOT NULL);



CREATE INDEX "support_messages_case_idx" ON "public"."support_messages" USING "btree" ("case_id", "created_at");



CREATE UNIQUE INDEX "support_messages_inbound_uq" ON "public"."support_messages" USING "btree" ("case_id", "provider_event_id") WHERE ("direction" = 'inbound'::"text");



CREATE INDEX "support_proofs_expires_idx" ON "public"."support_proofs" USING "btree" ("expires_at");



CREATE INDEX "support_usage_key_at_idx" ON "public"."support_usage" USING "btree" ("usage_key", "at");



CREATE INDEX "telegram_event_log_chat_idx" ON "public"."telegram_event_log" USING "btree" ("chat_id", "created_at");



CREATE UNIQUE INDEX "telegram_event_log_dedupe_idx" ON "public"."telegram_event_log" USING "btree" ("direction", "update_id", "kind") WHERE ("update_id" IS NOT NULL);



CREATE INDEX "telegram_event_log_expiry_idx" ON "public"."telegram_event_log" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "telegram_event_log_sender_idx" ON "public"."telegram_event_log" USING "btree" ("sender_id", "created_at");



CREATE INDEX "telegram_event_log_session_idx" ON "public"."telegram_event_log" USING "btree" ("session_id");



CREATE INDEX "translation_queue_lead_id_idx" ON "public"."translation_queue" USING "btree" ("lead_id");



CREATE INDEX "translation_queue_pending_idx" ON "public"."translation_queue" USING "btree" ("created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));



CREATE UNIQUE INDEX "users_email_lower_key" ON "public"."users" USING "btree" ("lower"("email"));



CREATE INDEX "web_scan_contacts_contact_idx" ON "public"."web_scan_contacts" USING "btree" ("channel", "contact_id");



CREATE INDEX "web_scan_contacts_web_scan_id_idx" ON "public"."web_scan_contacts" USING "btree" ("web_scan_id");



CREATE INDEX "web_scan_events_step_idx" ON "public"."web_scan_events" USING "btree" ("step", "occurred_at");



CREATE INDEX "web_scan_listing_checks_web_scan_idx" ON "public"."web_scan_listing_checks" USING "btree" ("web_scan_id");



CREATE INDEX "web_scan_returns_returned_at_idx" ON "public"."web_scan_returns" USING "btree" ("returned_at");



CREATE INDEX "web_scans_created_at_idx" ON "public"."web_scans" USING "btree" ("created_at");



CREATE INDEX "purge_log_run_idx" ON "visit_log"."purge_log" USING "btree" ("run_at") WHERE ("country" = '*'::"text");



CREATE INDEX "visits_ts_idx" ON ONLY "visit_log"."visits" USING "btree" ("ts");



CREATE INDEX "visits_at_ts_idx" ON "visit_log"."visits_at" USING "btree" ("ts");



CREATE INDEX "visits_be_ts_idx" ON "visit_log"."visits_be" USING "btree" ("ts");



CREATE INDEX "visits_bg_ts_idx" ON "visit_log"."visits_bg" USING "btree" ("ts");



CREATE INDEX "visits_cy_ts_idx" ON "visit_log"."visits_cy" USING "btree" ("ts");



CREATE INDEX "visits_cz_ts_idx" ON "visit_log"."visits_cz" USING "btree" ("ts");



CREATE INDEX "visits_de_ts_idx" ON "visit_log"."visits_de" USING "btree" ("ts");



CREATE INDEX "visits_default_ts_idx" ON "visit_log"."visits_default" USING "btree" ("ts");



CREATE INDEX "visits_dk_ts_idx" ON "visit_log"."visits_dk" USING "btree" ("ts");



CREATE INDEX "visits_ee_ts_idx" ON "visit_log"."visits_ee" USING "btree" ("ts");



CREATE INDEX "visits_es_ts_idx" ON "visit_log"."visits_es" USING "btree" ("ts");



CREATE INDEX "visits_fi_ts_idx" ON "visit_log"."visits_fi" USING "btree" ("ts");



CREATE INDEX "visits_fr_ts_idx" ON "visit_log"."visits_fr" USING "btree" ("ts");



CREATE INDEX "visits_gb_ts_idx" ON "visit_log"."visits_gb" USING "btree" ("ts");



CREATE INDEX "visits_gr_ts_idx" ON "visit_log"."visits_gr" USING "btree" ("ts");



CREATE INDEX "visits_hk_ts_idx" ON "visit_log"."visits_hk" USING "btree" ("ts");



CREATE INDEX "visits_hr_ts_idx" ON "visit_log"."visits_hr" USING "btree" ("ts");



CREATE INDEX "visits_hu_ts_idx" ON "visit_log"."visits_hu" USING "btree" ("ts");



CREATE INDEX "visits_ie_ts_idx" ON "visit_log"."visits_ie" USING "btree" ("ts");



CREATE INDEX "visits_it_ts_idx" ON "visit_log"."visits_it" USING "btree" ("ts");



CREATE INDEX "visits_lt_ts_idx" ON "visit_log"."visits_lt" USING "btree" ("ts");



CREATE INDEX "visits_lu_ts_idx" ON "visit_log"."visits_lu" USING "btree" ("ts");



CREATE INDEX "visits_lv_ts_idx" ON "visit_log"."visits_lv" USING "btree" ("ts");



CREATE INDEX "visits_mt_ts_idx" ON "visit_log"."visits_mt" USING "btree" ("ts");



CREATE INDEX "visits_nl_ts_idx" ON "visit_log"."visits_nl" USING "btree" ("ts");



CREATE INDEX "visits_pl_ts_idx" ON "visit_log"."visits_pl" USING "btree" ("ts");



CREATE INDEX "visits_pt_ts_idx" ON "visit_log"."visits_pt" USING "btree" ("ts");



CREATE INDEX "visits_ro_ts_idx" ON "visit_log"."visits_ro" USING "btree" ("ts");



CREATE INDEX "visits_se_ts_idx" ON "visit_log"."visits_se" USING "btree" ("ts");



CREATE INDEX "visits_si_ts_idx" ON "visit_log"."visits_si" USING "btree" ("ts");



CREATE INDEX "visits_sk_ts_idx" ON "visit_log"."visits_sk" USING "btree" ("ts");



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_at_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_at_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_be_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_be_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_bg_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_bg_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_cy_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_cy_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_cz_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_cz_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_de_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_de_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_default_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_default_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_dk_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_dk_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_ee_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_ee_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_es_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_es_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_fi_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_fi_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_fr_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_fr_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_gb_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_gb_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_gr_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_gr_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_hk_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_hk_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_hr_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_hr_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_hu_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_hu_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_ie_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_ie_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_it_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_it_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_lt_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_lt_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_lu_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_lu_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_lv_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_lv_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_mt_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_mt_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_nl_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_nl_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_pl_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_pl_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_pt_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_pt_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_ro_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_ro_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_se_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_se_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_si_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_si_ts_idx";



ALTER INDEX "visit_log"."visits_pkey" ATTACH PARTITION "visit_log"."visits_sk_pkey";



ALTER INDEX "visit_log"."visits_ts_idx" ATTACH PARTITION "visit_log"."visits_sk_ts_idx";



CREATE OR REPLACE TRIGGER "data_point_append_only" BEFORE DELETE OR UPDATE ON "ledger"."data_point" FOR EACH ROW EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "data_point_h18_not_allowed" BEFORE INSERT ON "ledger"."data_point" FOR EACH ROW EXECUTE FUNCTION "ledger"."_data_point_h18_not_allowed"();



CREATE OR REPLACE TRIGGER "data_point_no_truncate" BEFORE TRUNCATE ON "ledger"."data_point" FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "data_point_validate" BEFORE INSERT ON "ledger"."data_point" FOR EACH ROW EXECUTE FUNCTION "ledger"."_data_point_validate"();



CREATE OR REPLACE TRIGGER "render_log_append_only" BEFORE DELETE OR UPDATE ON "ledger"."render_log" FOR EACH ROW EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "render_log_no_truncate" BEFORE TRUNCATE ON "ledger"."render_log" FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "report_profile_item_h18" BEFORE INSERT OR UPDATE ON "ledger"."report_profile_item" FOR EACH ROW EXECUTE FUNCTION "ledger"."_profile_item_h18"();



CREATE OR REPLACE TRIGGER "risk_decision_append_only" BEFORE DELETE OR UPDATE ON "ledger"."risk_decision_event" FOR EACH ROW EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "risk_decision_no_truncate" BEFORE TRUNCATE ON "ledger"."risk_decision_event" FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "risk_decision_validate" BEFORE INSERT ON "ledger"."risk_decision_event" FOR EACH ROW EXECUTE FUNCTION "ledger"."_risk_decision_validate"();



CREATE OR REPLACE TRIGGER "risk_education_append_only" BEFORE DELETE OR UPDATE ON "ledger"."risk_education_event" FOR EACH ROW EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "risk_education_no_truncate" BEFORE TRUNCATE ON "ledger"."risk_education_event" FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "risk_education_validate" BEFORE INSERT ON "ledger"."risk_education_event" FOR EACH ROW EXECUTE FUNCTION "ledger"."_risk_education_validate"();



CREATE OR REPLACE TRIGGER "shown_event_append_only" BEFORE DELETE OR UPDATE ON "ledger"."shown_event" FOR EACH ROW EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "shown_event_no_truncate" BEFORE TRUNCATE ON "ledger"."shown_event" FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."_append_only"();



CREATE OR REPLACE TRIGGER "channel_preferences_set_updated_at" BEFORE UPDATE ON "public"."channel_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_set_updated_at"();



CREATE OR REPLACE TRIGGER "conversation_states_set_updated_at" BEFORE UPDATE ON "public"."conversation_states" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_set_updated_at"();



CREATE OR REPLACE TRIGGER "mpt_hexagon_events_link_answer" BEFORE INSERT ON "public"."mpt_hexagon_events" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_hexagon_events_link_answer"();



CREATE OR REPLACE TRIGGER "mpt_learning_absorb_edge_visit" BEFORE DELETE ON "public"."edge_visits" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_learning_absorb_edge_visit"();



CREATE OR REPLACE TRIGGER "mpt_learning_absorb_web_scan" BEFORE DELETE ON "public"."web_scans" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_learning_absorb_web_scan"();



CREATE OR REPLACE TRIGGER "mpt_raw_metrics_no_truncate" BEFORE TRUNCATE ON "public"."mpt_raw_metrics" FOR EACH STATEMENT EXECUTE FUNCTION "public"."mpt_raw_metrics_block_changes"();



CREATE OR REPLACE TRIGGER "mpt_raw_metrics_no_update_delete" BEFORE DELETE OR UPDATE ON "public"."mpt_raw_metrics" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_raw_metrics_block_changes"();



CREATE OR REPLACE TRIGGER "mpt_users_opt_out_to_suppression" AFTER INSERT OR UPDATE OF "email_opt_out_at" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_users_opt_out_to_suppression"();



CREATE OR REPLACE TRIGGER "removal_tasks_set_updated_at" BEFORE UPDATE ON "public"."removal_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_set_updated_at"();



CREATE OR REPLACE TRIGGER "scans_count_hourly" AFTER INSERT ON "public"."scans" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_count_scan_hourly"();



CREATE OR REPLACE TRIGGER "scans_delete_children" AFTER DELETE ON "public"."scans" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_scans_delete_children"();



CREATE OR REPLACE TRIGGER "scans_set_delete_after" BEFORE INSERT OR UPDATE OF "report_sent_at", "delivery_status", "delivery_status_at", "kept_at", "consent_id" ON "public"."scans" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_scans_set_delete_after"();



CREATE OR REPLACE TRIGGER "translation_queue_set_updated_at" BEFORE UPDATE ON "public"."translation_queue" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_set_updated_at"();



CREATE OR REPLACE TRIGGER "users_set_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_set_updated_at"();



CREATE OR REPLACE TRIGGER "web_scans_delete_children" AFTER DELETE ON "public"."web_scans" FOR EACH ROW EXECUTE FUNCTION "public"."mpt_web_scans_delete_children"();



CREATE OR REPLACE TRIGGER "country_policy_partition" AFTER INSERT ON "visit_log"."country_policy" FOR EACH ROW EXECUTE FUNCTION "visit_log"."country_policy_partition"();



ALTER TABLE ONLY "ledger"."data_point"
    ADD CONSTRAINT "data_point_backfill_batch_id_fkey" FOREIGN KEY ("backfill_batch_id") REFERENCES "ledger"."backfill_batch"("backfill_batch_id");



ALTER TABLE ONLY "ledger"."data_point"
    ADD CONSTRAINT "data_point_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."data_point"
    ADD CONSTRAINT "data_point_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "ledger"."data_point"("data_point_id");



ALTER TABLE ONLY "ledger"."data_point"
    ADD CONSTRAINT "data_point_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "ledger"."data_point_type"("code");



ALTER TABLE ONLY "ledger"."identity_link"
    ADD CONSTRAINT "identity_link_person_a_fkey" FOREIGN KEY ("person_a") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."identity_link"
    ADD CONSTRAINT "identity_link_person_b_fkey" FOREIGN KEY ("person_b") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."person_identifier"
    ADD CONSTRAINT "person_identifier_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."person"
    ADD CONSTRAINT "person_merged_into_fkey" FOREIGN KEY ("merged_into") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."render_log"
    ADD CONSTRAINT "render_log_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."report_profile_item"
    ADD CONSTRAINT "report_profile_item_profile_fkey" FOREIGN KEY ("profile") REFERENCES "ledger"."report_profile"("profile");



ALTER TABLE ONLY "ledger"."report_profile_item"
    ADD CONSTRAINT "report_profile_item_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "ledger"."data_point_type"("code");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_education_fk" FOREIGN KEY ("education_id", "type_code", "subject_key", "scan_key") REFERENCES "ledger"."risk_education_event"("education_id", "type_code", "subject_key", "scan_key");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_event_data_point_id_fkey" FOREIGN KEY ("data_point_id") REFERENCES "ledger"."data_point"("data_point_id");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_event_evidence_data_point_id_fkey" FOREIGN KEY ("evidence_data_point_id") REFERENCES "ledger"."data_point"("data_point_id");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_event_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_event_render_id_fkey" FOREIGN KEY ("render_id") REFERENCES "ledger"."render_log"("render_id");



ALTER TABLE ONLY "ledger"."risk_decision_event"
    ADD CONSTRAINT "risk_decision_event_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "ledger"."data_point_type"("code");



ALTER TABLE ONLY "ledger"."risk_education_event"
    ADD CONSTRAINT "risk_education_event_data_point_id_fkey" FOREIGN KEY ("data_point_id") REFERENCES "ledger"."data_point"("data_point_id");



ALTER TABLE ONLY "ledger"."risk_education_event"
    ADD CONSTRAINT "risk_education_event_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."risk_education_event"
    ADD CONSTRAINT "risk_education_event_render_id_fkey" FOREIGN KEY ("render_id") REFERENCES "ledger"."render_log"("render_id");



ALTER TABLE ONLY "ledger"."risk_education_event"
    ADD CONSTRAINT "risk_education_event_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "ledger"."data_point_type"("code");



ALTER TABLE ONLY "ledger"."shown_event"
    ADD CONSTRAINT "shown_event_data_point_id_fkey" FOREIGN KEY ("data_point_id") REFERENCES "ledger"."data_point"("data_point_id");



ALTER TABLE ONLY "ledger"."shown_event"
    ADD CONSTRAINT "shown_event_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ledger"."person"("person_id");



ALTER TABLE ONLY "ledger"."shown_event"
    ADD CONSTRAINT "shown_event_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "ledger"."data_point_type"("code");



ALTER TABLE ONLY "public"."account_plan_log"
    ADD CONSTRAINT "account_plan_log_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_scans"
    ADD CONSTRAINT "account_scans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_scans"
    ADD CONSTRAINT "account_scans_web_scan_id_fkey" FOREIGN KEY ("web_scan_id") REFERENCES "public"."web_scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cairn_facts"
    ADD CONSTRAINT "cairn_facts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cairn_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cairn_intents"
    ADD CONSTRAINT "cairn_intents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cairn_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cairn_sessions"
    ADD CONSTRAINT "cairn_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_preferences"
    ADD CONSTRAINT "channel_preferences_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_states"
    ADD CONSTRAINT "conversation_states_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_links"
    ADD CONSTRAINT "dashboard_links_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_sessions"
    ADD CONSTRAINT "dashboard_sessions_link_hash_fkey" FOREIGN KEY ("link_hash") REFERENCES "public"."dashboard_links"("token_hash") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_sessions"
    ADD CONSTRAINT "dashboard_sessions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deep_osint_results"
    ADD CONSTRAINT "deep_osint_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."deep_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eradication_jobs"
    ADD CONSTRAINT "eradication_jobs_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "public"."deletion_consents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fix_wizard_items"
    ADD CONSTRAINT "fix_wizard_items_baseline_snapshot_id_fkey" FOREIGN KEY ("baseline_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fix_wizard_items"
    ADD CONSTRAINT "fix_wizard_items_recheck_snapshot_id_fkey" FOREIGN KEY ("recheck_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."hexagon_scores"
    ADD CONSTRAINT "hexagon_scores_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interaction_log"
    ADD CONSTRAINT "interaction_log_conversation_state_id_fkey" FOREIGN KEY ("conversation_state_id") REFERENCES "public"."conversation_states"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mpt_business_members"
    ADD CONSTRAINT "mpt_business_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."mpt_business_teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mpt_business_teams"
    ADD CONSTRAINT "mpt_business_teams_admin_account_id_fkey" FOREIGN KEY ("admin_account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mpt_hexagon_events"
    ADD CONSTRAINT "mpt_hexagon_events_shown_event_id_fkey" FOREIGN KEY ("shown_event_id") REFERENCES "public"."mpt_hexagon_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mpt_osint_scan_results"
    ADD CONSTRAINT "mpt_osint_scan_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mpt_user_engagement"
    ADD CONSTRAINT "mpt_user_engagement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."osint_results"
    ADD CONSTRAINT "osint_results_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referee_user_id_fkey" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."removal_tasks"
    ADD CONSTRAINT "removal_tasks_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."removal_tasks"
    ADD CONSTRAINT "removal_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scan_recipient_log"
    ADD CONSTRAINT "scan_recipient_log_recipient_key_fkey" FOREIGN KEY ("recipient_key") REFERENCES "public"."recipients_registry"("key");



ALTER TABLE ONLY "public"."scans"
    ADD CONSTRAINT "scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signals"
    ADD CONSTRAINT "signals_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_events"
    ADD CONSTRAINT "social_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."social_contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_action_receipts"
    ADD CONSTRAINT "support_action_receipts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_inbound_events"
    ADD CONSTRAINT "support_inbound_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."translation_queue"
    ADD CONSTRAINT "translation_queue_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."web_scan_contacts"
    ADD CONSTRAINT "web_scan_contacts_web_scan_id_fkey" FOREIGN KEY ("web_scan_id") REFERENCES "public"."web_scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."web_scan_events"
    ADD CONSTRAINT "web_scan_events_web_scan_id_fkey" FOREIGN KEY ("web_scan_id") REFERENCES "public"."web_scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."web_scan_listing_checks"
    ADD CONSTRAINT "web_scan_listing_checks_web_scan_id_fkey" FOREIGN KEY ("web_scan_id") REFERENCES "public"."web_scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."web_scan_returns"
    ADD CONSTRAINT "web_scan_returns_previous_scan_id_fkey" FOREIGN KEY ("previous_scan_id") REFERENCES "public"."web_scans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."web_scan_returns"
    ADD CONSTRAINT "web_scan_returns_web_scan_id_fkey" FOREIGN KEY ("web_scan_id") REFERENCES "public"."web_scans"("id") ON DELETE CASCADE;



ALTER TABLE "ledger"."backfill_batch" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."data_point" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."data_point_type" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."domain_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."identity_link" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."person" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."person_identifier" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."render_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."report_profile" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."report_profile_item" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."risk_decision_event" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."risk_education_event" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ledger"."shown_event" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Enable all access for service role" ON "public"."localization" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."account_plan_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_scans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon can insert registrations" ON "public"."hk_spam_registrations" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon can insert waitlist signups" ON "public"."hk_shield_waitlist" FOR INSERT TO "anon" WITH CHECK (("consent" = true));



CREATE POLICY "anon signup validation (restrictive)" ON "public"."subscribers" AS RESTRICTIVE FOR INSERT TO "anon" WITH CHECK (((("char_length"("email") >= 3) AND ("char_length"("email") <= 255)) AND ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'::"text") AND (("consent_source" IS NULL) OR ("char_length"("consent_source") <= 100)) AND (("source" IS NULL) OR ("char_length"("source") <= 100)) AND (("utm_source" IS NULL) OR ("char_length"("utm_source") <= 100)) AND (("utm_medium" IS NULL) OR ("char_length"("utm_medium") <= 100)) AND (("utm_campaign" IS NULL) OR ("char_length"("utm_campaign") <= 100))));



CREATE POLICY "anon signup with sane email" ON "public"."subscribers" FOR INSERT TO "anon" WITH CHECK (((("char_length"("email") >= 3) AND ("char_length"("email") <= 255)) AND ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'::"text") AND (("consent_source" IS NULL) OR ("char_length"("consent_source") <= 100)) AND (("source" IS NULL) OR ("char_length"("source") <= 100)) AND (("utm_source" IS NULL) OR ("char_length"("utm_source") <= 100)) AND (("utm_medium" IS NULL) OR ("char_length"("utm_medium") <= 100)) AND (("utm_campaign" IS NULL) OR ("char_length"("utm_campaign") <= 100))));



ALTER TABLE "public"."cairn_facts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cairn_facts_owner_read" ON "public"."cairn_facts" FOR SELECT TO "authenticated" USING (("session_id" IN ( SELECT "s"."id"
   FROM "public"."cairn_sessions" "s"
  WHERE ("s"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "cairn_facts_service" ON "public"."cairn_facts" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."cairn_intents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cairn_intents_owner_read" ON "public"."cairn_intents" FOR SELECT TO "authenticated" USING (("session_id" IN ( SELECT "s"."id"
   FROM "public"."cairn_sessions" "s"
  WHERE ("s"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "cairn_intents_service" ON "public"."cairn_intents" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."cairn_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cairn_sessions_owner_read" ON "public"."cairn_sessions" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "cairn_sessions_service" ON "public"."cairn_sessions" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."capability_min_tier" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_probe_captures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confidence_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confidence_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deep_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deep_osint_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deep_research_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deletion_consents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_visit_retention" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_sends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_suppressions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eradication_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fix_wizard_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."free_record_deletion_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."free_record_policy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hexagon_catalogue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hexagon_catalogue_read" ON "public"."hexagon_catalogue" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."hexagon_findings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hexagon_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_shield_waitlist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_spam_deletion_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_spam_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hk_spam_retention" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."interaction_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_aggregate_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."localization" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_alert_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_api_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_business_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_business_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_business_teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_channel_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_conversation_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_hexagon_event_rollups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_hexagon_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_hexagon_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_osint_scan_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_raw_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_score_baselines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_user_engagement" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpt_x_oauth_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."osint_engine_tuning_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."osint_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own account read" ON "public"."accounts" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "owner reads own engagement" ON "public"."mpt_user_engagement" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "owner reads own unexpired scan results" ON "public"."mpt_osint_scan_results" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("expires_at" > "now"())));



ALTER TABLE "public"."plan_scan_allowance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipients_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."removal_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_consent_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_consents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_consumption" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_hourly_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_recipient_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scans_deletion_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service role full access" ON "public"."account_plan_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."account_scans" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."accounts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."capability_min_tier" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."confidence_config" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."confidence_proposals" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."dashboard_links" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."dashboard_sessions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."deep_jobs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."deep_osint_results" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."deep_research_challenges" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."edge_visit_retention" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."edge_visits" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."email_sends" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."email_suppressions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."fix_wizard_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."free_record_deletion_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."free_record_policy" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."hexagon_findings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."hk_shield_waitlist" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."hk_spam_deletion_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."hk_spam_registrations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."hk_spam_retention" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."learning_aggregate_daily" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."mpt_business_members" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."mpt_business_teams" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."mpt_conversation_state" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."mpt_hexagon_event_rollups" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."mpt_hexagon_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."mpt_hexagon_interactions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."osint_engine_tuning_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."plan_scan_allowance" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."profile_snapshots" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."scan_consumption" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."scans_deletion_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scan_contacts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scan_deletion_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scan_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scan_listing_checks" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scan_retention" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scan_returns" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role full access" ON "public"."web_scans" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscribers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_action_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_inbound_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_proofs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_event_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."translation_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_deletion_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_listing_checks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_retention" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scan_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_scans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."country_policy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."purge_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_at" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_be" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_bg" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_cy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_cz" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_de" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_default" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_dk" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_ee" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_es" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_fi" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_fr" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_gb" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_gr" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_hk" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_hr" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_hu" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_ie" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_it" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_lt" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_lu" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_lv" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_mt" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_nl" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_pl" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_pt" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_ro" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_se" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_si" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "visit_log"."visits_sk" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "writer only" ON "visit_log"."country_policy" TO "visit_log_writer" USING (true) WITH CHECK (true);



CREATE POLICY "writer only" ON "visit_log"."purge_log" TO "visit_log_writer" USING (true) WITH CHECK (true);



CREATE POLICY "writer only" ON "visit_log"."visits" TO "visit_log_writer" USING (true) WITH CHECK (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "ledger" TO "service_role";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "ledger"."_append_only"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_consequence_approved"("p_key" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_data_point_h18_not_allowed"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_data_point_validate"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_eval_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", OUT "o_class" "text", OUT "o_variant" "text", OUT "o_params" "jsonb", OUT "o_bar" smallint, OUT "o_action" "text", OUT "o_ids" "uuid"[], OUT "o_base" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_expired"("p_expires" timestamp with time zone, "p_observed" timestamp with time zone, "p_max_age" interval) FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_merge_persons"("p_from" "uuid", "p_into" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_normalise_identifier"("p_type" "text", "p_value" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_profile_item_h18"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_risk_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", OUT "o_root" "uuid", OUT "o_dp" "uuid", OUT "o_status" "text", OUT "o_value" "jsonb", OUT "o_hash" "text", OUT "o_expired" boolean, OUT "o_not_me" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_risk_decision_validate"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_risk_education_validate"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."_risk_eval"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan" "text", OUT "o_state" "text", OUT "o_reason" "text", OUT "o_basis" "text", OUT "o_dp" "uuid", OUT "o_hash" "text", OUT "o_education" "uuid", OUT "o_decision" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."attach_identifier"("p_person" "uuid", "p_type" "text", "p_value" "text", "p_proof_state" "text", "p_proof_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."attach_identifier"("p_person" "uuid", "p_type" "text", "p_value" "text", "p_proof_state" "text", "p_proof_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."class_of"("p_source" "text", "p_status" "text", "p_confidence" smallint, "p_expired" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."confidence_band"("p_confidence" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."confidence_band"("p_confidence" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."confirm_link"("p_link" "uuid", "p_given_data_point" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."confirm_link"("p_link" "uuid", "p_given_data_point" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."erase_person"("p_person" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."erase_person"("p_person" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."guard_version"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."guess_below"() FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."guess_below"() TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."hexagon_type_code"("p_id" "text", "p_channel" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."normalise_wa_id"("p" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."normalise_wa_id"("p" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."person_family"("p_root" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."record_answer"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_answer" "text", "p_confidence_at_display" smallint, "p_latency_ms" integer, "p_channel" "text", "p_input_ref" "text", "p_locale" "text", "p_shown_at" timestamp with time zone, "p_observed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."record_answer"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_answer" "text", "p_confidence_at_display" smallint, "p_latency_ms" integer, "p_channel" "text", "p_input_ref" "text", "p_locale" "text", "p_shown_at" timestamp with time zone, "p_observed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."record_data_point"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_value" "jsonb", "p_status" "text", "p_confidence" smallint, "p_source" "text", "p_channel" "text", "p_method" "text", "p_source_name" "text", "p_input_ref" "text", "p_locale" "text", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_supersedes" "uuid", "p_provenance" "jsonb", "p_collector_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."record_data_point"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_value" "jsonb", "p_status" "text", "p_confidence" smallint, "p_source" "text", "p_channel" "text", "p_method" "text", "p_source_name" "text", "p_input_ref" "text", "p_locale" "text", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_supersedes" "uuid", "p_provenance" "jsonb", "p_collector_version" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."record_risk_decision"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_kind" "text", "p_basis" "text", "p_education_id" "uuid", "p_input_ref" "text", "p_render_id" "uuid", "p_evidence_dp" "uuid", "p_channel" "text", "p_locale" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."record_risk_decision"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_kind" "text", "p_basis" "text", "p_education_id" "uuid", "p_input_ref" "text", "p_render_id" "uuid", "p_evidence_dp" "uuid", "p_channel" "text", "p_locale" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."record_risk_education"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_render_id" "uuid", "p_channel" "text", "p_locale" "text", "p_visible_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."record_risk_education"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_render_id" "uuid", "p_channel" "text", "p_locale" "text", "p_visible_ms" integer) TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."record_shown"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_confidence_at_display" smallint, "p_channel" "text", "p_shown_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."record_shown"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_confidence_at_display" smallint, "p_channel" "text", "p_shown_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."render_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."render_claim"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."render_claim_risk"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."render_claim_risk"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."render_consequence"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."render_consequence"("p_person" "uuid", "p_type" "text", "p_subject" "text", "p_locale" "text", "p_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."render_progress"("p_person" "uuid", "p_profile" "text", "p_locale" "text", "p_channel" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."render_progress"("p_person" "uuid", "p_profile" "text", "p_locale" "text", "p_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."render_progress_risk"("p_person" "uuid", "p_profile" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."render_progress_risk"("p_person" "uuid", "p_profile" "text", "p_scan_key" "text", "p_locale" "text", "p_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."resolve_person"("p_type" "text", "p_value" "text", "p_create" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."resolve_person"("p_type" "text", "p_value" "text", "p_create" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."rollback_backfill_batch"("p_batch" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."root_person"("p" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."unmerge_person"("p_person" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "ledger"."unmerge_person"("p_person" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "ledger"."value_matches"("p_schema" "jsonb", "p_value" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ledger"."values_disagree"("p_given" "jsonb", "p_other" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."claim_onboarding_cohort"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_onboarding_cohort"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_deletion_consent"("p_scan_ref" "uuid", "p_categories" "text"[], "p_irreversible" boolean, "p_irreversible_ack" boolean, "p_price_cents" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_deletion_consent"("p_scan_ref" "uuid", "p_categories" "text"[], "p_irreversible" boolean, "p_irreversible_ack" boolean, "p_price_cents" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."eradication_begin"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."eradication_begin"("p_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."eradication_finish"("p_job_id" "uuid", "p_ok" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."eradication_finish"("p_job_id" "uuid", "p_ok" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."eradication_start"("p_consent_id" "uuid", "p_category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."eradication_start"("p_consent_id" "uuid", "p_category" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_aggregate_before_delete"("p_web_scans" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_aggregate_before_delete"("p_web_scans" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_bot_family"("p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_bot_family"("p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_brain_record"("p_channel" "text", "p_sender_id" "text", "p_intent" "text", "p_intent_source" "text", "p_response_key" "text", "p_new_state" "text", "p_trust_floor" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_brain_record"("p_channel" "text", "p_sender_id" "text", "p_intent" "text", "p_intent_source" "text", "p_response_key" "text", "p_new_state" "text", "p_trust_floor" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_authorise"("p_hash" "text", "p_version" "text", "p_share" boolean, "p_results" "jsonb", "p_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_authorise"("p_hash" "text", "p_version" "text", "p_share" boolean, "p_results" "jsonb", "p_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_create_team"("p_account" "uuid", "p_company" "text", "p_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_create_team"("p_account" "uuid", "p_company" "text", "p_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_decline"("p_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_decline"("p_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_delete_team"("p_account" "uuid", "p_team" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_delete_team"("p_account" "uuid", "p_team" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_invite"("p_account" "uuid", "p_team" "uuid", "p_emails" "text"[], "p_hashes" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_invite"("p_account" "uuid", "p_team" "uuid", "p_emails" "text"[], "p_hashes" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_list_teams"("p_account" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_list_teams"("p_account" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_member"("p_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_member"("p_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_remove_member"("p_account" "uuid", "p_team" "uuid", "p_member" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_remove_member"("p_account" "uuid", "p_team" "uuid", "p_member" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_revoke"("p_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_revoke"("p_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_set_share"("p_hash" "text", "p_share" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_set_share"("p_hash" "text", "p_share" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_business_summary"("p_account" "uuid", "p_team" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_business_summary"("p_account" "uuid", "p_team" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_can"("p_account" "uuid", "p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_can"("p_account" "uuid", "p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_channel_osint_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_channel_osint_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_claim_deletion_notices"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_claim_deletion_notices"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_complete_referral"("p_referee_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_complete_referral"("p_referee_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_confirm_scan_consumption"("p_scan" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_confirm_scan_consumption"("p_scan" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_consume_scan"("p_scan" "uuid", "p_email" "text", "p_confirmed" boolean, "p_account" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_consume_scan"("p_scan" "uuid", "p_email" "text", "p_confirmed" boolean, "p_account" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_count_scan_hourly"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_count_scan_hourly"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_country_bucket"("p_country" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_country_bucket"("p_country" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_cut_edge_visit_ips"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_cut_edge_visit_ips"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_challenge_create"("p_subject_hash" "text", "p_channel" "text", "p_code_hash" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_challenge_create"("p_subject_hash" "text", "p_channel" "text", "p_code_hash" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_challenge_verify"("p_id" "uuid", "p_code_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_challenge_verify"("p_id" "uuid", "p_code_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_delete_subject"("p_subject_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_delete_subject"("p_subject_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_is_verified"("p_subject_hash" "text", "p_channel" "text", "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_is_verified"("p_subject_hash" "text", "p_channel" "text", "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_purge_expired"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_purge_expired"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_record_finding"("p_subject_hash" "text", "p_hexagon_id" "text", "p_finding_type" "text", "p_confidence" integer, "p_encrypted_evidence" "text", "p_remediation_link" "text", "p_needs_human_review" boolean, "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_record_finding"("p_subject_hash" "text", "p_hexagon_id" "text", "p_finding_type" "text", "p_confidence" integer, "p_encrypted_evidence" "text", "p_remediation_link" "text", "p_needs_human_review" boolean, "p_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_deep_required_channels"("p_hexagon_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_deep_required_channels"("p_hexagon_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_delete_account"("p_account" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_delete_account"("p_account" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_delete_deep_data"("p_sender_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_delete_deep_data"("p_sender_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_delete_hk_spam_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_delete_hk_spam_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_delete_profile_snapshots"("p_sender_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_delete_profile_snapshots"("p_sender_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_delete_web_scan"("p_scan_number" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_delete_web_scan"("p_scan_number" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_dsar_erase"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_dsar_erase"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_dsar_export"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_dsar_export"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_email_delivery_counts"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_email_delivery_counts"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_ensure_account"("p_user" "uuid", "p_email" "text", "p_scan" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_ensure_account"("p_user" "uuid", "p_email" "text", "p_scan" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_erase_chat_sender"("p_channel" "text", "p_sender_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_erase_chat_sender"("p_channel" "text", "p_sender_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_erase_social_contact"("p_platform" "text", "p_user_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_erase_social_contact"("p_platform" "text", "p_user_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_export_hk_spam_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_export_hk_spam_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_export_web_scan"("p_scan_number" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_export_web_scan"("p_scan_number" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_find_auth_user_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_find_auth_user_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_ga4_metric"("p" "jsonb", "metric" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_ga4_metric"("p" "jsonb", "metric" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_get_account_scan"("p_account" "uuid", "p_web_scan" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_get_account_scan"("p_account" "uuid", "p_web_scan" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_get_entitlements"("p_account" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_get_entitlements"("p_account" "uuid", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_hexagon_events_link_answer"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_hexagon_events_link_answer"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_hk_date"("ts" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_hk_date"("ts" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_hk_ts"("d" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_hk_ts"("d" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_keep_scan"("p_scans_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_keep_scan"("p_scans_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_learning_absorb_edge_visit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_learning_absorb_edge_visit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_learning_absorb_web_scan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_learning_absorb_web_scan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_learning_aggregate_week"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_learning_aggregate_week"("p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_learning_count"("p_day" "date", "p_dimension" "text", "p_key" "text", "p_n" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_learning_count"("p_day" "date", "p_dimension" "text", "p_key" "text", "p_n" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_learning_count_tile_event"("p_hexagon_id" "text", "p_event" "text", "p_answer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_learning_count_tile_event"("p_hexagon_id" "text", "p_event" "text", "p_answer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_learning_loop"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_grace_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_learning_loop"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_grace_hours" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_ledger_pop_bind"("p_sid" "text", "p_wa" "text", "p_bound_at_ms" bigint, "p_inbound_ts" bigint, "p_consent_v" "text", "p_consent_accepted" boolean, "p_msg" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_ledger_pop_bind"("p_sid" "text", "p_wa" "text", "p_bound_at_ms" bigint, "p_inbound_ts" bigint, "p_consent_v" "text", "p_consent_accepted" boolean, "p_msg" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_ledger_pop_check"("p_sid" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_ledger_pop_check"("p_sid" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_ledger_pop_revoke"("p_wa" "text", "p_at_ms" bigint, "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_ledger_pop_revoke"("p_wa" "text", "p_at_ms" bigint, "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_link_scan_to_account"("p_account" "uuid", "p_web_scan" "uuid", "p_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_link_scan_to_account"("p_account" "uuid", "p_web_scan" "uuid", "p_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_list_account_scans"("p_account" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_list_account_scans"("p_account" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_machine_mirror_retention"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_machine_mirror_retention"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_machine_visits_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_machine_visits_daily"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_ping"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_ping"() TO "service_role";
GRANT ALL ON FUNCTION "public"."mpt_ping"() TO "anon";
GRANT ALL ON FUNCTION "public"."mpt_ping"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mpt_purge_alert"("p_test" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_alert"("p_test" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_dashboard_credentials"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_dashboard_credentials"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_deletion_consents"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_deletion_consents"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_cairn_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_cairn_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_channel_probe_captures"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_channel_probe_captures"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_deep_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_deep_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_hk_spam"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_hk_spam"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_interaction_log"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_interaction_log"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_profile_snapshots"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_profile_snapshots"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_scan_results"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_scan_results"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_scans"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_scans"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_social_contacts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_social_contacts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_telegram_event_log"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_telegram_event_log"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_expired_web_scans"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_expired_web_scans"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_free_records"("p_dry_run" boolean, "p_overdue" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_free_records"("p_dry_run" boolean, "p_overdue" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_purge_stale_channel_tokens"("p_dry_run" boolean, "p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_purge_stale_channel_tokens"("p_dry_run" boolean, "p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_raw_metrics_block_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_raw_metrics_block_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_recognition_candidates"("p_hashes" "jsonb", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_recognition_candidates"("p_hashes" "jsonb", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_record_email_event"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone, "p_bounce_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_record_email_event"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone, "p_bounce_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_record_email_receipt"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_record_email_receipt"("p_message_id" "text", "p_status" "text", "p_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_redeem_dashboard_link"("p_token_hash" "text", "p_session_hash" "text", "p_session_minutes" integer, "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_redeem_dashboard_link"("p_token_hash" "text", "p_session_hash" "text", "p_session_minutes" integer, "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_release_deletion_notice"("p_scans_id" "uuid", "p_stage" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_release_deletion_notice"("p_scans_id" "uuid", "p_stage" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_request_scan"("p_user_id" "uuid", "p_email" "text", "p_request_id" "uuid", "p_window" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_request_scan"("p_user_id" "uuid", "p_email" "text", "p_request_id" "uuid", "p_window" interval) TO "service_role";



GRANT ALL ON TABLE "public"."scans" TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_scan_is_kept"("p_scan" "public"."scans") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_scan_is_kept"("p_scan" "public"."scans") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_scan_period"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_scan_period"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_scan_report_alert"("p_test" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_scan_report_alert"("p_test" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_scan_report_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_scan_report_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_scans_delete_children"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_scans_delete_children"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_scans_set_delete_after"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_scans_set_delete_after"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_set_plan"("p_account" "uuid", "p_plan" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_set_plan"("p_account" "uuid", "p_plan" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_social_record"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean, "p_event_key" "text", "p_occurred_at" timestamp with time zone, "p_source_ref" "text", "p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_social_record"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean, "p_event_key" "text", "p_occurred_at" timestamp with time zone, "p_source_ref" "text", "p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_social_touch"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_social_touch"("p_platform" "text", "p_user_id" "text", "p_handle" "text", "p_event" "text", "p_follows_us" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_tier_rank"("p_tier" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_tier_rank"("p_tier" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_users_opt_out_to_suppression"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_users_opt_out_to_suppression"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_visit_log_policy"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_visit_log_policy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_visit_log_purge_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_visit_log_purge_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_visit_log_record"("p_country" "text", "p_ip" "text", "p_referrer" "text", "p_utm_source" "text", "p_utm_medium" "text", "p_utm_campaign" "text", "p_utm_content" "text", "p_device" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_visit_log_record"("p_country" "text", "p_ip" "text", "p_referrer" "text", "p_utm_source" "text", "p_utm_medium" "text", "p_utm_campaign" "text", "p_utm_content" "text", "p_device" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mpt_web_scans_delete_children"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mpt_web_scans_delete_children"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_conversation_state"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_conversation_state"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rollup_and_purge_hexagon_events"("retention" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rollup_and_purge_hexagon_events"("retention" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_append_inbound"("p_case_id" "uuid", "p_event_id" "text", "p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_append_inbound"("p_case_id" "uuid", "p_event_id" "text", "p_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_create_case_from_event"("p_channel" "text", "p_event_id" "text", "p_thread_key" "text", "p_sender" "text", "p_text" "text", "p_ref" "text", "p_policy" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_create_case_from_event"("p_channel" "text", "p_event_id" "text", "p_thread_key" "text", "p_sender" "text", "p_text" "text", "p_ref" "text", "p_policy" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_issue_proof"("p_token_hash" "text", "p_subject" "text", "p_tenant" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_issue_proof"("p_token_hash" "text", "p_subject" "text", "p_tenant" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_purge_expired"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_purge_expired"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_redeem_proof"("p_token_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_redeem_proof"("p_token_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."withdraw_deletion_consent"("p_consent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_deletion_consent"("p_consent_id" "uuid") TO "service_role";












REVOKE ALL ON FUNCTION "visit_log"."apply_policy"("p_country" "text", "p_dry_run" boolean, "p_drop_partition" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."country_policy_partition"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."ensure_partition"("p_country" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."purge"("p_dry_run" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."purge_country"("p_country" "text", "p_ip_days" integer, "p_derived_days" integer, "p_dry_run" boolean, OUT "ips_nulled" integer, OUT "rows_deleted" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."purge_health"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."record_visit"("p_country" "text", "p_ip" "text", "p_referrer" "text", "p_utm_source" "text", "p_utm_medium" "text", "p_utm_campaign" "text", "p_utm_content" "text", "p_device" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "visit_log"."shape_ip"("p_ip" "text", "p_mode" "text") FROM PUBLIC;















GRANT ALL ON TABLE "public"."account_plan_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."account_plan_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."account_scans" TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "service_role";
GRANT SELECT ON TABLE "public"."accounts" TO "authenticated";



GRANT ALL ON TABLE "public"."cairn_facts" TO "service_role";
GRANT SELECT ON TABLE "public"."cairn_facts" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cairn_facts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cairn_intents" TO "service_role";
GRANT SELECT ON TABLE "public"."cairn_intents" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cairn_intents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cairn_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."cairn_sessions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cairn_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."capability_min_tier" TO "service_role";



GRANT ALL ON TABLE "public"."channel_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."channel_probe_captures" TO "service_role";



GRANT ALL ON TABLE "public"."channel_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."confidence_config" TO "service_role";



GRANT ALL ON TABLE "public"."confidence_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_states" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_links" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."deep_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."deep_osint_results" TO "service_role";



GRANT ALL ON TABLE "public"."deep_research_challenges" TO "service_role";



GRANT ALL ON TABLE "public"."deletion_consents" TO "service_role";



GRANT ALL ON TABLE "public"."edge_visit_retention" TO "service_role";



GRANT ALL ON TABLE "public"."edge_visits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."edge_visits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_sends" TO "service_role";



GRANT ALL ON TABLE "public"."email_suppressions" TO "service_role";



GRANT ALL ON TABLE "public"."eradication_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."fix_wizard_items" TO "service_role";



GRANT ALL ON TABLE "public"."free_record_deletion_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."free_record_deletion_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."free_record_policy" TO "service_role";



GRANT ALL ON TABLE "public"."hexagon_catalogue" TO "service_role";
GRANT SELECT ON TABLE "public"."hexagon_catalogue" TO "anon";
GRANT SELECT ON TABLE "public"."hexagon_catalogue" TO "authenticated";



GRANT ALL ON TABLE "public"."hexagon_findings" TO "service_role";



GRANT ALL ON TABLE "public"."hexagon_scores" TO "service_role";



GRANT ALL ON TABLE "public"."hk_shield_waitlist" TO "service_role";
GRANT INSERT ON TABLE "public"."hk_shield_waitlist" TO "anon";



GRANT ALL ON TABLE "public"."hk_spam_deletion_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hk_spam_deletion_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hk_spam_registrations" TO "service_role";



GRANT INSERT("platform") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("language") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("utm_source") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("utm_medium") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("utm_campaign") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("protection_date") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("email") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("reminder_consent") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("source_page") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT INSERT("marketing_consent") ON TABLE "public"."hk_spam_registrations" TO "anon";



GRANT ALL ON TABLE "public"."hk_spam_due_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."hk_spam_marketing_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."hk_spam_retention" TO "service_role";



GRANT ALL ON TABLE "public"."interaction_log" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."learning_aggregate_daily" TO "service_role";



GRANT ALL ON TABLE "public"."localization" TO "service_role";



GRANT ALL ON SEQUENCE "public"."localization_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."localization_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."localization_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_alert_state" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_api_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_business_members" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_business_requests" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_business_teams" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_channel_metrics" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."mpt_raw_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_cloudflare_daily" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_cloudflare_day" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_conversation_state" TO "service_role";



GRANT SELECT ON TABLE "public"."mpt_hubspot_daily" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_user_engagement" TO "service_role";
GRANT SELECT ON TABLE "public"."mpt_user_engagement" TO "authenticated";



GRANT ALL ON TABLE "public"."mpt_youtube_daily" TO "service_role";



GRANT ALL ON TABLE "public"."scan_hourly_counts" TO "service_role";



GRANT ALL ON TABLE "public"."subscribers" TO "service_role";



GRANT INSERT("email") ON TABLE "public"."subscribers" TO "anon";



GRANT INSERT("source") ON TABLE "public"."subscribers" TO "anon";



GRANT INSERT("utm_source") ON TABLE "public"."subscribers" TO "anon";



GRANT INSERT("utm_medium") ON TABLE "public"."subscribers" TO "anon";



GRANT INSERT("utm_campaign") ON TABLE "public"."subscribers" TO "anon";



GRANT INSERT("consent_given_at") ON TABLE "public"."subscribers" TO "anon";



GRANT INSERT("consent_source") ON TABLE "public"."subscribers" TO "anon";



GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT SELECT ON TABLE "public"."mpt_daily_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_hexagon_event_rollups" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_hexagon_events" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_hexagon_interactions" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_osint_scan_results" TO "service_role";
GRANT SELECT ON TABLE "public"."mpt_osint_scan_results" TO "authenticated";



GRANT ALL ON TABLE "public"."mpt_score_baselines" TO "service_role";



GRANT SELECT ON TABLE "public"."mpt_weekly_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."mpt_x_oauth_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."osint_engine_tuning_log" TO "service_role";



GRANT ALL ON TABLE "public"."osint_results" TO "service_role";



GRANT ALL ON TABLE "public"."plan_scan_allowance" TO "service_role";



GRANT ALL ON TABLE "public"."profile_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."recipients_registry" TO "service_role";



GRANT ALL ON TABLE "public"."recipients_registry_public" TO "service_role";
GRANT SELECT ON TABLE "public"."recipients_registry_public" TO "anon";
GRANT SELECT ON TABLE "public"."recipients_registry_public" TO "authenticated";



GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON TABLE "public"."removal_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."scan_consent_counts" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."scan_consents" TO "service_role";



GRANT ALL ON TABLE "public"."scan_consumption" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."scan_recipient_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."scan_recipient_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."scans_deletion_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."scans_deletion_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."signals" TO "service_role";



GRANT ALL ON TABLE "public"."social_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."social_events" TO "service_role";



GRANT ALL ON TABLE "public"."support_action_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."support_cases" TO "service_role";



GRANT ALL ON TABLE "public"."support_inbound_events" TO "service_role";



GRANT ALL ON TABLE "public"."support_messages" TO "service_role";



GRANT ALL ON TABLE "public"."support_proofs" TO "service_role";



GRANT ALL ON TABLE "public"."support_usage" TO "service_role";



GRANT ALL ON SEQUENCE "public"."support_usage_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_event_log" TO "service_role";



GRANT ALL ON TABLE "public"."translation_queue" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_deletion_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."web_scan_deletion_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."web_scan_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."web_scans" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_funnel" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_listing_checks" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_retention" TO "service_role";



GRANT ALL ON TABLE "public"."web_scan_returns" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- ===== 2b. live migration 20261127053004 exclude_test_scans_from_kpi (applied after the snapshot) =====
create or replace function public.mpt_is_test_address(p_email text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  -- The SQL copy of isTestAddress() in shared/test-records.js; a test keeps the two in step.
  select coalesce(btrim(p_email) ~* '^testingnt69(\+[a-z0-9._-]{1,60})?@gmail\.com$', false);
$$;
revoke all on function public.mpt_is_test_address(text) from public, anon, authenticated;
grant execute on function public.mpt_is_test_address(text) to service_role;

alter table public.scan_hourly_counts add column if not exists test_scans bigint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scan_hourly_counts_test_scans_range' and conrelid = 'public.scan_hourly_counts'::regclass) then
    alter table public.scan_hourly_counts add constraint scan_hourly_counts_test_scans_range check (test_scans >= 0 and test_scans <= scans_created);
  end if;
end $$;
comment on column public.scan_hourly_counts.test_scans is 'Of scans_created, how many were the test mailbox. KPI views subtract it. History before this column: only where the email log or a surviving row proves it.';

-- The existing trigger keeps calling this function; only its body changes.
create or replace function public.mpt_count_scan_hourly() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.scan_hourly_counts (hour, scans_created, test_scans)
  values (date_trunc('hour', new.created_at), 1, case when public.mpt_is_test_address(new.email_scanned) then 1 else 0 end)
  on conflict (hour) do update set scans_created = public.scan_hourly_counts.scans_created + 1,
                                   test_scans = public.scan_hourly_counts.test_scans + excluded.test_scans;
  return new;
end $$;
revoke all on function public.mpt_count_scan_hourly() from public, anon, authenticated;

-- (The data-only history backfill of migration 20261127053004 is NOT part of the baseline: it updates rows, and this file is structure only.)

create or replace view public.mpt_daily_metrics with (security_invoker = true) as
with bounds as (
  select least(
           coalesce((select public.mpt_hk_date(min(hour)) from public.scan_hourly_counts), public.mpt_hk_date(now())),
           coalesce((select public.mpt_hk_date(min(period_start)) from public.mpt_raw_metrics), public.mpt_hk_date(now()))
         ) as first_day
),
days as (
  select d::date as day from bounds, generate_series(bounds.first_day::timestamp, public.mpt_hk_date(now())::timestamp, interval '1 day') d
),
scan_n as (select public.mpt_hk_date(hour) as day, sum(scans_created - test_scans) n from public.scan_hourly_counts group by 1),
eng_n as (
  select public.mpt_hk_date(created_at) as day, count(*) sessions, count(*) filter (where full_scan_completed) full_scans
  from public.mpt_user_engagement group by 1
),
lead_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.leads group by 1),
sub_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.subscribers group by 1),
user_n as (select public.mpt_hk_date(created_at) as day, count(*) n from public.users group by 1),
raw_n as (
  select public.mpt_hk_date(captured_at) as day, count(*) n, count(*) filter (where status = 'error') failed
  from public.mpt_raw_metrics group by 1
),
ga_overview as (
  select distinct on (public.mpt_hk_date(period_start)) public.mpt_hk_date(period_start) as day, payload
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'daily_overview' and status in ('ok', 'partial') and period_start is not null
  order by public.mpt_hk_date(period_start), captured_at desc
),
ga_events as (
  select distinct on (public.mpt_hk_date(period_start)) public.mpt_hk_date(period_start) as day,
    (select coalesce(sum(nullif(r -> 'metricValues' -> 0 ->> 'value', '')::numeric), 0)
       from jsonb_array_elements(coalesce(payload -> 'rows', '[]'::jsonb)) r
       where r -> 'dimensionValues' -> 0 ->> 'value' ilike '%scan%') as scan_events
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'daily_events' and status in ('ok', 'partial') and period_start is not null
  order by public.mpt_hk_date(period_start), captured_at desc
)
select
  days.day,
  (select coalesce(sum(h.scans_created - h.test_scans), 0) from public.scan_hourly_counts h where h.hour < public.mpt_hk_ts(days.day + 1))::bigint as cumulative_scans,
  coalesce(scan_n.n, 0)::bigint as new_scans,
  coalesce(eng_n.sessions, 0)::bigint as engagement_sessions,
  coalesce(eng_n.full_scans, 0)::bigint as engagement_full_scans,
  public.mpt_ga4_metric(ga_overview.payload, 'sessions') as ga4_sessions,
  public.mpt_ga4_metric(ga_overview.payload, 'activeUsers') as ga4_active_users,
  ga_events.scan_events as ga4_scan_events,
  coalesce(lead_n.n, 0)::bigint as new_leads,
  coalesce(sub_n.n, 0)::bigint as new_subscribers,
  coalesce(user_n.n, 0)::bigint as new_users,
  coalesce(raw_n.n, 0)::bigint as raw_rows_captured,
  coalesce(raw_n.failed, 0)::bigint as raw_pulls_failed,
  yt.youtube_subscribers,
  yt.youtube_videos_published,
  hs.hubspot_total_contacts,
  hs.hubspot_new_contacts,
  cf.cloudflare_visitors,
  cf.cloudflare_requests,
  cf.cloudflare_bandwidth_bytes,
  cf.cloudflare_cache_hit_ratio,
  cf.cloudflare_error_4xx,
  cf.cloudflare_error_5xx,
  cf.cloudflare_threats_blocked,
  (select coalesce(sum(h.test_scans), 0) from public.scan_hourly_counts h where h.hour < public.mpt_hk_ts(days.day + 1))::bigint as test_scans_excluded
from days
left join scan_n on scan_n.day = days.day
left join eng_n on eng_n.day = days.day
left join lead_n on lead_n.day = days.day
left join sub_n on sub_n.day = days.day
left join user_n on user_n.day = days.day
left join raw_n on raw_n.day = days.day
left join ga_overview on ga_overview.day = days.day
left join ga_events on ga_events.day = days.day
left join public.mpt_youtube_daily yt on yt.metric_date = days.day
left join public.mpt_hubspot_daily hs on hs.metric_date = days.day
left join public.mpt_cloudflare_day cf on cf.metric_date = days.day;

create or replace view public.mpt_weekly_metrics with (security_invoker = true) as
with bounds as (
  select date_trunc('week', min(day)::timestamp)::date as first_week from public.mpt_daily_metrics
),
weeks as (
  select w::date as week_of
  from bounds, generate_series(bounds.first_week::timestamp, date_trunc('week', public.mpt_hk_date(now())::timestamp), interval '7 days') w
),
paid as (
  select count(*) filter (where payment_status = 'active' and tier <> 'free' and not public.mpt_is_test_address(email)) as paid_users from public.users
),
latest_week_count as (
  select distinct on (source, public.mpt_hk_date(period_start)) source, public.mpt_hk_date(period_start) as week_of,
         nullif(payload ->> 'count', '')::numeric as n
  from public.mpt_raw_metrics
  where ((source = 'blog' and report = 'posts_published') or (source = 'x' and report = 'threads_posted'))
    and status in ('ok', 'partial') and period_start is not null
  order by source, public.mpt_hk_date(period_start), captured_at desc
),
ga_week as (
  select distinct on (public.mpt_hk_date(period_start)) public.mpt_hk_date(period_start) as week_of, payload
  from public.mpt_raw_metrics
  where source = 'ga4' and report = 'weekly_overview' and status in ('ok', 'partial') and period_start is not null
  order by public.mpt_hk_date(period_start), captured_at desc
),
mrr as (
  select distinct on (date_trunc('week', public.mpt_hk_date(period_start)::timestamp)::date) date_trunc('week', public.mpt_hk_date(period_start)::timestamp)::date as week_of,
         nullif(payload ->> 'mrr_usd', '')::numeric as mrr
  from public.mpt_raw_metrics
  where source = 'revenue' and report = 'mrr' and status in ('ok', 'partial') and period_start is not null
  order by date_trunc('week', public.mpt_hk_date(period_start)::timestamp)::date, period_start desc, captured_at desc
)
select
  weeks.week_of,
  (select coalesce(sum(h.scans_created - h.test_scans), 0) from public.scan_hourly_counts h where h.hour < least(public.mpt_hk_ts(weeks.week_of + 7), public.mpt_hk_ts(public.mpt_hk_date(now()) + 1)))::bigint as cumulative_scans,
  (select coalesce(sum(h.scans_created - h.test_scans), 0) from public.scan_hourly_counts h
     where h.hour >= public.mpt_hk_ts(weeks.week_of) and h.hour < public.mpt_hk_ts(weeks.week_of + 7))::bigint as weekly_new_scans,
  -- Scan-to-paid conversion has no stored history: only the current week is filled, from live users.
  case when weeks.week_of = date_trunc('week', public.mpt_hk_date(now())::timestamp)::date
        and (select coalesce(sum(scans_created - test_scans), 0) from public.scan_hourly_counts) > 0
       then round(100.0 * paid.paid_users / (select sum(scans_created - test_scans) from public.scan_hourly_counts), 2) end as conversion_rate_pct,
  mrr.mrr as current_mrr,
  public.mpt_ga4_metric(ga_week.payload, 'activeUsers') as ga4_active_users,
  blog.n as blog_posts_published,
  xt.n as x_threads_posted,
  (select coalesce(sum(d.engagement_sessions), 0) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7)::bigint as engagement_sessions,
  (select coalesce(sum(d.engagement_full_scans), 0) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7)::bigint as engagement_full_scans,
  (select sum(d.ga4_scan_events) from public.mpt_daily_metrics d
     where d.day >= weeks.week_of and d.day < weeks.week_of + 7) as ga4_scan_events,
  (select coalesce(sum(h.test_scans), 0) from public.scan_hourly_counts h where h.hour < least(public.mpt_hk_ts(weeks.week_of + 7), public.mpt_hk_ts(public.mpt_hk_date(now()) + 1)))::bigint as test_scans_excluded
from weeks
cross join paid
left join mrr on mrr.week_of = weeks.week_of
left join ga_week on ga_week.week_of = weeks.week_of
left join latest_week_count blog on blog.source = 'blog' and blog.week_of = weeks.week_of
left join latest_week_count xt on xt.source = 'x' and xt.week_of = weeks.week_of;

comment on view public.mpt_weekly_metrics is
  'One row per Monday-start Hong Kong week. Notion tracker mapping: week_of=Week Of, cumulative_scans=Cumulative Scans, weekly_new_scans=Weekly New Scans, conversion_rate_pct=Conversion Rate %, current_mrr=Current MRR, ga4_active_users=GA4 Active Users, blog_posts_published=Blog Posts Published, x_threads_posted=X Threads Posted. Scan figures leave out test-mailbox scans (test_scans_excluded = how many, to week end); scans with no evidence either way are counted. engagement_* and ga4_scan_events are separate signals. NULL = not collected. service_role only.';

revoke all on public.mpt_daily_metrics, public.mpt_weekly_metrics from public, anon, authenticated, service_role;
grant select on public.mpt_daily_metrics, public.mpt_weekly_metrics to service_role;

-- ===== 3. event trigger ensure_rls (live: enabled 'O', owner postgres, tags below) =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER "ensure_rls" ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION "public"."rls_auto_enable"();
    ALTER EVENT TRIGGER "ensure_rls" OWNER TO "postgres";
  END IF;
END $$;

-- ===== 4. pg_cron jobs (live: all 17 active, run as postgres in database postgres). cron.schedule(name, ...) updates a job of the same name =====
DO $$
BEGIN
  PERFORM cron.schedule('mpt-purge-expired-scan-results', '0 * * * *', $cmd$select public.mpt_purge_expired_scan_results();$cmd$);  -- live jobid 1
  PERFORM cron.schedule('mpt-purge-alert', '30 * * * *', $cmd$select public.mpt_purge_alert(false)$cmd$);  -- live jobid 2
  PERFORM cron.schedule('mpt-purge-expired-web-scans', '30 19 * * *', $cmd$select public.mpt_purge_expired_web_scans(false)$cmd$);  -- live jobid 3
  PERFORM cron.schedule('mpt-purge-expired-hk-spam', '20 19 * * *', $cmd$select public.mpt_purge_expired_hk_spam();$cmd$);  -- live jobid 8
  PERFORM cron.schedule('mpt-purge-conversation-state', '17 * * * *', $cmd$select public.purge_expired_conversation_state();$cmd$);  -- live jobid 9
  PERFORM cron.schedule('mpt-purge-expired-cairn-sessions', '45 * * * *', $cmd$select public.mpt_purge_expired_cairn_sessions();$cmd$);  -- live jobid 10
  PERFORM cron.schedule('mpt-scan-report-alert', '*/10 * * * *', $cmd$select public.mpt_scan_report_alert(false)$cmd$);  -- live jobid 11
  PERFORM cron.schedule('mpt-purge-hexagon-events', '40 19 * * *', $cmd$select public.rollup_and_purge_hexagon_events(interval '90 days');$cmd$);  -- live jobid 12
  PERFORM cron.schedule('mpt-purge-dashboard-credentials', '40 19 * * *', $cmd$select public.mpt_purge_dashboard_credentials();$cmd$);  -- live jobid 13
  PERFORM cron.schedule('mpt-purge-expired-profile-snapshots', '50 19 * * *', $cmd$select public.mpt_purge_expired_profile_snapshots();$cmd$);  -- live jobid 14
  PERFORM cron.schedule('mpt-purge-expired-deep-data', '55 19 * * *', $cmd$select public.mpt_purge_expired_deep_data();$cmd$);  -- live jobid 15
  PERFORM cron.schedule('support-purge-expired', '17 3 * * *', $cmd$select public.support_purge_expired();$cmd$);  -- live jobid 17
  PERFORM cron.schedule('mpt-purge-deletion-consents', '25 19 * * *', $cmd$select public.mpt_purge_deletion_consents(false)$cmd$);  -- live jobid 18
  PERFORM cron.schedule('mpt-purge-expired-deep-research', '41 19 * * *', $cmd$select public.mpt_deep_purge_expired();$cmd$);  -- live jobid 21
  PERFORM cron.schedule('visit-log-purge', '20 19 * * *', $cmd$select visit_log.purge(false)$cmd$);  -- live jobid 23
  PERFORM cron.schedule('mpt-purge-free-records', '7 * * * *', $cmd$select public.mpt_purge_free_records(false, interval '1 hour')$cmd$);  -- live jobid 24
  PERFORM cron.schedule('mpt-machine-mirror-retention', '10 19 * * *', $cmd$select public.mpt_machine_mirror_retention(false)$cmd$);  -- live jobid 25
END $$;
