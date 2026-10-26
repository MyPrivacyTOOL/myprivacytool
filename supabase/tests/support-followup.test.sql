-- MPC-8529: assertions for the provisional support follow-up watchdog (supabase/sql/mpc-8529-support-followup.sql).
-- Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and the file rolls back. Throwaway database only.
-- Note: now() is fixed inside one transaction, so time passing is simulated by editing the stored timestamps.
begin;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;
create or replace function pg_temp.st(c text) returns text language sql as $$ select state from public.support_followup where case_ref = c $$;

-- ===== closed to anon / authenticated, open to service_role; RLS forced =====
do $$
declare t text;
begin
  foreach t in array array['support_followup', 'support_followup_attempt'] loop
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon denied');
    perform pg_temp.assert(pg_temp.try_as('authenticated', format('select 1 from public.%I', t)) = '42501', t || ': authenticated denied');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role reads');
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS enabled and forced');
  end loop;
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select public.support_followup_sweep()') = '42501', 'sweep not callable by authenticated');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select public.support_followup_open('x')$q$) = '42501', 'open not callable by anon');
end $$;

-- ===== backoff is bounded and increasing: 15 min, 1 h, 6 h =====
select pg_temp.assert(public.support_followup_backoff(1) = interval '15 minutes'
  and public.support_followup_backoff(2) = interval '1 hour'
  and public.support_followup_backoff(3) = interval '6 hours', 'backoff schedule');

-- ===== open is idempotent =====
select public.support_followup_open('C-1');
select public.support_followup_open('C-1');
select pg_temp.assert((select count(*) from public.support_followup where case_ref = 'C-1') = 1, 'open is idempotent');
select pg_temp.assert(pg_temp.st('C-1') = 'open', 'new case is open');

-- ===== an update is only promised once its due time is committed =====
select pg_temp.assert(pg_temp.try_as('service_role', $q$select public.support_followup_schedule_update('C-1', now() - interval '1 minute')$q$) <> '', 'cannot schedule an update in the past');
select public.support_followup_schedule_update('C-1', now() + interval '2 hours') as due \gset
select pg_temp.assert(:'due'::timestamptz = (select next_update_due_at from public.support_followup where case_ref = 'C-1'), 'schedule returns the committed due time');
select pg_temp.assert(pg_temp.st('C-1') = 'update_scheduled', 'state is update_scheduled');
select pg_temp.assert(pg_temp.try_as('service_role', $q$select public.support_followup_schedule_update('NOPE', now() + interval '1 hour')$q$) <> '', 'unknown case cannot get a promise');

-- ===== lease: a second worker cannot take a leased case; expired lease is reclaimable =====
update public.support_followup set next_action_at = now() where case_ref = 'C-1';
select pg_temp.assert((select count(*) from public.support_followup_claim_due('worker-a', 10, 300)) = 1, 'worker-a claims the due case');
select pg_temp.assert((select count(*) from public.support_followup_claim_due('worker-b', 10, 300)) = 0, 'worker-b cannot take a leased case');
update public.support_followup set lock_expires_at = now() - interval '1 second' where case_ref = 'C-1';
select pg_temp.assert((select lock_owner from public.support_followup_claim_due('worker-b', 10, 300)) = 'worker-b', 'expired lease is reclaimed by worker-b');

-- ===== failures back off, are bounded, then land in unresolved_exhausted; no endless loop =====
select pg_temp.assert(public.support_followup_record_attempt('C-1', 'k1', 'update', 'failed') = 'recorded', 'attempt 1 recorded');
select pg_temp.assert(pg_temp.st('C-1') = 'delivery_failed', 'failed attempt -> delivery_failed (not delivered)');
select pg_temp.assert((select next_action_at from public.support_followup where case_ref = 'C-1') = now() + interval '15 minutes', 'first retry after 15 minutes');
select pg_temp.assert(public.support_followup_record_attempt('C-1', 'k1', 'update', 'failed') = 'duplicate', 'same idempotency key is a no-op');
select pg_temp.assert((select attempt_count from public.support_followup where case_ref = 'C-1') = 1, 'duplicate did not count twice');
select pg_temp.assert(public.support_followup_record_attempt('C-1', 'k2', 'update', 'failed') = 'recorded', 'attempt 2');
select pg_temp.assert((select next_action_at from public.support_followup where case_ref = 'C-1') = now() + interval '1 hour', 'second retry after 1 hour');
select pg_temp.assert(public.support_followup_record_attempt('C-1', 'k3', 'update', 'attempted') = 'recorded', 'attempt 3 (sent, no receipt) counts towards the bound');
select pg_temp.assert(pg_temp.st('C-1') = 'unresolved_exhausted', 'bound reached -> unresolved_exhausted');
select pg_temp.assert((select next_action_at from public.support_followup where case_ref = 'C-1') is null, 'exhausted case schedules nothing');
select pg_temp.assert(public.support_followup_record_attempt('C-1', 'k4', 'update', 'failed') = 'terminal', 'no further attempts on an exhausted case');
select pg_temp.assert((select count(*) from public.support_followup_claim_due('worker-a', 10, 300)) = 0, 'exhausted case is never claimed');
select pg_temp.assert((select count(*) from public.support_followup_attempt where case_ref = 'C-1') = 3, 'exactly 3 attempts stored');

-- ===== "attempted" is not "delivered" until a receipt arrives =====
select pg_temp.assert((select outcome from public.support_followup_attempt where idempotency_key = 'k3') = 'attempted', 'attempted stays attempted');
select pg_temp.assert((select delivered_at from public.support_followup_attempt where idempotency_key = 'k3') is null, 'no delivered_at without a receipt');
select public.support_followup_open('C-2');
select public.support_followup_record_attempt('C-2', 'd1', 'update', 'attempted');
select pg_temp.assert(pg_temp.st('C-2') = 'delivery_failed', 'attempted alone does not count as delivered');
select pg_temp.assert(public.support_followup_mark_delivered('d1', 'provider-receipt-1'), 'receipt marks the attempt delivered');
select pg_temp.assert(pg_temp.st('C-2') = 'waiting_customer', 'delivered -> waiting_customer');
select pg_temp.assert((select attempt_count from public.support_followup where case_ref = 'C-2') = 0, 'delivery resets the failure count');
select pg_temp.assert(not public.support_followup_mark_delivered('d1', 'again'), 'a second receipt for the same attempt is a no-op');
select pg_temp.assert(not public.support_followup_mark_delivered('no-such-key', 'x'), 'receipt for an unknown attempt changes nothing');

-- ===== customer silence never resolves or closes a case =====
update public.support_followup set created_at = now() - interval '90 days', updated_at = now() - interval '90 days', last_attempt_at = now() - interval '89 days' where case_ref = 'C-2';
select * from public.support_followup_sweep();
select pg_temp.assert(pg_temp.st('C-2') = 'waiting_customer', 'sweep does not resolve a silent customer case');
select pg_temp.assert((select resolved_at from public.support_followup where case_ref = 'C-2') is null, 'no resolved_at set by silence');

-- ===== watchdog: orphan rescue and expired-lease release =====
select public.support_followup_open('C-3');
update public.support_followup set next_action_at = null where case_ref = 'C-3';          -- orphan: active, nothing scheduled
update public.support_followup set lock_owner = 'dead-worker', lock_expires_at = now() - interval '1 hour' where case_ref = 'C-3';
select pg_temp.assert((select orphans_rescued from public.support_followup_sweep()) >= 1, 'orphan found');
select pg_temp.assert((select next_action_at from public.support_followup where case_ref = 'C-3') is not null, 'orphan rescheduled');
select pg_temp.assert((select lock_owner from public.support_followup where case_ref = 'C-3') is null, 'dead worker lease released');
select pg_temp.assert(pg_temp.st('C-3') = 'open', 'sweep leaves the state alone');

-- ===== resolution needs verification; failed verification reopens work; reply reopens a finished case =====
select public.support_followup_open('C-4');
select pg_temp.assert(pg_temp.try_as('service_role', $q$select public.support_followup_verify_resolution('C-4', true)$q$) <> '', 'cannot verify a case that was never proposed as resolved');
select public.support_followup_propose_resolution('C-4');
select pg_temp.assert(pg_temp.st('C-4') = 'resolution_proposed', 'proposed');
select pg_temp.assert(public.support_followup_verify_resolution('C-4', false) = 'open', 'failed verification returns the case to open');
select pg_temp.assert((select next_action_at from public.support_followup where case_ref = 'C-4') is not null, 'and schedules a new diagnostic');
select public.support_followup_propose_resolution('C-4');
select pg_temp.assert(public.support_followup_verify_resolution('C-4', true) = 'resolved_verified', 'verified outcome resolves');
select pg_temp.assert((select resolved_at from public.support_followup where case_ref = 'C-4') is not null, 'resolved_at set');
select pg_temp.assert(public.support_followup_customer_reply('C-4') = 'reopened', 'reply reopens a resolved case');
select pg_temp.assert(pg_temp.st('C-4') = 'reopened' and (select reopened_count from public.support_followup where case_ref = 'C-4') = 1, 'reopen counted, history kept');
select pg_temp.assert(public.support_followup_customer_reply('C-1') = 'reopened', 'reply also reopens an exhausted case');
select pg_temp.assert((select attempt_count from public.support_followup where case_ref = 'C-1') = 0, 'reopen resets the attempt bound');

-- ===== metrics: counts only, no case identifiers =====
select pg_temp.assert((select reopened_cases from public.support_followup_metrics) >= 2, 'metrics count reopened cases');
select pg_temp.assert((select resolved_verified from public.support_followup_metrics) = 0, 'metrics: reopened case is no longer resolved');
select pg_temp.assert((select count(*) from information_schema.columns where table_name = 'support_followup_metrics' and column_name = 'case_ref') = 0, 'metrics expose no case_ref');
select pg_temp.assert(pg_temp.try_as('anon', 'select * from public.support_followup_metrics') = '42501', 'metrics closed to anon');

rollback;
select 'OK: support follow-up assertions passed';
