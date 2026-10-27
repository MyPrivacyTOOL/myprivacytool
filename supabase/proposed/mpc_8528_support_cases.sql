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
-- Rollback: drop function if exists public.support_create_case_from_event, public.support_append_inbound, public.support_issue_proof, public.support_redeem_proof, public.support_purge_expired;
--           drop table if exists support_proofs, support_inbound_events, support_usage, support_action_receipts, support_messages, support_cases cascade;

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
create unique index if not exists support_messages_inbound_uq on public.support_messages (case_id, provider_event_id) where direction = 'inbound';

-- Race-safe dedupe across cases: one row per (channel, provider event). Inserted FIRST, inside the same transaction as the case/message.
create table if not exists public.support_inbound_events (
  channel           text not null check (channel in ('web','email','telegram','whatsapp','sms','social','voice')),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 512),
  case_id           uuid not null references public.support_cases (id) on delete cascade deferrable initially deferred,
  created_at        timestamptz not null default now(),
  primary key (channel, provider_event_id)
);
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
alter table public.support_inbound_events enable row level security; alter table public.support_inbound_events force row level security;
revoke all on public.support_cases, public.support_messages, public.support_action_receipts, public.support_usage, public.support_inbound_events from anon, authenticated;
grant select, insert, update, delete on public.support_cases, public.support_messages, public.support_action_receipts, public.support_usage, public.support_inbound_events to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Atomic intake. Returns {case: <row>, duplicate: bool}. A provider event is stored once; a repeat returns the original case
-- and changes nothing. Raises on any failure so the caller can answer "not recorded" (never a reference without a commit).
create or replace function public.support_create_case_from_event(
  p_channel text, p_event_id text, p_thread_key text, p_sender text, p_text text, p_ref text, p_policy text
) returns jsonb language plpgsql set search_path = public as $$
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

-- Atomic append to an existing case. Returns true when this provider event was already stored (duplicate).
create or replace function public.support_append_inbound(p_case_id uuid, p_event_id text, p_text text)
returns boolean language plpgsql set search_path = public as $$
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

revoke all on function public.support_create_case_from_event(text,text,text,text,text,text,text), public.support_append_inbound(uuid,text,text) from public, anon, authenticated;
grant execute on function public.support_create_case_from_event(text,text,text,text,text,text,text), public.support_append_inbound(uuid,text,text) to service_role;

-- ---------------------------------------------------------------- identity proofs (emailed one-time proof)
-- A proof is a random token emailed to the address on the account. Only its SHA-256 hash is stored. It is single-use and short-lived.
-- Redeeming it is the ONLY way a caller becomes `verified`; a chat "yes", a platform sender id or a password never does.
create table if not exists public.support_proofs (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  subject_id  text not null check (char_length(subject_id) between 1 and 128),
  tenant_id   text not null check (char_length(tenant_id) between 1 and 128),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create index if not exists support_proofs_expires_idx on public.support_proofs (expires_at);
alter table public.support_proofs enable row level security; alter table public.support_proofs force row level security;
revoke all on public.support_proofs from anon, authenticated;
grant select, insert, update, delete on public.support_proofs to service_role;
comment on table public.support_proofs is 'MPC-8528 proposed. Hashed single-use identity proofs. Never stores the token itself.';

create or replace function public.support_issue_proof(p_token_hash text, p_subject text, p_tenant text, p_ttl_seconds integer)
returns uuid language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then raise exception 'proof ttl must be 60..3600 seconds'; end if;
  insert into public.support_proofs (token_hash, subject_id, tenant_id, expires_at)
  values (p_token_hash, p_subject, p_tenant, now() + make_interval(secs => p_ttl_seconds)) returning id into v_id;
  return v_id;
end $$;

-- Atomic single-use redeem. Returns {subject_id, tenant_id} once, then null for every later attempt, an expired proof, or an unknown one.
create or replace function public.support_redeem_proof(p_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare v record;
begin
  update public.support_proofs set consumed_at = now()
   where token_hash = p_token_hash and consumed_at is null and expires_at > now()
   returning subject_id, tenant_id into v;
  if not found then return null; end if;
  return jsonb_build_object('subject_id', v.subject_id, 'tenant_id', v.tenant_id);
end $$;

-- ---------------------------------------------------------------- retention (proposed periods: raw message text 90 days, case 6 months)
-- NOT scheduled and NOT applied. The periods come from the task owner's recommended answer and still need legal sign-off and the
-- privacy-notice wording. A case is purged by inactivity (updated_at) in any state: an unresolved case does not keep personal data forever.
create or replace function public.support_purge_expired()
returns jsonb language plpgsql set search_path = public as $$
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
-- Schedule (when approved), same pattern as the other purge jobs; left commented on purpose:
--   select cron.schedule('support-purge-expired', '17 3 * * *', $$select public.support_purge_expired()$$);

revoke all on function public.support_issue_proof(text,text,text,integer), public.support_redeem_proof(text), public.support_purge_expired() from public, anon, authenticated;
grant execute on function public.support_issue_proof(text,text,text,integer), public.support_redeem_proof(text), public.support_purge_expired() to service_role;
