-- MPC-7891: Telegram baseline scan snapshots. One row per consented scan of an allow-listed test account (TELEGRAM_BASELINE_SCAN=on).
-- Holds the getChat and getUserProfilePhotos answers as Telegram returned them, with every bot-specific file id removed (file_unique_id only).
-- Reuse check: channel_probe_captures (7 day test expiry, no scan/detector version, no consent link, no idempotency key) and telegram_event_log
-- (event stream, not a per-scan record) are not compatible with the before/after comparison in strategy 9.7, hence this table.
--
-- Access: RLS enabled and forced, service_role only (the social-listeners Worker). No anon/authenticated grants.
-- Idempotency: unique (platform, sender_id, update_id); the Worker inserts with ON CONFLICT DO NOTHING, so a replayed Telegram update stores nothing twice.
-- Consent linkage: consent jsonb records the conversation states and the confirming update; consent_at is that update's Telegram time.
-- Retention: expires_at (Worker default 90 days, matching the consent text "up to 90 days"); purge function below. Deletion on request: mpt_delete_profile_snapshots.
-- NOT applied to production by the PR that adds it: apply by hand after approval, before enabling TELEGRAM_BASELINE_SCAN.
-- Rollback: drop function public.mpt_delete_profile_snapshots(text); drop function public.mpt_purge_expired_profile_snapshots(); drop table public.profile_snapshots;
create table if not exists public.profile_snapshots (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  platform       text not null default 'telegram' check (platform ~ '^[a-z][a-z0-9_]{0,31}$'),
  sender_id      text not null check (sender_id ~ '^[0-9]{1,20}$'),
  update_id      bigint not null,
  status         text not null check (status in ('complete', 'failed')),
  scan_version   text not null check (char_length(scan_version) between 1 and 40),   -- detector/report version, e.g. telegram-baseline-1
  risk_version   text not null check (char_length(risk_version) between 1 and 40),   -- risk-ranking contract version used for the score
  schema_version integer not null default 1,
  score          numeric(3, 1) check (score between 0 and 10),                       -- null when status = 'failed'
  consent        jsonb not null,
  consent_at     timestamptz,
  get_chat       jsonb not null,                                                     -- {status, response}, file ids removed
  photos         jsonb not null,                                                     -- {status, response}, file ids removed
  report         jsonb,                                                              -- scored items and insights as sent
  expires_at     timestamptz not null
);
create unique index if not exists profile_snapshots_dedupe_idx on public.profile_snapshots (platform, sender_id, update_id);
create index if not exists profile_snapshots_sender_idx on public.profile_snapshots (sender_id, created_at);
create index if not exists profile_snapshots_expiry_idx on public.profile_snapshots (expires_at);

alter table public.profile_snapshots enable row level security;
alter table public.profile_snapshots force row level security;
revoke all on public.profile_snapshots from public, anon, authenticated;
grant select, insert, delete on public.profile_snapshots to service_role;
drop policy if exists "service role full access" on public.profile_snapshots;
create policy "service role full access" on public.profile_snapshots for all to service_role using (true) with check (true);

comment on table public.profile_snapshots is 'MPC-7891 Telegram baseline scan snapshots for allow-listed test accounts: getChat + getUserProfilePhotos answers (bot-specific file ids removed), score, scan/risk versions, consent link. Personal data. service_role only. Expires per expires_at.';

create or replace function public.mpt_purge_expired_profile_snapshots() returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.profile_snapshots where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mpt_delete_profile_snapshots(p_sender_id text) returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.profile_snapshots where sender_id = p_sender_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_purge_expired_profile_snapshots() from public, anon, authenticated;
revoke all on function public.mpt_delete_profile_snapshots(text) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_profile_snapshots() to service_role;
grant execute on function public.mpt_delete_profile_snapshots(text) to service_role;
