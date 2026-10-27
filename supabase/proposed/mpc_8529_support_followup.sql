-- MPC-8529: bounded support follow-up watchdog, built on the MPC-8528 case table (supabase/proposed/mpc_8528_support_cases.sql).
--
-- PROPOSED, NOT APPLIED TO PRODUCTION. Lives in supabase/proposed/ (not read by deploy-supabase.yml); tested on a throwaway
-- database by supabase/tests/run.sh. Moving it to supabase/migrations/, and scheduling the sweep (bottom of file), are
-- production actions that need approval. Apply after mpc_8528_support_cases.sql (file name sorts after it).
--
-- Design: the case STATE stays in support_cases (MPC-8528 owns it). This file adds only scheduling and attempt history,
-- keyed by support_cases.id, and moves a case only along MPC-8528's own transition table (mirrored in
-- support_followup_can_move; src/lib/supportFollowup.test.ts fails if it drifts from shared/support/states.ts).
--
-- Mapping of follow-up outcomes onto MPC-8528 states (there is no 'exhausted' or 'delivery_failed' state in MPC-8528):
--   promised update / send failed or unconfirmed  -> waiting_system, state_reason 'update_scheduled' / 'reply_delivery_failed'
--   receipt-confirmed delivery                    -> waiting_customer
--   retries exhausted                             -> blocked, state_reason 'followup_exhausted'  (honest "unresolved")
--   verified outcome                              -> resolved;  customer reply on resolved/closed/blocked -> reopened
-- Rules: an update is promised only once next_update_due_at is committed; 'attempted' is not delivered; attempts carry an
-- idempotency key; work is claimed under a lease (FOR UPDATE SKIP LOCKED); attempts are bounded; customer silence never
-- resolves or closes a case; resolution needs a verification step; no personal data is stored here.
--
-- Provisional numbers pending MPC-8530 approval: backoff 15 min, 1 h, 6 h; max_attempts 3.
-- Rollback: select cron.unschedule('mpt-support-followup-sweep');  full removal: drop the objects below in reverse order.

create table if not exists public.support_followup (
  case_id uuid primary key references public.support_cases (id) on delete cascade,
  next_action_kind text,
  next_action_at timestamptz,
  next_update_due_at timestamptz,
  resolution_proposed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_attempt_at timestamptz,
  lock_owner text,
  lock_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists support_followup_due_idx on public.support_followup (next_action_at) where next_action_at is not null;

create table if not exists public.support_followup_attempt (
  idempotency_key text primary key check (char_length(idempotency_key) between 1 and 128),
  case_id uuid not null references public.support_cases (id) on delete cascade,
  message_id uuid references public.support_messages (id) on delete set null,
  kind text not null,
  outcome text not null check (outcome in ('attempted', 'delivered', 'failed')),
  receipt_ref text,
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz
);

comment on table public.support_followup is 'MPC-8529 proposed. Scheduling for a support case; the case state itself stays in support_cases. No personal data. service_role only.';
alter table public.support_followup enable row level security;         alter table public.support_followup force row level security;
alter table public.support_followup_attempt enable row level security; alter table public.support_followup_attempt force row level security;
revoke all on public.support_followup, public.support_followup_attempt from anon, authenticated;
grant all on public.support_followup, public.support_followup_attempt to service_role;

-- MPC-8528's transition table (shared/support/states.ts NEXT), plus "stay in the same state".
create or replace function public.support_followup_can_move(p_from text, p_to text) returns boolean
language sql immutable as $$
  select p_from = p_to or exists (
    select 1 from (values
      ('new','triage'),('new','waiting_system'),('new','blocked'),
      ('triage','diagnosing'),('triage','waiting_customer'),('triage','waiting_system'),('triage','resolved'),('triage','blocked'),
      ('diagnosing','action_running'),('diagnosing','waiting_customer'),('diagnosing','waiting_system'),('diagnosing','resolved'),('diagnosing','blocked'),
      ('action_running','diagnosing'),('action_running','waiting_customer'),('action_running','waiting_system'),('action_running','resolved'),('action_running','blocked'),
      ('waiting_customer','triage'),('waiting_customer','diagnosing'),('waiting_customer','waiting_system'),('waiting_customer','resolved'),('waiting_customer','closed'),('waiting_customer','blocked'),
      ('waiting_system','triage'),('waiting_system','diagnosing'),('waiting_system','waiting_customer'),('waiting_system','resolved'),('waiting_system','blocked'),
      ('resolved','closed'),('resolved','reopened'),
      ('closed','reopened'),
      ('reopened','triage'),('reopened','diagnosing'),('reopened','waiting_customer'),('reopened','waiting_system'),('reopened','resolved'),('reopened','blocked'),
      ('blocked','triage'),('blocked','reopened'),('blocked','resolved')
    ) t(f, t) where t.f = p_from and t.t = p_to)
$$;

-- Proposed backoff; mirrored by src/lib/supportFollowup.ts (a test keeps them equal).
create or replace function public.support_followup_backoff(p_failures integer) returns interval
language sql immutable as $$
  select case when p_failures <= 1 then interval '15 minutes' when p_failures = 2 then interval '1 hour' else interval '6 hours' end
$$;

-- Move a case along MPC-8528's own transitions only. Raises on an illegal move.
create or replace function public.support_followup_move(p_case uuid, p_to text, p_reason text) returns void
language plpgsql set search_path = public as $$
declare v_from text;
begin
  select state into v_from from public.support_cases where id = p_case for update;
  if v_from is null then raise exception 'unknown case %', p_case; end if;
  if not public.support_followup_can_move(v_from, p_to) then raise exception 'illegal case transition % -> %', v_from, p_to; end if;
  update public.support_cases set state = p_to, state_reason = p_reason, updated_at = now() where id = p_case;
end $$;

create or replace function public.support_followup_ensure(p_case uuid) returns void
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.support_cases where id = p_case) then raise exception 'unknown case %', p_case; end if;
  insert into public.support_followup (case_id, next_action_kind, next_action_at) values (p_case, 'first_response', now()) on conflict (case_id) do nothing;
end $$;

-- Register a case for follow-up. Idempotent.
create or replace function public.support_followup_open(p_case uuid) returns void
language sql set search_path = public as $$ select public.support_followup_ensure(p_case) $$;

-- Promise an update only by committing its due time. Returns the committed due time (what the customer may be told).
create or replace function public.support_followup_schedule_update(p_case uuid, p_due timestamptz) returns timestamptz
language plpgsql set search_path = public as $$
declare v_state text; v_due timestamptz;
begin
  if p_due <= now() then raise exception 'update due time must be in the future'; end if;
  perform public.support_followup_ensure(p_case);
  select state into v_state from public.support_cases where id = p_case;
  if v_state in ('resolved', 'closed', 'blocked') then raise exception 'cannot promise an update on a % case', v_state; end if;
  perform public.support_followup_move(p_case, 'waiting_system', 'update_scheduled');
  update public.support_followup set next_update_due_at = p_due, next_action_at = p_due, next_action_kind = 'update', attempt_count = 0, updated_at = now()
   where case_id = p_case returning next_update_due_at into v_due;
  return v_due;
end $$;

-- Claim due work under a lease. A second worker cannot take a leased case; an expired lease can be reclaimed.
create or replace function public.support_followup_claim_due(p_owner text, p_limit integer default 10, p_lease_seconds integer default 300)
returns setof public.support_followup
language plpgsql set search_path = public as $$
begin
  return query
  with due as (
    select f.case_id from public.support_followup f join public.support_cases c on c.id = f.case_id
     where f.next_action_at is not null and f.next_action_at <= now()
       and c.state not in ('resolved', 'closed', 'blocked')
       and (f.lock_expires_at is null or f.lock_expires_at < now())
     order by f.next_action_at limit greatest(p_limit, 0)
     for update of f skip locked)
  update public.support_followup f
     set lock_owner = p_owner, lock_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    from due where f.case_id = due.case_id
  returning f.*;
end $$;

-- Record an outbound attempt. Returns 'recorded', 'duplicate' (same idempotency key) or 'terminal' (resolved / closed / blocked).
-- 'delivered' resets the failure count; 'attempted' (sent, no receipt) and 'failed' both count towards the bound.
-- support_messages.delivery uses MPC-8528's values: failed -> 'failed', attempted -> 'unknown', delivered -> 'sent'.
create or replace function public.support_followup_record_attempt(
  p_case uuid, p_key text, p_kind text, p_outcome text, p_receipt text default null, p_message uuid default null) returns text
language plpgsql set search_path = public as $$
declare v_state text; v_count integer; v_max integer; v_inserted integer;
begin
  perform public.support_followup_ensure(p_case);
  select state into v_state from public.support_cases where id = p_case for update;
  if v_state in ('resolved', 'closed', 'blocked') then return 'terminal'; end if;
  select attempt_count, max_attempts into v_count, v_max from public.support_followup where case_id = p_case for update;

  insert into public.support_followup_attempt (idempotency_key, case_id, message_id, kind, outcome, receipt_ref, delivered_at)
  values (p_key, p_case, p_message, p_kind, p_outcome, p_receipt, case when p_outcome = 'delivered' then now() end)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  if p_message is not null then
    update public.support_messages set delivery = case p_outcome when 'delivered' then 'sent' when 'failed' then 'failed' else 'unknown' end
     where id = p_message and case_id = p_case and direction = 'outbound';
  end if;

  if p_outcome = 'delivered' then
    if v_state = 'new' then perform public.support_followup_move(p_case, 'triage', null); end if;
    perform public.support_followup_move(p_case, 'waiting_customer', null);
    update public.support_followup set attempt_count = 0, last_attempt_at = now(), lock_owner = null, lock_expires_at = null,
           next_action_at = null, next_action_kind = null, updated_at = now() where case_id = p_case;
  elsif v_count + 1 >= v_max then
    perform public.support_followup_move(p_case, 'blocked', 'followup_exhausted');
    update public.support_followup set attempt_count = v_count + 1, last_attempt_at = now(), lock_owner = null, lock_expires_at = null,
           next_action_at = null, next_action_kind = null, updated_at = now() where case_id = p_case;
  else
    perform public.support_followup_move(p_case, 'waiting_system', 'reply_delivery_failed');
    update public.support_followup set attempt_count = v_count + 1, last_attempt_at = now(), lock_owner = null, lock_expires_at = null,
           next_action_at = now() + public.support_followup_backoff(v_count + 1), updated_at = now() where case_id = p_case;
  end if;
  return 'recorded';
end $$;

-- A provider receipt arrived for an earlier 'attempted' or 'failed' attempt: now (and only now) it counts as delivered.
create or replace function public.support_followup_mark_delivered(p_key text, p_receipt text) returns boolean
language plpgsql set search_path = public as $$
declare v_case uuid; v_msg uuid; v_state text;
begin
  update public.support_followup_attempt set outcome = 'delivered', receipt_ref = p_receipt, delivered_at = now()
   where idempotency_key = p_key and outcome <> 'delivered' returning case_id, message_id into v_case, v_msg;
  if v_case is null then return false; end if;
  if v_msg is not null then update public.support_messages set delivery = 'sent' where id = v_msg; end if;
  select state into v_state from public.support_cases where id = v_case for update;
  if v_state in ('waiting_system', 'reopened', 'triage', 'diagnosing', 'action_running') then
    perform public.support_followup_move(v_case, 'waiting_customer', null);
    update public.support_followup set attempt_count = 0, next_action_at = null, next_action_kind = null, lock_owner = null, lock_expires_at = null, updated_at = now() where case_id = v_case;
  end if;
  return true;
end $$;

-- Propose a resolution, then verify it. Verification must come from a re-run diagnostic, never from silence.
create or replace function public.support_followup_propose_resolution(p_case uuid) returns void
language plpgsql set search_path = public as $$
begin
  perform public.support_followup_ensure(p_case);
  if (select state from public.support_cases where id = p_case) in ('resolved', 'closed') then raise exception 'case already finished'; end if;
  update public.support_followup set resolution_proposed_at = now(), next_action_at = null, next_action_kind = 'verify_resolution', updated_at = now() where case_id = p_case;
end $$;

create or replace function public.support_followup_verify_resolution(p_case uuid, p_outcome_verified boolean) returns text
language plpgsql set search_path = public as $$
declare v_proposed timestamptz; v_state text;
begin
  select resolution_proposed_at into v_proposed from public.support_followup where case_id = p_case for update;
  select state into v_state from public.support_cases where id = p_case;
  if v_proposed is null then raise exception 'case % has no proposed resolution to verify', p_case; end if;
  if p_outcome_verified then
    perform public.support_followup_move(p_case, 'resolved', null);
    update public.support_followup set resolution_proposed_at = null, next_action_at = null, next_action_kind = null, updated_at = now() where case_id = p_case;
    return 'resolved';
  end if;
  perform public.support_followup_move(p_case,
    case when public.support_followup_can_move(v_state, 'diagnosing') then 'diagnosing' else 'triage' end, 'verification_failed');
  update public.support_followup set resolution_proposed_at = null, attempt_count = 0, next_action_at = now(), next_action_kind = 'diagnose', updated_at = now() where case_id = p_case;
  return 'reopened_work';
end $$;

-- A customer reply. Reopens finished or exhausted cases (history kept); wakes a case that was waiting for the customer.
-- MPC-8528 intake may already have reopened the case; then this only makes sure follow-up is scheduled.
create or replace function public.support_followup_customer_reply(p_case uuid) returns text
language plpgsql set search_path = public as $$
declare v_state text; v_result text := 'recorded';
begin
  perform public.support_followup_ensure(p_case);
  select state into v_state from public.support_cases where id = p_case for update;
  if v_state in ('resolved', 'closed', 'blocked') then
    perform public.support_followup_move(p_case, 'reopened', 'customer_reply');
    update public.support_cases set reopen_count = reopen_count + 1 where id = p_case;
    v_result := 'reopened';
  elsif v_state = 'waiting_customer' then
    perform public.support_followup_move(p_case, 'triage', 'customer_reply');
  elsif v_state <> 'reopened' then
    return v_result;
  end if;
  update public.support_followup set attempt_count = 0, resolution_proposed_at = null, next_action_at = now(), next_action_kind = 'respond', updated_at = now() where case_id = p_case;
  return v_result;
end $$;

-- Watchdog sweep: rescue orphans (active case with nothing scheduled) and release expired leases (worker died).
-- It NEVER resolves or closes a case, and leaves waiting_customer alone (silence is not a reason to act). Returns counts only.
create or replace function public.support_followup_sweep() returns table (orphans_rescued integer, leases_released integer)
language plpgsql set search_path = public as $$
declare v_orphans integer; v_leases integer; v_new integer;
begin
  insert into public.support_followup (case_id, next_action_kind, next_action_at)
  select c.id, 'respond', now() from public.support_cases c
   where c.state in ('new', 'triage', 'diagnosing', 'action_running', 'waiting_system', 'reopened')
     and not exists (select 1 from public.support_followup f where f.case_id = c.id)
  on conflict (case_id) do nothing;
  get diagnostics v_new = row_count;
  update public.support_followup f set next_action_at = now(), next_action_kind = coalesce(f.next_action_kind, 'respond'), updated_at = now()
    from public.support_cases c
   where c.id = f.case_id and f.next_action_at is null and f.resolution_proposed_at is null
     and c.state in ('new', 'triage', 'diagnosing', 'action_running', 'waiting_system', 'reopened');
  get diagnostics v_orphans = row_count;
  update public.support_followup set lock_owner = null, lock_expires_at = null, updated_at = now() where lock_owner is not null and lock_expires_at < now();
  get diagnostics v_leases = row_count;
  return query select v_orphans + v_new, v_leases;
end $$;

-- Aggregate, personal-data-free metrics. Definitions: docs/support-followup-watchdog-mpc-8529-prep.md section 7.
create or replace view public.support_followup_metrics as
select
  count(*) filter (where c.state not in ('resolved', 'closed'))                                          as unresolved_cases,
  count(*) filter (where f.next_action_at is not null and f.next_action_at < now() - interval '15 minutes'
                     and (f.lock_expires_at is null or f.lock_expires_at < now()))                         as overdue_actions,
  count(*) filter (where c.state = 'blocked' and c.state_reason = 'followup_exhausted')                    as retry_exhausted,
  count(*) filter (where c.state = 'waiting_system' and c.state_reason = 'reply_delivery_failed')          as delivery_failing,
  count(*) filter (where c.reopen_count > 0)                                                               as reopened_cases,
  count(*) filter (where c.state in ('resolved', 'closed'))                                                as resolved_cases,
  coalesce(max(extract(epoch from now() - c.created_at)) filter (where c.state not in ('resolved', 'closed')), 0)::bigint as oldest_open_age_seconds
from public.support_cases c left join public.support_followup f on f.case_id = c.id;
revoke all on public.support_followup_metrics from anon, authenticated;
grant select on public.support_followup_metrics to service_role;

revoke all on function
  public.support_followup_can_move(text, text), public.support_followup_backoff(integer), public.support_followup_move(uuid, text, text),
  public.support_followup_ensure(uuid), public.support_followup_open(uuid), public.support_followup_schedule_update(uuid, timestamptz),
  public.support_followup_claim_due(text, integer, integer), public.support_followup_record_attempt(uuid, text, text, text, text, uuid),
  public.support_followup_mark_delivered(text, text), public.support_followup_propose_resolution(uuid),
  public.support_followup_verify_resolution(uuid, boolean), public.support_followup_customer_reply(uuid), public.support_followup_sweep()
  from public, anon, authenticated;
grant execute on function
  public.support_followup_can_move(text, text), public.support_followup_backoff(integer), public.support_followup_move(uuid, text, text),
  public.support_followup_ensure(uuid), public.support_followup_open(uuid), public.support_followup_schedule_update(uuid, timestamptz),
  public.support_followup_claim_due(text, integer, integer), public.support_followup_record_attempt(uuid, text, text, text, text, uuid),
  public.support_followup_mark_delivered(text, text), public.support_followup_propose_resolution(uuid),
  public.support_followup_verify_resolution(uuid, boolean), public.support_followup_customer_reply(uuid), public.support_followup_sweep()
  to service_role;

-- PROPOSED SCHEDULE: NOT ACTIVE. Needs approval, and a delivery worker that calls claim_due / record_attempt (MPC-8532 Notifier adapters).
-- Skipped where pg_cron is not installed (local test databases), same pattern as mpt-purge-conversation-state.
--
-- do $$ begin
--   if exists (select 1 from pg_extension where extname = 'pg_cron') then
--     perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-support-followup-sweep';
--     perform cron.schedule('mpt-support-followup-sweep', '*/5 * * * *', 'select * from public.support_followup_sweep();');
--   end if;
-- end $$;
