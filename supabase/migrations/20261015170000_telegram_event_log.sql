-- Telegram full event log: every inbound update, outbound Bot API call and core-brain answer for ALLOW-LISTED or OPTED-IN accounts only.
-- social-listeners writes here only when PROBE_MODE=on AND the sender is in PROBE_TELEGRAM_IDS or PROBE_LOG_OPTIN_IDS.
-- PROBE_MODE=all never writes here. Additive and safe to apply before the Worker change. service_role only.
-- Rollback: drop function public.mpt_purge_expired_telegram_event_log(); drop table public.telegram_event_log;
create table if not exists public.telegram_event_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  platform   text not null default 'telegram' check (platform ~ '^[a-z][a-z0-9_]{0,31}$'),
  direction  text not null check (direction in ('in', 'out', 'brain')),
  kind       text not null check (char_length(kind) between 1 and 96),   -- in: update type; out: Bot API method; brain: 'core-brain'
  sender_id  text not null check (char_length(sender_id) between 1 and 64),
  chat_id    text not null check (char_length(chat_id) between 1 and 64),
  update_id  bigint,                                                      -- links in/out/brain rows of one update
  session_id text not null check (char_length(session_id) between 1 and 160),  -- '<chat_id>:<sender_id>:<n>'
  payload    jsonb not null,
  expires_at timestamptz                                                  -- null = kept until deleted by hand
);

-- A retried update_id must not be logged twice (the Worker inserts with ON CONFLICT DO NOTHING). Rows without an update_id are never deduplicated.
create unique index if not exists telegram_event_log_dedupe_idx on public.telegram_event_log (direction, update_id, kind) where update_id is not null;
create index if not exists telegram_event_log_sender_idx on public.telegram_event_log (sender_id, created_at);
create index if not exists telegram_event_log_session_idx on public.telegram_event_log (session_id);
create index if not exists telegram_event_log_chat_idx on public.telegram_event_log (chat_id, created_at);
create index if not exists telegram_event_log_expiry_idx on public.telegram_event_log (expires_at) where expires_at is not null;

alter table public.telegram_event_log enable row level security;
alter table public.telegram_event_log force row level security;
revoke all on public.telegram_event_log from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_event_log to service_role;

comment on table public.telegram_event_log is 'Full Telegram event log for allow-listed (PROBE_TELEGRAM_IDS) or opted-in (PROBE_LOG_OPTIN_IDS) accounts only, written when PROBE_MODE=on. direction in = raw update untrimmed; out = Bot API call {method, request, status, response} (never the bot token); brain = core-brain answer used to pick the reply. Linked by update_id; grouped by session_id (new session after 30 minutes of silence). expires_at per PROBE_LOG_RETENTION_DAYS (default 90, 1-365, or null for "forever"). Contains personal data. service_role only.';

create or replace function public.mpt_purge_expired_telegram_event_log()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.telegram_event_log where expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_purge_expired_telegram_event_log() from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_telegram_event_log() to service_role;
