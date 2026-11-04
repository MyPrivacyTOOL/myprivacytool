-- MPC-8689: assertions for telegram_event_flags (migration 20261029130000). Throwaway database only. Every check RAISES on failure; the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;
do $$
begin
  perform pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.telegram_event_flags'::regclass), 'RLS enabled and forced');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.telegram_event_flags') = '42501', 'anon cannot select');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.telegram_event_flags') = '42501', 'authenticated cannot select');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select public.mpt_record_event_flag('6000000001', 'tg.edits', 'edited', now() + interval '90 days')$q$) = '42501', 'anon cannot record');
  perform public.mpt_record_event_flag('6000000001', 'tg.edits', 'edited', now() + interval '90 days');
  perform public.mpt_record_event_flag('6000000001', 'tg.edits', 'edited', now() + interval '90 days');
  perform public.mpt_record_event_flag('6000000001', 'tg.blocked_bot', 'blocked', now() + interval '90 days');
  perform pg_temp.assert((select seen_count from public.telegram_event_flags where sender_id = '6000000001' and flag = 'tg.edits') = 2, 'a repeat increments the count, one row per flag');
  perform pg_temp.assert((select count(*) from public.telegram_event_flags where sender_id = '6000000001') = 2, 'two flags for the sender');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'select 1 from public.telegram_event_flags') = '', 'service_role can select');
end $$;
do $$
declare code text := '';
begin
  begin perform public.mpt_record_event_flag('6000000001', 'tg.message_text', 'edited', now()); exception when check_violation then code := 'ck'; end;
  perform pg_temp.assert(code = 'ck', 'an unknown flag is rejected');
  code := '';
  begin perform public.mpt_record_event_flag('not an id', 'tg.edits', 'edited', now()); exception when check_violation then code := 'ck'; end;
  perform pg_temp.assert(code = 'ck', 'a malformed sender id is rejected');
end $$;
do $$
begin
  perform public.mpt_record_event_flag('6000000002', 'tg.edits', 'edited', now() - interval '1 day');
  perform pg_temp.assert(public.mpt_purge_expired_event_flags() = 1, 'purge removes only expired rows');
  perform pg_temp.assert(public.mpt_delete_event_flags('6000000001') = 2, 'delete removes the sender''s flags');
  perform pg_temp.assert((select count(*) from public.telegram_event_flags) = 0, 'nothing left');
end $$;
rollback;
