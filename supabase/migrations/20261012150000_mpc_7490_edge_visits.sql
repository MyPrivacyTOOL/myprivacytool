-- MPC-7490: raw edge visits. One row per request seen by the Pages middleware (functions/_middleware.ts), raw facts first with the
-- classification stored beside them (class, the rule that decided it, the rule-set version) so rows can be re-classified later.
-- Capture is OFF in production (EDGE_CAPTURE_ENABLED unset). This migration only creates storage; nothing writes until the switch is on.
--
-- 1. public.edge_visits           raw visit rows. service_role only, RLS forced.
-- 2. public.edge_visit_retention  the ONE place the IP retention period is set (single row). ip_days = 30 is the proposal; Chris confirms
--                                 it in MPC-7491. Applies to class person and unknown (unknown is treated as a person). bot and ai rows
--                                 are kept in full.
-- 3. mpt_cut_edge_visit_ips(dry)  sets ip = null (and ip_cut_at) on person/unknown rows older than ip_days. Everything else on the row stays.
-- 4. daily pg_cron job mpt-cut-edge-visit-ips (19:20 UTC = 03:20 HKT), skipped where pg_cron is absent.
--
-- Rollback:
--   select cron.unschedule('mpt-cut-edge-visit-ips');   -- if pg_cron is present
--   drop function if exists public.mpt_cut_edge_visit_ips(boolean);
--   drop table if exists public.edge_visits, public.edge_visit_retention;

create table if not exists public.edge_visit_retention (
  id      boolean primary key default true check (id),
  ip_days integer not null default 30 check (ip_days between 1 and 3650),
  updated_at timestamptz not null default now()
);
insert into public.edge_visit_retention (id, ip_days) values (true, 30) on conflict (id) do nothing;
comment on table public.edge_visit_retention is 'MPC-7490. Single row: days a person/unknown edge visit keeps its IP address before it is cut. Proposed 30; Chris confirms in MPC-7491.';

create table if not exists public.edge_visits (
  id              bigint generated always as identity primary key,
  seen_at         timestamptz not null default now(),
  host            text,
  path            text not null,
  method          text not null,
  status          smallint,
  user_agent      text,
  ip              text,
  ip_cut_at       timestamptz,
  country         text check (country is null or country ~ '^[A-Z]{2}$'),
  asn             integer,
  network         text,
  colo            text,
  referrer        text,
  headers         jsonb not null default '{}'::jsonb,
  class           text not null check (class in ('person', 'bot', 'ai', 'unknown')),
  rule            text not null,
  ruleset_version text not null
);
comment on table public.edge_visits is 'MPC-7490. Raw request facts from the edge, plus the class, deciding rule and rule-set version. Path only (no query string); referrer reduced to origin+path; no cookies or credentials. ip is nulled after edge_visit_retention.ip_days for class person/unknown; bot and ai rows are kept in full. service_role only.';
comment on column public.edge_visits.ip is 'Connecting IP. Personal data for person/unknown rows: cut to null by mpt_cut_edge_visit_ips after the retention period.';

create index if not exists edge_visits_seen_at_idx on public.edge_visits (seen_at);
create index if not exists edge_visits_class_seen_at_idx on public.edge_visits (class, seen_at);
create index if not exists edge_visits_ip_cut_idx on public.edge_visits (seen_at) where ip is not null and class in ('person', 'unknown');

alter table public.edge_visits enable row level security;
alter table public.edge_visits force row level security;
alter table public.edge_visit_retention enable row level security;
alter table public.edge_visit_retention force row level security;
revoke all on public.edge_visits, public.edge_visit_retention from public, anon, authenticated;
grant all on public.edge_visits, public.edge_visit_retention to service_role;
grant usage, select on sequence public.edge_visits_id_seq to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'edge_visits' and policyname = 'service role full access') then
    create policy "service role full access" on public.edge_visits for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'edge_visit_retention' and policyname = 'service role full access') then
    create policy "service role full access" on public.edge_visit_retention for all to service_role using (true) with check (true);
  end if;
end $$;

create or replace function public.mpt_cut_edge_visit_ips(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare d int; n int := 0;
begin
  select ip_days into d from public.edge_visit_retention where id;
  if d is null then d := 30; end if;
  if p_dry_run then
    select count(*) into n from public.edge_visits
     where ip is not null and class in ('person', 'unknown') and seen_at < now() - make_interval(days => d);
  else
    update public.edge_visits set ip = null, ip_cut_at = now()
     where ip is not null and class in ('person', 'unknown') and seen_at < now() - make_interval(days => d);
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'ip_days', d, 'ips_cut', n, 'ran_at', now());
end $$;
revoke all on function public.mpt_cut_edge_visit_ips(boolean) from public, anon, authenticated;
grant execute on function public.mpt_cut_edge_visit_ips(boolean) to service_role;
comment on function public.mpt_cut_edge_visit_ips(boolean) is 'MPC-7490. Nulls ip on person/unknown edge visits older than edge_visit_retention.ip_days. Bot and ai rows untouched. p_dry_run counts only. Returns counts, no data. service_role only.';

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mpt-cut-edge-visit-ips', '20 19 * * *', 'select public.mpt_cut_edge_visit_ips(false)');
  end if;
end $$;
