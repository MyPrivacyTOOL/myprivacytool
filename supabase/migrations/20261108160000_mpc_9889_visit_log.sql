-- MPC-9889 (Open Tracker design section 3): the visit log, its per-country policy and the purge job.
-- Decisions applied (Chris, 2026-11-08, design page section 0): DEFAULT row ip_mode raw (decision 3), raw-IP window 7 days (decision 4),
-- derived fields 730 days, explicit rows for HK (raw), the EU member states and the UK (truncated until the lawyer review MPC-6798 says otherwise).
--
-- Separation (rule 3): own schema, own role, no foreign key, no session / scan / email / hash / cookie column. Nothing outside this file,
-- functions/_visit-log.ts and the purge job may mention the schema (scripts/ci/check-visit-log-isolation.mjs + an ESLint rule fail CI otherwise).
-- No object in this schema reads schema public (asserted in supabase/tests/visit-log.test.sql).
--
--   visit_log.country_policy   ip_mode raw|truncated|none, retention_days (raw-IP window), derived_retention_days, enabled. '*' = DEFAULT row.
--   visit_log.visits           partitioned BY LIST (country) + DEFAULT. One partition per country that has a policy row.
--   visit_log.ensure_partition(country)   creates the partition (never on the write path: a Worker cannot run DDL).
--   visit_log.record_visit(...)           the ONLY write door. Re-applies the policy in the database, so a stale Worker cache cannot loosen it.
--   visit_log.purge(dry_run)              nulls ip past retention_days, deletes rows past derived_retention_days, writes COUNTS to purge_log.
--   visit_log.apply_policy(country, ...)  enforces a changed policy retroactively (truncate / null / delete, optional partition drop).
--   public.mpt_visit_log_policy() / mpt_visit_log_record(...) / mpt_visit_log_purge_health()   service_role-only doors for the Pages middleware and the alert.
--
-- The legacy mpt-cut-edge-visit-ips job (public.edge_visits) stays: person/unknown rows already in edge_visits keep being cut until MPC-9891
-- migrates them. This task only stops new person/unknown rows going there.
--
-- Rollback (every statement idempotent; counts only are lost, no personal data is kept anywhere else):
--   select cron.unschedule('visit-log-purge');   -- if pg_cron is present
--   drop function if exists public.mpt_visit_log_policy(), public.mpt_visit_log_record(text, text, text, text, text, text, text, text), public.mpt_visit_log_purge_health();
--   drop schema visit_log cascade;
--   drop role if exists visit_log_writer;

create schema if not exists visit_log;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'visit_log_writer') then
    create role visit_log_writer nologin noinherit;
  end if;
end $$;

-- The creating role joins visit_log_writer so it can hand the objects below to it (the migration role is postgres on Supabase).
do $$ begin
  begin grant visit_log_writer to current_user; exception when others then null; end;
end $$;
alter schema visit_log owner to visit_log_writer;

revoke all on schema visit_log from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on schema visit_log from %I', r); end if;
  end loop;
end $$;
grant usage on schema visit_log to visit_log_writer;

-- ===== policy ===============================================================================================================
create table if not exists visit_log.country_policy (
  country                text primary key check (country = '*' or country ~ '^[A-Z]{2}$'),
  ip_mode                text not null check (ip_mode in ('raw', 'truncated', 'none')),
  retention_days         integer not null check (retention_days between 1 and 3650),
  derived_retention_days integer not null default 730 check (derived_retention_days between 1 and 3650),
  enabled                boolean not null default true,
  notes                  text,
  updated_at             timestamptz not null default now(),
  updated_by             text,
  check (derived_retention_days >= retention_days)
);
comment on table visit_log.country_policy is 'MPC-9889. One row per country (ISO2 of the arrival country, cf.country) plus the DEFAULT row country = ''*''. ip_mode raw = log_raw_ip, truncated = log_truncated_ip (IPv4 /24, IPv6 /48), none = do_not_log (row without IP). enabled = false writes no row. retention_days = how long a stored IP is kept; derived_retention_days = how long country / source / device / ts are kept.';

-- ===== visits ===============================================================================================================
create table if not exists visit_log.visits (
  id           uuid not null default gen_random_uuid(),
  country      text not null check (country ~ '^[A-Z]{2}$'),
  ip           inet,
  ip_mode      text not null check (ip_mode in ('raw', 'truncated', 'none')),
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  device       text not null default 'unknown' check (device in ('mobile', 'desktop', 'tablet', 'unknown')),
  ts           timestamptz not null default now(),
  primary key (country, id)
) partition by list (country);
comment on table visit_log.visits is 'MPC-9889. Marketing visit log: ip (shaped by policy), referrer (host + path), utm tags, country, device class, ts. No session, scan, email, hash, user agent or cookie. Partitioned by ARRIVAL country (a VPN visitor is filed under the VPN country).';

create table if not exists visit_log.visits_default partition of visit_log.visits default;
create index if not exists visits_ts_idx on visit_log.visits (ts);

create table if not exists visit_log.purge_log (
  id           bigint generated always as identity primary key,
  run_at       timestamptz not null default now(),
  dry_run      boolean not null,
  country      text not null,            -- '*' = the run total
  ips_nulled   integer not null default 0,
  rows_deleted integer not null default 0
);
comment on table visit_log.purge_log is 'MPC-9889. Counts only, one row per country touched plus a ''*'' total per run. Never a value.';
create index if not exists purge_log_run_idx on visit_log.purge_log (run_at) where country = '*';

alter table visit_log.country_policy enable row level security;
alter table visit_log.country_policy force row level security;
alter table visit_log.visits enable row level security;
alter table visit_log.visits force row level security;
alter table visit_log.purge_log enable row level security;
alter table visit_log.purge_log force row level security;
revoke all on all tables in schema visit_log from public;
grant select, insert, update, delete on visit_log.country_policy, visit_log.visits, visit_log.purge_log to visit_log_writer;
do $$ declare t text; begin
  foreach t in array array['country_policy', 'purge_log'] loop
    if not exists (select 1 from pg_policies where schemaname = 'visit_log' and tablename = t and policyname = 'writer only') then
      execute format('create policy "writer only" on visit_log.%I for all to visit_log_writer using (true) with check (true)', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'visit_log' and tablename = 'visits' and policyname = 'writer only') then
    create policy "writer only" on visit_log.visits for all to visit_log_writer using (true) with check (true);
  end if;
end $$;
-- visit_log_writer owns the tables and (below) every function. FORCE ROW LEVEL SECURITY applies to owners, and the "writer only" policies
-- name that role, so the only way in is through a visit_log function. Partitions created by ensure_partition are owned by it too.
alter table visit_log.country_policy owner to visit_log_writer;
alter table visit_log.visits owner to visit_log_writer;
alter table visit_log.visits_default owner to visit_log_writer;
alter table visit_log.visits_default enable row level security;
alter table visit_log.visits_default force row level security;
alter table visit_log.purge_log owner to visit_log_writer;

-- ===== partitions ===========================================================================================================
create or replace function visit_log.ensure_partition(p_country text) returns text
language plpgsql security definer set search_path = pg_catalog, visit_log
as $$
declare part text;
begin
  if p_country is null or p_country !~ '^[A-Z]{2}$' then raise exception 'visit_log.ensure_partition: bad country %', p_country; end if;
  part := 'visits_' || lower(p_country);
  if to_regclass(format('visit_log.%I', part)) is not null then return part; end if;
  -- Rows already filed under DEFAULT for this country must move first, or the new partition's constraint fails.
  create temp table _vl_move on commit drop as select * from visit_log.visits where country = p_country;     -- via the parent: no partition exists for it yet, so these are the DEFAULT rows
  delete from visit_log.visits where country = p_country;
  execute format('create table visit_log.%I partition of visit_log.visits for values in (%L)', part, p_country);
  execute format('grant select, insert, update, delete on visit_log.%I to visit_log_writer', part);
  execute format('alter table visit_log.%I enable row level security', part);     -- queries go through the parent; direct access to a partition has no policy = denied
  execute format('alter table visit_log.%I force row level security', part);
  insert into visit_log.visits select * from pg_temp._vl_move;
  drop table if exists pg_temp._vl_move;
  return part;
end $$;
revoke all on function visit_log.ensure_partition(text) from public;
grant execute on function visit_log.ensure_partition(text) to visit_log_writer;

create or replace function visit_log.country_policy_partition() returns trigger
language plpgsql security definer set search_path = pg_catalog, visit_log
as $$
begin
  if new.country <> '*' then perform visit_log.ensure_partition(new.country); end if;
  return new;
end $$;
revoke all on function visit_log.country_policy_partition() from public;
drop trigger if exists country_policy_partition on visit_log.country_policy;
create trigger country_policy_partition after insert on visit_log.country_policy for each row execute function visit_log.country_policy_partition();

-- ===== seed: DEFAULT, HK, the EU member states, the UK ======================================================================
insert into visit_log.country_policy (country, ip_mode, retention_days, derived_retention_days, enabled, notes, updated_by) values
  ('*',  'raw', 7, 730, true, 'DEFAULT row. Decision 3 (Chris 2026-11-08): raw for countries without a row; decision 4: 7 days. A country is switched to truncated / none by adding a row when a rule requires it.', 'MPC-9889'),
  ('HK', 'raw', 7, 730, true, 'Explicit raw row (PCPD: a standalone IP is not personal data, to be confirmed in the lawyer packet MPC-6798).', 'MPC-9889'),
  ('GB', 'truncated', 7, 730, true, 'UK GDPR: truncated until the lawyer review (MPC-6798) clears raw. Add-a-row change, apply_policy(country) enforces it retroactively.', 'MPC-9889')
on conflict (country) do nothing;
insert into visit_log.country_policy (country, ip_mode, retention_days, derived_retention_days, enabled, notes, updated_by)
select c, 'truncated', 7, 730, true, 'EU member state, GDPR: truncated until the lawyer review (MPC-6798) clears raw.', 'MPC-9889'
from unnest(array['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']) as c
on conflict (country) do nothing;

-- ===== shaping =============================================================================================================
-- IPv4 /24, IPv6 /48, host bits zeroed. Idempotent. Anything that is not an address becomes null.
create or replace function visit_log.shape_ip(p_ip text, p_mode text) returns inet
language plpgsql immutable set search_path = pg_catalog
as $$
declare a inet;
begin
  if p_ip is null or p_mode = 'none' then return null; end if;
  begin a := p_ip::inet; exception when others then return null; end;
  if p_mode = 'raw' then return host(a)::inet; end if;
  return host(network(set_masklen(a, case family(a) when 4 then 24 else 48 end)))::inet;
end $$;
revoke all on function visit_log.shape_ip(text, text) from public;
grant execute on function visit_log.shape_ip(text, text) to visit_log_writer;

-- ===== the write door ======================================================================================================
create or replace function visit_log.record_visit(
  p_country text, p_ip text, p_referrer text, p_utm_source text, p_utm_medium text, p_utm_campaign text, p_utm_content text, p_device text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, visit_log
as $$
declare c text; pol record;
begin
  c := upper(coalesce(nullif(p_country, ''), 'XX'));
  if c !~ '^[A-Z]{2}$' then c := 'XX'; end if;
  select * into pol from visit_log.country_policy where country = c;
  if not found then select * into pol from visit_log.country_policy where country = '*'; end if;
  if not found then return false; end if;                 -- no policy at all: fail closed, write nothing
  if not pol.enabled then return false; end if;
  insert into visit_log.visits (country, ip, ip_mode, referrer, utm_source, utm_medium, utm_campaign, utm_content, device)
  values (c, visit_log.shape_ip(p_ip, pol.ip_mode), pol.ip_mode, left(p_referrer, 512), left(p_utm_source, 128), left(p_utm_medium, 128),
          left(p_utm_campaign, 128), left(p_utm_content, 128),
          case when p_device in ('mobile', 'desktop', 'tablet') then p_device else 'unknown' end);
  return true;
end $$;
revoke all on function visit_log.record_visit(text, text, text, text, text, text, text, text) from public;
grant execute on function visit_log.record_visit(text, text, text, text, text, text, text, text) to visit_log_writer;

-- ===== purge ===============================================================================================================
create or replace function visit_log.purge_country(p_country text, p_ip_days integer, p_derived_days integer, p_dry_run boolean, out ips_nulled integer, out rows_deleted integer)
language plpgsql security definer set search_path = pg_catalog, visit_log
as $$
begin
  if p_dry_run then
    select count(*) into ips_nulled from visit_log.visits where country = p_country and ip is not null and ts < now() - make_interval(days => p_ip_days);
    select count(*) into rows_deleted from visit_log.visits where country = p_country and ts < now() - make_interval(days => p_derived_days);
  else
    update visit_log.visits set ip = null where country = p_country and ip is not null and ts < now() - make_interval(days => p_ip_days);
    get diagnostics ips_nulled = row_count;
    delete from visit_log.visits where country = p_country and ts < now() - make_interval(days => p_derived_days);
    get diagnostics rows_deleted = row_count;
  end if;
end $$;
revoke all on function visit_log.purge_country(text, integer, integer, boolean) from public;
grant execute on function visit_log.purge_country(text, integer, integer, boolean) to visit_log_writer;

create or replace function visit_log.purge(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, visit_log
as $$
declare def record; r record; n record; tot_ips integer := 0; tot_del integer := 0; countries integer := 0;
begin
  select * into def from visit_log.country_policy where country = '*';
  if not found then raise exception 'visit_log.purge: DEFAULT policy row missing'; end if;
  for r in
    select c.country, coalesce(p.retention_days, def.retention_days) as ip_days, coalesce(p.derived_retention_days, def.derived_retention_days) as derived_days
      from (select country from visit_log.country_policy where country <> '*'
            union select distinct country from visit_log.visits) c
      left join visit_log.country_policy p on p.country = c.country
  loop
    select * into n from visit_log.purge_country(r.country, r.ip_days, r.derived_days, p_dry_run);
    countries := countries + 1; tot_ips := tot_ips + n.ips_nulled; tot_del := tot_del + n.rows_deleted;
    if n.ips_nulled > 0 or n.rows_deleted > 0 then
      insert into visit_log.purge_log (dry_run, country, ips_nulled, rows_deleted) values (p_dry_run, r.country, n.ips_nulled, n.rows_deleted);
    end if;
  end loop;
  insert into visit_log.purge_log (dry_run, country, ips_nulled, rows_deleted) values (p_dry_run, '*', tot_ips, tot_del);
  return jsonb_build_object('dry_run', p_dry_run, 'countries', countries, 'ips_nulled', tot_ips, 'rows_deleted', tot_del, 'ran_at', now());
end $$;
revoke all on function visit_log.purge(boolean) from public;
grant execute on function visit_log.purge(boolean) to visit_log_writer;

-- ===== apply a changed policy retroactively =================================================================================
-- Change the row, then run this. raw -> truncated truncates what is stored; anything -> none nulls it; enabled = false deletes the country's rows
-- (and drops its partition when p_drop_partition). Moving to a LOOSER mode cannot restore what was cut. Retention is then applied.
create or replace function visit_log.apply_policy(p_country text, p_dry_run boolean default false, p_drop_partition boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, visit_log
as $$
declare def record; pol record; c text; cs text[]; changed integer := 0; deleted integer := 0; n integer; pr record; part text; dropped boolean := false;
begin
  select * into def from visit_log.country_policy where country = '*';
  if not found then raise exception 'visit_log.apply_policy: DEFAULT policy row missing'; end if;
  if p_country = '*' then
    select coalesce(array_agg(distinct v.country), '{}') into cs from visit_log.visits v where not exists (select 1 from visit_log.country_policy p where p.country = v.country);
  elsif p_country ~ '^[A-Z]{2}$' then cs := array[p_country];
  else raise exception 'visit_log.apply_policy: bad country %', p_country;
  end if;
  foreach c in array cs loop
    select * into pol from visit_log.country_policy where country = c;
    if not found then pol := def; end if;
    if not pol.enabled then
      select count(*) into n from visit_log.visits where country = c;
      deleted := deleted + n;
      if not p_dry_run then
        delete from visit_log.visits where country = c;
        part := 'visits_' || lower(c);
        if p_drop_partition and to_regclass(format('visit_log.%I', part)) is not null then execute format('drop table visit_log.%I', part); dropped := true; end if;
      end if;
      continue;
    end if;
    if pol.ip_mode = 'none' then
      select count(*) into n from visit_log.visits where country = c and ip is not null;
      if not p_dry_run then update visit_log.visits set ip = null, ip_mode = 'none' where country = c and (ip is not null or ip_mode <> 'none'); end if;
    elsif pol.ip_mode = 'truncated' then
      select count(*) into n from visit_log.visits where country = c and ip_mode = 'raw';
      if not p_dry_run then update visit_log.visits set ip = visit_log.shape_ip(host(ip), 'truncated'), ip_mode = 'truncated' where country = c and ip_mode = 'raw'; end if;
    else n := 0;
    end if;
    changed := changed + n;
    select * into pr from visit_log.purge_country(c, pol.retention_days, pol.derived_retention_days, p_dry_run);
    deleted := deleted + pr.rows_deleted;
  end loop;
  insert into visit_log.purge_log (dry_run, country, ips_nulled, rows_deleted) values (p_dry_run, p_country, changed, deleted);
  return jsonb_build_object('country', p_country, 'dry_run', p_dry_run, 'ips_reshaped', changed, 'rows_deleted', deleted, 'partition_dropped', dropped);
end $$;
revoke all on function visit_log.apply_policy(text, boolean, boolean) from public;
grant execute on function visit_log.apply_policy(text, boolean, boolean) to visit_log_writer;

-- ===== health (the 26 h alert reads this) ===================================================================================
create or replace function visit_log.purge_health() returns jsonb
language sql stable security definer set search_path = pg_catalog, visit_log
as $$
  select jsonb_build_object(
    'last_run', m.last_run,
    'age_hours', case when m.last_run is null then null else round((extract(epoch from now() - m.last_run) / 3600)::numeric, 1) end,
    'degraded', m.last_run is null or m.last_run < now() - interval '26 hours',
    'limit_hours', 26)
  from (select max(run_at) as last_run from visit_log.purge_log where country = '*' and not dry_run) m
$$;
revoke all on function visit_log.purge_health() from public;
grant execute on function visit_log.purge_health() to visit_log_writer;

-- Every function runs as visit_log_writer, the one role that holds privileges on these tables.
alter function visit_log.ensure_partition(text) owner to visit_log_writer;
alter function visit_log.country_policy_partition() owner to visit_log_writer;
alter function visit_log.shape_ip(text, text) owner to visit_log_writer;
alter function visit_log.record_visit(text, text, text, text, text, text, text, text) owner to visit_log_writer;
alter function visit_log.purge_country(text, integer, integer, boolean) owner to visit_log_writer;
alter function visit_log.purge(boolean) owner to visit_log_writer;
alter function visit_log.apply_policy(text, boolean, boolean) owner to visit_log_writer;
alter function visit_log.purge_health() owner to visit_log_writer;
grant create on schema visit_log to visit_log_writer;   -- ensure_partition creates partitions as the function owner

-- ===== the service_role doors (public wrappers; the only names the Pages middleware knows) =================================
create or replace function public.mpt_visit_log_policy() returns jsonb
language sql stable security definer set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('country', country, 'ip_mode', ip_mode, 'enabled', enabled) order by country), '[]'::jsonb)
    from visit_log.country_policy
$$;
revoke all on function public.mpt_visit_log_policy() from public, anon, authenticated;
grant execute on function public.mpt_visit_log_policy() to service_role;

create or replace function public.mpt_visit_log_record(
  p_country text default null, p_ip text default null, p_referrer text default null, p_utm_source text default null, p_utm_medium text default null,
  p_utm_campaign text default null, p_utm_content text default null, p_device text default null
) returns boolean
language sql security definer set search_path = pg_catalog, public
as $$ select visit_log.record_visit(p_country, p_ip, p_referrer, p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_device) $$;
revoke all on function public.mpt_visit_log_record(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mpt_visit_log_record(text, text, text, text, text, text, text, text) to service_role;

create or replace function public.mpt_visit_log_purge_health() returns jsonb
language sql stable security definer set search_path = pg_catalog, public
as $$ select visit_log.purge_health() $$;
revoke all on function public.mpt_visit_log_purge_health() from public, anon, authenticated;
grant execute on function public.mpt_visit_log_purge_health() to service_role;

-- The wrappers are owned by the migration role, which reaches visit_log through its membership in visit_log_writer.

-- ===== pg_cron: daily 03:20 HKT (19:20 UTC). Skipped where pg_cron is absent (throwaway CI database) ==========================
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('visit-log-purge', '20 19 * * *', 'select visit_log.purge(false)');
  end if;
end $$;

-- First real run, so the 26 h alert has a baseline from the day this lands (counts only).
select visit_log.purge(false);
