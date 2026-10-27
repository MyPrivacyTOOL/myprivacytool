-- MPC-8528: assertions for the PROPOSED support schema (supabase/proposed/mpc_8528_support_cases.sql). supabase/tests/run.sh has already
-- applied that file to the THROWAWAY database; this re-applies it once to prove it is idempotent. Any failed assertion aborts (ON_ERROR_STOP).
\set ON_ERROR_STOP on
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
-- identity proofs: single use, expiry, bounds, hash format, access
set role service_role;
do $$ declare id1 uuid; r jsonb; h text := repeat('a', 64); begin
  id1 := public.support_issue_proof(h, 'user-A', 't1', 600);
  if id1 is null then raise exception 'proof not issued'; end if;
  begin perform public.support_issue_proof(repeat('b', 64), 'u', 't', 30); raise exception 'short ttl accepted'; exception when raise_exception then if sqlerrm like 'short ttl%' then raise; end if; end;
  begin perform public.support_issue_proof(repeat('b', 64), 'u', 't', 7200); raise exception 'long ttl accepted'; exception when raise_exception then if sqlerrm like 'long ttl%' then raise; end if; end;
  begin perform public.support_issue_proof('not-a-hash', 'u', 't', 600); raise exception 'bad hash accepted'; exception when check_violation then null; end;
  begin perform public.support_issue_proof(h, 'u2', 't', 600); raise exception 'duplicate hash accepted'; exception when unique_violation then null; end;
  r := public.support_redeem_proof(h);
  if r->>'subject_id' <> 'user-A' or r->>'tenant_id' <> 't1' then raise exception 'redeem returned wrong identity: %', r; end if;
  if public.support_redeem_proof(h) is not null then raise exception 'proof redeemed twice'; end if;
  if public.support_redeem_proof(repeat('c', 64)) is not null then raise exception 'unknown proof redeemed'; end if;
  -- expiry: an issued proof whose expiry has passed cannot be redeemed
  perform public.support_issue_proof(repeat('d', 64), 'user-B', 't1', 600);
  update public.support_proofs set expires_at = now() - interval '1 second', created_at = now() - interval '1 hour' where token_hash = repeat('d', 64);
  if public.support_redeem_proof(repeat('d', 64)) is not null then raise exception 'expired proof redeemed'; end if;
end $$;
reset role;
set role anon;
do $$ begin begin perform public.support_redeem_proof(repeat('a', 64)); raise exception 'anon could redeem'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform 1 from public.support_proofs; raise exception 'anon could read proofs'; exception when insufficient_privilege then null; end; end $$;
reset role;
-- retention: text removed after 90 days, cases after 6 months of inactivity, recent rows untouched
set role service_role;
do $$ declare c_old uuid; c_new uuid; r jsonb; begin
  insert into support_cases (ref, channel, policy_version, state) values ('SUP-OLDOLDOL','web','p','resolved') returning id into c_old;
  insert into support_cases (ref, channel, policy_version) values ('SUP-NEWNEWNE','web','p') returning id into c_new;
  insert into support_messages (case_id, direction, author, provider_event_id, body) values (c_new, 'inbound', 'customer', 'ret-new', 'recent text'), (c_new, 'inbound', 'customer', 'ret-mid', 'ninety-one days old');
  update support_messages set created_at = now() - interval '91 days' where provider_event_id = 'ret-mid';
  update support_cases set updated_at = now() - interval '7 months' where id = c_old;
  r := public.support_purge_expired();
  if (r->>'cases_deleted')::int < 1 then raise exception 'old case not deleted: %', r; end if;
  if exists (select 1 from support_cases where id = c_old) then raise exception 'old case still present'; end if;
  if not exists (select 1 from support_cases where id = c_new) then raise exception 'recent case was purged'; end if;
  if (select body from support_messages where provider_event_id = 'ret-new') <> 'recent text' then raise exception 'recent text was purged'; end if;
  if (select body from support_messages where provider_event_id = 'ret-mid') like 'ninety-one%' then raise exception 'old text was kept'; end if;
end $$;
reset role;
set role anon;
do $$ begin begin perform public.support_purge_expired(); raise exception 'anon could purge'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'support schema assertions passed' as result;
