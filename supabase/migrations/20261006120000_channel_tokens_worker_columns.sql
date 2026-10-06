-- MPC-115: make the existing public.channel_tokens fit the github-channel Worker. Additive only.
--
-- public.channel_tokens was created directly in the project by migration 20261006060503 "create_channel_tokens"
-- (columns: id, user_id text, provider, access_token_enc, refresh_token_enc, scope, expires_at, created_at,
-- updated_at; UNIQUE (user_id, provider)). The Worker uses user_id = the provider's user id, provider = 'github'.
-- This migration does not touch existing rows.
--
-- Changes:
--  1. key_version: ENCRYPTION_KEY rotation (MPC-115 decision I). Existing rows get 1.
--  2. The ciphertext CHECKs only accepted 'v1.%', which would reject rows written after a key rotation
--     (v2., v3., ...). Relax them to '^v[0-9]+\.'.
--  3. FORCE row level security and revoke anon/authenticated (RLS was enabled with no policies; service_role bypasses RLS).
--
-- Rollback:
--   alter table public.channel_tokens drop column if exists key_version;
--   (the relaxed CHECKs and forced RLS are safe to leave in place)

alter table public.channel_tokens
  add column if not exists key_version integer not null default 1 check (key_version >= 1);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.channel_tokens'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%access_token_enc%' or pg_get_constraintdef(oid) like '%refresh_token_enc%')
  loop
    execute format('alter table public.channel_tokens drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.channel_tokens
  add constraint channel_tokens_access_token_enc_ciphertext check (access_token_enc ~ '^v[0-9]+\.'),
  add constraint channel_tokens_refresh_token_enc_ciphertext check (refresh_token_enc is null or refresh_token_enc ~ '^v[0-9]+\.');

alter table public.channel_tokens force row level security;
revoke all on table public.channel_tokens from anon, authenticated;
