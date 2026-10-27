-- MPC-8659: 7-day retention for public.scans, without losing the scan count the KPIs read.
--
-- Owner decision 2026-10-27 (TTL schedule): public.scans = 7 days. Until now the column default was 30 days and nothing purged expired rows.
--
-- Why this is in supabase/proposed/ and does NOT schedule the purge:
--   1. The KPI views (supabase/sql/mpt-raw-metrics.sql, mpt-hk-days.sql) compute cumulative_scans and conversion_rate_pct with count(*) over public.scans.
--      Purging scans would make "Cumulative Scans" go DOWN. This migration adds public.scan_hourly_counts (counts only, no user link) and backfills it, so the views can
--      be switched to it first (MPC-8655). Only then should the purge be scheduled (step 3 below).
--   2. Deleting a scan cascades to signals and then removal_tasks. The purge therefore skips scans that still have an open removal task
--      (not_started / in_progress). Owner decision 2026-10-27: NEVER delete a scan while it has an open removal task; it goes on the first run after the task is completed or failed.
--
-- Rollout:  1. apply this file (adds the counter + function; changes the default for NEW rows only; deletes nothing)
--           2. switch the KPI views to public.scan_hourly_counts (MPC-8655), then check: select public.mpt_purge_expired_scans(true);   -- dry run
--           3. schedule:  select cron.schedule('mpt-purge-expired-scans', '35 19 * * *', 'select public.mpt_purge_expired_scans(false)');
-- Rollback: select cron.unschedule('mpt-purge-expired-scans');  drop function if exists public.mpt_purge_expired_scans(boolean);
--           drop trigger if exists scans_count_hourly on public.scans;  drop function if exists public.mpt_count_scan_hourly();
--           drop table if exists public.scan_hourly_counts;  alter table public.scans alter column expires_at set default (now() + interval '30 days');

-- ---------------------------------------------------------------- anonymous counter (survives the purge)
create table if not exists public.scan_hourly_counts (
  hour           timestamptz primary key,                  -- date_trunc('hour', scans.created_at); hour buckets let both UTC days and Hong Kong days (UTC+8) be derived
  scans_created  bigint not null default 0 check (scans_created >= 0)
);
comment on table public.scan_hourly_counts is 'MPC-8659. Number of scans created per hour. Counts only: no user, email or scan reference. Kept after public.scans rows are purged so cumulative scan KPIs stay correct. service_role only.';
alter table public.scan_hourly_counts enable row level security;
alter table public.scan_hourly_counts force row level security;
revoke all on public.scan_hourly_counts from public, anon, authenticated;
grant select on public.scan_hourly_counts to service_role;

-- backfill from rows that still exist; safe to re-run (never overwrites an hour that already has a count)
insert into public.scan_hourly_counts (hour, scans_created)
select date_trunc('hour', created_at), count(*) from public.scans group by 1
on conflict (hour) do nothing;

create or replace function public.mpt_count_scan_hourly() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.scan_hourly_counts (hour, scans_created) values (date_trunc('hour', new.created_at), 1)
  on conflict (hour) do update set scans_created = public.scan_hourly_counts.scans_created + 1;
  return new;
end $$;
revoke all on function public.mpt_count_scan_hourly() from public, anon, authenticated;

drop trigger if exists scans_count_hourly on public.scans;
create trigger scans_count_hourly after insert on public.scans for each row execute function public.mpt_count_scan_hourly();

-- ---------------------------------------------------------------- 7-day default for new rows
alter table public.scans alter column expires_at set default (now() + interval '7 days');

-- ---------------------------------------------------------------- purge (dry run by default)
create or replace function public.mpt_purge_expired_scans(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_due int; n_held int; n_no_expiry int; n_deleted int := 0;
begin
  select count(*) into n_no_expiry from public.scans where expires_at is null;
  select count(*) into n_due from public.scans where expires_at < now();
  select count(*) into n_held from public.scans s
   where s.expires_at < now()
     and exists (select 1 from public.signals g join public.removal_tasks r on r.signal_id = g.id
                  where g.scan_id = s.id and r.status in ('not_started', 'in_progress'));

  if not p_dry_run then
    delete from public.scans s
     where s.expires_at < now()
       and not exists (select 1 from public.signals g join public.removal_tasks r on r.signal_id = g.id
                        where g.scan_id = s.id and r.status in ('not_started', 'in_progress'));
    get diagnostics n_deleted = row_count;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'due', n_due, 'held_for_open_removals', n_held,
                            'rows_without_expiry', n_no_expiry, 'deleted', n_deleted, 'ran_at', now());
end $$;
revoke all on function public.mpt_purge_expired_scans(boolean) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_scans(boolean) to service_role;
comment on function public.mpt_purge_expired_scans(boolean) is 'MPC-8659. Deletes public.scans rows past expires_at (7 days for new rows), cascading to signals, hexagon_scores and removal_tasks. NEVER deletes a scan that has an open removal task (not_started / in_progress); owner decision 2026-10-27. Dry run by default. Returns counts only. Not scheduled: see the header of this file.';
