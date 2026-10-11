-- MPC-7488: saved web scans are personal data (strategy D11). The visitor holds the scan number and can have the scan deleted by
-- quoting it; scans are removed automatically after the retention period; every deletion is logged without personal data.
--
-- 1. public.web_scan_retention   the ONE place the retention period is set (single row). months = 12 (Chris confirms in MPC-7470).
--                                unlinked_days = 90 is the shorter rule for scans never linked to a contact that Chris approved in
--                                #249 (MPC-7470, 2026-10-11 20:20 HKT); set it to null to apply only the single `months` period.
-- 2. public.web_scan_deletion_log  one row per deletion run: kind, counts and time. No scan number, no email, no values.
-- 3. mpt_purge_expired_web_scans(p_dry_run)   replaces the #249 function: same rules read from the setting, a dry-run mode that
--                                deletes nothing, and a log row either way (kind 'purge' or 'purge_dry_run').
-- 4. mpt_delete_web_scan(p_scan_number)       deletes one saved scan and its contact link(s) by scan number. Logged (kind 'by_scan_number').
-- 5. mpt_export_web_scan(p_scan_number)       returns the saved scan for that number (the visitor's right of access by scan number).
-- 6. daily pg_cron job mpt-purge-expired-web-scans (19:10 UTC = 03:10 HKT), skipped where pg_cron is absent. Same name and time as
--    the job in PR #251, so applying both is harmless (cron.schedule replaces a job of the same name).
-- 7. corrects the table comments: no connection IP is stored in a column, but the results hold browser-reported values, which
--    include IP addresses (and fingerprint-style values). A saved scan is personal data, not anonymous.
--
-- All functions are service_role only. Rollback:
--   select cron.unschedule('mpt-purge-expired-web-scans');   -- if pg_cron is present
--   drop function if exists public.mpt_export_web_scan(uuid), public.mpt_delete_web_scan(uuid), public.mpt_purge_expired_web_scans(boolean);
--   drop table if exists public.web_scan_deletion_log, public.web_scan_retention;
--   (then re-create public.mpt_purge_expired_web_scans() from migration 20261011180000)

create table if not exists public.web_scan_retention (
  id            boolean primary key default true check (id),
  months        integer not null default 12 check (months between 1 and 120),
  unlinked_days integer check (unlinked_days is null or unlinked_days between 1 and 3650),
  updated_at    timestamptz not null default now()
);
insert into public.web_scan_retention (id, months, unlinked_days) values (true, 12, 90) on conflict (id) do nothing;
comment on table public.web_scan_retention is 'MPC-7488. Single row: how long saved web scans are kept. months = every scan; unlinked_days = shorter period for scans never linked to a contact (null = off).';

create table if not exists public.web_scan_deletion_log (
  id             bigint generated always as identity primary key,
  logged_at      timestamptz not null default now(),
  kind           text not null check (kind in ('purge', 'purge_dry_run', 'by_scan_number')),
  scans_deleted  integer not null check (scans_deleted >= 0),
  links_deleted  integer not null default 0 check (links_deleted >= 0),
  note           text
);
comment on table public.web_scan_deletion_log is 'MPC-7488. One row per deletion run. Counts only: no scan number, contact, IP or value is ever written here.';

alter table public.web_scan_retention enable row level security;
alter table public.web_scan_retention force row level security;
alter table public.web_scan_deletion_log enable row level security;
alter table public.web_scan_deletion_log force row level security;
revoke all on public.web_scan_retention, public.web_scan_deletion_log from public, anon, authenticated;
grant all on public.web_scan_retention, public.web_scan_deletion_log to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'web_scan_retention' and policyname = 'service role full access') then
    create policy "service role full access" on public.web_scan_retention for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'web_scan_deletion_log' and policyname = 'service role full access') then
    create policy "service role full access" on public.web_scan_deletion_log for all to service_role using (true) with check (true);
  end if;
end $$;

drop function if exists public.mpt_purge_expired_web_scans();

create or replace function public.mpt_purge_expired_web_scans(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.web_scan_retention;
  n_unlinked int := 0; n_old int := 0; n_links int := 0;
begin
  select * into r from public.web_scan_retention where id;
  if not found then r.months := 12; r.unlinked_days := 90; end if;

  if p_dry_run then
    if r.unlinked_days is not null then
      select count(*) into n_unlinked from public.web_scans w
       where w.created_at < now() - make_interval(days => r.unlinked_days)
         and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id);
    end if;
    select count(*) into n_old from public.web_scans w
     where w.created_at < now() - make_interval(months => r.months)
       and not (r.unlinked_days is not null and w.created_at < now() - make_interval(days => r.unlinked_days)
                and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id));
    select count(*) into n_links from public.web_scan_contacts c join public.web_scans w on w.id = c.web_scan_id
     where w.created_at < now() - make_interval(months => r.months);
  else
    if r.unlinked_days is not null then
      delete from public.web_scans w
       where w.created_at < now() - make_interval(days => r.unlinked_days)
         and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id);
      get diagnostics n_unlinked = row_count;
    end if;
    select count(*) into n_links from public.web_scan_contacts c join public.web_scans w on w.id = c.web_scan_id
     where w.created_at < now() - make_interval(months => r.months);
    delete from public.web_scans w where w.created_at < now() - make_interval(months => r.months);   -- cascades to web_scan_contacts
    get diagnostics n_old = row_count;
  end if;

  insert into public.web_scan_deletion_log (kind, scans_deleted, links_deleted, note)
  values (case when p_dry_run then 'purge_dry_run' else 'purge' end, n_unlinked + n_old, n_links,
          format('retention months=%s unlinked_days=%s', r.months, coalesce(r.unlinked_days::text, 'off')));

  return jsonb_build_object('dry_run', p_dry_run, 'months', r.months, 'unlinked_days', r.unlinked_days,
                            'unlinked_scans', n_unlinked, 'expired_scans', n_old, 'scans', n_unlinked + n_old,
                            'contact_links', n_links, 'ran_at', now());
end $$;

create or replace function public.mpt_delete_web_scan(p_scan_number uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n_links int := 0; n_scans int := 0;
begin
  select count(*) into n_links from public.web_scan_contacts where web_scan_id = p_scan_number;
  delete from public.web_scans where id = p_scan_number;       -- cascades to web_scan_contacts
  get diagnostics n_scans = row_count;
  if n_scans = 0 then n_links := 0; end if;
  insert into public.web_scan_deletion_log (kind, scans_deleted, links_deleted, note)
  values ('by_scan_number', n_scans, n_links, case when n_scans = 0 then 'scan number not found' else null end);
  return jsonb_build_object('found', n_scans > 0, 'scans_deleted', n_scans, 'contact_links_deleted', n_links, 'deleted_at', now());
end $$;

create or replace function public.mpt_export_web_scan(p_scan_number uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('generated_at', now(), 'web_scan', to_jsonb(w),
              'contact_links', coalesce((select jsonb_agg(jsonb_build_object('channel', c.channel, 'linked_at', c.linked_at)) from public.web_scan_contacts c where c.web_scan_id = w.id), '[]'::jsonb))
       from public.web_scans w where w.id = p_scan_number),
    jsonb_build_object('generated_at', now(), 'web_scan', null, 'contact_links', '[]'::jsonb));
$$;

revoke all on function public.mpt_purge_expired_web_scans(boolean), public.mpt_delete_web_scan(uuid), public.mpt_export_web_scan(uuid) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_web_scans(boolean), public.mpt_delete_web_scan(uuid), public.mpt_export_web_scan(uuid) to service_role;

comment on function public.mpt_purge_expired_web_scans(boolean) is 'MPC-7488. Deletes saved web scans older than public.web_scan_retention (months; unlinked_days for never-linked scans). p_dry_run=true counts only. Logs counts in web_scan_deletion_log. service_role only.';
comment on function public.mpt_delete_web_scan(uuid) is 'MPC-7488. Deletes one saved web scan and its contact links by scan number. Logs counts only. service_role only.';
comment on function public.mpt_export_web_scan(uuid) is 'MPC-7488. Returns the saved web scan stored under a scan number, for an access request. service_role only.';

comment on table public.web_scans is 'MPC-7465/7488. One row per completed web scan, stored under a random scan number (id). PERSONAL DATA, not anonymous: results hold what the browser reported per hexagon, which includes IP addresses and fingerprint-style values (untrusted text). No connection IP, email or user id is stored in a column of this table; a contact is linked only through web_scan_contacts when the visitor gives one. Saved only with the scan-saving consent purpose. Deleted by scan number (mpt_delete_web_scan) or after the retention period (web_scan_retention). service_role only.';
comment on column public.web_scans.id is 'The scan number shown to the visitor and carried to the contact step. Random; anyone who holds it can ask for the scan to be deleted.';

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mpt-purge-expired-web-scans', '10 19 * * *', 'select public.mpt_purge_expired_web_scans(false)');
  end if;
end $$;
