-- MPC-7651: B2B partner API (workers/partner-api). Partners call POST /v1/scan, GET /v1/report/:id and /v1/monitors with an API key.
--
-- public.partners              one row per business partner. status 'active' | 'suspended'.
-- public.partner_api_keys      SHA-256 hash of each key (the key itself is shown once at issue and never stored), prefix for support, revocable.
-- public.partner_scans         one row per billable scan: the result the partner was shown, plus a SHA-256 of the scanned value (never the value).
--                              Rows are billing records for 13 months and the stored result is cleared after 30 days (see purge function).
-- public.partner_monitors      a registered watch on one identifier. Stores the identifier because a re-check needs it; only created
--                              when the partner attests the data subject consented (subject_consent). Re-check runner is NOT built yet.
-- public.partner_usage_monthly billable scans per partner per UTC month (price tiers are applied in the Worker, not here).
--
-- Access: RLS forced, no anon/authenticated grants, service_role only (the mpt-partner-api Worker).
-- Idempotent. Rollback:
--   select cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-partner-scan-results';
--   drop view if exists public.partner_usage_monthly; drop function if exists public.purge_partner_scan_results();
--   drop table if exists public.partner_monitors, public.partner_scans, public.partner_api_keys, public.partners;

create table if not exists public.partners (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 120),
  contact_email text,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  monthly_scan_cap integer check (monthly_scan_cap is null or monthly_scan_cap > 0)
);

create table if not exists public.partner_api_keys (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners (id) on delete cascade,
  created_at  timestamptz not null default now(),
  key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix  text not null check (char_length(key_prefix) between 8 and 16),
  label       text,
  revoked_at  timestamptz,
  last_used_at timestamptz
);
create index if not exists partner_api_keys_partner_idx on public.partner_api_keys (partner_id);

create table if not exists public.partner_scans (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners (id) on delete cascade,
  created_at  timestamptz not null default now(),
  input_type  text not null check (input_type in ('email', 'phone', 'handle', 'domain')),
  value_sha256 text not null check (value_sha256 ~ '^[0-9a-f]{64}$'),
  reference   text check (reference is null or char_length(reference) <= 128),
  status      text not null check (status in ('checked', 'not_checked')),
  billable    boolean not null default true,
  result      jsonb,
  result_cleared_at timestamptz
);
create index if not exists partner_scans_partner_created_idx on public.partner_scans (partner_id, created_at desc);

create table if not exists public.partner_monitors (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners (id) on delete cascade,
  created_at  timestamptz not null default now(),
  input_type  text not null check (input_type in ('email', 'phone', 'handle', 'domain')),
  value       text not null check (char_length(value) <= 320),
  reference   text check (reference is null or char_length(reference) <= 128),
  webhook_url text not null check (webhook_url ~ '^https://' and char_length(webhook_url) <= 512),
  subject_consent boolean not null check (subject_consent),
  deleted_at  timestamptz,
  last_checked_at timestamptz
);
create index if not exists partner_monitors_partner_idx on public.partner_monitors (partner_id) where deleted_at is null;

comment on table public.partner_scans is 'MPC-7651. Partner API scan log and billing record. value_sha256 only, never the scanned value. result cleared after 30 days.';
comment on table public.partner_monitors is 'MPC-7651. Holds the monitored identifier in clear (a re-check needs it). Removed on DELETE /v1/monitors/:id (value overwritten) and with the partner.';

do $$ declare t text; begin
  foreach t in array array['partners', 'partner_api_keys', 'partner_scans', 'partner_monitors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists "service role full access" on public.%I', t);
    execute format('create policy "service role full access" on public.%I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;

create or replace view public.partner_usage_monthly
  with (security_invoker = true) as
select partner_id,
       date_trunc('month', created_at at time zone 'UTC')::date as month,
       count(*) filter (where billable) as billable_scans,
       count(*)                          as total_scans
from public.partner_scans
group by 1, 2;
revoke all on public.partner_usage_monthly from public, anon, authenticated;
grant select on public.partner_usage_monthly to service_role;

-- 30-day clear of stored results; the billing row (counts, hash, type) stays.
create or replace function public.purge_partner_scan_results()
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  update public.partner_scans set result = null, result_cleared_at = now()
   where result is not null and created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_partner_scan_results() from public, anon, authenticated;
grant execute on function public.purge_partner_scan_results() to service_role;

-- Daily at 19:20 UTC. Idempotent. Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-partner-scan-results';
    perform cron.schedule('mpt-purge-partner-scan-results', '20 19 * * *', 'select public.purge_partner_scan_results();');
  end if;
end $$;
