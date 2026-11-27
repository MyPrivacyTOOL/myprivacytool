-- MPC-7915 slice 2: where visitors' answers about a tile are kept, and where proposed confidence changes wait for a human.
-- Design: https://app.notion.com/p/3fe28547eaa781bbb748c984b7601dd3  (Chris agreed the five open questions on 2026-10-19).
--
-- public.mpt_hexagon_events          append-only. 'shown' = a tile with an answer option was put on screen; 'answer' = the visitor pressed
--                                    one of its buttons (yes_me / not_me / disputed / kept). Closing a prompt records nothing, and a plain
--                                    tap is never an answer. person_key is a random id the browser makes: no account, phone or email.
--                                    NO finding value is stored. A repeat 'shown' for the same person, tile and scan window is ignored
--                                    (unique index). Answers are not unique: the first one counts, a later change is kept but not counted twice.
-- public.mpt_hexagon_event_rollups   what is left after the raw rows pass their retention (about 90 days): counts per day, tile and config.
-- public.confidence_config           versioned confidence in force. Version 0 is empty and means "the registry's fixed numbers".
--                                    Exactly one row is active. Switching the active row back is the rollback; nothing is rewritten.
-- public.confidence_proposals        append-only record of what the answers suggest. NOTHING is applied automatically: a human sets status
--                                    to approved or rejected and is named on the row (Chris alone for now).
-- public.rollup_and_purge_hexagon_events(retention)   rolls old raw rows into the rollup table, deletes them, returns how many it deleted.
--                                    Not scheduled by this migration.
--
-- Access: RLS forced, no anon/authenticated grants, service_role only (the webhook-receiver Worker). Idempotent.
-- Rollback: drop function if exists public.rollup_and_purge_hexagon_events(interval); drop table if exists public.confidence_proposals;
--           drop table if exists public.confidence_config; drop table if exists public.mpt_hexagon_event_rollups; drop table if exists public.mpt_hexagon_events;
-- Not applied to production by the PR that adds it: apply by hand (SQL editor) before anything writes to it. Privacy Policy wording for
-- this data is still open (MPC-6798 owner); do not switch the write path on before that is settled.

create table if not exists public.mpt_hexagon_events (
  id                    uuid primary key default gen_random_uuid(),
  event_type            varchar(8)  not null check (event_type in ('shown', 'answer')),
  person_key            varchar(64) not null check (person_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  scan_window           varchar(32) not null check (char_length(scan_window) between 1 and 32),
  hexagon_id            varchar(64) not null,
  source                varchar(64) not null default 'web-scan',
  tile_kind             varchar(32),
  confidence_at_display double precision check (confidence_at_display is null or confidence_at_display between 0 and 1),
  config_version        integer     not null default 0 check (config_version >= 0),
  answer                varchar(16) check (answer is null or answer in ('yes_me', 'not_me', 'disputed', 'kept')),
  created_at            timestamptz not null default now(),
  check ((event_type = 'answer') = (answer is not null))
);
comment on table public.mpt_hexagon_events is 'Visitors'' answers about a tile, append-only. No finding value, no account, phone or email: person_key is a random browser-made id. Raw rows are rolled up and deleted after about 90 days.';
create unique index if not exists mpt_hexagon_events_shown_once on public.mpt_hexagon_events (person_key, hexagon_id, source, scan_window) where event_type = 'shown';
create index if not exists mpt_hexagon_events_tile_idx on public.mpt_hexagon_events (hexagon_id, source, event_type, created_at desc);
create index if not exists mpt_hexagon_events_created_idx on public.mpt_hexagon_events (created_at);

create table if not exists public.mpt_hexagon_event_rollups (
  day            date        not null,
  hexagon_id     varchar(64) not null,
  source         varchar(64) not null,
  config_version integer     not null,
  shown_people   integer     not null default 0 check (shown_people >= 0),
  yes_me         integer     not null default 0 check (yes_me >= 0),
  not_me         integer     not null default 0 check (not_me >= 0),
  disputed       integer     not null default 0 check (disputed >= 0),
  kept           integer     not null default 0 check (kept >= 0),
  primary key (day, hexagon_id, source, config_version)
);
comment on table public.mpt_hexagon_event_rollups is 'Counts left after raw events pass retention. Each person''s first answer per tile and scan window is counted once.';

create table if not exists public.confidence_config (
  version    integer primary key check (version >= 0),
  confidences jsonb not null default '{}'::jsonb,
  active     boolean not null default false,
  created_by text not null,
  note       text,
  created_at timestamptz not null default now()
);
comment on table public.confidence_config is 'Versioned confidence in force (hexagon id -> 0..1). Version 0 is empty: use the registry''s fixed numbers. Exactly one row is active; switching it back is the rollback.';
create unique index if not exists confidence_config_one_active on public.confidence_config ((true)) where active;
insert into public.confidence_config (version, confidences, active, created_by, note)
  values (0, '{}'::jsonb, true, 'registry default', 'The registry''s fixed confidence numbers')
  on conflict (version) do nothing;

create table if not exists public.confidence_proposals (
  id             uuid primary key default gen_random_uuid(),
  hexagon_id     varchar(64) not null,
  source         varchar(64) not null,
  basis          varchar(12) not null check (basis in ('accuracy', 'dispute')),
  current_value  double precision not null check (current_value between 0 and 1),
  proposed_value double precision not null check (proposed_value between 0 and 1),
  interval_low   double precision not null check (interval_low between 0 and 1),
  interval_high  double precision not null check (interval_high between 0 and 1),
  responders     integer not null check (responders >= 30),
  response_rate  double precision not null check (response_rate between 0 and 1),
  config_version integer not null check (config_version >= 0),
  status         varchar(10) not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  decided_by     text,
  decided_at     timestamptz,
  reason         text,
  created_at     timestamptz not null default now(),
  check (interval_low <= interval_high),
  check (status = 'proposed' or (decided_by is not null and decided_at is not null))
);
comment on table public.confidence_proposals is 'What visitors'' answers suggest about a tile''s confidence. Never applied automatically: a human approves or rejects and is named. responders is never below 30 (the agreed minimum).';
create index if not exists confidence_proposals_status_idx on public.confidence_proposals (status, created_at desc);

alter table public.mpt_hexagon_events enable row level security;       alter table public.mpt_hexagon_events force row level security;
alter table public.mpt_hexagon_event_rollups enable row level security; alter table public.mpt_hexagon_event_rollups force row level security;
alter table public.confidence_config enable row level security;         alter table public.confidence_config force row level security;
alter table public.confidence_proposals enable row level security;      alter table public.confidence_proposals force row level security;
revoke all on public.mpt_hexagon_events, public.mpt_hexagon_event_rollups, public.confidence_config, public.confidence_proposals from public, anon, authenticated;
grant all on public.mpt_hexagon_events, public.mpt_hexagon_event_rollups, public.confidence_config, public.confidence_proposals to service_role;
drop policy if exists "service role full access" on public.mpt_hexagon_events;
create policy "service role full access" on public.mpt_hexagon_events for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.mpt_hexagon_event_rollups;
create policy "service role full access" on public.mpt_hexagon_event_rollups for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.confidence_config;
create policy "service role full access" on public.confidence_config for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.confidence_proposals;
create policy "service role full access" on public.confidence_proposals for all to service_role using (true) with check (true);

create or replace function public.rollup_and_purge_hexagon_events(retention interval default interval '90 days') returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  cutoff  timestamptz := now() - retention;
  removed bigint;
begin
  if retention < interval '1 day' then raise exception 'retention must be at least one day'; end if;
  with old as (select * from public.mpt_hexagon_events where created_at < cutoff),
  shown as (
    select created_at::date as day, hexagon_id, source, config_version, count(distinct person_key)::int as n
    from old where event_type = 'shown' group by 1, 2, 3, 4
  ),
  first_answer as (
    select distinct on (person_key, hexagon_id, source, scan_window) *
    from old where event_type = 'answer'
    order by person_key, hexagon_id, source, scan_window, created_at
  ),
  answered as (
    select created_at::date as day, hexagon_id, source, config_version,
      count(*) filter (where answer = 'yes_me')::int   as yes_me,
      count(*) filter (where answer = 'not_me')::int   as not_me,
      count(*) filter (where answer = 'disputed')::int as disputed,
      count(*) filter (where answer = 'kept')::int     as kept
    from first_answer group by 1, 2, 3, 4
  )
  insert into public.mpt_hexagon_event_rollups as r (day, hexagon_id, source, config_version, shown_people, yes_me, not_me, disputed, kept)
  select coalesce(s.day, a.day), coalesce(s.hexagon_id, a.hexagon_id), coalesce(s.source, a.source), coalesce(s.config_version, a.config_version),
         coalesce(s.n, 0), coalesce(a.yes_me, 0), coalesce(a.not_me, 0), coalesce(a.disputed, 0), coalesce(a.kept, 0)
  from shown s full join answered a on (s.day, s.hexagon_id, s.source, s.config_version) = (a.day, a.hexagon_id, a.source, a.config_version)
  on conflict (day, hexagon_id, source, config_version) do update set
    shown_people = r.shown_people + excluded.shown_people, yes_me = r.yes_me + excluded.yes_me, not_me = r.not_me + excluded.not_me,
    disputed = r.disputed + excluded.disputed, kept = r.kept + excluded.kept;
  with gone as (delete from public.mpt_hexagon_events where created_at < cutoff returning 1) select count(*) into removed from gone;
  return removed;
end $$;
comment on function public.rollup_and_purge_hexagon_events(interval) is 'Rolls raw events older than the retention into the rollup table, then deletes them. Counts each person''s first answer once; a scan window that straddles the cutoff can be counted twice at the edge. Not scheduled by the migration.';
revoke all on function public.rollup_and_purge_hexagon_events(interval) from public, anon, authenticated;
grant execute on function public.rollup_and_purge_hexagon_events(interval) to service_role;
