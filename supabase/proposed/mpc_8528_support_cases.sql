-- MPC-8528 PROPOSED schema for the AI support service. NOT in supabase/migrations/ on purpose:
-- .github/workflows/deploy-supabase.yml runs `supabase db push` on every merge to main, so a file there is a production
-- migration. Moving this file into supabase/migrations/ is the production-migration approval step (see
-- docs/support-ai-backend-mpc-8528.md). Verified only on a throwaway local Postgres, never on the live project.
--
-- Why new tables: core-brain's interaction_log / mpt_conversation_state are best-effort by design (docs/core-brain.md) and
-- its `trust_level` is raised by a yes/no reply, so neither can be a durable case record or an authentication source.
--
-- Access: RLS forced, no anon/authenticated grants, service_role only. Raw message text is restricted personal data.
-- Retention/deletion periods are NOT set here: they need an approved decision (MPC-8530 / privacy notice).
-- Rollback: drop table if exists support_usage, support_action_receipts, support_messages, support_cases cascade;

create table if not exists public.support_cases (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique check (ref ~ '^SUP-[A-Z2-9]{8}$'),
  channel          text not null check (channel in ('web','email','telegram','whatsapp','sms','social','voice')),
  thread_key       text,
  sender_handle    text,
  state            text not null default 'new' check (state in ('new','triage','diagnosing','action_running','waiting_customer','waiting_system','resolved','closed','reopened','blocked')),
  state_reason     text,
  identity_level   text not null default 'anonymous' check (identity_level in ('anonymous','channel_asserted','verified')),
  linked_subject_id text,
  tenant_id        text,
  policy_version   text not null,
  knowledge_version text,
  reopen_count     integer not null default 0 check (reopen_count >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- a verified level must carry the subject and tenant it was verified for
  check (identity_level <> 'verified' or (linked_subject_id is not null and tenant_id is not null))
);
create unique index if not exists support_cases_thread_uq on public.support_cases (channel, thread_key) where thread_key is not null;
create index if not exists support_cases_state_updated_idx on public.support_cases (state, updated_at);

create table if not exists public.support_messages (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.support_cases (id) on delete cascade,
  direction         text not null check (direction in ('inbound','outbound')),
  author            text not null check (author in ('customer','ai','system')),
  provider_event_id text,
  body              text not null check (char_length(body) <= 20000),
  delivery          text check (delivery in ('queued','sent','failed','unknown')),
  created_at        timestamptz not null default now(),
  check (direction <> 'inbound' or provider_event_id is not null)
);
-- Dedupe key: one inbound provider event is stored once per case. The service also checks (channel, event) across cases.
create unique index if not exists support_messages_inbound_uq on public.support_messages (case_id, provider_event_id) where direction = 'inbound';
create index if not exists support_messages_case_idx on public.support_messages (case_id, created_at);

create table if not exists public.support_action_receipts (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.support_cases (id) on delete cascade,
  tool            text not null,
  idempotency_key text not null,
  policy_version  text not null,
  outcome         text not null check (outcome in ('success','denied','failed','unknown','rate_limited','disabled')),
  detail          text,
  cost_units      integer not null default 0 check (cost_units >= 0),
  created_at      timestamptz not null default now(),
  unique (case_id, idempotency_key)
);

create table if not exists public.support_usage (
  id         bigint generated always as identity primary key,
  usage_key  text not null,
  cost_units integer not null default 0 check (cost_units >= 0),
  at         timestamptz not null default now()
);
create index if not exists support_usage_key_at_idx on public.support_usage (usage_key, at);

comment on table public.support_cases is 'MPC-8528 proposed. One durable support case per thread. A row exists only after intake succeeded; the reference is returned to the customer only after this insert commits. No staff-assignment or founder-escalation column by design.';
comment on table public.support_action_receipts is 'MPC-8528 proposed. Audit receipt for every tool call including denied/disabled. outcome=unknown means a side-effecting tool may have written and must not be retried or reported as success.';

alter table public.support_cases enable row level security;          alter table public.support_cases force row level security;
alter table public.support_messages enable row level security;       alter table public.support_messages force row level security;
alter table public.support_action_receipts enable row level security; alter table public.support_action_receipts force row level security;
alter table public.support_usage enable row level security;          alter table public.support_usage force row level security;
revoke all on public.support_cases, public.support_messages, public.support_action_receipts, public.support_usage from anon, authenticated;
grant select, insert, update, delete on public.support_cases, public.support_messages, public.support_action_receipts, public.support_usage to service_role;
grant usage, select on all sequences in schema public to service_role;
