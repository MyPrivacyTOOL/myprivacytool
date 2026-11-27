-- MPC-7508: production-readiness pass on RLS and schema. Additive/tightening only; NOT yet applied to the live project.
-- Findings (live project xmdmkumwxpgahmlweuug, 2026-10-06):
--   1. public.subscribers (created out-of-band, not in repo) kept Supabase's default grants: anon/authenticated held
--      ALL privileges (incl. TRUNCATE, which bypasses RLS), RLS was not FORCED, and the anon INSERT policy was
--      `with check (true)`, so the public key could write any column (risk_score, scan_completed, ip_address...).
--      The Newsletter page only sends email, consent_given_at and consent_source.
--   2. Two foreign keys had no covering index (leads.user_id, removal_tasks.signal_id): slow cascades/erasure.
--   3. users.updated_at / removal_tasks.updated_at were never maintained.
--   4. New tables created by `postgres` were auto-granted to anon/authenticated; each needed a manual revoke.
--   5. subscribers_email_idx duplicates the unique index subscribers_email_key.
-- Rollback notes are at the bottom.

-- ---------------------------------------------------------------- 1. subscribers
-- Keep the table definition in the repo so CI and fresh environments match production.
create table if not exists public.subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  source           text,
  scan_completed   boolean default false,
  risk_score       integer,
  confirmed_count  integer,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  created_at       timestamptz not null default now(),
  consent_given_at timestamptz not null default now(),
  consent_source   text,
  ip_address       text
);
create index if not exists subscribers_created_at_idx on public.subscribers (created_at desc);
create index if not exists subscribers_consent_given_at_idx on public.subscribers (consent_given_at desc);
drop index if exists public.subscribers_email_idx;   -- redundant with subscribers_email_key

alter table public.subscribers enable row level security;
alter table public.subscribers force row level security;

revoke all on public.subscribers from anon, authenticated;
-- Public signup form: anon may insert only these columns. Everything else (ip_address, risk_score, ...) is server-set.
grant insert (email, source, utm_source, utm_medium, utm_campaign, consent_given_at, consent_source)
  on public.subscribers to anon;

drop policy if exists "Allow anonymous inserts" on public.subscribers;
create policy "anon signup with sane email"
  on public.subscribers for insert to anon
  with check (
    char_length(email) between 3 and 255
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and (consent_source is null or char_length(consent_source) <= 100)
    and (source is null or char_length(source) <= 100)
    and (utm_source   is null or char_length(utm_source)   <= 100)
    and (utm_medium   is null or char_length(utm_medium)   <= 100)
    and (utm_campaign is null or char_length(utm_campaign) <= 100)
  );

-- ---------------------------------------------------------------- 2. covering indexes for foreign keys
create index if not exists leads_user_id_idx on public.leads (user_id);
create index if not exists removal_tasks_signal_id_idx on public.removal_tasks (signal_id);

-- ---------------------------------------------------------------- 3. maintain updated_at
create or replace function public.mpt_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.mpt_set_updated_at() from public, anon, authenticated;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
  for each row execute function public.mpt_set_updated_at();
drop trigger if exists removal_tasks_set_updated_at on public.removal_tasks;
create trigger removal_tasks_set_updated_at before update on public.removal_tasks
  for each row execute function public.mpt_set_updated_at();

-- ---------------------------------------------------------------- 4. deny-by-default for future tables
-- Tables later created by this role no longer get anon/authenticated grants automatically; expose a table
-- deliberately with an explicit GRANT plus a policy. service_role keeps its defaults.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Rollback:
--   alter default privileges in schema public grant all on tables to anon, authenticated;
--   alter default privileges in schema public grant all on sequences to anon, authenticated;
--   alter default privileges in schema public grant execute on functions to anon, authenticated;
--   drop trigger users_set_updated_at on public.users; drop trigger removal_tasks_set_updated_at on public.removal_tasks;
--   drop function public.mpt_set_updated_at();
--   drop index public.leads_user_id_idx, public.removal_tasks_signal_id_idx;
--   drop policy "anon signup with sane email" on public.subscribers;
--   create policy "Allow anonymous inserts" on public.subscribers for insert to anon with check (true);
