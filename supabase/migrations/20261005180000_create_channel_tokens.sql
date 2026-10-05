-- MPC-115: encrypted OAuth tokens for Phase 1 channel integrations (GitHub first, Reddit in MPC-116).
--
-- Columns holding secrets store AES-256-GCM CIPHERTEXT only (format v<key_version>.<iv>.<data>, see
-- workers/github-channel/lib/encryption.js). The plaintext token never reaches this table.
--
-- Access model (same as 20261005120000_scan_report_pipeline.sql): RLS is ENABLED and FORCED with NO
-- policies, and table privileges are revoked from anon/authenticated. Only the service_role key held by
-- the github-channel Worker can read or write.
--
-- Additive only. Requires public.users from 20261005120000.
--
-- Rollback:  drop table if exists public.channel_tokens;

create table if not exists public.channel_tokens (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.users(id) on delete cascade,  -- nullable until accounts are linked
  channel            text not null check (channel in ('github')),         -- widen per channel (MPC-116: 'reddit')
  subject_id         text not null check (char_length(subject_id) <= 64), -- the provider's stable user id
  access_token_enc   text not null,
  refresh_token_enc  text,
  key_version        integer not null default 1 check (key_version >= 1), -- ENCRYPTION_KEY rotation (MPC-115 decision I)
  scope              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (channel, subject_id)
);

create index if not exists channel_tokens_user_id_idx on public.channel_tokens (user_id);

alter table public.channel_tokens enable row level security;
alter table public.channel_tokens force  row level security;
revoke all on table public.channel_tokens from anon, authenticated;
