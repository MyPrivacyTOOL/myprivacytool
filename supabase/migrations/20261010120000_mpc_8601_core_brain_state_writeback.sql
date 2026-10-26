-- MPC-8601 follow-up: core-brain state write-back and the interaction_log table.
--
-- Why this shape: conversation_states.lead_id is NOT NULL and public.leads.email is NOT NULL, but a chat
-- sender (Telegram/WhatsApp/...) has no email. Inventing placeholder leads would pollute the lead list, hand fake
-- addresses to email campaigns and hide chat data from the email-keyed DSAR path. Instead a state row may belong to
-- a chat sender (sender_id) until a real lead is attached later (lead_id).
--
-- Additive and idempotent. service_role only (RLS enabled + forced, no anon/authenticated grants), like the rest of
-- the lead pipeline. Rollback notes are at the bottom.

-- ---------------------------------------------------------------- conversation_states: rows for chat senders
alter table public.conversation_states alter column lead_id drop not null;
alter table public.conversation_states add column if not exists sender_id text;

alter table public.conversation_states drop constraint if exists conversation_states_sender_id_len;
alter table public.conversation_states add constraint conversation_states_sender_id_len
  check (sender_id is null or char_length(sender_id) between 1 and 128);
alter table public.conversation_states drop constraint if exists conversation_states_has_owner;
alter table public.conversation_states add constraint conversation_states_has_owner
  check (lead_id is not null or sender_id is not null);

-- Backfill from the earlier convention (context->>'sender_id'), newest row wins per (channel, sender).
update public.conversation_states cs
   set sender_id = s.sid
  from (
    select distinct on (channel, context->>'sender_id') id, context->>'sender_id' as sid
      from public.conversation_states
     where sender_id is null
       and context ? 'sender_id'
       and char_length(context->>'sender_id') between 1 and 128
     order by channel, context->>'sender_id', updated_at desc
  ) s
 where cs.id = s.id;

create unique index if not exists conversation_states_channel_sender_key
  on public.conversation_states (channel, sender_id) where sender_id is not null;

comment on column public.conversation_states.sender_id is 'MPC-8601. The platform''s sender id as text (Telegram chat id, WhatsApp number, ...). PII: erase with public.mpt_erase_chat_sender() or with the lead. A row has a sender_id, a lead_id, or both.';

-- ---------------------------------------------------------------- interaction_log
-- One row per routed message. Metadata only, by design: NO message text and NO sender id. The sender is reachable
-- through conversation_state_id, so erasing the state row erases its log rows (ON DELETE CASCADE).
create table if not exists public.interaction_log (
  id                    uuid primary key default gen_random_uuid(),
  conversation_state_id uuid references public.conversation_states(id) on delete cascade,
  channel               text not null check (char_length(channel) between 1 and 32),
  intent                text not null check (intent in ('scan','help','verify','unknown')),
  intent_source         text not null check (intent_source in ('qwen','rules')),
  response_key          text not null check (char_length(response_key) between 1 and 100),
  state_before          text not null,
  state_after           text not null,
  trust_before          smallint not null check (trust_before between 0 and 5),
  trust_after           smallint not null check (trust_after between 0 and 5),
  created_at            timestamptz not null default now(),
  retain_until          timestamptz not null default now() + interval '90 days'
);
create index if not exists interaction_log_state_idx on public.interaction_log (conversation_state_id, created_at desc);
create index if not exists interaction_log_created_idx on public.interaction_log (created_at desc);
create index if not exists interaction_log_retain_until_idx on public.interaction_log (retain_until);

alter table public.interaction_log enable row level security;
alter table public.interaction_log force row level security;
revoke all on public.interaction_log from anon, authenticated;

comment on table public.interaction_log is 'MPC-8601. Audit/analytics trail of core-brain routing: intent, response key and state/trust transitions. No message text and no sender id. 90 day default retention (retain_until; purge with public.mpt_purge_expired_interaction_log()). Rows go with their conversation_states row. service_role only.';

-- ---------------------------------------------------------------- write-back: one atomic call from core-brain
-- Upserts the sender's state and appends the log row in ONE transaction, so state and audit trail cannot disagree.
--   * trust_level only ever goes up: greatest(existing, p_trust_floor). A message can never lower trust.
--   * p_new_state must be one of the known states (the Worker is not trusted to invent new ones). NULL keeps the current
--     state: the Worker sends it when it could not read the sender's state, so a read failure can never reset a conversation.
--   * Channels outside conversation_states' check (e.g. X) or a null sender id are log-only: no state row.
create or replace function public.mpt_brain_record(
  p_channel       text,
  p_sender_id     text,
  p_intent        text,
  p_intent_source text,
  p_response_key  text,
  p_new_state     text default null,
  p_trust_floor   smallint default 0
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
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
    -- create-if-missing, then lock the row so concurrent messages from one sender serialise
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

-- ---------------------------------------------------------------- erasure and retention for chat senders
-- Chat senders without a lead are invisible to the email-keyed DSAR helpers, so they get their own erase path.
create or replace function public.mpt_erase_chat_sender(p_channel text, p_sender_id text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.conversation_states where channel = p_channel and sender_id = p_sender_id;   -- log rows cascade
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mpt_purge_expired_interaction_log()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.interaction_log where retain_until < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_brain_record(text, text, text, text, text, text, smallint) from public, anon, authenticated;
revoke all on function public.mpt_erase_chat_sender(text, text) from public, anon, authenticated;
revoke all on function public.mpt_purge_expired_interaction_log() from public, anon, authenticated;
grant execute on function public.mpt_brain_record(text, text, text, text, text, text, smallint) to service_role;
grant execute on function public.mpt_erase_chat_sender(text, text) to service_role;
grant execute on function public.mpt_purge_expired_interaction_log() to service_role;

-- Rollback (nothing outside these objects depends on them; chat-sender state rows must go first because the old
-- shape requires a lead):
--   drop function public.mpt_brain_record(text, text, text, text, text, text, smallint),
--                 public.mpt_erase_chat_sender(text, text), public.mpt_purge_expired_interaction_log();
--   drop table public.interaction_log;
--   delete from public.conversation_states where lead_id is null;
--   drop index public.conversation_states_channel_sender_key;
--   alter table public.conversation_states drop constraint conversation_states_has_owner,
--     drop constraint conversation_states_sender_id_len, drop column sender_id, alter column lead_id set not null;
