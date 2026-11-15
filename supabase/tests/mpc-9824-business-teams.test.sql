-- MPC-9824: assertions for mpt_business_teams / mpt_business_members and the mpt_business_* functions. SYNTHETIC identities only (example.test).
-- Throwaway database only. Every check RAISES on failure (psql ON_ERROR_STOP=1) and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== RLS closed; functions service_role only =====
do $$
declare t text; f text;
begin
  foreach t in array array['mpt_business_teams', 'mpt_business_members'] loop
    perform pg_temp.assert((select relforcerowsecurity and relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS enabled and forced');
    perform pg_temp.assert(pg_temp.try_as('anon', format('select 1 from public.%I', t)) = '42501', t || ': anon denied');
    perform pg_temp.assert(pg_temp.try_as('authenticated', format('select 1 from public.%I', t)) = '42501', t || ': authenticated denied (the Worker reads, not the browser)');
    perform pg_temp.assert(pg_temp.try_as('service_role', format('select 1 from public.%I', t)) = '', t || ': service_role reads');
  end loop;
  foreach f in array array['mpt_business_summary(uuid, uuid)', 'mpt_business_member(text)', 'mpt_business_list_teams(uuid)', 'mpt_business_remove_member(uuid, uuid, uuid)', 'mpt_business_delete_team(uuid, uuid)',
                           'mpt_business_create_team(uuid, text, text)', 'mpt_business_invite(uuid, uuid, text[], text[])', 'mpt_business_authorise(text, text, boolean, jsonb, text)',
                           'mpt_business_decline(text)', 'mpt_business_revoke(text)', 'mpt_business_set_share(text, boolean)'] loop
    perform pg_temp.assert(not has_function_privilege('anon', 'public.' || f, 'execute') and not has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ': not callable by anon or authenticated');
    perform pg_temp.assert(has_function_privilege('service_role', 'public.' || f, 'execute'), f || ': callable by service_role');
  end loop;
end $$;

-- ===== NO IP anywhere =====
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('mpt_business_teams', 'mpt_business_members')
                                   and (column_name ~* '(^|_)ip(_|$)' or column_name ~* 'ip_?address' or udt_name = 'inet')), 'no IP column on the business tables');

-- ===== fixtures =====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000a9824', 'admin.test+9824@example.test'), ('00000000-0000-0000-0000-0000000b9824', 'other.test+9824@example.test');
insert into public.accounts (id, email) values ('00000000-0000-0000-0000-0000000a9824', 'admin.test+9824@example.test'), ('00000000-0000-0000-0000-0000000b9824', 'other.test+9824@example.test');
create temp table ctx (k text primary key, v text);

do $$
declare r jsonb; v_team uuid; h text[] := array[repeat('a', 64), repeat('b', 64), repeat('c', 64)]; s jsonb; m jsonb;
begin
  -- create: one admin_invite queue row
  r := public.mpt_business_create_team('00000000-0000-0000-0000-0000000a9824', 'Quillfeather Ltd', 'BIZ-AAAAAAAA');
  perform pg_temp.assert((r->>'created')::boolean, 'create team');
  v_team := (r->>'team_id')::uuid; insert into ctx values ('team', v_team::text);
  perform pg_temp.assert((select count(*) from public.mpt_business_requests where ref = 'BIZ-AAAAAAAA' and source = 'admin_invite') = 1, 'create: exactly one admin_invite row in the queue');
  perform pg_temp.assert(public.mpt_business_create_team('00000000-0000-0000-0000-00000000ffff', 'X', 'BIZ-BBBBBBBB')->>'reason' = 'no_account', 'create: no account => no team');

  -- invite 3
  r := public.mpt_business_invite('00000000-0000-0000-0000-0000000a9824', v_team, array['ada.test+9824@example.test', 'bo.test+9824@example.test', 'cy.test+9824@example.test'], h);
  perform pg_temp.assert((r->>'ok')::boolean and jsonb_array_length(r->'added') = 3, 'invite: 3 added');
  perform pg_temp.assert(not (public.mpt_business_invite('00000000-0000-0000-0000-0000000b9824', v_team, array['x.test@example.test'], array[repeat('d', 64)])->>'ok')::boolean, 'invite: another admin cannot invite into this team');
  perform pg_temp.assert(jsonb_array_length(public.mpt_business_invite('00000000-0000-0000-0000-0000000a9824', v_team, array['ada.test+9824@example.test'], array[repeat('e', 64)])->'skipped') = 1, 'invite: an address already invited is skipped');

  -- invited-but-not-authorised: data-only-when-authorised constraint
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$update public.mpt_business_members set results = '[]'::jsonb where team_id = %L and email like 'cy.%%'$q$, v_team)) = '23514', 'constraint: results cannot be set on a person who has not authorised');
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$update public.mpt_business_members set share_detail = true where team_id = %L and email like 'cy.%%'$q$, v_team)) = '23514', 'constraint: share cannot be set on a person who has not authorised');

  -- view by token
  perform pg_temp.assert(public.mpt_business_member(h[1])->>'status' = 'invited' and public.mpt_business_member(h[1])->>'company' = 'Quillfeather Ltd', 'member view: invited, with the company');
  perform pg_temp.assert(public.mpt_business_member(repeat('0', 64)) is null, 'member view: unknown token => null');

  -- Ada authorises with a listed page and shares; Bo authorises, one not-listed page, no share; Cy never answers
  r := public.mpt_business_authorise(h[1], '2026-11-08-v1', true, '[{"key":"spokeo","state":"listed"}]'::jsonb, 'BIZ-CCCCCCCC');
  perform pg_temp.assert((r->>'ok')::boolean, 'authorise: Ada');
  r := public.mpt_business_authorise(h[2], '2026-11-08-v1', false, '[{"key":"spokeo","state":"not_listed"},{"key":"x","state":"not_checked"}]'::jsonb, 'BIZ-DDDDDDDD');
  perform pg_temp.assert((r->>'ok')::boolean, 'authorise: Bo');
  perform pg_temp.assert((select count(*) from public.mpt_business_requests where source = 'employee_consent' and notes = 'team ' || v_team::text) = 2, 'authorise: one employee_consent queue row per person');
  perform public.mpt_business_authorise(h[1], '2026-11-08-v1', true, '[{"key":"spokeo","state":"listed"}]'::jsonb, 'BIZ-EEEEEEEE');
  perform pg_temp.assert((select count(*) from public.mpt_business_requests where source = 'employee_consent' and notes = 'team ' || v_team::text) = 2, 'authorise: re-authorising does not add a second queue row');
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$select public.mpt_business_authorise(%L, 'v', false, '[1,2,3,4]'::jsonb)$q$, h[3])) = '22023', 'authorise: more than 3 results refused');

  -- summary: the two authorised only
  s := public.mpt_business_summary('00000000-0000-0000-0000-0000000a9824', v_team);
  perform pg_temp.assert((s->'counts'->>'invited_total')::int = 3 and (s->'counts'->>'authorised')::int = 2 and (s->'counts'->>'awaiting')::int = 1, 'summary counts: 3 invited, 2 authorised, 1 awaiting');
  perform pg_temp.assert((s->'aggregate'->>'people_included')::int = 2 and (s->'aggregate'->>'pages_checked')::int = 3 and (s->'aggregate'->>'listed')::int = 1
                         and (s->'aggregate'->>'not_listed')::int = 1 and (s->'aggregate'->>'not_checked')::int = 1 and (s->'aggregate'->>'people_with_a_listing')::int = 1, 'summary aggregate covers the two authorised only');
  perform pg_temp.assert((select count(*) from jsonb_array_elements(s->'members') x where x ? 'member_id' and x->>'member_id' is not null) = 3, 'summary: every member row carries member_id');
  perform pg_temp.assert((select x->'detail' from jsonb_array_elements(s->'members') x where x->>'email' like 'ada.%') <> 'null'::jsonb, 'summary: Ada shared, detail visible');
  perform pg_temp.assert((select x->'detail' from jsonb_array_elements(s->'members') x where x->>'email' like 'bo.%') = 'null'::jsonb, 'summary: Bo did not share, no detail');
  perform pg_temp.assert((select x->'detail' from jsonb_array_elements(s->'members') x where x->>'email' like 'cy.%') = 'null'::jsonb and (select x->>'status' from jsonb_array_elements(s->'members') x where x->>'email' like 'cy.%') = 'invited', 'summary: the third person has no data');
  perform pg_temp.assert(public.mpt_business_summary('00000000-0000-0000-0000-0000000b9824', v_team) is null, 'summary: another admin gets nothing');

  -- share toggle, revoke clears results, revoked link cannot re-authorise
  perform public.mpt_business_set_share(h[2], true);
  perform pg_temp.assert((select x->'detail' from jsonb_array_elements(public.mpt_business_summary('00000000-0000-0000-0000-0000000a9824', v_team)->'members') x where x->>'email' like 'bo.%') <> 'null'::jsonb, 'share: Bo shares, detail visible');
  perform public.mpt_business_revoke(h[2]);
  perform pg_temp.assert((select results is null and checked_at is null and share_detail = false and consent_at is null and status = 'revoked' from public.mpt_business_members where token_hash = h[2]), 'revoke: results, share and consent cleared');
  perform pg_temp.assert(public.mpt_business_authorise(h[2], 'v', false, '[]'::jsonb)->>'reason' = 'revoked', 'revoke: the old link cannot authorise again');
  perform pg_temp.assert((public.mpt_business_summary('00000000-0000-0000-0000-0000000a9824', v_team)->'aggregate'->>'people_included')::int = 1, 'revoke: Bo no longer counted');
  perform pg_temp.assert((public.mpt_business_decline(h[3])->>'ok')::boolean, 'decline: ok');
  perform pg_temp.assert((select status from public.mpt_business_members where token_hash = h[3]) = 'declined', 'decline: status declined');

  -- expiry
  update public.mpt_business_members set status = 'invited', token_expires_at = now() - interval '1 day' where token_hash = h[3];
  perform pg_temp.assert(public.mpt_business_member(h[3]) is null and (public.mpt_business_authorise(h[3], 'v', false, '[]'::jsonb)->>'reason') = 'invalid_link', 'expiry: an expired invitation is invalid');

  -- remove member: by id from the summary; other admin cannot
  m := (select x from jsonb_array_elements(public.mpt_business_summary('00000000-0000-0000-0000-0000000a9824', v_team)->'members') x where x->>'email' like 'cy.%');
  perform pg_temp.assert(not (public.mpt_business_remove_member('00000000-0000-0000-0000-0000000b9824', v_team, (m->>'member_id')::uuid)->>'ok')::boolean, 'remove: another admin cannot');
  perform pg_temp.assert((public.mpt_business_remove_member('00000000-0000-0000-0000-0000000a9824', v_team, (m->>'member_id')::uuid)->>'ok')::boolean, 'remove: the admin removes a person by the summary member_id');
  perform pg_temp.assert(not exists (select 1 from public.mpt_business_members where email like 'cy.%'), 'remove: the row is gone');

  -- delete team: every member row gone; other admin cannot
  perform pg_temp.assert(not (public.mpt_business_delete_team('00000000-0000-0000-0000-0000000b9824', v_team)->>'ok')::boolean, 'delete team: another admin cannot');
  r := public.mpt_business_delete_team('00000000-0000-0000-0000-0000000a9824', v_team);
  perform pg_temp.assert((r->>'ok')::boolean and (r->>'members_deleted')::int = 2, 'delete team: ok, 2 member rows counted');
  perform pg_temp.assert(not exists (select 1 from public.mpt_business_members where team_id = v_team) and not exists (select 1 from public.mpt_business_teams where id = v_team), 'delete team: team and all member rows gone');
end $$;
rollback;
select 'OK mpc-9824-business-teams';
