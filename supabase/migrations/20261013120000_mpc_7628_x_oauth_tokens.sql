-- MPC-7628: durable store for the X (Twitter) OAuth 2.0 user token that the Mirror bot (social-listeners Worker) sends DMs with.
-- X access tokens last about 2 hours and every refresh returns a NEW single-use refresh token, so the latest pair must live
-- somewhere a Worker can read and write. One row per bot (id = 'mirror'). Service_role only: RLS is enabled and forced and no
-- policy exists, so anon/authenticated can neither read nor write. Contains credentials, never log or export it.
-- Rollback: drop table public.mpt_x_oauth_tokens;
create table if not exists public.mpt_x_oauth_tokens (
  id            text primary key check (char_length(id) between 1 and 32),
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

alter table public.mpt_x_oauth_tokens enable row level security;
alter table public.mpt_x_oauth_tokens force row level security;
revoke all on public.mpt_x_oauth_tokens from anon, authenticated;
grant select, insert, update on public.mpt_x_oauth_tokens to service_role;

comment on table public.mpt_x_oauth_tokens is 'MPC-7628: rotating X OAuth 2.0 access/refresh token for the Mirror bot. Credentials. service_role only.';
