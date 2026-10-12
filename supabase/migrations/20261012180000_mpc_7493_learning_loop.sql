-- MPC-7493 (inbound funnels F4, the learning loop): did they come back, why didn't they stay, what made them leave.
--
-- Funnel steps are recorded against the scan number of a SAVED scan, so they exist only for visitors who accepted the specific
-- scan-saving consent purpose (MPC-7488). No new personal data: a step is a name, a time and (for time on results) a number of seconds.
-- Return visits are counted by the scan number the visitor's browser already keeps (MPC-7488), never by fingerprint matching.
--
-- public.web_scan_events   one row per (scan, step): scan_started, scan_finished, results_viewed, contact_step_opened, contact_given, results_time
-- public.web_scan_returns  one row per scan that was made by a browser holding an earlier scan number: (this scan, the earlier scan)
-- public.mpt_learning_loop(from, to, grace_hours)  aggregates only, as jsonb. Used by the weekly publisher.
--
-- All three cascade from web_scans, so deleting a scan by its number (mpt_delete_web_scan) or the 12-month clean-up removes its steps and returns too.
-- Access: RLS forced, service_role only.
-- Rollback: drop function if exists public.mpt_learning_loop(timestamptz, timestamptz, integer);
--           drop table if exists public.web_scan_returns; drop table if exists public.web_scan_events;

create table if not exists public.web_scan_events (
  id           bigint generated always as identity primary key,
  web_scan_id  uuid not null references public.web_scans (id) on delete cascade,
  step         text not null check (step in ('scan_started', 'scan_finished', 'results_viewed', 'contact_step_opened', 'contact_given', 'results_time')),
  occurred_at  timestamptz not null default now(),
  seconds      integer check (seconds is null or seconds between 0 and 3600),
  unique (web_scan_id, step),
  check ((step = 'results_time') = (seconds is not null))
);
comment on table public.web_scan_events is 'MPC-7493. First time each funnel step happened for a saved scan (results_time keeps the longest time reported, in seconds). No other data. Cascades from web_scans. service_role only.';

create index if not exists web_scan_events_step_idx on public.web_scan_events (step, occurred_at);

create table if not exists public.web_scan_returns (
  web_scan_id       uuid primary key references public.web_scans (id) on delete cascade,
  previous_scan_id  uuid not null references public.web_scans (id) on delete cascade,
  returned_at       timestamptz not null default now(),
  check (web_scan_id <> previous_scan_id)
);
comment on table public.web_scan_returns is 'MPC-7493. This scan was made by a browser that still held the earlier scan number (kept by the site, MPC-7488). That is the only way a return visit is recognised: no fingerprint matching. Cascades from either scan. service_role only.';

create index if not exists web_scan_returns_returned_at_idx on public.web_scan_returns (returned_at);

alter table public.web_scan_events enable row level security;
alter table public.web_scan_events force row level security;
alter table public.web_scan_returns enable row level security;
alter table public.web_scan_returns force row level security;
revoke all on public.web_scan_events, public.web_scan_returns from public, anon, authenticated;
grant all on public.web_scan_events, public.web_scan_returns to service_role;
grant usage, select on sequence public.web_scan_events_id_seq to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'web_scan_events' and policyname = 'service role full access') then
    create policy "service role full access" on public.web_scan_events for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'web_scan_returns' and policyname = 'service role full access') then
    create policy "service role full access" on public.web_scan_returns for all to service_role using (true) with check (true);
  end if;
end $$;

-- Aggregates for scans CREATED in [p_from, p_to). Nothing in the result identifies a scan.
--   finished / contacts_given             scans saved, and how many of them have a contact linked (stayers)
--   leavers                               scans with no contact that are at least p_grace_hours old at p_to (younger ones may still convert)
--   leavers_last_step                     the last step each leaver reached: scan_finished | results_viewed | contact_step_opened
--   results_seconds                       average seconds on the results screen, leavers vs stayers (only scans that reported a time)
--   hexagons                              per hexagon id: how many leavers / stayers had it shown as a finding (status 'found'), out of how many
--   returns                               return scans made in the window whose earlier scan was <= 7 / <= 30 days older
create or replace function public.mpt_learning_loop(p_from timestamptz, p_to timestamptz, p_grace_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select w.id, w.created_at, w.results,
           exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id) as stayer
      from public.web_scans w
     where w.created_at >= p_from and w.created_at < p_to
  ), grp as (
    select b.*, case when b.stayer then 'stayer'
                     when b.created_at <= p_to - make_interval(hours => p_grace_hours) then 'leaver'
                     else 'pending' end as grp
      from base b
  ), last_step as (
    select g.id,
           case when exists (select 1 from public.web_scan_events e where e.web_scan_id = g.id and e.step = 'contact_step_opened') then 'contact_step_opened'
                when exists (select 1 from public.web_scan_events e where e.web_scan_id = g.id and e.step = 'results_viewed') then 'results_viewed'
                else 'scan_finished' end as step
      from grp g where g.grp = 'leaver'
  ), hex as (
    select g.grp, h->>'id' as hexagon_id, (h->>'status') = 'found' as found
      from grp g, jsonb_array_elements(g.results) h
     where g.grp in ('leaver', 'stayer')
  ), ret as (
    select r.returned_at - p.created_at as gap
      from public.web_scan_returns r join public.web_scans p on p.id = r.previous_scan_id
     where r.returned_at >= p_from and r.returned_at < p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'grace_hours', p_grace_hours,
    'finished',       (select count(*) from base),
    'contacts_given', (select count(*) from grp where grp = 'stayer'),
    'leavers',        (select count(*) from grp where grp = 'leaver'),
    'pending',        (select count(*) from grp where grp = 'pending'),
    'leavers_last_step', jsonb_build_object(
      'scan_finished',       (select count(*) from last_step where step = 'scan_finished'),
      'results_viewed',      (select count(*) from last_step where step = 'results_viewed'),
      'contact_step_opened', (select count(*) from last_step where step = 'contact_step_opened')),
    'results_seconds', jsonb_build_object(
      'leavers_n',   (select count(*) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'leaver'),
      'leavers_avg', (select round(avg(e.seconds), 1) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'leaver'),
      'stayers_n',   (select count(*) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'stayer'),
      'stayers_avg', (select round(avg(e.seconds), 1) from grp g join public.web_scan_events e on e.web_scan_id = g.id and e.step = 'results_time' where g.grp = 'stayer')),
    'hexagons', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.hexagon_id,
          'leavers_found', t.leavers_found, 'leavers_total', t.leavers_total,
          'stayers_found', t.stayers_found, 'stayers_total', t.stayers_total) order by t.hexagon_id)
        from (select hexagon_id,
                     count(*) filter (where grp = 'leaver' and found) as leavers_found,
                     count(*) filter (where grp = 'leaver') as leavers_total,
                     count(*) filter (where grp = 'stayer' and found) as stayers_found,
                     count(*) filter (where grp = 'stayer') as stayers_total
                from hex group by hexagon_id) t), '[]'::jsonb),
    'returns', jsonb_build_object(
      'returned_total', (select count(*) from ret),
      'within_7_days',  (select count(*) from ret where gap <= interval '7 days'),
      'within_30_days', (select count(*) from ret where gap <= interval '30 days'))
  );
$$;

revoke all on function public.mpt_learning_loop(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mpt_learning_loop(timestamptz, timestamptz, integer) to service_role;
comment on function public.mpt_learning_loop(timestamptz, timestamptz, integer) is 'MPC-7493. Aggregate learning-loop numbers for scans created in [from, to): finished vs contact given, last step reached by leavers, hexagons shown as findings to leavers vs stayers, average time on results, returns within 7/30 days. Counts only. service_role only.';
