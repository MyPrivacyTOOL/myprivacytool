-- Encrypted OAuth tokens for third-party channel integrations (MPC-115/116).
-- Tokens are AES-256-GCM ciphertext produced app-side; the DB never sees plaintext.
-- Rollback (Reddit only): DELETE FROM channel_tokens WHERE platform = 'reddit';
-- Full rollback:          DROP TABLE channel_tokens;
create table if not exists public.channel_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  platform text not null,
  access_token_enc text not null,
  refresh_token_enc text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

-- Service-role only: RLS on with no policies denies anon/authenticated access.
alter table public.channel_tokens enable row level security;
