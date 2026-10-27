-- MPC-8529: assertions for the follow-up watchdog (supabase/proposed/mpc_8529_support_followup.sql) on top of the MPC-8528
-- case table. Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and the file rolls back. Throwaway database only.
-- now() is fixed inside one transaction, so time passing is simulated by editing stored timestamps.
begin;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;
create or replace function pg_temp.mk(p_ref text, p_state text default 'new') returns uuid language sql as
  $$ insert into public.support_cases (ref, channel, policy_version, state) values (p_ref, 'web', 'unapproved-0', p_state) returning id $$;
create or replace function pg_temp.st(c uuid) returns text language sql as $$ select state from public.support_cases where id = c $$;
create or replace function pg_temp.why(c uuid) returns text language sql as $$ select state_reason from public.support_cases where id = c $$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as
  $$ begin execute stmt; return ''; exception when others then return sqlstate; end $$;

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
  perform pg_temp.assert(pg_temp.try_as('anon', 'select * from public.support_followup_metrics') = '42501', 'metrics closed to anon');
end $$;

-- ===== backoff is bounded and increasing; transition table matches MPC-8528 (spot checks; the full table is checked in vitest) =====
select pg_temp.assert(public.support_followup_backoff(1) = interval '15 minutes' and public.support_followup_backoff(2) = interval '1 hour'
  and public.support_followup_backoff(3) = interval '6 hours', 'backoff schedule');
select pg_temp.assert(public.support_followup_can_move('new', 'triage') and not public.support_followup_can_move('new', 'waiting_customer')
  and not public.support_followup_can_move('resolved', 'triage') and public.support_followup_can_move('blocked', 'reopened')
  and public.support_followup_can_move('waiting_system', 'waiting_system'), 'transition table spot checks');

-- ===== promise an update only by committing its due time =====
select pg_temp.mk('SUP-AAAAAAA2') as c1 \gset
select public.support_followup_open(:'c1');
select public.support_followup_open(:'c1');
select pg_temp.assert((select count(*) from public.support_followup where case_id = :'c1') = 1, 'open is idempotent');
select pg_temp.assert(pg_temp.err(format($q$select public.support_followup_schedule_update(%L, now() - interval '1 minute')$q$, :'c1')) <> '', 'cannot promise an update in the past');
select public.support_followup_schedule_update(:'c1', now() + interval '2 hours') as due \gset
select pg_temp.assert(:'due'::timestamptz = (select next_update_due_at from public.support_followup where case_id = :'c1'), 'schedule returns the committed due time');
select pg_temp.assert(pg_temp.st(:'c1') = 'waiting_system' and pg_temp.why(:'c1') = 'update_scheduled', 'case is waiting_system / update_scheduled');
select pg_temp.assert(pg_temp.err($q$select public.support_followup_schedule_update('00000000-0000-0000-0000-000000000000', now() + interval '1 hour')$q$) <> '', 'unknown case cannot get a promise');

-- ===== lease: second worker cannot take a leased case; expired lease is reclaimable =====
update public.support_followup set next_action_at = now() where case_id = :'c1';
select pg_temp.assert((select count(*) from public.support_followup_claim_due('worker-a', 100, 300) where case_id = :'c1') = 1, 'worker-a claims the due case');
select pg_temp.assert((select count(*) from public.support_followup_claim_due('worker-b', 100, 300) where case_id = :'c1') = 0, 'worker-b cannot take a leased case');
update public.support_followup set lock_expires_at = now() - interval '1 second' where case_id = :'c1';
select pg_temp.assert((select lock_owner from public.support_followup_claim_due('worker-b', 100, 300) where case_id = :'c1') = 'worker-b', 'expired lease reclaimed');

-- ===== failures back off, are bounded, then land in blocked / followup_exhausted; no endless loop =====
select pg_temp.assert(public.support_followup_record_attempt(:'c1', 'k1', 'update', 'failed') = 'recorded', 'attempt 1 recorded');
select pg_temp.assert(pg_temp.st(:'c1') = 'waiting_system' and pg_temp.why(:'c1') = 'reply_delivery_failed', 'failed send is visible: waiting_system / reply_delivery_failed');
select pg_temp.assert((select next_action_at from public.support_followup where case_id = :'c1') = now() + interval '15 minutes', 'first retry after 15 minutes');
select pg_temp.assert(public.support_followup_record_attempt(:'c1', 'k1', 'update', 'failed') = 'duplicate', 'same idempotency key is a no-op');
select pg_temp.assert((select attempt_count from public.support_followup where case_id = :'c1') = 1, 'duplicate did not count twice');
select pg_temp.assert(public.support_followup_record_attempt(:'c1', 'k2', 'update', 'failed') = 'recorded', 'attempt 2');
select pg_temp.assert((select next_action_at from public.support_followup where case_id = :'c1') = now() + interval '1 hour', 'second retry after 1 hour');
select pg_temp.assert(public.support_followup_record_attempt(:'c1', 'k3', 'update', 'attempted') = 'recorded', 'attempt 3 (sent, no receipt) counts towards the bound');
select pg_temp.assert(pg_temp.st(:'c1') = 'blocked' and pg_temp.why(:'c1') = 'followup_exhausted', 'bound reached -> blocked / followup_exhausted');
select pg_temp.assert((select next_action_at from public.support_followup where case_id = :'c1') is null, 'exhausted case schedules nothing');
select pg_temp.assert(public.support_followup_record_attempt(:'c1', 'k4', 'update', 'failed') = 'terminal', 'no further attempts once blocked');
select pg_temp.assert((select count(*) from public.support_followup_claim_due('worker-a', 100, 300) where case_id = :'c1') = 0, 'blocked case is never claimed');
select pg_temp.assert((select count(*) from public.support_followup_attempt where case_id = :'c1') = 3, 'exactly 3 attempts stored');

-- ===== "attempted" is not "delivered" until a receipt arrives; MPC-8528 message.delivery is kept in step =====
select pg_temp.mk('SUP-AAAAAAA3') as c2 \gset
insert into public.support_messages (case_id, direction, author, body, delivery) values (:'c2', 'outbound', 'ai', 'reply', 'queued') returning id as m2 \gset
select public.support_followup_record_attempt(:'c2', 'd1', 'update', 'attempted', null, :'m2');
select pg_temp.assert(pg_temp.st(:'c2') = 'waiting_system', 'attempted alone does not count as delivered');
select pg_temp.assert((select delivery from public.support_messages where id = :'m2') = 'unknown', 'message.delivery = unknown while unconfirmed');
select pg_temp.assert(public.support_followup_mark_delivered('d1', 'provider-receipt-1'), 'receipt marks the attempt delivered');
select pg_temp.assert(pg_temp.st(:'c2') = 'waiting_customer', 'delivered -> waiting_customer (new case took two legal hops)');
select pg_temp.assert((select delivery from public.support_messages where id = :'m2') = 'sent', 'message.delivery = sent after receipt');
select pg_temp.assert((select attempt_count from public.support_followup where case_id = :'c2') = 0, 'delivery resets the failure count');
select pg_temp.assert(not public.support_followup_mark_delivered('d1', 'again'), 'a second receipt is a no-op');
select pg_temp.assert(not public.support_followup_mark_delivered('no-such-key', 'x'), 'receipt for an unknown attempt changes nothing');

-- ===== customer silence never resolves or closes a case =====
update public.support_cases set created_at = now() - interval '90 days', updated_at = now() - interval '90 days' where id = :'c2';
select * from public.support_followup_sweep();
select pg_temp.assert(pg_temp.st(:'c2') = 'waiting_customer', 'sweep does not resolve or close a silent customer case');
select pg_temp.assert((select next_action_at from public.support_followup where case_id = :'c2') is null, 'and does not schedule work for a waiting_customer case');

-- ===== watchdog: orphan rescue and expired-lease release =====
-- active case with no follow-up row at all
select pg_temp.mk('SUP-AAAAAAA4', 'triage') as c3 \gset
select pg_temp.assert((select orphans_rescued from public.support_followup_sweep()) >= 1, 'orphan with no follow-up row found');
select pg_temp.assert((select next_action_at from public.support_followup where case_id = :'c3') is not null, 'orphan scheduled');
update public.support_followup set next_action_at = null, lock_owner = 'dead-worker', lock_expires_at = now() - interval '1 hour' where case_id = :'c3';
select pg_temp.assert((select orphans_rescued from public.support_followup_sweep()) >= 1, 'orphan with nothing scheduled found');
select pg_temp.assert((select lock_owner from public.support_followup where case_id = :'c3') is null, 'dead worker lease released');
select pg_temp.assert(pg_temp.st(:'c3') = 'triage', 'sweep leaves the state alone');

-- ===== resolution needs verification; failed verification reopens work; reply reopens a finished case =====
select pg_temp.mk('SUP-AAAAAAA5', 'diagnosing') as c4 \gset
select public.support_followup_open(:'c4');
select pg_temp.assert(pg_temp.err(format($q$select public.support_followup_verify_resolution(%L, true)$q$, :'c4')) <> '', 'cannot verify a case never proposed as resolved');
select public.support_followup_propose_resolution(:'c4');
select pg_temp.assert(pg_temp.st(:'c4') = 'diagnosing', 'proposing a resolution does not resolve it');
select pg_temp.assert(public.support_followup_verify_resolution(:'c4', false) = 'reopened_work', 'failed verification returns the case to work');
select pg_temp.assert(pg_temp.st(:'c4') = 'diagnosing' and pg_temp.why(:'c4') = 'verification_failed', 'back to diagnosing with a reason');
select pg_temp.assert((select next_action_at from public.support_followup where case_id = :'c4') is not null, 'and a new diagnostic is scheduled');
select public.support_followup_propose_resolution(:'c4');
select pg_temp.assert(public.support_followup_verify_resolution(:'c4', true) = 'resolved', 'verified outcome resolves');
select pg_temp.assert(pg_temp.st(:'c4') = 'resolved', 'state is resolved');
select pg_temp.assert(public.support_followup_customer_reply(:'c4') = 'reopened', 'reply reopens a resolved case');
select pg_temp.assert(pg_temp.st(:'c4') = 'reopened' and (select reopen_count from public.support_cases where id = :'c4') = 1, 'reopen counted, history kept');
select pg_temp.assert(public.support_followup_customer_reply(:'c1') = 'reopened', 'reply also reopens an exhausted (blocked) case');
select pg_temp.assert((select attempt_count from public.support_followup where case_id = :'c1') = 0, 'reopen resets the attempt bound');
select pg_temp.assert(public.support_followup_customer_reply(:'c2') = 'recorded' and pg_temp.st(:'c2') = 'triage', 'reply wakes a waiting_customer case');

-- ===== full lifecycle journey: intake -> promised update -> failed send -> receipt -> silence -> failed then passed verification -> reopen -> exhaustion =====
select pg_temp.mk('SUP-AAAAAAA6', 'triage') as j \gset
select public.support_followup_open(:'j');
select public.support_followup_schedule_update(:'j', now() + interval '1 hour') as jdue \gset
select pg_temp.assert(:'jdue'::timestamptz > now(), 'journey: update promise committed before it is told to the customer');
update public.support_followup set next_action_at = now() where case_id = :'j';
select pg_temp.assert((select count(*) from public.support_followup_claim_due('journey-worker', 100, 300) where case_id = :'j') = 1, 'journey: due update claimed');
select pg_temp.assert(public.support_followup_record_attempt(:'j', 'j-a1', 'update', 'failed') = 'recorded' and pg_temp.why(:'j') = 'reply_delivery_failed', 'journey: first send fails, visibly');
select pg_temp.assert(public.support_followup_record_attempt(:'j', 'j-a2', 'update', 'attempted') = 'recorded' and pg_temp.st(:'j') = 'waiting_system', 'journey: retry sent, no receipt, still not delivered');
select pg_temp.assert(public.support_followup_mark_delivered('j-a2', 'receipt-j2') and pg_temp.st(:'j') = 'waiting_customer', 'journey: receipt arrives, waiting for the customer');
select * from public.support_followup_sweep();
select pg_temp.assert(pg_temp.st(:'j') = 'waiting_customer', 'journey: silence leaves the case waiting, never resolved');
select public.support_followup_customer_reply(:'j');
select public.support_followup_propose_resolution(:'j');
select pg_temp.assert(public.support_followup_verify_resolution(:'j', false) = 'reopened_work', 'journey: outcome check fails, work continues');
select public.support_followup_propose_resolution(:'j');
select pg_temp.assert(public.support_followup_verify_resolution(:'j', true) = 'resolved', 'journey: outcome verified');
select pg_temp.assert(public.support_followup_customer_reply(:'j') = 'reopened', 'journey: customer reply reopens');
select pg_temp.assert(public.support_followup_record_attempt(:'j', 'j-b1', 'respond', 'failed') = 'recorded'
                  and public.support_followup_record_attempt(:'j', 'j-b2', 'respond', 'failed') = 'recorded'
                  and public.support_followup_record_attempt(:'j', 'j-b3', 'respond', 'failed') = 'recorded', 'journey: dead transport, three bounded attempts');
select pg_temp.assert(pg_temp.st(:'j') = 'blocked' and pg_temp.why(:'j') = 'followup_exhausted', 'journey: ends honestly as blocked / followup_exhausted, not as success');
select pg_temp.assert((select reopen_count from public.support_cases where id = :'j') = 1, 'journey: reopen history kept');

-- ===== metrics: counts only, no case identifiers =====
select pg_temp.assert((select reopened_cases from public.support_followup_metrics) >= 2, 'metrics count reopened cases');
select pg_temp.assert((select retry_exhausted from public.support_followup_metrics) >= 1, 'metrics count exhausted cases');
select pg_temp.assert((select count(*) from information_schema.columns where table_name = 'support_followup_metrics' and column_name in ('ref', 'case_id', 'sender_handle')) = 0, 'metrics expose no case identifiers');

rollback;
select 'OK: support follow-up assertions passed (MPC-8529 on MPC-8528 support_cases)';
