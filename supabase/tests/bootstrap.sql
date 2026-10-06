-- MPC-7300: minimal stand-in for the parts of a Supabase project our SQL depends on, so the repo's SQL can be
-- applied to a THROWAWAY Postgres database in CI. It never runs against the live project (xmdmkumwxpgahmlweuug).
-- Roles are cluster-wide, hence the guards. Stubs mirror Supabase's real definitions closely enough for RLS tests:
--   auth.users            minimal columns used by the FKs and the isolation test
--   auth.uid()/auth.role()  read the same `request.jwt.claims` setting PostgREST sets per request
--   public.channel_tokens   created out-of-band in the live project (migration 20261006060503), so it is
--                           recreated here exactly as the 20261006120000 migration header documents it.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon')          then create role anon          nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role')  then create role service_role  nologin noinherit bypassrls; end if;
end $$;

create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
-- Supabase grants new public tables to anon/authenticated by default; the SQL under test must revoke what it should.
alter default privileges in schema public grant all on tables to anon, authenticated;

create table public.channel_tokens (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null,
  provider          text not null,
  access_token_enc  text not null check (access_token_enc ~ '^v1\.'),
  refresh_token_enc text check (refresh_token_enc ~ '^v1\.'),
  scope             text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider)
);
alter table public.channel_tokens enable row level security;

-- public.rls_auto_enable() is a Supabase-managed event-trigger helper that exists in the live project (not in
-- our repo SQL). Migration 20261006130000_revoke_rls_auto_enable_execute.sql (MPC-7350) revokes EXECUTE on it, so
-- a stand-in must exist here or that migration fails on a fresh database. Body is a no-op: the tests only need
-- the function to exist so the REVOKE can be applied and asserted.
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin null; end $$;
