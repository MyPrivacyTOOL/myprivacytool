-- MPC-9824 fix: the admin summary rows carried no member id, so the admin could not remove a person (handleRemoveMember needs member_id).
-- Only change: 'member_id', m.id in each members row. Same signature, same grants; create or replace is idempotent.
-- Rollback: re-run the function from 20261108160000_mpc_9824_business_teams.sql.

create or replace function public.mpt_business_summary(p_account uuid, p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t public.mpt_business_teams; v_inv int; v_auth int; v_dec int; v_rev int; v_listed int := 0; v_not_listed int := 0; v_not_checked int := 0; v_pages int := 0; v_with_listing int := 0; v_members jsonb;
begin
  select * into t from public.mpt_business_teams where id = p_team and admin_account_id = p_account;
  if not found then return null; end if;
  select count(*) filter (where status = 'invited'), count(*) filter (where status = 'authorised'), count(*) filter (where status = 'declined'), count(*) filter (where status = 'revoked')
    into v_inv, v_auth, v_dec, v_rev from public.mpt_business_members where team_id = p_team;
  select coalesce(sum((select count(*) from jsonb_array_elements(m.results) r where r->>'state' = 'listed')), 0),
         coalesce(sum((select count(*) from jsonb_array_elements(m.results) r where r->>'state' = 'not_listed')), 0),
         coalesce(sum((select count(*) from jsonb_array_elements(m.results) r where r->>'state' = 'not_checked')), 0),
         coalesce(sum(jsonb_array_length(m.results)), 0),
         count(*) filter (where exists (select 1 from jsonb_array_elements(m.results) r where r->>'state' = 'listed'))
    into v_listed, v_not_listed, v_not_checked, v_pages, v_with_listing
    from public.mpt_business_members m where m.team_id = p_team and m.status = 'authorised' and m.results is not null;
  select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'email', m.email, 'status', m.status, 'shared', m.share_detail,
            'detail', case when m.status = 'authorised' and m.share_detail then m.results else null end) order by m.invited_at), '[]'::jsonb)
    into v_members from public.mpt_business_members m where m.team_id = p_team;
  return jsonb_build_object('team_id', t.id, 'company', t.company, 'request_ref', t.request_ref,
    'counts', jsonb_build_object('invited_total', v_inv + v_auth + v_dec + v_rev, 'awaiting', v_inv, 'authorised', v_auth, 'declined', v_dec, 'revoked', v_rev),
    'aggregate', jsonb_build_object('people_included', v_auth, 'people_with_a_listing', v_with_listing, 'pages_checked', v_pages, 'listed', v_listed, 'not_listed', v_not_listed, 'not_checked', v_not_checked),
    'members', v_members);
end $$;

revoke all on function public.mpt_business_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mpt_business_summary(uuid, uuid) to service_role;
