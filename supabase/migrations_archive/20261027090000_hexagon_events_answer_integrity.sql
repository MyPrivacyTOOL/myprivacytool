-- CK-8492 (MPC-7915 release gate): an answer must belong to a shown event, and an exact replay is ignored.
-- Builds on 20261019180000_hexagon_learning_events.sql. NOT applied anywhere by the PR that adds it: production DDL needs Chris's migration
-- approval (apply by hand, like the first migration; auto-migration is off). Collection stays OFF until the gates in docs/learning-events-release-gates.md pass.
--
-- shown_event_id   set by the trigger below on every answer: the 'shown' row for the same person, tile, source and scan window that was put on
--                  screen no more than 24 hours before the answer. NULL on 'shown' rows and on answers stored before this migration.
--                  on delete set null, so the daily purge is unaffected.
-- trigger          an answer with no such shown row is refused (check_violation, 23514): a closed dialog or a plain tap never creates a
--                  'shown'-less answer, and an answer cannot outlive the 24 hour window in which what was shown is still what is on screen.
-- unique index     the same person giving the same answer again for the same tile and scan window (a replayed request) is ignored (23505);
--                  a different answer (a change of mind) is still kept, and the aggregation counts only the first.
--
-- Idempotent. Rollback:
--   drop trigger if exists mpt_hexagon_events_link_answer on public.mpt_hexagon_events;
--   drop function if exists public.mpt_hexagon_events_link_answer();
--   drop index if exists public.mpt_hexagon_events_answer_once;
--   alter table public.mpt_hexagon_events drop column if exists shown_event_id;

alter table public.mpt_hexagon_events add column if not exists shown_event_id uuid references public.mpt_hexagon_events (id) on delete set null;

create unique index if not exists mpt_hexagon_events_answer_once
  on public.mpt_hexagon_events (person_key, hexagon_id, source, scan_window, answer) where event_type = 'answer';

create or replace function public.mpt_hexagon_events_link_answer() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.event_type <> 'answer' then
    return new;
  end if;
  select s.id into new.shown_event_id
  from public.mpt_hexagon_events s
  where s.event_type = 'shown' and s.person_key = new.person_key and s.hexagon_id = new.hexagon_id
    and s.source = new.source and s.scan_window = new.scan_window
    and s.created_at <= new.created_at and s.created_at >= new.created_at - interval '24 hours'
  limit 1;
  if new.shown_event_id is null then
    raise exception 'answer has no recent shown event' using errcode = '23514';
  end if;
  return new;
end $$;
comment on function public.mpt_hexagon_events_link_answer() is 'Links an answer to the shown event it answers (same person, tile, source and scan window, within 24 hours) and refuses an answer with none.';
revoke all on function public.mpt_hexagon_events_link_answer() from public, anon, authenticated;

drop trigger if exists mpt_hexagon_events_link_answer on public.mpt_hexagon_events;
create trigger mpt_hexagon_events_link_answer before insert on public.mpt_hexagon_events
  for each row execute function public.mpt_hexagon_events_link_answer();
