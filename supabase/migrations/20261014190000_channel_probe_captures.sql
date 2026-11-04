-- Channel probe "reader": TEST-ONLY capture of raw platform payloads and public-lookup results for allow-listed test accounts.
-- social-listeners writes here only when PROBE_MODE=on AND the sender is on the PROBE_TELEGRAM_IDS allow-list (our own test accounts).
-- Real users are never written here. Rows expire after 7 days (expires_at, mpt_purge_expired_channel_probe_captures).
-- Purpose: measure what each channel really delivers (the message) and what a public lookup of the sender returns (OSINT step),
-- to turn Verified ticks in the Channel Signal Availability database into measured evidence.
-- Additive and safe to apply before the Worker change. service_role only.
-- Rollback: drop function public.mpt_purge_expired_channel_probe_captures(); drop table public.channel_probe_captures;
create table if not exists public.channel_probe_captures (
  id         uuid primary key default gen_random_uuid(),
  platform   text not null check (platform ~ '^[a-z][a-z0-9_]{0,31}$'),
  sender_id  text not null check (char_length(sender_id) between 1 and 64),
  kind       text not null check (char_length(kind) between 1 and 64),   -- 'message' or 'lookup:<method>'
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists channel_probe_captures_lookup_idx on public.channel_probe_captures (platform, sender_id, created_at desc);
create index if not exists channel_probe_captures_expiry_idx on public.channel_probe_captures (expires_at);

alter table public.channel_probe_captures enable row level security;
alter table public.channel_probe_captures force row level security;
revoke all on public.channel_probe_captures from public, anon, authenticated;
grant select, insert, update, delete on public.channel_probe_captures to service_role;

comment on table public.channel_probe_captures is 'Channel probe reader. Raw payloads and public-lookup results for allow-listed TEST accounts only. 7 day expiry. service_role only.';

create or replace function public.mpt_purge_expired_channel_probe_captures()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.channel_probe_captures where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_purge_expired_channel_probe_captures() from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_channel_probe_captures() to service_role;
