-- MPC-8320: scan and conversation state for the WhatsApp RESULTS pull model moves from Firestore to Supabase, with a 24 h purge.
--
-- public.mpt_conversation_state   one row per key: deepdive:<scan_id>, deepdive_latest:<wa_id>, whatsapp:<wa_id>.
--                                 state is the same flat object the Worker used to keep in Firestore (a scan holds its hexagons as a JSON string).
--                                 Every row has a hard life: expires_at is the scan's own 24 h expiry, or 24 h from the last write for the others.
--                                 The Worker never returns an expired row and deletes expired rows from its Cron Trigger.
-- public.purge_expired_conversation_state()   deletes only rows past expires_at and returns how many. Same job as the Cron Trigger, for a
--                                 manual run or pg_cron. Not granted to anon / authenticated.
--
-- Access: RLS forced, no anon/authenticated grants, service_role only (the webhook-receiver Worker). Idempotent.
-- Rollback: drop function if exists public.purge_expired_conversation_state(); drop table if exists public.mpt_conversation_state;
-- Not applied to production by the PR that adds it: apply by hand (SQL editor) before the Worker with this change is deployed.

create table if not exists public.mpt_conversation_state (
  key        text primary key check (char_length(key) between 1 and 200),
  state      jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
comment on table public.mpt_conversation_state is 'Short-lived WhatsApp scan and conversation state. Every row expires within 24 h and is purged. Holds a wa_id inside state for the lifetime of the row only.';
create index if not exists mpt_conversation_state_expires_idx on public.mpt_conversation_state (expires_at);

alter table public.mpt_conversation_state enable row level security; alter table public.mpt_conversation_state force row level security;
revoke all on public.mpt_conversation_state from public, anon, authenticated;
grant all on public.mpt_conversation_state to service_role;
drop policy if exists "service role full access" on public.mpt_conversation_state;
create policy "service role full access" on public.mpt_conversation_state for all to service_role using (true) with check (true);

create or replace function public.purge_expired_conversation_state() returns bigint
language sql security invoker set search_path = public as $$
  with gone as (delete from public.mpt_conversation_state where expires_at < now() returning 1)
  select count(*) from gone;
$$;
revoke all on function public.purge_expired_conversation_state() from public, anon, authenticated;
grant execute on function public.purge_expired_conversation_state() to service_role;
