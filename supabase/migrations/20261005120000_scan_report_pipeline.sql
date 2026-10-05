-- MPC-6677: scan -> 48-hour privacy report pipeline.
-- Schema follows MPC-076 v1.0 section 5 (users, scans, signals, hexagon_scores, removal_tasks, leads)
-- plus the consent columns from the 2026-08-02 lead-capture decision (consent_given_at,
-- consent_source, ip_address, 3-year retention) and the report-job state the Worker needs.
--
-- Access model: RLS is ENABLED and FORCED on every table with NO policies, so anon and
-- authenticated roles get nothing. Only the service_role key (held by the scan-report Worker)
-- can read or write. Additive only: does not touch public.subscribers or the mpt_* tables.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- users
create table if not exists public.users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (char_length(email) <= 255),
  email_verified   boolean not null default false,
  tier             text not null default 'free' check (tier in ('free','basic','pro','executive')),
  subscription_id  text,
  payment_status   text check (payment_status in ('active','cancelled','past_due')),
  -- consent evidence (2026-08-02 decision)
  consent_given_at timestamptz,
  consent_source   text,
  ip_address       inet,
  retain_until     timestamptz,                 -- 3 years from consent_given_at
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists users_email_lower_key on public.users (lower(email));

-- ---------------------------------------------------------------- scans
create table if not exists public.scans (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  email_scanned         text not null check (char_length(email_scanned) <= 255),
  privacy_score         integer check (privacy_score between 0 and 100),   -- null until the report job runs
  scan_date             timestamptz not null default now(),
  data_freshness        timestamptz,
  signals_found         integer not null default 0,
  risk_level            text check (risk_level in ('low','medium','high','critical')),
  categories_checked    text[] not null default '{}',   -- partial scores must say what they cover
  categories_unchecked  text[] not null default '{}',
  created_at            timestamptz not null default now(),
  expires_at            timestamptz default (now() + interval '30 days'),
  -- report job state
  source                text not null default 'web_scan',
  confirmation_sent_at  timestamptz,
  report_status         text not null default 'pending'
                          check (report_status in ('pending','processing','sent','failed')),
  report_due_at         timestamptz not null default (now() + interval '48 hours'),
  report_attempts       integer not null default 0,
  report_last_error     text,
  report_claimed_at     timestamptz,
  report_sent_at        timestamptz,
  resend_message_id     text
);
create index if not exists scans_user_date_idx on public.scans (user_id, scan_date);
create index if not exists scans_report_queue_idx on public.scans (report_status, report_due_at);

-- ---------------------------------------------------------------- signals
create table if not exists public.signals (
  id                   uuid primary key default gen_random_uuid(),
  scan_id              uuid not null references public.scans(id) on delete cascade,
  category             text not null check (category in
                         ('broker','search','social','email','device','network','professional','ai_threat')),
  signal_type          text not null check (char_length(signal_type) <= 100),
  severity             text not null check (severity in ('low','medium','high','critical')),
  data_source          text not null check (char_length(data_source) <= 100),
  check_status         text not null default 'found' check (check_status in ('found','clear','not_checked')),
  details              text,
  removal_status       text not null default 'not_started'
                         check (removal_status in ('not_started','in_progress','removed','manual_only')),
  removal_url          text check (char_length(removal_url) <= 500),
  removal_instructions text,
  created_at           timestamptz not null default now()
);
create index if not exists signals_scan_idx on public.signals (scan_id);
create index if not exists signals_removal_status_idx on public.signals (removal_status);

-- ---------------------------------------------------------------- hexagon_scores
create table if not exists public.hexagon_scores (
  id               uuid primary key default gen_random_uuid(),
  scan_id          uuid not null references public.scans(id) on delete cascade,
  category         text not null check (category in
                     ('broker','search','social','email','device','network','professional','ai_threat')),
  score            integer check (score between 0 and 100),   -- null = not yet checked
  signals_count    integer not null default 0,
  risk_multiplier  numeric(2,1) not null check (risk_multiplier between 1.0 and 2.0),
  color            varchar(6) not null,
  checked          boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (scan_id, category)
);

-- ---------------------------------------------------------------- removal_tasks
create table if not exists public.removal_tasks (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  signal_id            uuid not null references public.signals(id) on delete cascade,
  broker_name          text not null check (char_length(broker_name) <= 100),
  status               text not null default 'not_started'
                         check (status in ('not_started','in_progress','completed','failed')),
  manual_confirmation  boolean not null default false,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists removal_tasks_user_status_idx on public.removal_tasks (user_id, status);

-- ---------------------------------------------------------------- leads (UTM attribution)
create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null check (char_length(email) <= 255),
  user_id            uuid references public.users(id) on delete set null,
  utm_source         text check (char_length(utm_source) <= 100),
  utm_medium         text check (char_length(utm_medium) <= 100),
  utm_campaign       text check (char_length(utm_campaign) <= 100),
  utm_content        text check (char_length(utm_content) <= 100),
  utm_referrer       text check (char_length(utm_referrer) <= 500),
  consent_given_at   timestamptz,
  consent_source     text,
  ip_address         inet,
  retain_until       timestamptz,
  created_at         timestamptz not null default now(),
  converted_to_user  boolean not null default false,
  converted_at       timestamptz
);
create unique index if not exists leads_email_lower_key on public.leads (lower(email));

-- ---------------------------------------------------------------- RLS: deny by default
do $$
declare t text;
begin
  foreach t in array array['users','scans','signals','hexagon_scores','removal_tasks','leads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

comment on table public.users          is 'MPC-6677 / MPC-076 5.1. service_role only. Retention: 3 years from consent_given_at; deletion on request removes the row.';
comment on table public.scans          is 'MPC-6677. One row per scan submission; also the report job queue (report_status/report_due_at). service_role only.';
comment on table public.signals        is 'MPC-6677. Per-scan findings; check_status=not_checked records sources we could not check, never a guess. service_role only.';
comment on table public.hexagon_scores is 'MPC-6677. Per-category score; score is null when the category was not checked. service_role only.';
comment on table public.removal_tasks  is 'MPC-6677. Manual removal tracking per found broker signal. service_role only.';
comment on table public.leads          is 'MPC-6677. UTM attribution + consent evidence per lead, deduped on lower(email). service_role only.';
