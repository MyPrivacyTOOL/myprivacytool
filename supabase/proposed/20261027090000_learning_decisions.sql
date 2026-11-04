-- CK-8493: where a human decision about a proposed confidence change is kept, and how it is followed up. NOT applied by the PR that adds it.
-- Lives in supabase/proposed/ ON PURPOSE: .github/workflows/deploy-supabase.yml runs `supabase db push` on every merge to main when its secrets are set,
-- and it reads only supabase/migrations/. Moving this file there IS the production release step and needs the approvals named in
-- docs/learning-decisions-ck-8493.md. supabase/tests/run.sh applies it to the throwaway test database so the controls are tested now.
-- Builds on MPC-7915 (20261019180000): confidence_proposals (what the answers suggest) and confidence_config (versioned confidence in force).
-- No second metrics store: this holds only the reasoning chain  evidence -> decision -> approval -> implementation version -> outcome check.
--
-- public.learning_decisions         immutable header: hypothesis, baseline counts + window, one bounded change, guardrails, evidence, owner,
--                                   who must approve, next outcome check date. Counts only: no person_key, no finding value. Never updated.
-- public.learning_decision_events   append-only: decided / approved / rejected / implemented / rolled_back / outcome_checked. Never updated or
--                                   deleted. State is derived from the events. Raw observations (mpt_hexagon_events) are never touched.
-- Controls enforced here as well as in src/lib/learning/decisions.ts:
--   * an 'implemented' event needs a prior 'decided: change', an approval by the named primary approver, and (dispute threshold) a second
--     approval by a DIFFERENT person; nothing may follow a 'rejected';
--   * one approval per person; one decision per record.
-- Recording 'implemented' does NOT change live configuration: switching confidence_config.active is a separate, approved production action.
--
-- Access: RLS forced, service_role only. Idempotent.
-- Rollback: drop table if exists public.learning_decision_events; drop table if exists public.learning_decisions;
--           drop function if exists public.learning_decisions_guard();

create table if not exists public.learning_decisions (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  owner                   text not null check (btrim(owner) <> ''),
  hypothesis              text not null check (btrim(hypothesis) <> ''),
  target_kind             varchar(20) not null check (target_kind in ('confidence', 'dispute_threshold')),
  hexagon_id              varchar(64) not null,
  source                  varchar(64) not null,
  tile_kind               varchar(32),
  baseline                jsonb not null,
  proposed_from           double precision not null check (proposed_from between 0 and 1),
  proposed_to             double precision not null check (proposed_to between 0 and 1),
  bound_min               double precision not null check (bound_min between 0 and 1),
  bound_max               double precision not null check (bound_max between 0 and 1),
  guardrails              jsonb not null check (jsonb_typeof(guardrails) = 'array' and jsonb_array_length(guardrails) >= 1),
  evidence                jsonb not null,
  proposal_id             uuid references public.confidence_proposals(id),
  primary_approver        text not null check (btrim(primary_approver) <> ''),
  second_approver_required boolean not null,
  next_outcome_check_due  timestamptz not null,
  policy_version          text not null,
  rules_version           text not null,
  check (bound_min <= bound_max and proposed_to between bound_min and bound_max),
  check (next_outcome_check_due > created_at),
  check (not (baseline ? 'person_key'))
);
comment on table public.learning_decisions is 'Immutable header of a reviewed decision about a proposed confidence change. Counts only. Never updated.';

create table if not exists public.learning_decision_events (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.learning_decisions(id),
  kind        varchar(16) not null check (kind in ('decided', 'approved', 'rejected', 'implemented', 'rolled_back', 'outcome_checked')),
  actor       text not null check (btrim(actor) <> ''),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  check (kind <> 'decided' or payload->>'decision' in ('keep', 'change', 'stop', 'insufficient_evidence')),
  check (kind <> 'decided' or btrim(coalesce(payload->>'reason', '')) <> ''),
  check (kind <> 'rejected' or btrim(coalesce(payload->>'reason', '')) <> ''),
  check (kind <> 'rolled_back' or (payload ? 'toConfigVersion' and btrim(coalesce(payload->>'reason', '')) <> '')),
  check (kind <> 'implemented' or (payload ? 'configVersion'))
);
comment on table public.learning_decision_events is 'Append-only steps of a decision. Never updated or deleted; state is derived from these rows.';
create index if not exists learning_decision_events_decision_idx on public.learning_decision_events (decision_id, created_at);
create unique index if not exists learning_decision_events_one_decision on public.learning_decision_events (decision_id) where kind = 'decided';
create unique index if not exists learning_decision_events_one_approval_each on public.learning_decision_events (decision_id, lower(actor)) where kind = 'approved';

create or replace function public.learning_decisions_guard() returns trigger language plpgsql security invoker set search_path = public as $$
declare
  hdr public.learning_decisions%rowtype;
  approvers int;
begin
  if tg_op in ('UPDATE', 'DELETE') then raise exception '% is append-only', tg_table_name using errcode = 'P0001'; end if;
  if tg_table_name = 'learning_decisions' then return new; end if;
  select * into hdr from public.learning_decisions where id = new.decision_id;
  if exists (select 1 from public.learning_decision_events where decision_id = new.decision_id and kind = 'rejected') then
    raise exception 'a rejected decision takes no further events' using errcode = 'P0001';
  end if;
  if new.kind in ('approved', 'rejected') then
    if not exists (select 1 from public.learning_decision_events where decision_id = new.decision_id and kind = 'decided' and payload->>'decision' = 'change') then
      raise exception 'only a decision to change awaits approval' using errcode = 'P0001';
    end if;
  elsif new.kind = 'implemented' then
    if not exists (select 1 from public.learning_decision_events where decision_id = new.decision_id and kind = 'decided' and payload->>'decision' = 'change') then
      raise exception 'no decision to change is recorded' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.learning_decision_events where decision_id = new.decision_id and kind = 'approved' and lower(actor) = lower(hdr.primary_approver)) then
      raise exception 'the primary approver has not approved' using errcode = 'P0001';
    end if;
    if hdr.second_approver_required then
      select count(distinct lower(actor)) into approvers from public.learning_decision_events
        where decision_id = new.decision_id and kind = 'approved' and lower(actor) <> lower(hdr.primary_approver);
      if approvers < 1 then raise exception 'a second, different approver is required for this change' using errcode = 'P0001'; end if;
    end if;
  elsif new.kind = 'rolled_back' then
    if not exists (select 1 from public.learning_decision_events where decision_id = new.decision_id and kind = 'implemented') then
      raise exception 'only an implemented change can be rolled back' using errcode = 'P0001';
    end if;
  elsif new.kind = 'outcome_checked' then
    if not exists (select 1 from public.learning_decision_events where decision_id = new.decision_id and kind in ('implemented', 'rolled_back')) then
      raise exception 'an outcome check needs an implemented or rolled-back version' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists learning_decisions_immutable on public.learning_decisions;
create trigger learning_decisions_immutable before update or delete on public.learning_decisions for each row execute function public.learning_decisions_guard();
drop trigger if exists learning_decision_events_guard on public.learning_decision_events;
create trigger learning_decision_events_guard before insert or update or delete on public.learning_decision_events for each row execute function public.learning_decisions_guard();

alter table public.learning_decisions enable row level security;       alter table public.learning_decisions force row level security;
alter table public.learning_decision_events enable row level security; alter table public.learning_decision_events force row level security;
revoke all on public.learning_decisions, public.learning_decision_events from public, anon, authenticated;
grant select, insert on public.learning_decisions, public.learning_decision_events to service_role;
-- Default privileges may have granted more: take update, delete and truncate back, so append-only holds at the privilege level as well as in the trigger.
revoke update, delete, truncate on public.learning_decisions, public.learning_decision_events from service_role;
revoke all on function public.learning_decisions_guard() from public, anon, authenticated;
drop policy if exists "service role full access" on public.learning_decisions;
create policy "service role full access" on public.learning_decisions for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.learning_decision_events;
create policy "service role full access" on public.learning_decision_events for all to service_role using (true) with check (true);
