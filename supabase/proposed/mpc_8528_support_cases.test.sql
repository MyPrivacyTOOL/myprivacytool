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
select 'support schema assertions passed' as result;
