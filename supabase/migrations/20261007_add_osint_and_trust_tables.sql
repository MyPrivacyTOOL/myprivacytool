-- CK-006 (FLEET-TASK-V4.2): schema for the "Progressive Trust" and OSINT features of MPT (MyPrivacyTOOL).
-- Additive only: four new tables and four new nullable/defaulted columns on public.leads. No existing data is rewritten.
-- Every new table is service_role only (RLS enabled + forced, no anon/authenticated grants), like the rest of the
-- lead pipeline. Expose a table to clients later with an explicit GRANT plus policy.
-- Rollback notes are at the bottom.

-- ---------------------------------------------------------------- leads: contact + channel columns
alter table public.leads
  add column if not exists phone_number     text,
  add column if not exists whatsapp_opt_in  boolean not null default false,
  add column if not exists locale_code      text,
  add column if not exists confidence_score numeric(4,3);

alter table public.leads drop constraint if exists leads_phone_number_e164;
alter table public.leads add constraint leads_phone_number_e164
  check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{6,14}$');
alter table public.leads drop constraint if exists leads_locale_code_format;
alter table public.leads add constraint leads_locale_code_format
  check (locale_code is null or locale_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
alter table public.leads drop constraint if exists leads_confidence_score_range;
alter table public.leads add constraint leads_confidence_score_range
  check (confidence_score is null or confidence_score between 0 and 1);

comment on column public.leads.phone_number     is 'CK-006. E.164 (+15551234567). PII: collected only with consent; erase with the lead.';
comment on column public.leads.whatsapp_opt_in  is 'CK-006. True only after an explicit WhatsApp opt-in; never infer it. Evidence lives in channel_preferences.';
comment on column public.leads.locale_code      is 'CK-006. BCP 47 language tag (en, pt-BR) used to pick message/translation locale.';
comment on column public.leads.confidence_score is 'CK-006. 0..1 identity/trust confidence for Progressive Trust; null = not scored.';

-- ---------------------------------------------------------------- osint_results
create table if not exists public.osint_results (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  source           text not null check (char_length(source) between 1 and 100),
  query_type       text not null check (char_length(query_type) between 1 and 100),
  status           text not null default 'found'
                     check (status in ('found','not_found','not_checked','error')),
  result           jsonb not null default '{}'::jsonb,
  confidence_score numeric(4,3) check (confidence_score is null or confidence_score between 0 and 1),
  fetched_at       timestamptz not null default now(),
  retain_until     timestamptz not null default now() + interval '24 hours',
  created_at       timestamptz not null default now()
);
create index if not exists osint_results_lead_id_idx on public.osint_results (lead_id, fetched_at desc);
create index if not exists osint_results_retain_until_idx on public.osint_results (retain_until);

-- ---------------------------------------------------------------- conversation_states
create table if not exists public.conversation_states (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  channel          text not null check (channel in ('web','email','sms','whatsapp','telegram')),
  trust_level      smallint not null default 0 check (trust_level between 0 and 5),
  state            text not null default 'new',
  context          jsonb not null default '{}'::jsonb,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (lead_id, channel)
);

-- ---------------------------------------------------------------- channel_preferences
create table if not exists public.channel_preferences (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  channel          text not null check (channel in ('web','email','sms','whatsapp','telegram')),
  opted_in         boolean not null default false,
  opted_in_at      timestamptz,
  opted_out_at     timestamptz,
  consent_source   text check (char_length(consent_source) <= 100),
  is_preferred     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (lead_id, channel)
);
-- at most one preferred channel per lead
create unique index if not exists channel_preferences_one_preferred_idx
  on public.channel_preferences (lead_id) where is_preferred;

-- ---------------------------------------------------------------- translation_queue
create table if not exists public.translation_queue (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references public.leads(id) on delete cascade,
  source_text      text not null check (char_length(source_text) <= 10000),
  source_locale    text not null check (source_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  target_locale    text not null check (target_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  status           text not null default 'pending'
                     check (status in ('pending','processing','completed','failed')),
  translated_text  text,
  attempts         integer not null default 0 check (attempts >= 0),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists translation_queue_pending_idx on public.translation_queue (created_at) where status in ('pending','processing');
create index if not exists translation_queue_lead_id_idx on public.translation_queue (lead_id);

-- ---------------------------------------------------------------- updated_at maintenance (function from MPC-7508)
drop trigger if exists conversation_states_set_updated_at on public.conversation_states;
create trigger conversation_states_set_updated_at before update on public.conversation_states
  for each row execute function public.mpt_set_updated_at();
drop trigger if exists channel_preferences_set_updated_at on public.channel_preferences;
create trigger channel_preferences_set_updated_at before update on public.channel_preferences
  for each row execute function public.mpt_set_updated_at();
drop trigger if exists translation_queue_set_updated_at on public.translation_queue;
create trigger translation_queue_set_updated_at before update on public.translation_queue
  for each row execute function public.mpt_set_updated_at();

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

comment on table public.osint_results       is 'CK-006. Microdrama (MPT) OSINT findings per lead; status=not_checked records sources we could not check, never a guess. 24h default retention (retain_until). service_role only.';
comment on table public.conversation_states is 'CK-006. Microdrama (MPT) Progressive Trust: one row per lead per channel holding trust_level and conversation state. service_role only.';
comment on table public.channel_preferences is 'CK-006. Per-lead channel opt-in/out with consent evidence (WhatsApp/SMS need an explicit opt-in). service_role only.';
comment on table public.translation_queue   is 'CK-006. Pending machine-translation jobs (Qwen) for outbound messages by locale. service_role only.';

-- Rollback (nothing outside these objects depends on them):
--   drop table public.translation_queue, public.channel_preferences, public.conversation_states, public.osint_results;
--   alter table public.leads drop constraint leads_phone_number_e164, drop constraint leads_locale_code_format,
--     drop constraint leads_confidence_score_range, drop column phone_number, drop column whatsapp_opt_in,
--     drop column locale_code, drop column confidence_score;
