-- MPC-8529: bounded support follow-up watchdog (PROVISIONAL CONTRACT, NOT APPLIED TO PRODUCTION).
--
-- Status: built and isolated-tested only. It is deliberately NOT in supabase/migrations/ (deploy-supabase.yml pushes that
-- folder to production). Applying it to production, and scheduling the sweep (bottom of file), need explicit approval.
--
-- Provisional because MPC-8528 (durable case schema) and MPC-8530 (approved retry / cost policy) are not delivered.
-- `case_ref` stands in for the MPC-8528 case reference; the backoff (15 min, 1 h, 6 h) and max_attempts = 3 are PROPOSALS.
-- If MPC-8528 lands a different schema, re-point case_ref at it and re-run supabase/tests/support-followup.test.sql.
--
-- Rules enforced here (see docs/support-followup-watchdog-mpc-8529-prep.md):
--   * an update is promised only once next_update_due_at is committed (support_followup_schedule_update)
--   * 'attempted' is not 'delivered': only a receipt (support_followup_mark_delivered) counts as delivered
--   * every outbound attempt has an idempotency key; a retry with the same key is a no-op
--   * work is claimed under a lease (FOR UPDATE SKIP LOCKED), so two workers never take the same case
--   * attempts are bounded; the last failure lands in 'unresolved_exhausted' and stops retrying
--   * customer silence never resolves a case; resolution needs an outcome verification
--   * no personal data is stored here: case_ref and operational timestamps only
--
-- Rollback / disable: select cron.unschedule('mpt-support-followup-sweep');  (cases stay durable and visible as overdue)
--                     full removal: drop the objects at the bottom of this file in reverse order.

create table if not exists public.support_followup (
  case_ref text primary key check (length(case_ref) between 1 and 64),
  state text not null default 'open' check (state in (
    'open', 'waiting_customer', 'waiting_system', 'update_scheduled', 'resolution_proposed',
    'resolved_verified', 'unresolved_exhausted', 'delivery_failed', 'engineering_handoff', 'reopened')),
  next_action_kind text,
  next_action_at timestamptz,
  next_update_due_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_attempt_at timestamptz,
  lock_owner text,
  lock_expires_at timestamptz,
  reopened_count integer not null default 0 check (reopened_count >= 0),
  last_customer_activity_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.support_followup is
  'MPC-8529 provisional follow-up scheduling per support case. No personal data. service_role only.';

create table if not exists public.support_followup_attempt (
  idempotency_key text primary key check (length(idempotency_key) between 1 and 128),
  case_ref text not null references public.support_followup(case_ref) on delete cascade,
  kind text not null,
  outcome text not null check (outcome in ('attempted', 'delivered', 'failed')),
  receipt_ref text,
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists support_followup_due_idx on public.support_followup (next_action_at) where next_action_at is not null;

alter table public.support_followup enable row level security;
alter table public.support_followup force row level security;
alter table public.support_followup_attempt enable row level security;
alter table public.support_followup_attempt force row level security;
revoke all on public.support_followup, public.support_followup_attempt from anon, authenticated;
grant all on public.support_followup, public.support_followup_attempt to service_role;

-- Proposed backoff; mirrored by src/lib/supportFollowup.ts (a test keeps them equal).
create or replace function public.support_followup_backoff(p_failures integer) returns interval
language sql immutable as $$
  select case when p_failures <= 1 then interval '15 minutes'
              when p_failures = 2 then interval '1 hour'
              else interval '6 hours' end
$$;

-- Register a case for follow-up. Idempotent: an existing case is left unchanged.
create or replace function public.support_followup_open(p_case_ref text) returns void
language sql as $$
  insert into public.support_followup (case_ref, state, next_action_kind, next_action_at)
  values (p_case_ref, 'open', 'first_response', now())
  on conflict (case_ref) do nothing
$$;

-- Promise an update only by committing its due time. Returns the committed due time (what the customer may be told).
create or replace function public.support_followup_schedule_update(p_case_ref text, p_due timestamptz) returns timestamptz
language plpgsql as $$
declare v_due timestamptz;
begin
  if p_due <= now() then raise exception 'update due time must be in the future'; end if;
  update public.support_followup
     set next_update_due_at = p_due, next_action_at = p_due, next_action_kind = 'update',
         state = case when state in ('resolved_verified', 'unresolved_exhausted') then state else 'update_scheduled' end,
         attempt_count = 0, updated_at = now()
   where case_ref = p_case_ref
  returning next_update_due_at into v_due;
  if v_due is null then raise exception 'unknown case %', p_case_ref; end if;
  return v_due;
end $$;

-- Claim due work under a lease. A second worker cannot take a leased case; an expired lease can be reclaimed.
create or replace function public.support_followup_claim_due(p_owner text, p_limit integer default 10, p_lease_seconds integer default 300)
returns setof public.support_followup
language plpgsql as $$
begin
  return query
  with due as (
    select case_ref from public.support_followup
     where next_action_at is not null and next_action_at <= now()
       and state not in ('resolved_verified', 'unresolved_exhausted')
       and (lock_expires_at is null or lock_expires_at < now())
     order by next_action_at
     limit greatest(p_limit, 0)
     for update skip locked)
  update public.support_followup f
     set lock_owner = p_owner, lock_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    from due where f.case_ref = due.case_ref
  returning f.*;
end $$;

-- Record an outbound attempt. Returns 'recorded', 'duplicate' (same idempotency key) or 'terminal' (case already finished).
-- 'delivered' resets the failure count; 'attempted' (sent, no receipt) and 'failed' both count towards the bound.
create or replace function public.support_followup_record_attempt(
  p_case_ref text, p_key text, p_kind text, p_outcome text, p_receipt text default null) returns text
language plpgsql as $$
declare v public.support_followup%rowtype; v_inserted integer;
begin
  select * into v from public.support_followup where case_ref = p_case_ref for update;
  if not found then raise exception 'unknown case %', p_case_ref; end if;
  if v.state in ('resolved_verified', 'unresolved_exhausted') then return 'terminal'; end if;

  insert into public.support_followup_attempt (idempotency_key, case_ref, kind, outcome, receipt_ref, delivered_at)
  values (p_key, p_case_ref, p_kind, p_outcome, p_receipt, case when p_outcome = 'delivered' then now() end)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  if p_outcome = 'delivered' then
    update public.support_followup
       set attempt_count = 0, last_attempt_at = now(), lock_owner = null, lock_expires_at = null,
           next_action_at = null, next_action_kind = null,
           state = case when state = 'resolution_proposed' then state else 'waiting_customer' end, updated_at = now()
     where case_ref = p_case_ref;
  elsif v.attempt_count + 1 >= v.max_attempts then
    update public.support_followup
       set attempt_count = v.attempt_count + 1, last_attempt_at = now(), lock_owner = null, lock_expires_at = null,
           next_action_at = null, next_action_kind = null, state = 'unresolved_exhausted', updated_at = now()
     where case_ref = p_case_ref;
  else
    update public.support_followup
       set attempt_count = v.attempt_count + 1, last_attempt_at = now(), lock_owner = null, lock_expires_at = null,
           next_action_at = now() + public.support_followup_backoff(v.attempt_count + 1), state = 'delivery_failed', updated_at = now()
     where case_ref = p_case_ref;
  end if;
  return 'recorded';
end $$;

-- A provider receipt arrived for an earlier 'attempted' or 'failed' attempt: now (and only now) it counts as delivered.
create or replace function public.support_followup_mark_delivered(p_key text, p_receipt text) returns boolean
language plpgsql as $$
declare v_case text;
begin
  update public.support_followup_attempt
     set outcome = 'delivered', receipt_ref = p_receipt, delivered_at = now()
   where idempotency_key = p_key and outcome <> 'delivered'
  returning case_ref into v_case;
  if v_case is null then return false; end if;
  update public.support_followup
     set attempt_count = 0, next_action_at = null, next_action_kind = null, lock_owner = null, lock_expires_at = null,
         state = case when state in ('delivery_failed', 'update_scheduled', 'open', 'reopened') then 'waiting_customer' else state end,
         updated_at = now()
   where case_ref = v_case and state not in ('resolved_verified', 'unresolved_exhausted');
  return true;
end $$;

-- Propose a resolution, then verify it. Verification must come from a re-run diagnostic, never from silence.
create or replace function public.support_followup_propose_resolution(p_case_ref text) returns void
language sql as $$
  update public.support_followup set state = 'resolution_proposed', next_action_at = null, next_action_kind = null, updated_at = now()
   where case_ref = p_case_ref and state not in ('resolved_verified', 'unresolved_exhausted')
$$;

create or replace function public.support_followup_verify_resolution(p_case_ref text, p_outcome_verified boolean) returns text
language plpgsql as $$
declare v_state text;
begin
  select state into v_state from public.support_followup where case_ref = p_case_ref for update;
  if v_state is distinct from 'resolution_proposed' then raise exception 'case % is not awaiting verification (state %)', p_case_ref, v_state; end if;
  if p_outcome_verified then
    update public.support_followup set state = 'resolved_verified', resolved_at = now(), next_action_at = null, next_action_kind = null, updated_at = now() where case_ref = p_case_ref;
    return 'resolved_verified';
  end if;
  update public.support_followup set state = 'open', attempt_count = 0, next_action_at = now(), next_action_kind = 'diagnose', updated_at = now() where case_ref = p_case_ref;
  return 'open';
end $$;

-- A customer reply. Reopens finished cases (history kept); otherwise just records activity.
create or replace function public.support_followup_customer_reply(p_case_ref text) returns text
language plpgsql as $$
declare v_state text;
begin
  select state into v_state from public.support_followup where case_ref = p_case_ref for update;
  if v_state is null then raise exception 'unknown case %', p_case_ref; end if;
  if v_state in ('resolved_verified', 'unresolved_exhausted') then
    update public.support_followup
       set state = 'reopened', reopened_count = reopened_count + 1, attempt_count = 0, resolved_at = null,
           next_action_at = now(), next_action_kind = 'first_response', last_customer_activity_at = now(), updated_at = now()
     where case_ref = p_case_ref;
    return 'reopened';
  end if;
  update public.support_followup
     set state = case when state = 'waiting_customer' then 'open' else state end,
         next_action_at = case when state = 'waiting_customer' then now() else next_action_at end,
         next_action_kind = case when state = 'waiting_customer' then 'respond' else next_action_kind end,
         last_customer_activity_at = now(), updated_at = now()
   where case_ref = p_case_ref;
  return 'recorded';
end $$;

-- Watchdog sweep: rescue orphans (active case, nothing scheduled) and release expired leases (worker died).
-- It NEVER closes or resolves a case. Returns counts only.
create or replace function public.support_followup_sweep() returns table (orphans_rescued integer, leases_released integer)
language plpgsql as $$
declare v_orphans integer; v_leases integer;
begin
  update public.support_followup
     set next_action_at = now(), next_action_kind = coalesce(next_action_kind, 'respond'), updated_at = now()
   where next_action_at is null and state in ('open', 'reopened', 'update_scheduled', 'delivery_failed', 'waiting_system', 'engineering_handoff');
  get diagnostics v_orphans = row_count;
  update public.support_followup set lock_owner = null, lock_expires_at = null, updated_at = now()
   where lock_owner is not null and lock_expires_at < now();
  get diagnostics v_leases = row_count;
  return query select v_orphans, v_leases;
end $$;

-- Aggregate, personal-data-free metrics. Definitions: docs/support-followup-watchdog-mpc-8529-prep.md section 7.
create or replace view public.support_followup_metrics as
select
  count(*) filter (where state not in ('resolved_verified'))                                   as unresolved_cases,
  count(*) filter (where next_action_at is not null and next_action_at < now() - interval '15 minutes'
                     and (lock_expires_at is null or lock_expires_at < now()))                  as overdue_actions,
  count(*) filter (where state = 'unresolved_exhausted')                                       as retry_exhausted,
  count(*) filter (where state = 'delivery_failed')                                            as delivery_failing,
  count(*) filter (where reopened_count > 0)                                                   as reopened_cases,
  count(*) filter (where state = 'resolved_verified')                                          as resolved_verified,
  coalesce(max(extract(epoch from now() - created_at)) filter (where state <> 'resolved_verified'), 0)::bigint as oldest_open_age_seconds
from public.support_followup;
revoke all on public.support_followup_metrics from anon, authenticated;
grant select on public.support_followup_metrics to service_role;

revoke all on function
  public.support_followup_open(text), public.support_followup_schedule_update(text, timestamptz),
  public.support_followup_claim_due(text, integer, integer), public.support_followup_record_attempt(text, text, text, text, text),
  public.support_followup_mark_delivered(text, text), public.support_followup_propose_resolution(text),
  public.support_followup_verify_resolution(text, boolean), public.support_followup_customer_reply(text),
  public.support_followup_sweep() from public, anon, authenticated;
grant execute on function
  public.support_followup_open(text), public.support_followup_schedule_update(text, timestamptz),
  public.support_followup_claim_due(text, integer, integer), public.support_followup_record_attempt(text, text, text, text, text),
  public.support_followup_mark_delivered(text, text), public.support_followup_propose_resolution(text),
  public.support_followup_verify_resolution(text, boolean), public.support_followup_customer_reply(text),
  public.support_followup_sweep() to service_role;

-- PROPOSED SCHEDULE: NOT ACTIVE. Needs approval, and a delivery worker that calls claim_due / record_attempt (MPC-8528 adapters).
-- Skipped where pg_cron is not installed (local test databases), same pattern as mpt-purge-conversation-state.
--
-- do $$ begin
--   if exists (select 1 from pg_extension where extname = 'pg_cron') then
--     perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-support-followup-sweep';
--     perform cron.schedule('mpt-support-followup-sweep', '*/5 * * * *', 'select * from public.support_followup_sweep();');
--   end if;
-- end $$;
