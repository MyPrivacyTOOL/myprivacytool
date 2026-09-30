-- MPC-6956: MPT operational databases (schema from MPC-6811) with Row Level Security.
-- Applied to Supabase project xmdmkumwxpgahmlweuug ("MyPrivacyTOOL Project2") on 2026-09-30
-- as migration 20260930105506 mpc_6956_mpt_operational_tables_rls.
-- Model: user-owned tables scoped by auth.uid(); aggregate/operational tables are
-- service_role only (RLS on, FORCE, no policies, grants revoked). service_role bypasses RLS.

create table public.mpt_osint_scan_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  user_handle text not null,
  data_points_found integer not null default 0 check (data_points_found >= 0),
  confidence_score numeric(4,3) check (confidence_score between 0 and 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
comment on table public.mpt_osint_scan_results is
  'Per-session OSINT scan results, 24h TTL via expires_at (purge job: MPC-6957). Owner-read only; writes via service_role.';
create index on public.mpt_osint_scan_results (user_id);
create index on public.mpt_osint_scan_results (session_id);
create index on public.mpt_osint_scan_results (expires_at);

create table public.mpt_user_engagement (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_clicked boolean not null default false,
  email_confirmed boolean not null default false,
  mobile_confirmed boolean not null default false,
  full_scan_completed boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.mpt_user_engagement is
  'Per-session engagement funnel. Owner-read only; writes via service_role.';
create index on public.mpt_user_engagement (user_id);
create index on public.mpt_user_engagement (session_id);

create table public.mpt_api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  endpoint text not null,
  calls_made integer not null default 0 check (calls_made >= 0),
  call_limit integer not null check (call_limit >= 0),
  reset_time timestamptz,
  last_checked timestamptz not null default now(),
  unique (platform, endpoint)
);
comment on table public.mpt_api_rate_limits is
  'Operational rate-limit counters. service_role only; no user-facing access.';

create table public.mpt_channel_metrics (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  metric_date date not null,
  dms_sent integer not null default 0 check (dms_sent >= 0),
  responses_received integer not null default 0 check (responses_received >= 0),
  conversion_rate numeric(5,4) check (conversion_rate between 0 and 1),
  unique (platform, metric_date)
);
comment on table public.mpt_channel_metrics is
  'Aggregate channel performance. service_role only; no user-facing access.';

alter table public.mpt_osint_scan_results enable row level security;
alter table public.mpt_user_engagement    enable row level security;
alter table public.mpt_api_rate_limits    enable row level security;
alter table public.mpt_channel_metrics    enable row level security;
alter table public.mpt_osint_scan_results force row level security;
alter table public.mpt_user_engagement    force row level security;
alter table public.mpt_api_rate_limits    force row level security;
alter table public.mpt_channel_metrics    force row level security;

revoke all on public.mpt_osint_scan_results, public.mpt_user_engagement,
              public.mpt_api_rate_limits, public.mpt_channel_metrics from anon, authenticated;
grant select on public.mpt_osint_scan_results, public.mpt_user_engagement to authenticated;

create policy "owner reads own unexpired scan results"
  on public.mpt_osint_scan_results for select to authenticated
  using (user_id = (select auth.uid()) and expires_at > now());

create policy "owner reads own engagement"
  on public.mpt_user_engagement for select to authenticated
  using (user_id = (select auth.uid()));
-- mpt_api_rate_limits / mpt_channel_metrics: intentionally no policies (deny-by-default).

-- Follow-up migration mpc_6956_anonymous_channel_sessions (applied 2026-09-30):
-- channel sessions (Telegram/SMS/email/web) have no auth.users row, so the owner is optional
-- (NULL never matches auth.uid() => service_role-only) and session_id carries a channel key.
alter table public.mpt_osint_scan_results alter column user_id drop not null;
alter table public.mpt_user_engagement    alter column user_id drop not null;
alter table public.mpt_osint_scan_results alter column session_id type text using session_id::text;
alter table public.mpt_user_engagement    alter column session_id type text using session_id::text;
