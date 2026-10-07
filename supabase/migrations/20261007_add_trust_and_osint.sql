-- MPT-1001: schema for the "Progressive Trust" and "OSINT" features (MPT = MyPrivacyTOOL).
-- FLEET-TASK-V4.2: goal, scope, acceptance criteria and rollback are below. NOT yet applied to the live project
-- (xmdmkumwxpgahmlweuug); production is applied by a human or connector, a merge does not apply it (docs/RUNBOOK.md).
--
-- Goal:   store OSINT findings, per-lead conversation/trust state, per-channel preferences and a translation
--         job queue, and extend public.leads with the contact + locale fields those features need.
-- Scope:  additive only. Four new tables and four nullable/defaulted columns on public.leads. No existing row,
--         policy or grant is changed.
-- Access: same model as MPC-6677 / MPC-7508: RLS ENABLED and FORCED with NO policies, anon/authenticated revoked.
--         Only service_role (the Workers) can read or write. Each table is exposed deliberately later, if ever.
-- PII:    this file contains no real PII, only structure. Phone numbers are stored in E.164 and must be
--         erased with the lead (ON DELETE CASCADE from leads); osint_results.summary must hold a short redacted
--         finding, not raw scraped profile content.
-- Microdrama: the "Microdrama" comments below mark the progressive-trust beats, one small reveal per
--         conversation turn, so the stage columns read as a story arc rather than a bare state machine.
--
-- Acceptance criteria:
--   1. public.osint_results, conversation_states, channel_preferences, translation_queue exist with RLS forced.
--   2. public.leads has phone_number text, whatsapp_opt_in boolean, locale_code text, confidence_score int.
--   3. anon and authenticated are denied on every new table; service_role can read and write.
--   4. Re-running the file is a no-op (idempotent).
--
-- Rollback (run as a NEW migration, never edit this one once applied):
--   drop table if exists public.translation_queue, public.channel_preferences,
--                        public.conversation_states, public.osint_results;
--   alter table public.leads
--     drop column if exists phone_number, drop column if exists whatsapp_opt_in,
--     drop column if exists locale_code, drop column if exists confidence_score;
--   (drop function public.mpt_set_updated_at() is NOT part of rollback: 20261006150000 owns it.)

-- ---------------------------------------------------------------- leads: contact + locale + confidence
alter table public.leads add column if not exists phone_number      text;
alter table public.leads add column if not exists whatsapp_opt_in   boolean not null default false;
alter table public.leads add column if not exists locale_code       text;
alter table public.leads add column if not exists confidence_score  integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.leads'::regclass and conname = 'leads_phone_number_e164_chk') then
    alter table public.leads add constraint leads_phone_number_e164_chk
      check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{6,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.leads'::regclass and conname = 'leads_locale_code_chk') then
    alter table public.leads add constraint leads_locale_code_chk
      check (locale_code is null or locale_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.leads'::regclass and conname = 'leads_confidence_score_chk') then
    alter table public.leads add constraint leads_confidence_score_chk
      check (confidence_score is null or confidence_score between 0 and 100);
  end if;
  -- A WhatsApp opt-in is meaningless (and unlawful to act on) without a number to message.
  if not exists (select 1 from pg_constraint where conrelid = 'public.leads'::regclass and conname = 'leads_whatsapp_needs_phone_chk') then
    alter table public.leads add constraint leads_whatsapp_needs_phone_chk
      check (not whatsapp_opt_in or phone_number is not null);
  end if;
end $$;

comment on column public.leads.phone_number     is 'MPT-1001. E.164 (+15550100). PII: erased with the lead.';
comment on column public.leads.whatsapp_opt_in  is 'MPT-1001. True only after explicit WhatsApp consent; requires phone_number.';
comment on column public.leads.locale_code      is 'MPT-1001. BCP-47 style language tag, e.g. en, es-MX. Drives translation_queue target_locale.';
comment on column public.leads.confidence_score is 'MPT-1001. 0-100 confidence that OSINT matches belong to this lead.';

-- ---------------------------------------------------------------- osint_results
create table if not exists public.osint_results (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.leads(id) on delete cascade,
  source            text not null check (char_length(source) <= 100),          -- e.g. 'broker:example', 'search'
  finding_type      text not null check (finding_type in ('data_broker','breach','social_profile','public_record','other')),
  summary           text check (char_length(summary) <= 1000),                 -- redacted; never raw profile content
  confidence_score  integer not null default 0 check (confidence_score between 0 and 100),
  status            text not null default 'new' check (status in ('new','verified','dismissed','removed')),
  raw_payload       jsonb not null default '{}'::jsonb,
  found_at          timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists osint_results_lead_id_idx on public.osint_results (lead_id, found_at desc);
create index if not exists osint_results_status_idx  on public.osint_results (status) where status = 'new';

-- ---------------------------------------------------------------- conversation_states
-- Microdrama: trust is earned one beat at a time. A lead starts at 'cold open' (stage 0) and each stage unlocks a
-- little more of what we ask for: first a name, then a locale, then a phone number, then WhatsApp consent.
create table if not exists public.conversation_states (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references public.leads(id) on delete cascade,
  channel             text not null check (channel in ('web','email','whatsapp','sms','github')),
  trust_stage         smallint not null default 0 check (trust_stage between 0 and 5),
  state               text not null default 'new' check (state in ('new','active','awaiting_reply','paused','completed','opted_out')),
  context             jsonb not null default '{}'::jsonb,                      -- non-PII conversation memory
  last_inbound_at     timestamptz,
  last_outbound_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (lead_id, channel)
);
create index if not exists conversation_states_state_idx on public.conversation_states (state, updated_at);

-- ---------------------------------------------------------------- channel_preferences
create table if not exists public.channel_preferences (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.leads(id) on delete cascade,
  channel           text not null check (channel in ('email','whatsapp','sms','web')),
  opted_in          boolean not null default false,
  opted_in_at       timestamptz,
  opted_out_at      timestamptz,
  consent_source    text check (char_length(consent_source) <= 100),
  preferred_locale  text check (preferred_locale is null or preferred_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'),
  quiet_hours       jsonb,                                                     -- e.g. {"start":"21:00","end":"08:00","tz":"Europe/Madrid"}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (lead_id, channel),
  check (not opted_in or opted_in_at is not null)
);

-- ---------------------------------------------------------------- translation_queue
create table if not exists public.translation_queue (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references public.leads(id) on delete cascade,
  source_locale     text not null check (source_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'),
  target_locale     text not null check (target_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'),
  source_text       text not null check (char_length(source_text) <= 10000),
  translated_text   text check (char_length(translated_text) <= 10000),
  status            text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts          integer not null default 0 check (attempts >= 0),
  last_error        text check (char_length(last_error) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  check (source_locale <> target_locale)
);
create index if not exists translation_queue_lead_id_idx on public.translation_queue (lead_id);
create index if not exists translation_queue_pending_idx on public.translation_queue (created_at) where status in ('pending','processing');

-- ---------------------------------------------------------------- updated_at maintenance
-- public.mpt_set_updated_at() is created by 20261006150000_mpc_7508_rls_schema_finalization.sql.
do $$
declare t text;
begin
  foreach t in array array['osint_results','conversation_states','channel_preferences','translation_queue'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.mpt_set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS: deny by default
do $$
declare t text;
begin
  foreach t in array array['osint_results','conversation_states','channel_preferences','translation_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

comment on table public.osint_results       is 'MPT-1001. OSINT findings per lead (redacted summary + confidence). service_role only.';
comment on table public.conversation_states is 'MPT-1001. Progressive Trust: per lead and channel conversation state and trust stage (Microdrama beats 0-5). service_role only.';
comment on table public.channel_preferences is 'MPT-1001. Per lead and channel opt-in, locale and quiet hours. service_role only.';
comment on table public.translation_queue   is 'MPT-1001. Pending/processed translation jobs keyed by locale. service_role only.';
