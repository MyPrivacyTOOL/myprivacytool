-- MPC-7470 / MPC-7488: bring PRODUCTION up to what the repo says: saved-scan retention + deletion by scan number (MPC-7488, #254)
-- and deletion-request (DSAR) export/erase that reach saved web scans (MPC-7470, #251).
-- WHY THIS FILE EXISTS: the deploy workflow skips migrations (repo secrets not set) and the Supabase connector times out on
-- function DDL, so these are applied by hand. Bodies are copied from supabase/migrations/20261011220000 and 20261011200000.
-- It replaces migration 20261011180000 (the no-argument purge) and the no-argument cron job in 20261011200000: do NOT apply those two.
-- Safe to re-run: every block is create-or-replace / if-not-exists. Nothing here turns scan saving on.
--
-- HOW: Supabase dashboard -> SQL Editor -> project xmdmkumwxpgahmlweuug. Paste and Run ONE BLOCK AT A TIME, in order.
-- Run block 0 first and block 10 last.

-- ===== BLOCK 0: before (read-only). Expect today: functions = mpt_probe_7470(), mpt_purge_expired_web_scans() (a do-nothing stub); no retention table; no job. =====
select (select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) from pg_proc p where pronamespace='public'::regnamespace and (proname like 'mpt_%web_scan%' or proname like 'mpt_dsar%' or proname like 'mpt_probe%')) as functions,
       (select string_agg(table_name, ', ') from information_schema.tables where table_schema='public' and table_name like 'web_scan%') as tables,
       (select count(*) from cron.job where jobname = 'mpt-purge-expired-web-scans') as purge_job;

-- ===== BLOCK 1: retention setting (12 months; 90 days if never linked) and the deletion log (counts only, no personal data). =====
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

-- ===== BLOCK 2: the real purge (replaces the do-nothing stub; adds a dry-run mode). =====
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

-- ===== BLOCK 3: delete one saved scan by scan number. =====
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

-- ===== BLOCK 4: export one saved scan by scan number (right of access). =====
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

-- ===== BLOCK 5: permissions (service_role only) and comments. =====
revoke all on function public.mpt_purge_expired_web_scans(boolean), public.mpt_delete_web_scan(uuid), public.mpt_export_web_scan(uuid) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_web_scans(boolean), public.mpt_delete_web_scan(uuid), public.mpt_export_web_scan(uuid) to service_role;

comment on function public.mpt_purge_expired_web_scans(boolean) is 'MPC-7488. Deletes saved web scans older than public.web_scan_retention (months; unlinked_days for never-linked scans). p_dry_run=true counts only. Logs counts in web_scan_deletion_log. service_role only.';
comment on function public.mpt_delete_web_scan(uuid) is 'MPC-7488. Deletes one saved web scan and its contact links by scan number. Logs counts only. service_role only.';
comment on function public.mpt_export_web_scan(uuid) is 'MPC-7488. Returns the saved web scan stored under a scan number, for an access request. service_role only.';

comment on table public.web_scans is 'MPC-7465/7488. One row per completed web scan, stored under a random scan number (id). PERSONAL DATA, not anonymous: results hold what the browser reported per hexagon, which includes IP addresses and fingerprint-style values (untrusted text). No connection IP, email or user id is stored in a column of this table; a contact is linked only through web_scan_contacts when the visitor gives one. Saved only with the scan-saving consent purpose. Deleted by scan number (mpt_delete_web_scan) or after the retention period (web_scan_retention). service_role only.';
comment on column public.web_scans.id is 'The scan number shown to the visitor and carried to the contact step. Random; anyone who holds it can ask for the scan to be deleted.';

-- ===== BLOCK 6: deletion-request EXPORT (by email) now includes saved web scans linked to the person. =====
create or replace function public.mpt_dsar_export(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');   -- same key the mpt-leads Worker writes
  uid uuid;
  out jsonb;
begin
  select id into uid from public.users where lower(email) = e;
  out := jsonb_build_object(
    'generated_at', now(),
    'subject_email', e,
    'users',      coalesce((select jsonb_agg(to_jsonb(u) - 'subscription_id') from public.users u where u.id = uid), '[]'),
    'leads',      coalesce((select jsonb_agg(to_jsonb(l)) from public.leads l where lower(l.email) = e), '[]'),
    'subscribers',coalesce((select jsonb_agg(to_jsonb(s)) from public.subscribers s where lower(s.email) = e), '[]'),
    'scans',      coalesce((select jsonb_agg(to_jsonb(s)) from public.scans s where s.user_id = uid), '[]'),
    'signals',    coalesce((select jsonb_agg(to_jsonb(g)) from public.signals g join public.scans s on s.id = g.scan_id where s.user_id = uid), '[]'),
    'hexagon_scores', coalesce((select jsonb_agg(to_jsonb(x)) from public.hexagon_scores x join public.scans s on s.id = x.scan_id where s.user_id = uid), '[]'),
    'removal_tasks',  coalesce((select jsonb_agg(to_jsonb(r)) from public.removal_tasks r where r.user_id = uid), '[]'),
    -- MPC-7470: saved web scans linked to this person's scan rows (web_scan_contacts.channel='email', contact_id = scans.id)
    'web_scans',  coalesce((select jsonb_agg(to_jsonb(w)) from public.web_scans w where w.id in (
                     select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
                     where c.channel = 'email' and s.user_id = uid)), '[]'),
    'score_baseline', coalesce((select jsonb_agg(to_jsonb(b) - 'email_hash') from public.mpt_score_baselines b where b.email_hash = h), '[]')
  );
  return out;
end $$;

-- ===== BLOCK 7: deletion-request ERASE (by email) now removes saved web scans linked to the person. =====
create or replace function public.mpt_dsar_erase(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');
  n_users int; n_leads int; n_subs int; n_base int; n_scans int; n_web int;
begin
  select count(*) into n_scans from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e;
  -- MPC-7470: saved web scans first (web_scan_contacts.contact_id has no foreign key to scans, so deleting users does not reach them).
  -- Deleting a web_scans row cascades to its web_scan_contacts rows.
  delete from public.web_scans where id in (
    select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
    where c.channel = 'email' and lower(u.email) = e);              get diagnostics n_web   = row_count;
  delete from public.users where lower(email) = e;                 get diagnostics n_users = row_count;
  delete from public.leads where lower(email) = e;                 get diagnostics n_leads = row_count;
  delete from public.subscribers where lower(email) = e;           get diagnostics n_subs  = row_count;
  delete from public.mpt_score_baselines where email_hash = h;     get diagnostics n_base  = row_count;
  return jsonb_build_object('erased_at', now(), 'users', n_users, 'scans_cascaded', n_scans,
                            'leads', n_leads, 'subscribers', n_subs, 'score_baselines', n_base, 'web_scans', n_web);
end $$;

-- ===== BLOCK 8: permissions for the two deletion-request functions. =====
revoke all on function public.mpt_dsar_export(text), public.mpt_dsar_erase(text) from public, anon, authenticated;
grant execute on function public.mpt_dsar_export(text), public.mpt_dsar_erase(text) to service_role;

-- ===== BLOCK 9: schedule the daily purge (03:10 HKT) and remove the leftover probe function. =====
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mpt-purge-expired-web-scans', '10 19 * * *', 'select public.mpt_purge_expired_web_scans(false)');
  end if;
end $$;
drop function if exists public.mpt_probe_7470();

-- ===== BLOCK 10: verify. Expect: purge_is_real = true, 6 functions listed, job_schedule = 10 19 * * *, probe_left = 0. =====
select (select pg_get_functiondef(p.oid) like '%web_scan_retention%' from pg_proc p where p.proname='mpt_purge_expired_web_scans' and p.pronamespace='public'::regnamespace) as purge_is_real,
       (select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) from pg_proc p where pronamespace='public'::regnamespace and proname in ('mpt_dsar_export','mpt_dsar_erase','mpt_purge_expired_web_scans','mpt_delete_web_scan','mpt_export_web_scan')) as functions,
       (select schedule from cron.job where jobname = 'mpt-purge-expired-web-scans') as job_schedule,
       (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname = 'mpt_probe_7470') as probe_left,
       (select count(*) from public.web_scans) as web_scan_rows;
