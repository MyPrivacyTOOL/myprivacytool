-- MPC-8689: Telegram event flags for the extra hexagons "Edits" (tg.edits) and "Blocked or unblocked us" (tg.blocked_bot).
-- These arrive as separate Telegram updates (edited_message, my_chat_member), not with the consent message, so the baseline scan cannot see them.
-- One row per (sender, flag): THAT it happened, when it was first and last seen and how many times. Never the message text, the edit content or any other field.
-- Access: RLS enabled and forced, service_role only (the social-listeners Worker). No anon/authenticated grants.
-- sender_id uses the same key as profile_snapshots (plain id, or "h1:" + HMAC when TELEGRAM_ID_HMAC_KEY is set).
-- Retention: expires_at (Worker default 90 days, like profile_snapshots); daily purge job below. Deletion on request: mpt_delete_event_flags (called by STOP / delete my data).
-- Applied to the live project by .github/workflows/deploy-supabase.yml when the PR merges to main. It only adds a table and three functions; nothing writes to it until
-- TELEGRAM_BASELINE_SCAN=on and the sender is on the allow-list.
-- Rollback: select cron.unschedule('mpt-purge-expired-event-flags'); drop function public.mpt_record_event_flag(text, text, text, timestamptz);
--           drop function public.mpt_delete_event_flags(text); drop function public.mpt_purge_expired_event_flags(); drop table public.telegram_event_flags;
create table if not exists public.telegram_event_flags (
  sender_id   text not null check (sender_id ~ '^(h1:[0-9a-f]{64}|[0-9]{1,20})$'),
  flag        text not null check (flag in ('tg.edits', 'tg.blocked_bot')),
  state       text not null check (state in ('edited', 'blocked', 'unblocked')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  seen_count  integer not null default 1 check (seen_count >= 1),
  expires_at  timestamptz not null,
  primary key (sender_id, flag)
);
create index if not exists telegram_event_flags_expiry_idx on public.telegram_event_flags (expires_at);

alter table public.telegram_event_flags enable row level security;
alter table public.telegram_event_flags force row level security;
revoke all on public.telegram_event_flags from public, anon, authenticated;
grant select on public.telegram_event_flags to service_role;
drop policy if exists "service role full access" on public.telegram_event_flags;
create policy "service role full access" on public.telegram_event_flags for all to service_role using (true) with check (true);
comment on table public.telegram_event_flags is 'MPC-8689 Telegram event flags (edits, blocked or unblocked) for allow-listed accounts: that it happened and when, never content. 90-day retention.';

create or replace function public.mpt_record_event_flag(p_sender_id text, p_flag text, p_state text, p_expires_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.telegram_event_flags (sender_id, flag, state, expires_at) values (p_sender_id, p_flag, p_state, p_expires_at)
  on conflict (sender_id, flag) do update
    set state = excluded.state, last_seen = now(), seen_count = public.telegram_event_flags.seen_count + 1, expires_at = excluded.expires_at;
end $$;

create or replace function public.mpt_delete_event_flags(p_sender_id text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.telegram_event_flags where sender_id = p_sender_id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mpt_purge_expired_event_flags() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.telegram_event_flags where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_record_event_flag(text, text, text, timestamptz), public.mpt_delete_event_flags(text), public.mpt_purge_expired_event_flags() from public, anon, authenticated;
grant execute on function public.mpt_record_event_flag(text, text, text, timestamptz), public.mpt_delete_event_flags(text), public.mpt_purge_expired_event_flags() to service_role;

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-expired-event-flags';
    perform cron.schedule('mpt-purge-expired-event-flags', '58 19 * * *', 'select public.mpt_purge_expired_event_flags();');
  end if;
end $$;
