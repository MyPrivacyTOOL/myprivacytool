-- Run by hand against a THROWAWAY database after supabase/tests/bootstrap.sql. Any failed assertion aborts (ON_ERROR_STOP).
\set ON_ERROR_STOP on
\i supabase/proposed/mpc_8528_support_cases.sql
-- idempotent re-apply
\i supabase/proposed/mpc_8528_support_cases.sql
insert into support_cases (ref, channel, policy_version, thread_key) values ('SUP-ABCDEFGH','web','p1','t1');
do $$ begin
  begin insert into support_cases (ref, channel, policy_version) values ('bad-ref','web','p1'); raise exception 'bad ref accepted'; exception when check_violation then null; end;
  begin insert into support_cases (ref, channel, policy_version, state) values ('SUP-ABCDEFGJ','web','p1','escalated_to_founder'); raise exception 'bad state accepted'; exception when check_violation then null; end;
  begin insert into support_cases (ref, channel, policy_version, identity_level) values ('SUP-ABCDEFGK','web','p1','verified'); raise exception 'verified without subject accepted'; exception when check_violation then null; end;
  begin insert into support_cases (ref, channel, policy_version, thread_key) values ('SUP-ABCDEFGL','web','p1','t1'); raise exception 'duplicate thread accepted'; exception when unique_violation then null; end;
end $$;
insert into support_messages (case_id, direction, author, provider_event_id, body) select id,'inbound','customer','e1','hi' from support_cases;
do $$ begin
  begin insert into support_messages (case_id, direction, author, provider_event_id, body) select id,'inbound','customer','e1','dup' from support_cases; raise exception 'duplicate event accepted'; exception when unique_violation then null; end;
  begin insert into support_messages (case_id, direction, author, body) select id,'inbound','customer','no event id' from support_cases; raise exception 'inbound without event id accepted'; exception when check_violation then null; end;
end $$;
insert into support_action_receipts (case_id, tool, idempotency_key, policy_version, outcome) select id,'t','k1','p','unknown' from support_cases;
do $$ begin
  begin insert into support_action_receipts (case_id, tool, idempotency_key, policy_version, outcome) select id,'t','k1','p','success' from support_cases; raise exception 'duplicate receipt key accepted'; exception when unique_violation then null; end;
end $$;
-- access: anon/authenticated see nothing and cannot write; service_role can.
set role anon;
do $$ begin begin perform 1 from support_cases; raise exception 'anon could read'; exception when insufficient_privilege then null; end; end $$;
reset role; set role authenticated;
do $$ begin begin perform 1 from support_cases; raise exception 'authenticated could read'; exception when insufficient_privilege then null; end; end $$;
reset role; set role service_role;
do $$ begin if (select count(*) from support_cases) <> 1 then raise exception 'service_role cannot read'; end if; end $$;
reset role;
-- atomic intake functions
set role service_role;
do $$ declare r jsonb; d boolean; begin
  r := public.support_create_case_from_event('email','ev-1','th-A','sender-1','first message','SUP-ZZZZZZZ2','p1');
  if (r->>'duplicate')::boolean then raise exception 'first event reported as duplicate'; end if;
  if (select count(*) from support_messages where provider_event_id = 'ev-1') <> 1 then raise exception 'message not stored'; end if;
  -- the same provider event again: same case, no new rows
  if (public.support_create_case_from_event('email','ev-1','th-A','sender-1','first message','SUP-YYYYYYY3','p1')->>'duplicate')::boolean is not true then raise exception 'repeat not flagged duplicate'; end if;
  if (select count(*) from support_cases where thread_key = 'th-A') <> 1 then raise exception 'duplicate created a second case'; end if;
  if (select count(*) from support_messages where provider_event_id = 'ev-1') <> 1 then raise exception 'duplicate stored a second message'; end if;
  -- same event id on a DIFFERENT channel is a different event
  if (public.support_create_case_from_event('web','ev-1',null,null,'other channel','SUP-XXXXXXX4','p1')->>'duplicate')::boolean then raise exception 'cross-channel event wrongly deduped'; end if;
  -- append: first stores, repeat is a duplicate
  d := public.support_append_inbound((r->'case'->>'id')::uuid, 'ev-2', 'reply');
  if d then raise exception 'new append flagged duplicate'; end if;
  if public.support_append_inbound((r->'case'->>'id')::uuid, 'ev-2', 'reply') is not true then raise exception 'repeat append not duplicate'; end if;
  if (select count(*) from support_messages where provider_event_id = 'ev-2') <> 1 then raise exception 'append stored twice'; end if;
  -- a failure leaves nothing behind (bad channel violates the check; whole call rolls back)
  begin perform public.support_create_case_from_event('fax','ev-9',null,null,'x','SUP-WWWWWWW5','p1'); raise exception 'bad channel accepted'; exception when check_violation then null; end;
  if exists (select 1 from support_cases where ref = 'SUP-WWWWWWW5') then raise exception 'failed intake left a case'; end if;
end $$;
reset role;
set role anon;
do $$ begin begin perform public.support_create_case_from_event('web','ev-x',null,null,'x','SUP-VVVVVVV6','p'); raise exception 'anon could call intake'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'support schema assertions passed' as result;
