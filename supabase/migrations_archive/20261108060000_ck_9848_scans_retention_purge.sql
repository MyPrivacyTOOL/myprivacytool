-- CK-9848 (from MPC-9833 F10): the `scans` row (visitor email, report status, delivery status) had expires_at = created_at + 30 days
-- but no job deleted by it. This adds the interim purge. MPC-9890 replaces it with the relationship-based rule (free personal
-- record deleted 7 days after report delivery unless "keep my scan" was ticked; paid/signed-up kept per plan).
--
-- 1. public.scans_deletion_log      one row per run: kind, counts, time. No email, scan id or value is ever written here.
-- 2. mpt_purge_expired_scans(p_dry_run)  deletes scans where coalesce(expires_at, created_at + 30 days) < now().
--                                   Dependents: signals and hexagon_scores cascade (ON DELETE CASCADE, checked on production
--                                   2026-11-08: they are the only foreign keys to public.scans). users rows are NOT touched.
--                                   p_dry_run = true counts only. Counts-only log row either way.
-- 3. daily pg_cron job mpt-purge-expired-scans (19:40 UTC = 03:40 HKT, ten minutes after the web_scans job), skipped where
--    pg_cron is absent.
-- Rollback: select cron.unschedule('mpt-purge-expired-scans');
--           drop function if exists public.mpt_purge_expired_scans(boolean); drop table if exists public.scans_deletion_log;
--           (deleted rows are not recoverable: run the dry run first)

create table if not exists public.scans_deletion_log (
  id            bigint generated always as identity primary key,
  logged_at     timestamptz not null default now(),
  kind          text not null check (kind in ('purge', 'purge_dry_run')),
  scans_deleted integer not null check (scans_deleted >= 0),
  note          text
);
comment on table public.scans_deletion_log is 'CK-9848. One row per scans purge run. Counts only: no email, scan id or value is ever written here.';

alter table public.scans_deletion_log enable row level security;
alter table public.scans_deletion_log force row level security;
revoke all on public.scans_deletion_log from public, anon, authenticated;
grant all on public.scans_deletion_log to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scans_deletion_log' and policyname = 'service role full access') then
    create policy "service role full access" on public.scans_deletion_log for all to service_role using (true) with check (true);
  end if;
end $$;

create or replace function public.mpt_purge_expired_scans(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int := 0;
begin
  if p_dry_run then
    select count(*) into n from public.scans s where coalesce(s.expires_at, s.created_at + interval '30 days') < now();
  else
    delete from public.scans s where coalesce(s.expires_at, s.created_at + interval '30 days') < now();   -- cascades to signals, hexagon_scores
    get diagnostics n = row_count;
  end if;
  insert into public.scans_deletion_log (kind, scans_deleted, note)
  values (case when p_dry_run then 'purge_dry_run' else 'purge' end, n, 'expires_at; null = created_at + 30 days');
  return jsonb_build_object('dry_run', p_dry_run, 'scans', n, 'ran_at', now());
end $$;

revoke all on function public.mpt_purge_expired_scans(boolean) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_scans(boolean) to service_role;
comment on function public.mpt_purge_expired_scans(boolean) is 'CK-9848. Deletes scans (report request: email, report and delivery status) past expires_at, 30 days after creation where null. p_dry_run=true counts only. Counts-only log in scans_deletion_log. service_role only. Interim until MPC-9890.';

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mpt-purge-expired-scans', '40 19 * * *', 'select public.mpt_purge_expired_scans(false)');
  end if;
end $$;
