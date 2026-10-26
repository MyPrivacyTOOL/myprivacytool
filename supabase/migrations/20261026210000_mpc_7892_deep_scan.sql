-- MPC-7892: Telegram DEEP username check. NOTE: public.osint_results already exists (CK-006, lead-based, 24h retention, unused) and is not compatible (lead_id NOT NULL, different status set), so this table is named deep_osint_results. deep_jobs = one consented job per DEEP request (allow-listed test accounts, TELEGRAM_DEEP_SCAN=on);
-- deep_osint_results = one row per site checked, with source, observation time, detector version, status and limitation.
-- Storage scope: strategy 9.9 decision D-A (2026-10-15) stores everything during prototyping; retention and legal wording are still to be fixed (expires_at below is a placeholder default).
-- Access: RLS enabled and forced, service_role only (the social-listeners Worker). No anon/authenticated grants.
-- Idempotency: deep_jobs.idempotency_key unique (telegram:<sender>:<update_id>); deep_osint_results unique (job_id, source).
-- NOT applied to production by the PR that adds it: apply by hand after approval, before enabling TELEGRAM_DEEP_SCAN.
-- Rollback: drop function public.mpt_delete_deep_data(text); drop function public.mpt_purge_expired_deep_data(); drop table public.deep_osint_results; drop table public.deep_jobs;
create table if not exists public.deep_jobs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  platform         text not null default 'telegram' check (platform ~ '^[a-z][a-z0-9_]{0,31}$'),
  sender_id        text not null check (sender_id ~ '^[0-9]{1,20}$'),
  idempotency_key  text not null unique check (char_length(idempotency_key) between 1 and 80),
  status           text not null check (status in ('awaiting_consent','running','complete','partial','failed','cancelled','expired','interrupted')),
  query_username   text not null check (query_username ~ '^[A-Za-z0-9_]{5,32}$'),   -- always the sender's own username, never user-supplied text
  consent          jsonb,                                                            -- text version, confirming update id, sites listed, photo_sent=false
  consent_at       timestamptz,
  schema_version   integer not null default 1,
  detector_version text not null check (char_length(detector_version) between 1 and 40),
  started_at       timestamptz,
  heartbeat_at     timestamptz,
  finished_at      timestamptz,
  expires_at       timestamptz not null
);
create index if not exists deep_jobs_sender_idx on public.deep_jobs (sender_id, created_at);
create index if not exists deep_jobs_expiry_idx on public.deep_jobs (expires_at);

create table if not exists public.deep_osint_results (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.deep_jobs (id) on delete cascade,
  source           text not null check (char_length(source) between 1 and 40),
  site_name        text not null,
  status           text not null check (status in ('found','not_found','unavailable','blocked','error')),
  http_status      integer not null default 0,
  observed_at      timestamptz not null,
  detector_version text not null,
  schema_version   integer not null default 1,
  evidence         jsonb not null default '{}'::jsonb,                               -- no response bodies; reason/host/check only
  limitation       text not null,                                                    -- username match is not identity; not_found/blocked is not an all-clear
  unique (job_id, source)
);

alter table public.deep_jobs enable row level security;
alter table public.deep_jobs force row level security;
alter table public.deep_osint_results enable row level security;
alter table public.deep_osint_results force row level security;
revoke all on public.deep_jobs, public.deep_osint_results from public, anon, authenticated;
grant select, insert, update, delete on public.deep_jobs, public.deep_osint_results to service_role;
drop policy if exists "service role full access" on public.deep_jobs;
create policy "service role full access" on public.deep_jobs for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.deep_osint_results;
create policy "service role full access" on public.deep_osint_results for all to service_role using (true) with check (true);

comment on table public.deep_jobs is 'MPC-7892 DEEP jobs for allow-listed Telegram test accounts: consent link, status, versions. Personal data. service_role only. Expires per expires_at.';
comment on table public.deep_osint_results is 'MPC-7892 per-site username check results (observation, detector version, status, limitation). Personal data. service_role only. Deleted with its job.';

create or replace function public.mpt_purge_expired_deep_data() returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.deep_jobs where expires_at < now();   -- results cascade
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mpt_delete_deep_data(p_sender_id text) returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.deep_jobs where sender_id = p_sender_id;   -- results cascade
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_purge_expired_deep_data() from public, anon, authenticated;
revoke all on function public.mpt_delete_deep_data(text) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_deep_data() to service_role;
grant execute on function public.mpt_delete_deep_data(text) to service_role;
