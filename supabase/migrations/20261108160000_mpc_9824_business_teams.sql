-- MPC-9824 (F6, employee intake): a Business admin invites employees; each employee authorises THEIR OWN scan; the admin sees an aggregate for the
-- authorised employees only. Decisions that govern (Vision 6A.4 in the Fixes page, Open Tracker design section 0, Chris 2026-11-07/08):
--   * payment or invitation by one person never grants access to another's shadow: nothing is read about an employee until that employee presses Authorise;
--   * the admin sees counts (aggregate) unless the employee ticks "share my detail with my admin"; a person who is invited but has not authorised has NO data row at all;
--   * the employee can revoke at any time and revoking DELETES the results (not an unlink); the details typed for the check (name, city, phone) are never stored,
--     only the result fields (the same rule as the free F1 check, MPC-9813);
--   * every team and every employee consent writes ONE row into public.mpt_business_requests (MPC-9825, source 'admin_invite' / 'employee_consent'): one queue, one 48 h clock.
--
--   public.mpt_business_teams     one team per admin account (Supabase Auth account, MPC-9817)
--   public.mpt_business_members   one row per invited address: status, hashed invite token, consent, share flag, result fields
--   functions                     mpt_business_* (security definer, service_role only)
--
-- Additive and idempotent. Touches nothing existing. No IP column. Rollback:
--   drop function if exists public.mpt_business_create_team(uuid, text, text), public.mpt_business_invite(uuid, uuid, text[], text[]), public.mpt_business_member(text),
--     public.mpt_business_authorise(text, text, boolean, jsonb), public.mpt_business_decline(text), public.mpt_business_revoke(text), public.mpt_business_set_share(text, boolean),
--     public.mpt_business_summary(uuid, uuid), public.mpt_business_list_teams(uuid), public.mpt_business_remove_member(uuid, uuid, uuid), public.mpt_business_delete_team(uuid, uuid);
--   drop table if exists public.mpt_business_members, public.mpt_business_teams;

create table if not exists public.mpt_business_teams (
  id               uuid primary key default gen_random_uuid(),
  admin_account_id uuid not null references public.accounts(id) on delete cascade,
  company          text not null check (char_length(company) between 1 and 200),
  request_ref      text,                                    -- the BIZ-XXXXXXXX queue row written when the team was created (no foreign key: the queue is purged on its own clock)
  created_at       timestamptz not null default now()
);
create index if not exists mpt_business_teams_admin_idx on public.mpt_business_teams (admin_account_id);
comment on table public.mpt_business_teams is 'MPC-9824. One Business team per admin account. Deleted with the account and by mpt_business_delete_team (which deletes every member row and result). No IP.';

create table if not exists public.mpt_business_members (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.mpt_business_teams(id) on delete cascade,
  email            text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the invite token; the token itself is only ever in the email
  status           text not null default 'invited' check (status in ('invited', 'authorised', 'declined', 'revoked')),
  invited_at       timestamptz not null default now(),
  token_expires_at timestamptz not null default (now() + interval '30 days'),
  responded_at     timestamptz,
  consent_version  text check (consent_version is null or consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'),
  consent_at       timestamptz,
  share_detail     boolean not null default false,          -- true = the employee chose to show their own result detail to the admin
  results          jsonb,                                   -- result fields only (state, match, broker name, evidence_url, checked_at); never the typed name, city or phone
  checked_at       timestamptz,
  unique (team_id, email),
  -- nothing about a person is held unless that person authorised
  constraint business_member_data_only_when_authorised check (status = 'authorised' or (results is null and checked_at is null and share_detail = false))
);
create index if not exists mpt_business_members_team_idx on public.mpt_business_members (team_id);
comment on table public.mpt_business_members is 'MPC-9824. One row per invited employee address. results/checked_at/share_detail can only be set while status = authorised (table constraint); revoke clears them. The admin reads counts unless share_detail. No IP.';

alter table public.mpt_business_teams enable row level security;   alter table public.mpt_business_teams force row level security;
alter table public.mpt_business_members enable row level security; alter table public.mpt_business_members force row level security;
revoke all on public.mpt_business_teams, public.mpt_business_members from public, anon, authenticated;
grant all on public.mpt_business_teams, public.mpt_business_members to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mpt_business_teams' and policyname = 'service role full access') then
    create policy "service role full access" on public.mpt_business_teams for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mpt_business_members' and policyname = 'service role full access') then
    create policy "service role full access" on public.mpt_business_members for all to service_role using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------- functions

-- Creates a team for a signed-in admin and the ONE queue row for it. p_ref is the BIZ- reference made by the Worker (shared/business/sla.js makeRef).
create or replace function public.mpt_business_create_team(p_account uuid, p_company text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text; v_company text := btrim(p_company); t public.mpt_business_teams;
begin
  select email into v_email from public.accounts where id = p_account;
  if v_email is null then return jsonb_build_object('created', false, 'reason', 'no_account'); end if;
  if v_company is null or v_company = '' or char_length(v_company) > 200 then raise exception 'company required' using errcode = '22023'; end if;
  if (select count(*) from public.mpt_business_teams where admin_account_id = p_account) >= 5 then return jsonb_build_object('created', false, 'reason', 'team_limit'); end if;
  insert into public.mpt_business_requests (ref, contact_email, company, source, consent_source)
    values (p_ref, v_email, v_company, 'admin_invite', 'business_team_admin');
  insert into public.mpt_business_teams (admin_account_id, company, request_ref) values (p_account, v_company, p_ref) returning * into t;
  return jsonb_build_object('created', true, 'team_id', t.id, 'company', t.company, 'request_ref', t.request_ref, 'created_at', t.created_at);
end $$;

-- Adds invitations. p_emails and p_hashes line up by index (the Worker makes a fresh random token per address and sends it by email; only its hash is stored).
-- Returns the addresses that now hold a NEW token (new, or a previously declined/revoked/expired person being invited again). An address already invited or authorised is skipped.
create or replace function public.mpt_business_invite(p_account uuid, p_team uuid, p_emails text[], p_hashes text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare i int; v_n int; v_email text; m public.mpt_business_members; v_added jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.mpt_business_teams where id = p_team and admin_account_id = p_account) then return jsonb_build_object('ok', false, 'reason', 'not_your_team'); end if;
  if coalesce(array_length(p_emails, 1), 0) <> coalesce(array_length(p_hashes, 1), 0) or coalesce(array_length(p_emails, 1), 0) = 0 then raise exception 'emails and hashes must line up' using errcode = '22023'; end if;
  select count(*) into v_n from public.mpt_business_members where team_id = p_team;
  for i in 1 .. array_length(p_emails, 1) loop
    v_email := lower(btrim(p_emails[i]));
    select * into m from public.mpt_business_members where team_id = p_team and email = v_email;
    if found then
      if m.status in ('declined', 'revoked') or m.token_expires_at < now() and m.status = 'invited' then
        update public.mpt_business_members set token_hash = p_hashes[i], status = 'invited', invited_at = now(), token_expires_at = now() + interval '30 days', responded_at = null,
               consent_version = null, consent_at = null, share_detail = false, results = null, checked_at = null where id = m.id;
        v_added := v_added || to_jsonb(v_email);
      else
        v_skipped := v_skipped || to_jsonb(v_email);
      end if;
    else
      if v_n >= 50 then v_skipped := v_skipped || to_jsonb(v_email); continue; end if;
      insert into public.mpt_business_members (team_id, email, token_hash) values (p_team, v_email, p_hashes[i]);
      v_n := v_n + 1;
      v_added := v_added || to_jsonb(v_email);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', v_added, 'skipped', v_skipped);
end $$;

-- What an invited person may see before and after authorising: their own row and the team's company name. Null when the token is unknown or expired.
create or replace function public.mpt_business_member(p_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('member_id', m.id, 'email', m.email, 'status', m.status, 'company', t.company, 'share_detail', m.share_detail,
                            'checked_at', m.checked_at, 'results', m.results, 'team_id', t.id)
    from public.mpt_business_members m join public.mpt_business_teams t on t.id = m.team_id
   where m.token_hash = p_hash and (m.token_expires_at >= now() or m.status = 'authorised')
$$;

-- The employee presses Authorise. Records the consent, the result fields and the share choice, and writes the employee_consent queue row (one clock per consent).
create or replace function public.mpt_business_authorise(p_hash text, p_version text, p_share boolean, p_results jsonb, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.mpt_business_members; v_company text;
begin
  select * into m from public.mpt_business_members where token_hash = p_hash for update;
  if not found or (m.token_expires_at < now() and m.status <> 'authorised') then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  if m.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 3 then raise exception 'results must be an array of at most 3' using errcode = '22023'; end if;
  update public.mpt_business_members
     set status = 'authorised', responded_at = coalesce(responded_at, now()), consent_version = p_version, consent_at = now(), share_detail = coalesce(p_share, false),
         results = p_results, checked_at = now()
   where id = m.id;
  select company into v_company from public.mpt_business_teams where id = m.team_id;
  if m.status <> 'authorised' and p_ref is not null then
    insert into public.mpt_business_requests (ref, contact_email, company, source, consent_source, notes)
      values (p_ref, m.email, v_company, 'employee_consent', 'business_team_employee', 'team ' || m.team_id::text) on conflict (ref) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'status', 'authorised', 'company', v_company);
end $$;

create or replace function public.mpt_business_decline(p_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.mpt_business_members set status = 'declined', responded_at = now(), results = null, checked_at = null, share_detail = false
   where token_hash = p_hash and status in ('invited', 'declined') and token_expires_at >= now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;

-- Revoke = delete the results and the share choice; the row stays only to say "this person withdrew" (and to stop a re-run without a new invitation).
create or replace function public.mpt_business_revoke(p_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.mpt_business_members set status = 'revoked', responded_at = now(), results = null, checked_at = null, share_detail = false, consent_version = null, consent_at = null
   where token_hash = p_hash and status in ('authorised', 'invited', 'declined');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;

create or replace function public.mpt_business_set_share(p_hash text, p_share boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.mpt_business_members set share_detail = coalesce(p_share, false) where token_hash = p_hash and status = 'authorised';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1, 'share_detail', coalesce(p_share, false));
end $$;

-- The admin's view. Aggregate counts over AUTHORISED members only. Per person: address and status; result detail only where that person shared it.
-- A person who is invited but has not authorised contributes nothing to any count of results.
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
  select coalesce(jsonb_agg(jsonb_build_object('email', m.email, 'status', m.status, 'shared', m.share_detail,
            'detail', case when m.status = 'authorised' and m.share_detail then m.results else null end) order by m.invited_at), '[]'::jsonb)
    into v_members from public.mpt_business_members m where m.team_id = p_team;
  return jsonb_build_object('team_id', t.id, 'company', t.company, 'request_ref', t.request_ref,
    'counts', jsonb_build_object('invited_total', v_inv + v_auth + v_dec + v_rev, 'awaiting', v_inv, 'authorised', v_auth, 'declined', v_dec, 'revoked', v_rev),
    'aggregate', jsonb_build_object('people_included', v_auth, 'people_with_a_listing', v_with_listing, 'pages_checked', v_pages, 'listed', v_listed, 'not_listed', v_not_listed, 'not_checked', v_not_checked),
    'members', v_members);
end $$;

create or replace function public.mpt_business_list_teams(p_account uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'company', t.company, 'created_at', t.created_at) order by t.created_at), '[]'::jsonb)
    from public.mpt_business_teams t where t.admin_account_id = p_account
$$;

-- Removing a person deletes their row (and with it every result).
create or replace function public.mpt_business_remove_member(p_account uuid, p_team uuid, p_member uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.mpt_business_members m using public.mpt_business_teams t
   where m.id = p_member and m.team_id = p_team and t.id = m.team_id and t.admin_account_id = p_account;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;

create or replace function public.mpt_business_delete_team(p_account uuid, p_team uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; m int;
begin
  select count(*) into m from public.mpt_business_members where team_id = p_team and exists (select 1 from public.mpt_business_teams where id = p_team and admin_account_id = p_account);
  delete from public.mpt_business_teams where id = p_team and admin_account_id = p_account;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1, 'members_deleted', case when n = 1 then m else 0 end);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'mpt_business_create_team(uuid, text, text)', 'mpt_business_invite(uuid, uuid, text[], text[])', 'mpt_business_member(text)', 'mpt_business_authorise(text, text, boolean, jsonb, text)',
    'mpt_business_decline(text)', 'mpt_business_revoke(text)', 'mpt_business_set_share(text, boolean)', 'mpt_business_summary(uuid, uuid)', 'mpt_business_list_teams(uuid)',
    'mpt_business_remove_member(uuid, uuid, uuid)', 'mpt_business_delete_team(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
