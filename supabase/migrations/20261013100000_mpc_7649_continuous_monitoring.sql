-- MPC-7649: continuous monitoring for Pro and Executive plans (data model only; nothing is scheduled by this file).
--
-- public.monitoring_subscriptions  one row per monitored contact. Which checks run and where alerts go.
--                                  Email is the default alert channel; SMS needs its own opt-in (sms_opt_in_at) and a number.
-- public.monitoring_findings       one row per distinct exposure found. fingerprint (source + normalised identifier + breach/site)
--                                  is unique per subscription, so a re-run never re-alerts the same exposure.
--                                  A user can mark a finding 'not_mine'; that feeds the false-positive rate (target < 1%).
-- public.monitoring_runs           one row per scheduled run (daily breach check, weekly dark web scan, monthly report),
--                                  so missed runs and run sizes can be seen from the table alone.
--
-- No raw breach data is stored: only the source name, a breach/site label, the data classes exposed and a date.
-- Access: RLS forced, no anon/authenticated grants, service_role only (the monitoring Worker, once it exists).
-- Written idempotently so it is safe whether applied by the Supabase MCP or by `supabase db push`.
-- Rollback:
--   drop view if exists public.monitoring_false_positive_rate;
--   drop table if exists public.monitoring_runs; drop table if exists public.monitoring_findings;
--   drop table if exists public.monitoring_subscriptions;

create table if not exists public.monitoring_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  tier             text not null check (tier in ('pro', 'executive')),
  email            text not null check (position('@' in email) > 1 and char_length(email) <= 254),
  phone_e164       text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  sms_opt_in_at    timestamptz,
  alert_email      boolean not null default true,
  daily_breach     boolean not null default true,
  weekly_darkweb   boolean not null default true,
  monthly_report   boolean not null default true,
  paused_at        timestamptz,
  -- SMS is only ever sent with a number and an explicit opt-in on record.
  check (sms_opt_in_at is null or phone_e164 is not null)
);

comment on table public.monitoring_subscriptions is 'MPC-7649. One row per monitored contact on a Pro or Executive plan. SMS only with phone_e164 AND sms_opt_in_at. service_role only.';

create unique index if not exists monitoring_subscriptions_email_idx on public.monitoring_subscriptions (lower(email));

create table if not exists public.monitoring_findings (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.monitoring_subscriptions (id) on delete cascade,
  found_at         timestamptz not null default now(),
  source           text not null check (source in ('breach_db', 'dark_web', 'social')),
  label            text not null check (char_length(label) between 1 and 120),
  data_classes     text[] not null default '{}',
  fingerprint      text not null check (char_length(fingerprint) between 8 and 128),
  severity         text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status           text not null default 'new' check (status in ('new', 'seen', 'resolved', 'not_mine')),
  alerted_at       timestamptz,
  unique (subscription_id, fingerprint)
);

comment on table public.monitoring_findings is 'MPC-7649. One row per distinct exposure. unique(subscription_id, fingerprint) stops repeat alerts. status not_mine = user says this is not theirs (false positive). No raw breach data.';

create index if not exists monitoring_findings_sub_found_idx on public.monitoring_findings (subscription_id, found_at desc);

create table if not exists public.monitoring_runs (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('daily_breach', 'weekly_darkweb', 'monthly_report')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  checked       integer not null default 0 check (checked >= 0),
  new_findings  integer not null default 0 check (new_findings >= 0),
  alerts_sent   integer not null default 0 check (alerts_sent >= 0),
  error         text
);

comment on table public.monitoring_runs is 'MPC-7649. One row per scheduled monitoring run, so a missed daily or weekly run is visible from the table alone.';

create index if not exists monitoring_runs_kind_started_idx on public.monitoring_runs (kind, started_at desc);

alter table public.monitoring_subscriptions enable row level security;
alter table public.monitoring_subscriptions force row level security;
alter table public.monitoring_findings enable row level security;
alter table public.monitoring_findings force row level security;
alter table public.monitoring_runs enable row level security;
alter table public.monitoring_runs force row level security;

revoke all on public.monitoring_subscriptions from public, anon, authenticated;
revoke all on public.monitoring_findings from public, anon, authenticated;
revoke all on public.monitoring_runs from public, anon, authenticated;
grant all on public.monitoring_subscriptions to service_role;
grant all on public.monitoring_findings to service_role;
grant all on public.monitoring_runs to service_role;
grant usage, select on sequence public.monitoring_runs_id_seq to service_role;

drop policy if exists "service role full access" on public.monitoring_subscriptions;
create policy "service role full access" on public.monitoring_subscriptions
  for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.monitoring_findings;
create policy "service role full access" on public.monitoring_findings
  for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.monitoring_runs;
create policy "service role full access" on public.monitoring_runs
  for all to service_role using (true) with check (true);

-- Success metric from the task: false positives (marked not_mine) as a share of all findings, per UTC month.
create or replace view public.monitoring_false_positive_rate
  with (security_invoker = true) as
select date_trunc('month', found_at)::date as month,
       count(*)                                          as findings,
       count(*) filter (where status = 'not_mine')       as false_positives,
       round(100.0 * count(*) filter (where status = 'not_mine') / nullif(count(*), 0), 2) as false_positive_pct
from public.monitoring_findings
group by 1;

revoke all on public.monitoring_false_positive_rate from public, anon, authenticated;
grant select on public.monitoring_false_positive_rate to service_role;
