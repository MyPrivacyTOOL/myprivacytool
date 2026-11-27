-- MPC-7893: Telegram web dashboard. One-time links and restricted sessions.
-- dashboard_links: a link is a random UUID (the only thing in the URL). Only its SHA-256 hash is stored, so a database reader cannot open a link.
--   Single use: mpt_redeem_dashboard_link marks it redeemed and creates the session in ONE statement; of two concurrent requests exactly one wins.
--   Expiry: 15 minutes, checked in the database (expires_at > now()) and capped by a table constraint.
-- dashboard_sessions: opaque random session value in an HttpOnly cookie; only its SHA-256 hash is stored. Scoped to one sender and one baseline snapshot.
-- Both tables cascade from profile_snapshots, so mpt_delete_profile_snapshots / the 90 day purge also remove links and sessions.
-- Access: RLS enabled and forced, service_role only (Pages Functions and the social-listeners Worker). No anon/authenticated grants.
-- NOT applied to production by the PR that adds it: apply by hand after approval, before enabling TELEGRAM_DASHBOARD_LINKS and DASHBOARD_ENABLED.
-- Rollback: drop function public.mpt_redeem_dashboard_link(text, text, integer); drop function public.mpt_purge_dashboard_credentials(); drop table public.dashboard_sessions; drop table public.dashboard_links;
create table if not exists public.dashboard_links (
  token_hash  text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  sender_id   text not null check (sender_id ~ '^[0-9]{1,20}$'),
  snapshot_id uuid not null references public.profile_snapshots (id) on delete cascade,
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  constraint dashboard_links_max_15_minutes check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index if not exists dashboard_links_expiry_idx on public.dashboard_links (expires_at);
create index if not exists dashboard_links_snapshot_idx on public.dashboard_links (snapshot_id);

create table if not exists public.dashboard_sessions (
  session_hash text primary key check (session_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  link_hash    text not null unique references public.dashboard_links (token_hash) on delete cascade,
  sender_id    text not null check (sender_id ~ '^[0-9]{1,20}$'),
  snapshot_id  uuid not null references public.profile_snapshots (id) on delete cascade,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  constraint dashboard_sessions_max_2_hours check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);
create index if not exists dashboard_sessions_expiry_idx on public.dashboard_sessions (expires_at);

alter table public.dashboard_links enable row level security;
alter table public.dashboard_links force row level security;
alter table public.dashboard_sessions enable row level security;
alter table public.dashboard_sessions force row level security;
revoke all on public.dashboard_links, public.dashboard_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_links, public.dashboard_sessions to service_role;
drop policy if exists "service role full access" on public.dashboard_links;
create policy "service role full access" on public.dashboard_links for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.dashboard_sessions;
create policy "service role full access" on public.dashboard_sessions for all to service_role using (true) with check (true);

comment on table public.dashboard_links is 'MPC-7893 one-time dashboard links: SHA-256 of a random UUID, scoped to one Telegram sender and snapshot, 15 minute expiry, single use. Credential material (hashed). service_role only.';
comment on table public.dashboard_sessions is 'MPC-7893 restricted dashboard sessions created by redeeming a link: SHA-256 of an opaque cookie value, scoped to one sender and snapshot. Credential material (hashed). service_role only.';

-- Atomic redemption. Returns true only for the single caller that consumed an unredeemed, unexpired link whose snapshot is still stored and unexpired.
-- A second, expired, unknown or deleted-scan attempt returns false and changes nothing. The session is created in the same statement as the redemption.
create or replace function public.mpt_redeem_dashboard_link(p_token_hash text, p_session_hash text, p_session_minutes integer default 30) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare ok boolean;
begin
  if p_session_minutes is null or p_session_minutes < 1 or p_session_minutes > 120 then
    raise exception 'session minutes must be 1-120';
  end if;
  with l as (
    update public.dashboard_links d
       set redeemed_at = now()
     where d.token_hash = p_token_hash
       and d.redeemed_at is null
       and d.expires_at > now()
       and exists (select 1 from public.profile_snapshots s where s.id = d.snapshot_id and s.expires_at > now())
    returning d.token_hash, d.sender_id, d.snapshot_id
  ), s as (
    insert into public.dashboard_sessions (session_hash, link_hash, sender_id, snapshot_id, expires_at)
    select p_session_hash, l.token_hash, l.sender_id, l.snapshot_id, now() + make_interval(mins => p_session_minutes) from l
    returning 1
  )
  select exists (select 1 from s) into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.mpt_purge_dashboard_credentials() returns integer
language plpgsql set search_path = public, pg_temp as $$
declare a integer; b integer;
begin
  delete from public.dashboard_sessions where expires_at < now() or revoked_at is not null;
  get diagnostics a = row_count;
  delete from public.dashboard_links where expires_at < now() - interval '1 day';
  get diagnostics b = row_count;
  return a + b;
end $$;

revoke all on function public.mpt_redeem_dashboard_link(text, text, integer) from public, anon, authenticated;
revoke all on function public.mpt_purge_dashboard_credentials() from public, anon, authenticated;
grant execute on function public.mpt_redeem_dashboard_link(text, text, integer) to service_role;
grant execute on function public.mpt_purge_dashboard_credentials() to service_role;
