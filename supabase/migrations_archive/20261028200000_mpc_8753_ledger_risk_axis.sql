-- MPC-8753: ledger risk axis, education before acceptance, 366-hexagon registry, amended guard.
-- Implements design MPC-7898 Amendment A3 + A3.9 (approved by Chris 2026-10-28). Applied AFTER 20261028130000_mpc_8737_data_point_ledger_v1.sql.
-- PRODUCTION MIGRATION: .github/workflows/deploy-supabase.yml runs `supabase db push` on merge to main.
-- ADDITIVE: new tables, new functions, new nullable registry columns. It changes no v1 column, no legacy table and no v1 guard function
-- (render_claim / render_progress keep their exact v1 return types; the risk-aware guard is the NEW render_claim_risk / render_progress_risk).
-- The only v1 objects it replaces are ledger.erase_person (now also erases the two risk tables) and the render_log kind CHECK (adds 'consequence');
-- both are restored by the ROLLBACK block. It writes no personal data. There is no backfill: no risk history exists anywhere today.
-- Idempotent: create ... if not exists / create or replace / on conflict do nothing.
--
-- The risk axis (A3.2) is stored apart from identity/confidence, per CLAIM and per SCAN (A3.9 D7: risk decisions last for one scan only; no reopen):
--   claim key = (person, type_code, subject_key, scan_key)
--   states    = unknown (implicit, no row) -> educated (risk_education_event) -> accepted | removed (risk_decision_event)
--   the axis applies only to a claim whose current checked/taken data point has status 'found' and whose identity answer is not not_me.
--
-- New rules (continuing section 5 of the design):
--   H11 risk applies only to what was found      triggers: the data point must be the claim's current 'found' checked/taken row
--   H12 no acceptance without prior education    CHECK + composite FK + trigger: same claim, same scan, shown earlier, same value hash, current consequence version
--   H13 education is a real, traceable render    render_id NOT NULL; the render_log row must carry this data point and the consequence key; the type needs an APPROVED consequence text
--   H14 each transition carries its own provenance  basis checked / given / accepted; given and accepted need input_ref; removed-by-checked needs a re-check that says clear
--   H15 only legal transitions                   trigger derives the state and rejects anything outside: educate from unknown/educated, accept from educated, remove from unknown/educated
--   H16 append-only, one way to write            UPDATE / DELETE / TRUNCATE blocked; no role has table privileges; callers use the SECURITY DEFINER record_* functions
--   H17 the two axes are independent             a decision on a not_me claim is rejected; the risk tables never touch identity rows
--   H18 only built, allowed hexagons are promised   report_profile_item rejects an unbuilt / non-ok hexagon; a not_allowed type cannot receive a checked data point
--
-- Open default (listed in the PR): consequence_key_base / consequence_version are NULL for all 366 types, so NO hexagon can be educated, and therefore none can
-- be accepted, until a human-approved consequence text exists in public.localization (status 'approved') and the registry row points at it (H13).
--
-- Rollback (tested by supabase/tests/run.sh, which extracts the lines below). A seeded hexagon type that a data point already references is kept as a plain registry row
-- (only its added columns go); report_profile_item rows for hexagons are config and are removed.
-- ROLLBACK
--   drop table if exists ledger.risk_decision_event;
--   drop table if exists ledger.risk_education_event;
--   select set_config('ledger.allow_erase', 'on', false);
--   delete from ledger.render_log where kind = 'consequence';
--   select set_config('ledger.allow_erase', 'off', false);
--   alter table ledger.render_log drop constraint if exists render_log_kind_check;
--   alter table ledger.render_log add constraint render_log_kind_check check (kind in ('claim','progress'));
--   drop trigger if exists report_profile_item_h18 on ledger.report_profile_item;
--   drop trigger if exists data_point_h18_not_allowed on ledger.data_point;
--   drop function if exists ledger.render_progress_risk(uuid, text, text, text, text);
--   drop function if exists ledger.render_claim_risk(uuid, text, text, text, text, text);
--   drop function if exists ledger.record_risk_decision(uuid, text, text, text, text, text, uuid, text, uuid, uuid, text, text);
--   drop function if exists ledger.record_risk_education(uuid, text, text, text, uuid, text, text, integer);
--   drop function if exists ledger.render_consequence(uuid, text, text, text, text);
--   drop function if exists ledger._risk_decision_validate();
--   drop function if exists ledger._risk_education_validate();
--   drop function if exists ledger._consequence_approved(text);
--   drop function if exists ledger._risk_eval(uuid, text, text, text);
--   drop function if exists ledger._risk_claim(uuid, text, text);
--   drop function if exists ledger._profile_item_h18();
--   drop function if exists ledger._data_point_h18_not_allowed();
--   delete from ledger.report_profile_item where type_code in (select code from ledger.data_point_type where hexagon_id is not null);
--   delete from ledger.data_point_type t where t.hexagon_id is not null and not exists (select 1 from ledger.data_point d where d.type_code = t.code) and not exists (select 1 from ledger.shown_event e where e.type_code = t.code);
--   drop function if exists ledger.hexagon_type_code(text, text);
--   drop index if exists ledger.data_point_type_hexagon_id_uq;
--   alter table ledger.data_point_type drop constraint if exists data_point_type_hexagon_shape, drop constraint if exists data_point_type_consequence_pair, drop constraint if exists data_point_type_consequence_key_shape;
--   alter table ledger.data_point_type drop column if exists hexagon_id, drop column if exists channel, drop column if exists channel_group, drop column if exists arrival, drop column if exists risk_tier, drop column if exists build_state, drop column if exists access_class, drop column if exists risk_applicable, drop column if exists consequence_key_base, drop column if exists consequence_version, drop column if exists catalogue_version, drop column if exists claim_group;
--   create or replace function ledger.erase_person(p_person uuid) returns jsonb language plpgsql security definer set search_path = ledger, pg_temp as $$
--   declare root uuid := ledger.root_person(p_person); fam uuid[]; n_dp int; n_se int; n_rl int; n_id int;
--   begin
--     select array_agg(x) into fam from ledger.person_family(root) x;
--     perform set_config('ledger.allow_erase', 'on', true);
--     delete from ledger.shown_event where person_id = any (fam); get diagnostics n_se = row_count;
--     delete from ledger.render_log where person_id = any (fam); get diagnostics n_rl = row_count;
--     delete from ledger.data_point where person_id = any (fam); get diagnostics n_dp = row_count;
--     delete from ledger.identity_link where person_a = any (fam) or person_b = any (fam);
--     delete from ledger.person_identifier where person_id = any (fam); get diagnostics n_id = row_count;
--     update ledger.person set status = 'erased', merged_into = null, primary_locale = null where person_id = any (fam);
--     perform set_config('ledger.allow_erase', 'off', true);
--     return jsonb_build_object('persons', cardinality(fam), 'data_points', n_dp, 'shown_events', n_se, 'render_log', n_rl, 'identifiers', n_id);
--   end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Registry at 366 scale (A3.5): added columns, all nullable or defaulted so every v1 row stays valid
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table ledger.data_point_type add column if not exists hexagon_id           text;
alter table ledger.data_point_type add column if not exists channel              text;
alter table ledger.data_point_type add column if not exists channel_group        text;
alter table ledger.data_point_type add column if not exists arrival              text;
alter table ledger.data_point_type add column if not exists risk_tier            text;
alter table ledger.data_point_type add column if not exists build_state          text;
alter table ledger.data_point_type add column if not exists access_class         text;
alter table ledger.data_point_type add column if not exists risk_applicable      boolean not null default false;
alter table ledger.data_point_type add column if not exists consequence_key_base text;
alter table ledger.data_point_type add column if not exists consequence_version  integer;
alter table ledger.data_point_type add column if not exists catalogue_version    text;
alter table ledger.data_point_type add column if not exists claim_group          text;   -- reserved, unused (D5: one decision per hexagon)

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'data_point_type_hexagon_shape' and conrelid = 'ledger.data_point_type'::regclass) then
    alter table ledger.data_point_type add constraint data_point_type_hexagon_shape check (
      (hexagon_id is null and not risk_applicable)
      or (hexagon_id is not null and channel is not null and channel_group is not null and arrival in ('A','B','C','D')
          and risk_tier in ('high','medium','low') and build_state in ('built','not_built')
          and access_class in ('ok','off','verify','signin','paid','partner','owner_decision','not_allowed')));
    alter table ledger.data_point_type add constraint data_point_type_consequence_pair check ((consequence_key_base is null) = (consequence_version is null));
    alter table ledger.data_point_type add constraint data_point_type_consequence_key_shape check (consequence_key_base is null or consequence_key_base ~ '^[a-z0-9_.]+$');
  end if;
end $$;
create unique index if not exists data_point_type_hexagon_id_uq on ledger.data_point_type (hexagon_id) where hexagon_id is not null;

-- hexagon id -> registry code. Dotted ids are kept verbatim; the 61 un-dotted ids (54 web, 7 email) get their channel as prefix. Collision-free (tested).
create or replace function ledger.hexagon_type_code(p_id text, p_channel text) returns text language sql immutable as $$
  select case when p_id like '%.%' then p_id
              when p_channel = 'email' and p_id like 'email-%' then 'email.' || replace(substr(p_id, 7), '-', '_')
              else p_channel || '.' || replace(p_id, '-', '_') end
$$;

-- Seed: exactly the 366 hexagons of public.hexagon_catalogue (MPC-8689, itself seeded from hexagons-366.json). Registry rows only; nothing about a person.
-- scope is a coarse PROPOSAL (number for phone-number facts, device for web, person otherwise); it matters only to rule H8 and is a one-line change per row.
do $$ begin
  if to_regclass('public.hexagon_catalogue') is null then raise exception 'MPC-8753: public.hexagon_catalogue (MPC-8689) must be applied first'; end if;
  if (select count(*) from public.hexagon_catalogue) <> 366 then raise exception 'MPC-8753: expected 366 rows in hexagon_catalogue, found %', (select count(*) from public.hexagon_catalogue); end if;
end $$;
insert into ledger.data_point_type (code, domain, scope, value_schema, sensitivity, clean_phrase_allowed, phrase_key_base, untyped, note,
                                    hexagon_id, channel, channel_group, arrival, risk_tier, build_state, access_class, risk_applicable, catalogue_version)
select ledger.hexagon_type_code(h.id, h.channel), h.channel,
       case when h.id ~ '^(sms|call|fax)\.number' or h.id ~ '^wa\.(phone|number_)' then 'number' when h.channel = 'web' then 'device' else 'person' end,
       '{}'::jsonb, h.risk, false, replace(ledger.hexagon_type_code(h.id, h.channel), '.', '_'), true,
       'MPC-8753 seed from hexagon_catalogue: ' || h.label,
       h.id, h.channel, h.channel_group, h.arrival, h.risk,
       case h.status when 'defined' then 'built' else 'not_built' end,
       case h.access when 'OK' then 'ok' when 'OK (off)' then 'off' when 'Verify' then 'verify' when 'Their sign-in' then 'signin' when 'Paid' then 'paid'
                     when 'Partner access' then 'partner' when 'Owner decision' then 'owner_decision' when 'Not allowed' then 'not_allowed' end,
       true, h.catalogue_version
from public.hexagon_catalogue h
-- A v1 type with the same code (the MPC-8737 backfill registers web.<id> the same way) is promoted in place: its schema, sensitivity and notes are kept,
-- only the hexagon columns are filled. A row that already carries a DIFFERENT hexagon_id is left alone and the count assertion below fails loudly.
on conflict (code) do update set
  hexagon_id = excluded.hexagon_id, channel = excluded.channel, channel_group = excluded.channel_group, arrival = excluded.arrival, risk_tier = excluded.risk_tier,
  build_state = excluded.build_state, access_class = excluded.access_class, risk_applicable = true, catalogue_version = excluded.catalogue_version
  where ledger.data_point_type.hexagon_id is null;
do $$ begin
  if (select count(*) from ledger.data_point_type where hexagon_id is not null) <> 366 then
    raise exception 'MPC-8753: registry holds % hexagon types, expected 366', (select count(*) from ledger.data_point_type where hexagon_id is not null); end if;
end $$;

-- H18: a report profile may promise only hexagons that are built and allowed; a not_allowed type can never receive a checked data point.
create or replace function ledger._profile_item_h18() returns trigger language plpgsql set search_path = ledger, pg_temp as $$
declare t ledger.data_point_type%rowtype;
begin
  select * into t from ledger.data_point_type where code = new.type_code;
  if t.hexagon_id is not null and (t.build_state <> 'built' or t.access_class <> 'ok') then
    raise exception 'ledger: H18 % is % / access %, so it cannot be promised in a report profile', new.type_code, t.build_state, t.access_class using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists report_profile_item_h18 on ledger.report_profile_item;
create trigger report_profile_item_h18 before insert or update on ledger.report_profile_item for each row execute function ledger._profile_item_h18();

create or replace function ledger._data_point_h18_not_allowed() returns trigger language plpgsql set search_path = ledger, pg_temp as $$
begin
  if new.source = 'checked' and exists (select 1 from ledger.data_point_type where code = new.type_code and access_class = 'not_allowed') then
    raise exception 'ledger: H18 % is not allowed (breaks the MPC-8452 rules); nothing may be checked for it', new.type_code using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists data_point_h18_not_allowed on ledger.data_point;
create trigger data_point_h18_not_allowed before insert on ledger.data_point for each row execute function ledger._data_point_h18_not_allowed();

-- render_log gains the 'consequence' kind (the render that shows "what someone could do with this", H13)
alter table ledger.render_log drop constraint if exists render_log_kind_check;
alter table ledger.render_log add constraint render_log_kind_check check (kind in ('claim','progress','consequence'));

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Risk tables (A3.2). Both append-only; the claim key carries scan_key (A3.9 D7).
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists ledger.risk_education_event (
  education_id        uuid primary key default gen_random_uuid(),
  person_id           uuid not null references ledger.person (person_id),
  type_code           text not null references ledger.data_point_type (code),
  subject_key         text not null default '' check (char_length(subject_key) <= 200),
  scan_key            text not null check (char_length(scan_key) between 1 and 200),
  data_point_id       uuid not null references ledger.data_point (data_point_id),
  value_hash          text not null check (value_hash ~ '^[0-9a-f]{32}$'),
  consequence_key     text not null,
  consequence_version integer not null,
  render_id           uuid not null references ledger.render_log (render_id),
  channel             text not null check (channel in ('web','email','telegram','whatsapp','sms')),
  locale              text check (locale is null or locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  shown_at            timestamptz not null default clock_timestamp(),
  visible_ms          integer check (visible_ms is null or visible_ms >= 0),   -- loop data only, not a gate
  provenance          text not null default 'shown_by_us' check (provenance = 'shown_by_us'),
  created_at          timestamptz not null default clock_timestamp(),
  unique (education_id, type_code, subject_key, scan_key)
);
create index if not exists risk_education_claim_idx on ledger.risk_education_event (type_code, subject_key, scan_key, shown_at desc);
create index if not exists risk_education_person_idx on ledger.risk_education_event (person_id);

create table if not exists ledger.risk_decision_event (
  decision_id             uuid primary key default gen_random_uuid(),
  person_id               uuid not null references ledger.person (person_id),
  type_code               text not null references ledger.data_point_type (code),
  subject_key             text not null default '' check (char_length(subject_key) <= 200),
  scan_key                text not null check (char_length(scan_key) between 1 and 200),
  data_point_id           uuid not null references ledger.data_point (data_point_id),
  value_hash              text not null check (value_hash ~ '^[0-9a-f]{32}$'),
  kind                    text not null check (kind in ('accepted','removed')),
  from_state              text not null check (from_state in ('unknown','educated')),
  to_state                text not null check (to_state in ('accepted','removed')),
  basis                   text not null check (basis in ('checked','given','accepted')),
  education_id            uuid,
  input_ref               text,
  evidence_data_point_id  uuid references ledger.data_point (data_point_id),
  render_id               uuid references ledger.render_log (render_id),
  channel                 text not null check (channel in ('web','email','telegram','whatsapp','sms')),
  locale                  text check (locale is null or locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  decided_at              timestamptz not null default clock_timestamp(),
  created_at              timestamptz not null default clock_timestamp(),
  constraint risk_decision_kind_state check (kind = to_state),
  -- H12: an acceptance names its education; nothing else does
  constraint risk_decision_h12_education check ((kind = 'accepted') = (education_id is not null)),
  constraint risk_decision_accept_from_educated check (kind <> 'accepted' or from_state = 'educated'),
  -- H14: each transition carries its own provenance
  constraint risk_decision_h14_basis check ((kind = 'accepted' and basis = 'accepted') or (kind = 'removed' and basis in ('checked','given'))),
  constraint risk_decision_h14_input check (basis not in ('given','accepted') or (nullif(btrim(input_ref), '') is not null and render_id is not null)),
  constraint risk_decision_h14_evidence check (not (kind = 'removed' and basis = 'checked') or evidence_data_point_id is not null),
  -- H12: the education is for the SAME claim and the SAME scan (person family and the other conditions are checked by trigger)
  constraint risk_decision_education_fk foreign key (education_id, type_code, subject_key, scan_key)
    references ledger.risk_education_event (education_id, type_code, subject_key, scan_key)
);
create index if not exists risk_decision_claim_idx on ledger.risk_decision_event (type_code, subject_key, scan_key, decided_at desc);
create index if not exists risk_decision_person_idx on ledger.risk_decision_event (person_id);

alter table ledger.risk_education_event enable row level security; alter table ledger.risk_education_event force row level security;
alter table ledger.risk_decision_event  enable row level security; alter table ledger.risk_decision_event  force row level security;
comment on table ledger.risk_education_event is 'MPC-8753 A3: the person was shown what this data point enables, in a guard render. Valid only for the same scan and the same value hash. Append-only.';
comment on table ledger.risk_decision_event is 'MPC-8753 A3: accepted (needs a prior education) or removed. Risk state is derived (ledger._risk_eval), never stored. Append-only.';

-- the shared view of "the claim as it stands now": the latest checked / taken row, and the latest identity answer
create or replace function ledger._risk_claim(p_person uuid, p_type text, p_subject text,
  out o_root uuid, out o_dp uuid, out o_status text, out o_value jsonb, out o_hash text, out o_expired boolean, out o_not_me boolean)
language plpgsql stable set search_path = ledger, pg_temp as $$
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

-- Derived risk state (A3.2). o_state: not_applicable | unknown | educated | accepted | removed | not_me. o_reason says why not_applicable.
create or replace function ledger._risk_eval(p_person uuid, p_type text, p_subject text, p_scan text,
  out o_state text, out o_reason text, out o_basis text, out o_dp uuid, out o_hash text, out o_education uuid, out o_decision uuid)
language plpgsql stable set search_path = ledger, pg_temp as $$
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

-- Is there a human-approved localization for this consequence key? (H13: hedge-class strings are never machine-approved.)
create or replace function ledger._consequence_approved(p_key text) returns boolean language plpgsql stable set search_path = ledger, pg_temp as $$
begin
  if to_regclass('public.localization') is null then return false; end if;
  return exists (select 1 from public.localization l where l.key = p_key and l.status = 'approved');
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Triggers: H11 to H17
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger._risk_education_validate() returns trigger language plpgsql set search_path = ledger, pg_temp as $$
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
drop trigger if exists risk_education_validate on ledger.risk_education_event;
create trigger risk_education_validate before insert on ledger.risk_education_event for each row execute function ledger._risk_education_validate();

create or replace function ledger._risk_decision_validate() returns trigger language plpgsql set search_path = ledger, pg_temp as $$
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
drop trigger if exists risk_decision_validate on ledger.risk_decision_event;
create trigger risk_decision_validate before insert on ledger.risk_decision_event for each row execute function ledger._risk_decision_validate();

drop trigger if exists risk_education_append_only on ledger.risk_education_event;
create trigger risk_education_append_only before update or delete on ledger.risk_education_event for each row execute function ledger._append_only();
drop trigger if exists risk_decision_append_only on ledger.risk_decision_event;
create trigger risk_decision_append_only before update or delete on ledger.risk_decision_event for each row execute function ledger._append_only();
drop trigger if exists risk_education_no_truncate on ledger.risk_education_event;
create trigger risk_education_no_truncate before truncate on ledger.risk_education_event for each statement execute function ledger._append_only();
drop trigger if exists risk_decision_no_truncate on ledger.risk_decision_event;
create trigger risk_decision_no_truncate before truncate on ledger.risk_decision_event for each statement execute function ledger._append_only();

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Writers and the guard (the only way in). The risk-aware guard is NEW; v1 render_claim / render_progress are untouched.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- "What someone could do with this": a guard render of the type's approved consequence text. The channel calls record_risk_education(render_id) AFTER it was delivered.
create or replace function ledger.render_consequence(p_person uuid, p_type text, p_subject text, p_locale text, p_channel text)
returns table (phrase_key text, phrase_params jsonb, data_point_ids uuid[], render_id uuid)
language plpgsql security definer set search_path = ledger, pg_temp as $$
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

create or replace function ledger.record_risk_education(p_person uuid, p_type text, p_subject text, p_scan_key text, p_render_id uuid, p_channel text,
  p_locale text default null, p_visible_ms integer default null)
returns uuid language plpgsql security definer set search_path = ledger, pg_temp as $$
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

create or replace function ledger.record_risk_decision(p_person uuid, p_type text, p_subject text, p_scan_key text, p_kind text, p_basis text,
  p_education_id uuid, p_input_ref text, p_render_id uuid, p_evidence_dp uuid, p_channel text, p_locale text default null)
returns uuid language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- render_claim + the risk axis. Every v1 field keeps its meaning; added: risk_state, risk_basis, risk_phrase_key, risk_event_id, education_id.
-- G9 accepted is never clean (the risk axis applies only to FOUND claims, and the clean family needs clear). G10 no nagging: accepted / removed return no action.
-- G12 fail closed: any error is not_applicable + retry, never accepted.
create or replace function ledger.render_claim_risk(p_person uuid, p_type text, p_subject text, p_scan_key text, p_locale text, p_channel text)
returns table (class text, phrase_key text, phrase_params jsonb, bar smallint, action_key text, data_point_ids uuid[], render_id uuid,
               risk_state text, risk_basis text, risk_phrase_key text, risk_event_id uuid, education_id uuid)
language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- render_progress + the risk line. v1's three provenance integers are unchanged (D2: Inferred counts in not_yet_checked). Added, all integers (G6: no ratio, no percentage):
--   unaddressed_unknown / unaddressed_educated / unaddressed_risk (the score), accepted, removed, clear, not_me, not_checked, risk_not_applicable.
-- The RISK buckets partition the profile: unaddressed_risk + accepted + removed + clear + not_me + not_checked + risk_not_applicable = the profile's size (G7).
-- not_checked here means "no usable checked/taken found-or-clear row", which is NOT the same set as the provenance not_yet_checked (an Inferred found claim is
-- not_yet_checked on the provenance line but unaddressed on the risk line).
create or replace function ledger.render_progress_risk(p_person uuid, p_profile text, p_scan_key text, p_locale text, p_channel text)
returns table (verified integer, self_attested_fixes integer, not_yet_checked integer,
               unaddressed_unknown integer, unaddressed_educated integer, unaddressed_risk integer, accepted integer, removed integer, clear integer, not_me integer,
               not_checked integer, risk_not_applicable integer,
               phrase_key text, phrase_params jsonb, data_point_ids uuid[], risk_event_ids uuid[], render_id uuid)
language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Erase parity (A3.6 M3): the two risk tables go first, then the v1 order. Replaces the v1 function of the same signature.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ledger.erase_person(p_person uuid) returns jsonb language plpgsql security definer set search_path = ledger, pg_temp as $$
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

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Grants (H7/H16): no role reads or writes a ledger table; service_role may only call the guard and the writers.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on ledger.risk_education_event, ledger.risk_decision_event from public;
revoke all on all functions in schema ledger from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on ledger.risk_education_event, ledger.risk_decision_event from anon; revoke all on all functions in schema ledger from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on ledger.risk_education_event, ledger.risk_decision_event from authenticated; revoke all on all functions in schema ledger from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on ledger.risk_education_event, ledger.risk_decision_event from service_role;
    grant execute on function ledger.render_consequence(uuid, text, text, text, text),
      ledger.record_risk_education(uuid, text, text, text, uuid, text, text, integer),
      ledger.record_risk_decision(uuid, text, text, text, text, text, uuid, text, uuid, uuid, text, text),
      ledger.render_claim_risk(uuid, text, text, text, text, text),
      ledger.render_progress_risk(uuid, text, text, text, text),
      ledger.erase_person(uuid) to service_role;
  end if;
end $$;
