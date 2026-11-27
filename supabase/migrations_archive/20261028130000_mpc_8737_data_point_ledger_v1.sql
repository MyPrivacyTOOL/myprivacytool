-- MPC-8737: Data-point ledger v1 (M1 create + M2 seed of the approved MPC-7898 design: D1-D4, Amendments A1/A2).
-- PRODUCTION MIGRATION: .github/workflows/deploy-supabase.yml runs `supabase db push` on merge to main.
-- ADDITIVE ONLY. Creates a new schema `ledger` plus three new public.mpt_ledger_pop_* functions. It does not alter, drop or read any existing
-- table, and no existing writer or reader calls it yet except the PoP gate (workers/webhook-receiver/pop.ts). It writes no personal data:
-- the seed below is registry rows and report profiles only. Backfill is a separate, never-auto-run script (supabase/backfill/).
-- Idempotent: every statement is create ... if not exists / create or replace / on conflict do nothing, so a second run changes nothing.
--
-- The honesty rules are database constraints, not channel copy (design section 5):
--   H1 below 80 is a guess          no stored "fact" flag exists; the class is computed from confidence by ledger.guess_below() = 80
--   H2 not_checked is never a guess CHECK: not_checked / check_failed carry NO confidence and NO value; found / clear must carry both
--   H3 not_checked never renders clean   the clean phrase family is reachable only from ledger.render_claim, only for source = checked, status = clear
--   H4 provenance is mandatory      CHECK: checked needs source_name, given needs input_ref
--   H5 history is never rewritten   trigger blocks UPDATE / DELETE / TRUNCATE on data_point, shown_event, render_log (erase functions excepted)
--   H6 self-report and check are separate rows (v_disagreement lists conflicts)
--   H7 one way to read             no role has SELECT on any ledger table or view; service_role has EXECUTE on the guard / writer functions only
--   H8 one precise claim per point trigger: derived_from types must share the new type's scope (a number-scoped fact cannot make a person-scoped point)
--   H9 stale is not current         past expires_at or the type's max_age the guard answers Unknown
--   H10 100 is earned               CHECK: confidence 100 needs checked + exact_lookup, or taken + webhook; a user answer (given) tops out at 99
--
-- Defaults taken from the design page where a ruling is still open (each is listed under "needs Chris ruling" in the PR and the task):
--   * word + bar bands: <40 bar 1, 40-59 bar 2, 60-79 bar 3, 80-94 bar 4, 95-100 bar 5 (ledger.confidence_band)
--   * a user's Y is stored at 95 (D2); the progress line counts Inferred in "not yet checked" (F11)
--   * registry default_check_confidence is NULL for every seeded type, so nothing is invented; rows that need a default are held by the backfill
--   * the category mapping table is seeded 'proposed' only (F6: no silent merge of the two taxonomies)
--   * retain_until stays NULL and policy-free; consent / retention / erasure semantics are deferred (design Part 11)
--
-- Rollback (tested by supabase/tests/run.sh, which extracts the lines below):
-- ROLLBACK
--   drop function if exists public.mpt_ledger_pop_bind(text, text, bigint, bigint, text, boolean, text, integer);
--   drop function if exists public.mpt_ledger_pop_check(text);
--   drop function if exists public.mpt_ledger_pop_revoke(text, bigint, integer);
--   drop schema if exists ledger cascade;

create schema if not exists ledger;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Tables
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists ledger.person (
  person_id      uuid primary key default gen_random_uuid(),
  status         text not null default 'provisional' check (status in ('provisional','active','merged','erased')),
  merged_into    uuid references ledger.person (person_id),
  primary_locale text check (primary_locale is null or primary_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  created_at     timestamptz not null default now(),
  check ((status = 'merged') = (merged_into is not null)),
  check (merged_into is distinct from person_id)
);

-- Every external key is a row here, never a column on person (D1). wa_id is canonical E.164 with a leading +; email is only ever a sha256 hex hash.
create table if not exists ledger.person_identifier (
  identifier_id uuid primary key default gen_random_uuid(),
  person_id     uuid not null references ledger.person (person_id),
  id_type       text not null check (id_type in ('wa_id','telegram_id','email_hash','lead_id','conversation_id','web_scan_id','scan_id','session_id','user_id','social_x')),
  id_value      text not null check (char_length(id_value) between 1 and 200),
  proof_state   text not null default 'unproven' check (proof_state in ('unproven','claimed','proven')),
  proven_at     timestamptz,
  proof_method  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (id_type, id_value),
  check (proof_state <> 'proven' or (proven_at is not null and proof_method is not null)),
  check (id_type <> 'wa_id' or id_value ~ '^\+[1-9][0-9]{5,14}$'),
  check (id_type <> 'email_hash' or id_value ~ '^[0-9a-f]{64}$'),
  check (id_type <> 'telegram_id' or id_value ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$')   -- plain numeric id, or the keyed hash MPC-7894 allows in the scan tables
);
create index if not exists person_identifier_person_idx on ledger.person_identifier (person_id);

create table if not exists ledger.identity_link (
  link_id    uuid primary key default gen_random_uuid(),
  person_a   uuid not null references ledger.person (person_id),
  person_b   uuid not null references ledger.person (person_id),
  confidence smallint not null check (confidence between 0 and 100),
  basis      text not null,
  state      text not null default 'proposed' check (state in ('proposed','confirmed','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (person_a <> person_b)
);
create unique index if not exists identity_link_pair_uq on ledger.identity_link (
  (case when person_a < person_b then person_a else person_b end), (case when person_a < person_b then person_b else person_a end));

-- Registry: one row per claim type. default_check_confidence is deliberately NULL until Chris / Qwen approve a default (nothing is invented per row).
create table if not exists ledger.data_point_type (
  code                     text primary key check (code ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  domain                   text not null,
  scope                    text not null check (scope in ('number','person','device','account','scan')),
  value_schema             jsonb not null default '{}'::jsonb,
  sensitivity              text not null default 'medium' check (sensitivity in ('low','medium','high')),
  max_age                  interval check (max_age is null or max_age > interval '0'),
  default_check_confidence smallint check (default_check_confidence is null or default_check_confidence between 0 and 100),
  clean_phrase_allowed     boolean not null default false,
  phrase_key_base          text not null check (phrase_key_base ~ '^[a-z0-9_]+$'),
  untyped                  boolean not null default false,
  note                     text
);

-- F6: the two legacy category taxonomies stay separate domain values; this table only records a PROPOSED mapping for approval.
create table if not exists ledger.domain_map (
  taxonomy        text not null,
  source_category text not null,
  domain          text not null,
  map_state       text not null default 'proposed' check (map_state in ('proposed','approved')),
  primary key (taxonomy, source_category)
);

create table if not exists ledger.backfill_batch (
  backfill_batch_id uuid primary key default gen_random_uuid(),
  source_name       text not null,
  note              text,
  created_at        timestamptz not null default now()
);

create table if not exists ledger.data_point (
  data_point_id     uuid primary key default gen_random_uuid(),
  person_id         uuid not null references ledger.person (person_id),
  type_code         text not null references ledger.data_point_type (code),
  subject_ref       text check (subject_ref is null or char_length(subject_ref) <= 200),
  value             jsonb,
  status            text not null check (status in ('found','clear','not_checked','check_failed')),
  confidence        smallint check (confidence between 0 and 100),
  source            text not null check (source in ('taken','given','checked')),
  channel           text not null check (channel in ('web','email','telegram','whatsapp','sms')),
  method            text not null check (method in ('webhook','button_tap','free_text','exact_lookup','heuristic','estimate','scrape','local_analysis','mpt_score','legacy_import')),
  source_name       text,
  input_ref         text,
  collector_version text,
  provenance_extra  jsonb not null default '{}'::jsonb,
  locale            text check (locale is null or locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  observed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,
  supersedes_id     uuid references ledger.data_point (data_point_id),
  retain_until      timestamptz,
  legacy_ref        text,
  backfill_batch_id uuid references ledger.backfill_batch (backfill_batch_id),
  -- H2: not_checked / check_failed have no number and no value; found / clear must have both
  constraint data_point_h2_honest_unknown check (
    (status in ('not_checked','check_failed') and confidence is null and value is null)
    or (status in ('found','clear') and confidence is not null and value is not null)),
  -- H4: a claim with no origin cannot be inserted
  constraint data_point_h4_provenance check (
    (source <> 'checked' or nullif(btrim(source_name), '') is not null)
    and (source <> 'given' or nullif(btrim(input_ref), '') is not null)),
  -- H10: 100 is earned
  constraint data_point_h10_hundred_is_earned check (
    confidence is distinct from 100
    or (source = 'checked' and method = 'exact_lookup')
    or (source = 'taken' and method = 'webhook')),
  constraint data_point_expiry_after_observation check (expires_at is null or expires_at > observed_at),
  constraint data_point_backfill_tag check ((legacy_ref is null) = (backfill_batch_id is null))
);
create index if not exists data_point_person_type_idx on ledger.data_point (person_id, type_code, observed_at desc);
create index if not exists data_point_subject_idx on ledger.data_point (type_code, subject_ref);
create unique index if not exists data_point_legacy_ref_uq on ledger.data_point (legacy_ref) where legacy_ref is not null;
create index if not exists data_point_supersedes_idx on ledger.data_point (supersedes_id) where supersedes_id is not null;
create index if not exists data_point_backfill_idx on ledger.data_point (backfill_batch_id) where backfill_batch_id is not null;
-- one possession proof per web session (a second bind for the same session must fail, never overwrite)
create unique index if not exists data_point_pop_proof_session_uq on ledger.data_point (subject_ref) where type_code = 'phone.possession_proof';

-- D4 / A1.3: what we SHOWED and how the person responded. Loop data, not a claim about the person. Silence is never stored as a "no" fact.
create table if not exists ledger.shown_event (
  shown_id              uuid primary key default gen_random_uuid(),
  person_id             uuid not null references ledger.person (person_id),
  type_code             text not null references ledger.data_point_type (code),
  subject_ref           text check (subject_ref is null or char_length(subject_ref) <= 200),
  confidence_at_display smallint not null check (confidence_at_display between 0 and 100),
  response              text not null check (response in ('confirmed','not_me','disputed','no_response')),
  latency_ms            integer check (latency_ms is null or latency_ms >= 0),
  channel               text not null check (channel in ('web','email','telegram','whatsapp','sms')),
  shown_at              timestamptz not null default now(),
  data_point_id         uuid references ledger.data_point (data_point_id),
  check (response <> 'no_response' or (latency_ms is null and data_point_id is null)),
  check (response = 'no_response' or data_point_id is not null)
);
create index if not exists shown_event_person_idx on ledger.shown_event (person_id, shown_at desc);

-- The list of types each report is expected to cover, so an unchecked item shows as "not yet checked" instead of silence (G7).
create table if not exists ledger.report_profile (
  profile     text primary key check (profile ~ '^[a-z0-9_]+$'),
  description text not null,
  defined     boolean not null default true
);
create table if not exists ledger.report_profile_item (
  profile     text not null references ledger.report_profile (profile),
  type_code   text not null references ledger.data_point_type (code),
  subject_ref text not null default '',
  primary key (profile, type_code, subject_ref)
);

create table if not exists ledger.render_log (
  render_id      uuid primary key default gen_random_uuid(),
  person_id      uuid references ledger.person (person_id),
  kind           text not null check (kind in ('claim','progress')),
  channel        text not null check (channel in ('web','email','telegram','whatsapp','sms')),
  locale         text,
  type_code      text,
  subject_ref    text,
  class          text not null check (class in ('verified','self_attested','inferred','unknown')),
  phrase_keys    text[] not null default '{}',
  data_point_ids uuid[] not null default '{}',
  guard_version  text not null,
  created_at     timestamptz not null default now()
);
create index if not exists render_log_person_idx on ledger.render_log (person_id, created_at desc);

alter table ledger.person              enable row level security; alter table ledger.person              force row level security;
alter table ledger.person_identifier   enable row level security; alter table ledger.person_identifier   force row level security;
alter table ledger.identity_link       enable row level security; alter table ledger.identity_link       force row level security;
alter table ledger.data_point_type     enable row level security; alter table ledger.data_point_type     force row level security;
alter table ledger.domain_map          enable row level security; alter table ledger.domain_map          force row level security;
alter table ledger.backfill_batch      enable row level security; alter table ledger.backfill_batch      force row level security;
alter table ledger.data_point          enable row level security; alter table ledger.data_point          force row level security;
alter table ledger.shown_event         enable row level security; alter table ledger.shown_event         force row level security;
alter table ledger.report_profile      enable row level security; alter table ledger.report_profile      force row level security;
alter table ledger.report_profile_item enable row level security; alter table ledger.report_profile_item force row level security;
alter table ledger.render_log          enable row level security; alter table ledger.render_log          force row level security;

comment on schema ledger is 'MPC-8737 data-point ledger v1 (design MPC-7898). Append-only. Not exposed to the REST API; no role reads the tables directly, channels call ledger.render_claim / render_progress.';
comment on table ledger.data_point is 'One observation of one claim by one source. Append-only (H5). Class (Verified / Self-attested / Inferred / Unknown) is never stored; the guard computes it.';
comment on column ledger.data_point.retain_until is 'Reserved and left unpopulated: retention policy is deferred (design Part 11).';

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pure helpers
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger.guess_below() returns smallint language sql immutable as $$ select 80::smallint $$;
create or replace function ledger.guard_version() returns text language sql immutable as $$ select 'ledger-guard-1'::text $$;

-- Canonical E.164 with a leading +, or NULL. Mirrors normaliseTarget() in workers/webhook-receiver/pop.ts (digits only; a leading 00 is the international prefix).
-- Meta's real wa_id format is UNCONFIRMED (design F14): normalisation lives in this one function so the answer changes in one place.
create or replace function ledger.normalise_wa_id(p text) returns text language sql immutable as $$
  select case when d ~ '^[1-9][0-9]{5,14}$' then '+' || d end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', '') as d) s
$$;

-- Word + bar bands (design 6.1, PROPOSED defaults awaiting Chris). Config, not data. The exact figure stays in the record.
create or replace function ledger.confidence_band(p_confidence smallint) returns smallint language sql immutable as $$
  select case when p_confidence is null then null
              when p_confidence < 40 then 1 when p_confidence < 60 then 2 when p_confidence < 80 then 3 when p_confidence < 95 then 4 else 5 end::smallint
$$;

-- The class of one row. unknown wins over everything: no number, a failed / skipped check, or a stale row can never be anything else.
create or replace function ledger.class_of(p_source text, p_status text, p_confidence smallint, p_expired boolean) returns text language sql immutable as $$
  select case
    when p_status is null or p_status not in ('found','clear') or p_confidence is null or coalesce(p_expired, true) then 'unknown'
    when p_confidence < ledger.guess_below() then 'inferred'
    when p_source in ('checked','taken') then 'verified'
    when p_source = 'given' then 'self_attested'
    else 'unknown' end
$$;

-- A user's answer (value.answer) contradicts a finding only when it says not_me / disputed; otherwise two rows disagree when their values differ.
create or replace function ledger.values_disagree(p_given jsonb, p_other jsonb) returns boolean language sql immutable as $$
  select case when p_given is null or p_other is null then false
              when jsonb_typeof(p_given) = 'object' and p_given ? 'answer' then (p_given->>'answer') in ('not_me','disputed')
              else p_given is distinct from p_other end
$$;

-- Minimal registry value-schema check: type, enum, required, properties, additionalProperties:false.
create or replace function ledger.value_matches(p_schema jsonb, p_value jsonb) returns boolean language plpgsql immutable as $$
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
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Person resolution (D1)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger.root_person(p uuid) returns uuid language plpgsql stable set search_path = ledger, pg_temp as $$
declare cur uuid := p; nxt uuid; n int := 0;
begin
  loop
    select merged_into into nxt from ledger.person where person_id = cur;
    if nxt is null then return cur; end if;
    cur := nxt; n := n + 1;
    if n > 50 then raise exception 'ledger: merge chain too long'; end if;
  end loop;
end $$;

-- The root plus every person merged into it (directly or through a chain). Data points keep their original person_id; reads follow the pointer.
create or replace function ledger.person_family(p_root uuid) returns setof uuid language sql stable set search_path = ledger, pg_temp as $$
  with recursive fam(person_id) as (
    select p_root union select pe.person_id from ledger.person pe join fam on pe.merged_into = fam.person_id)
  select person_id from fam
$$;

create or replace function ledger._normalise_identifier(p_type text, p_value text) returns text language sql immutable as $$
  select case p_type
    when 'wa_id' then ledger.normalise_wa_id(p_value)
    when 'email_hash' then lower(btrim(p_value))
    when 'telegram_id' then btrim(p_value)
    else nullif(btrim(p_value), '') end
$$;

-- Find the person an identifier belongs to (following merges). p_create makes a provisional person with an UNPROVEN identifier when none exists.
create or replace function ledger.resolve_person(p_type text, p_value text, p_create boolean default false)
returns uuid language plpgsql security definer set search_path = ledger, pg_temp as $$
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

create or replace function ledger._merge_persons(p_from uuid, p_into uuid) returns void language plpgsql security definer set search_path = ledger, pg_temp as $$
declare f uuid := ledger.root_person(p_from); i uuid := ledger.root_person(p_into);
begin
  if f = i then return; end if;
  if exists (select 1 from ledger.person where person_id in (f, i) and status = 'erased') then raise exception 'ledger: cannot merge an erased person'; end if;
  update ledger.person set status = 'merged', merged_into = i where person_id = f;
  update ledger.person set status = 'active' where person_id = i and status = 'provisional';
end $$;

-- Attach an identifier to a person under the D1 rules: only a PROVEN strong identifier (wa_id, telegram_id, email_hash) can merge two people;
-- anything weaker that lands on someone else's identifier becomes a proposed link, never a merge. Unproven identifiers never mint links.
create or replace function ledger.attach_identifier(p_person uuid, p_type text, p_value text, p_proof_state text default 'unproven', p_proof_method text default null)
returns jsonb language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- Merging on the user's word: needs a GIVEN data point of type identity.link_confirmation (D1: "or when the user confirms the link").
create or replace function ledger.confirm_link(p_link uuid, p_given_data_point uuid) returns void language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- Unmerging is clearing one pointer (D1). Nothing else was rewritten by the merge.
create or replace function ledger.unmerge_person(p_person uuid) returns void language plpgsql security definer set search_path = ledger, pg_temp as $$
begin
  update ledger.person set status = 'active', merged_into = null where person_id = p_person and status = 'merged';
  if not found then raise exception 'ledger: person % is not merged', p_person; end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Triggers: validation (H5, H8, value schema, person state, supersedes)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger._append_only() returns trigger language plpgsql set search_path = ledger, pg_temp as $$
begin
  -- Only the erase / batch-rollback functions (SECURITY DEFINER, so current_user is their owner) may remove rows. A caller running as any other role cannot opt in by setting the flag.
  if current_setting('ledger.allow_erase', true) = 'on' and tg_op = 'DELETE'
     and current_user = (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'ledger.erase_person(uuid)'::regprocedure) then
    return old;
  end if;
  raise exception 'ledger: % on %.% is not allowed (append-only; corrections are new rows via supersedes_id)', tg_op, tg_table_schema, tg_table_name using errcode = 'insufficient_privilege';
end $$;

create or replace function ledger._data_point_validate() returns trigger language plpgsql set search_path = ledger, pg_temp as $$
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

drop trigger if exists data_point_validate on ledger.data_point;
create trigger data_point_validate before insert on ledger.data_point for each row execute function ledger._data_point_validate();
drop trigger if exists data_point_append_only on ledger.data_point;
create trigger data_point_append_only before update or delete on ledger.data_point for each row execute function ledger._append_only();
drop trigger if exists data_point_no_truncate on ledger.data_point;
create trigger data_point_no_truncate before truncate on ledger.data_point for each statement execute function ledger._append_only();
drop trigger if exists shown_event_append_only on ledger.shown_event;
create trigger shown_event_append_only before update or delete on ledger.shown_event for each row execute function ledger._append_only();
drop trigger if exists render_log_append_only on ledger.render_log;
create trigger render_log_append_only before update or delete on ledger.render_log for each row execute function ledger._append_only();
drop trigger if exists shown_event_no_truncate on ledger.shown_event;
create trigger shown_event_no_truncate before truncate on ledger.shown_event for each statement execute function ledger._append_only();
drop trigger if exists render_log_no_truncate on ledger.render_log;
create trigger render_log_no_truncate before truncate on ledger.render_log for each statement execute function ledger._append_only();

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Views (not readable by any channel role: H7)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace view ledger.v_data_point_current as
select distinct on (ledger.root_person(d.person_id), d.type_code, coalesce(d.subject_ref, ''), d.source)
       d.*, ledger.root_person(d.person_id) as root_person_id
from ledger.data_point d
where not exists (select 1 from ledger.data_point s where s.supersedes_id = d.data_point_id)
order by ledger.root_person(d.person_id), d.type_code, coalesce(d.subject_ref, ''), d.source, d.observed_at desc, d.created_at desc;

create or replace view ledger.v_disagreement as
select g.root_person_id, g.type_code, g.subject_ref,
       g.data_point_id as given_id, c.data_point_id as other_id, c.source as other_source,
       g.value as given_value, c.value as other_value, g.observed_at as given_at, c.observed_at as other_at
from ledger.v_data_point_current g
join ledger.v_data_point_current c
  on c.root_person_id = g.root_person_id and c.type_code = g.type_code and coalesce(c.subject_ref, '') = coalesce(g.subject_ref, '') and c.source in ('checked','taken')
where g.source = 'given' and g.status in ('found','clear') and c.status in ('found','clear') and ledger.values_disagree(g.value, c.value);

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Writers (the only way in; they enforce the same rules a direct insert would hit)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger.record_data_point(
  p_person uuid, p_type text, p_subject text, p_value jsonb, p_status text, p_confidence smallint, p_source text, p_channel text, p_method text,
  p_source_name text default null, p_input_ref text default null, p_locale text default null, p_observed_at timestamptz default now(),
  p_expires_at timestamptz default null, p_supersedes uuid default null, p_provenance jsonb default '{}'::jsonb, p_collector_version text default null)
returns uuid language plpgsql security definer set search_path = ledger, pg_temp as $$
declare id uuid;
begin
  insert into ledger.data_point (person_id, type_code, subject_ref, value, status, confidence, source, channel, method, source_name, input_ref, locale,
                                 observed_at, expires_at, supersedes_id, provenance_extra, collector_version)
  values (ledger.root_person(p_person), p_type, p_subject, p_value, p_status, p_confidence, p_source, p_channel, p_method, p_source_name, p_input_ref, p_locale,
          coalesce(p_observed_at, now()), p_expires_at, p_supersedes, coalesce(p_provenance, '{}'::jsonb), p_collector_version)
  returning data_point_id into id;
  return id;
end $$;

-- A user's answer to something we showed (D4): writes the GIVEN point (confirmed / not_me / disputed, stored at 95 per D2) and the shown event together.
-- A missing answer is recorded by record_shown(... 'no_response'), never as a data point.
create or replace function ledger.record_answer(
  p_person uuid, p_type text, p_subject text, p_answer text, p_confidence_at_display smallint, p_latency_ms integer, p_channel text, p_input_ref text,
  p_locale text default null, p_shown_at timestamptz default now(), p_observed_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = ledger, pg_temp as $$
declare dp uuid; root uuid := ledger.root_person(p_person);
begin
  if p_answer not in ('confirmed','not_me','disputed') then raise exception 'ledger: unknown answer %', p_answer; end if;
  dp := ledger.record_data_point(root, p_type, p_subject, jsonb_build_object('answer', p_answer), 'found', 95::smallint, 'given', p_channel, 'button_tap',
                                 null, p_input_ref, p_locale, p_observed_at, null, null, '{}'::jsonb, null);
  insert into ledger.shown_event (person_id, type_code, subject_ref, confidence_at_display, response, latency_ms, channel, shown_at, data_point_id)
  values (root, p_type, p_subject, p_confidence_at_display, p_answer, p_latency_ms, p_channel, p_shown_at, dp);
  return dp;
end $$;

create or replace function ledger.record_shown(p_person uuid, p_type text, p_subject text, p_confidence_at_display smallint, p_channel text, p_shown_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = ledger, pg_temp as $$
declare id uuid;
begin
  insert into ledger.shown_event (person_id, type_code, subject_ref, confidence_at_display, response, channel, shown_at)
  values (ledger.root_person(p_person), p_type, p_subject, p_confidence_at_display, 'no_response', p_channel, p_shown_at) returning shown_id into id;
  return id;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The render guard (design 6.2). Every channel report generator calls these and nothing else.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger._expired(p_expires timestamptz, p_observed timestamptz, p_max_age interval) returns boolean language sql stable as $$
  select (p_expires is not null and p_expires <= now()) or (p_max_age is not null and p_observed + p_max_age <= now())
$$;

-- Internal evaluation shared by render_claim and render_progress. Returns the class, the phrase variant, typed params and the points used.
create or replace function ledger._eval_claim(p_person uuid, p_type text, p_subject text,
  out o_class text, out o_variant text, out o_params jsonb, out o_bar smallint, out o_action text, out o_ids uuid[], out o_base text)
language plpgsql stable set search_path = ledger, pg_temp as $$
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

create or replace function ledger.render_claim(p_person uuid, p_type text, p_subject text, p_locale text, p_channel text)
returns table (class text, phrase_key text, phrase_params jsonb, bar smallint, action_key text, data_point_ids uuid[], render_id uuid)
language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- Three integers, no ratio, no score (G6). Counts every item of the profile (G7). Inferred counts as "not yet checked" (D2 / F11).
create or replace function ledger.render_progress(p_person uuid, p_profile text, p_locale text, p_channel text)
returns table (verified integer, self_attested_fixes integer, not_yet_checked integer, phrase_key text, phrase_params jsonb, data_point_ids uuid[], render_id uuid)
language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Erase (the only deleters). M3 (wiring mpt_dsar_erase & co. to call this) is NOT in this migration: it edits live functions.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger.erase_person(p_person uuid) returns jsonb language plpgsql security definer set search_path = ledger, pg_temp as $$
declare root uuid := ledger.root_person(p_person); fam uuid[]; n_dp int; n_se int; n_rl int; n_id int;
begin
  select array_agg(x) into fam from ledger.person_family(root) x;
  perform set_config('ledger.allow_erase', 'on', true);
  delete from ledger.shown_event where person_id = any (fam); get diagnostics n_se = row_count;
  delete from ledger.render_log where person_id = any (fam); get diagnostics n_rl = row_count;
  delete from ledger.data_point where person_id = any (fam); get diagnostics n_dp = row_count;
  delete from ledger.identity_link where person_a = any (fam) or person_b = any (fam);
  delete from ledger.person_identifier where person_id = any (fam); get diagnostics n_id = row_count;
  update ledger.person set status = 'erased', merged_into = null, primary_locale = null where person_id = any (fam);
  perform set_config('ledger.allow_erase', 'off', true);
  return jsonb_build_object('persons', cardinality(fam), 'data_points', n_dp, 'shown_events', n_se, 'render_log', n_rl, 'identifiers', n_id);
end $$;

-- Exact reversal of one backfill run (M4 rollback). Postgres-owner only; not granted to any API role.
create or replace function ledger.rollback_backfill_batch(p_batch uuid) returns integer language plpgsql security definer set search_path = ledger, pg_temp as $$
declare n int;
begin
  perform set_config('ledger.allow_erase', 'on', true);
  delete from ledger.data_point where backfill_batch_id = p_batch; get diagnostics n = row_count;
  perform set_config('ledger.allow_erase', 'off', true);
  return n;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Seed (M2): registry rows and report profiles only. No personal data.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into ledger.data_point_type (code, domain, scope, value_schema, sensitivity, max_age, clean_phrase_allowed, phrase_key_base, note) values
  ('phone.possession_proof', 'identity', 'number',
   '{"type":"object","required":["inbound_ts","consent_v","consent_accepted"],"additionalProperties":false,"properties":{"inbound_ts":{"type":"number"},"consent_v":{"type":"string"},"consent_accepted":{"type":"boolean"}}}'::jsonb,
   'high', null, false, 'phone_possession', 'MPC-7902: a web session was bound to the wa_id that sent the one-time code. subject_ref = HMAC(session token). source taken / webhook / 100. Expiry (60 min) is carried by expires_at.'),
  ('phone.possession_revoked', 'identity', 'number',
   '{"type":"object","required":["via"],"additionalProperties":false,"properties":{"via":{"type":"string","enum":["stop_or_delete"]}}}'::jsonb,
   'high', null, false, 'phone_possession_revoked', 'MPC-7902: STOP / DELETE inbound. Any proof bound at or before this observed_at is dead. Final STOP -> consent.* mapping belongs to MPC-7904 (open ruling).'),
  ('identity.link_confirmation', 'identity', 'person',
   '{"type":"object","required":["answer"],"additionalProperties":false,"properties":{"answer":{"type":"string","enum":["confirmed"]}}}'::jsonb,
   'medium', null, false, 'identity_link', 'D1: the person confirms that two identities are theirs. A GIVEN point; the only way (besides two proven strong identifiers) to merge.'),
  ('category.broker.exposure',       'broker',       'scan', '{}'::jsonb, 'medium', null, false, 'category_broker',       'Mirror report, category-level claim. No writer yet: reads as not yet checked until one exists.'),
  ('category.search.exposure',       'search',       'scan', '{}'::jsonb, 'medium', null, false, 'category_search',       'Mirror report, category-level claim.'),
  ('category.social.exposure',       'social',       'scan', '{}'::jsonb, 'medium', null, false, 'category_social',       'Mirror report, category-level claim.'),
  ('category.email.exposure',        'email',        'scan', '{}'::jsonb, 'medium', null, false, 'category_email',        'Mirror report, category-level claim.'),
  ('category.device.exposure',       'device',       'scan', '{}'::jsonb, 'medium', null, false, 'category_device',       'Mirror report, category-level claim.'),
  ('category.network.exposure',      'network',      'scan', '{}'::jsonb, 'medium', null, false, 'category_network',      'Mirror report, category-level claim.'),
  ('category.professional.exposure', 'professional', 'scan', '{}'::jsonb, 'medium', null, false, 'category_professional', 'Mirror report, category-level claim.'),
  ('category.ai_threat.exposure',    'ai_threat',    'scan', '{}'::jsonb, 'medium', null, false, 'category_ai_threat',    'Mirror report, category-level claim.')
on conflict (code) do nothing;

insert into ledger.report_profile (profile, description, defined) values
  ('mirror_8_hexagon', 'The 8-hexagon Mirror report (broker, search, social, email, device, network, professional, ai_threat).', true),
  ('whatsapp_audit_14', 'The 14-point WhatsApp audit. ITEM LIST NOT DEFINED in the approved pages (strategy 6.3 table was not available); the guard treats an item-less profile as undefined, never as complete.', false)
on conflict (profile) do nothing;

insert into ledger.report_profile_item (profile, type_code, subject_ref)
select 'mirror_8_hexagon', code, '' from ledger.data_point_type where code like 'category.%.exposure'
on conflict do nothing;

-- F6: proposed only, one-to-one, no cross-taxonomy merge.
insert into ledger.domain_map (taxonomy, source_category, domain, map_state)
select 'signals_hexagon', c, c, 'proposed' from unnest(array['broker','search','social','email','device','network','professional','ai_threat']) c
union all
select 'web_scans', c, c, 'proposed' from unnest(array['behavior','device','fingerprint','language','network','orientation','privacy','profile','security','social','storage']) c
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Grants (H7). No role reads or writes a ledger table; service_role may only call the guard and the writers.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on schema ledger from public;
revoke all on all tables in schema ledger from public;
revoke all on all functions in schema ledger from public;
alter default privileges in schema ledger revoke all on tables from public;
alter default privileges in schema ledger revoke all on functions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema ledger from anon; revoke all on all tables in schema ledger from anon; revoke all on all functions in schema ledger from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema ledger from authenticated; revoke all on all tables in schema ledger from authenticated; revoke all on all functions in schema ledger from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on all tables in schema ledger from service_role;
    grant usage on schema ledger to service_role;
    grant execute on function ledger.render_claim(uuid, text, text, text, text), ledger.render_progress(uuid, text, text, text),
      ledger.record_data_point(uuid, text, text, jsonb, text, smallint, text, text, text, text, text, text, timestamptz, timestamptz, uuid, jsonb, text),
      ledger.record_answer(uuid, text, text, text, smallint, integer, text, text, text, timestamptz, timestamptz),
      ledger.record_shown(uuid, text, text, smallint, text, timestamptz),
      ledger.resolve_person(text, text, boolean), ledger.attach_identifier(uuid, text, text, text, text),
      ledger.confirm_link(uuid, uuid), ledger.unmerge_person(uuid), ledger.erase_person(uuid),
      ledger.guess_below(), ledger.normalise_wa_id(text), ledger.confidence_band(smallint) to service_role;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- MPC-7902 repoint (public RPCs the Worker calls over PostgREST; the ledger schema itself is not exposed).
-- The Worker keeps every decision (flag, consent version, target, revocation order). These functions only store and read the proof.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mpt_ledger_pop_bind(
  p_sid text, p_wa text, p_bound_at_ms bigint, p_inbound_ts bigint, p_consent_v text, p_consent_accepted boolean, p_msg text, p_ttl_seconds integer)
returns boolean language plpgsql security definer set search_path = public, ledger, pg_temp as $$
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

create or replace function public.mpt_ledger_pop_check(p_sid text) returns jsonb language plpgsql stable security definer set search_path = public, ledger, pg_temp as $$
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

-- STOP / DELETE. A number the ledger has never seen has no proof to kill, so nothing is created for it (no data about a stranger who only said STOP).
create or replace function public.mpt_ledger_pop_revoke(p_wa text, p_at_ms bigint, p_ttl_seconds integer) returns boolean language plpgsql security definer set search_path = public, ledger, pg_temp as $$
declare pid uuid; at_ts timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  if ledger.normalise_wa_id(p_wa) is null or p_ttl_seconds is null or p_ttl_seconds <= 0 then raise exception 'mpt_ledger_pop_revoke: bad arguments'; end if;
  pid := ledger.resolve_person('wa_id', p_wa, false);
  if pid is null then return true; end if;
  perform ledger.record_data_point(pid, 'phone.possession_revoked', null, jsonb_build_object('via', 'stop_or_delete'), 'found', 100::smallint, 'taken', 'whatsapp', 'webhook',
    'whatsapp_inbound', null, null, at_ts, at_ts + make_interval(secs => p_ttl_seconds), null, '{}'::jsonb, 'pop-1');
  return true;
end $$;

revoke all on function public.mpt_ledger_pop_bind(text, text, bigint, bigint, text, boolean, text, integer) from public;
revoke all on function public.mpt_ledger_pop_check(text) from public;
revoke all on function public.mpt_ledger_pop_revoke(text, bigint, integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mpt_ledger_pop_bind(text, text, bigint, bigint, text, boolean, text, integer) from anon;
    revoke all on function public.mpt_ledger_pop_check(text) from anon;
    revoke all on function public.mpt_ledger_pop_revoke(text, bigint, integer) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mpt_ledger_pop_bind(text, text, bigint, bigint, text, boolean, text, integer) from authenticated;
    revoke all on function public.mpt_ledger_pop_check(text) from authenticated;
    revoke all on function public.mpt_ledger_pop_revoke(text, bigint, integer) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mpt_ledger_pop_bind(text, text, bigint, bigint, text, boolean, text, integer) to service_role;
    grant execute on function public.mpt_ledger_pop_check(text) to service_role;
    grant execute on function public.mpt_ledger_pop_revoke(text, bigint, integer) to service_role; end if;
end $$;
