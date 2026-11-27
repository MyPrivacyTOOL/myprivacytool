-- MPC-9817 (F3, accounts and sign-in only): a visitor can create a free account with an email link and see / delete their scans.
-- Entitlements are MPC-9818, Stripe is MPC-9819, family add-on is MPC-9820: none of that is here.
--
-- Decisions that govern (Chris, 2026-11-07/08): no passwords; the click-to-confirm email (MPC-9813) is the identity primitive; signed-up = scans kept
-- (they leave the free 7-day deletion path of public.scans, MPC-8659); NO IP column anywhere on these tables; consent travels with the sign-up.
--
-- Identity itself is Supabase Auth (auth.users). Everything here hangs off auth.users.id.
--   public.accounts           one row per signed-in person: email, plan (default free), consent carried from the scan, keep_scans. NO IP.
--   public.account_scans      which saved scans (scan numbers) belong to which account. Cascades from the account AND from the saved scan.
--   public.capability_min_tier  the entitlement data (feature -> min_tier) from the F2 spec section 3. Only the FREE rows are wired; MPC-9818 adds the rest.
--   functions                 mpt_ensure_account, mpt_link_scan_to_account, mpt_list_account_scans, mpt_get_account_scan, mpt_delete_account, mpt_can (all service_role only)
--   web_scan_contacts.account_requested_at   the "keep my scan / create my free account" tick (one step), read at the click-to-confirm.
--
-- Additive and idempotent; deletes nothing; safe to apply before the Worker change (ACCOUNTS_ENABLED stays off until the Worker is deployed with it).
-- Rollback:
--   drop function if exists public.mpt_can(uuid, text), public.mpt_delete_account(uuid), public.mpt_get_account_scan(uuid, uuid), public.mpt_list_account_scans(uuid), public.mpt_link_scan_to_account(uuid, uuid, text), public.mpt_ensure_account(uuid, text, uuid);
--   drop table if exists public.account_scans, public.accounts, public.capability_min_tier;
--   alter table public.web_scan_contacts drop column if exists account_requested_at;

-- ---------------------------------------------------------------- accounts
create table if not exists public.accounts (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null check (char_length(email) between 3 and 255 and email = lower(email)),
  plan             text not null default 'free' check (plan in ('free', 'basic', 'pro', 'executive')),
  keep_scans       boolean not null default true,
  consent_version  text check (consent_version is null or consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'),
  consent_at       timestamptz,
  consent_scan_id  uuid,                                   -- the scan number the consent was given on (no foreign key: the scan may be deleted before the account)
  consent_hash     text check (consent_hash is null or consent_hash ~ '^[0-9a-f]{64}$'),   -- sha256(version|at|scan number): proves the three belong together
  created_at       timestamptz not null default now()
);
create unique index if not exists accounts_email_key on public.accounts (email);
comment on table public.accounts is 'MPC-9817. One row per signed-in person (Supabase Auth user). plan defaults to free; MPC-9818/9819 change it. consent_* is the scan-time consent carried on sign-up. NO IP address column, by decision. Deleted with the auth user and by mpt_delete_account. Read: own row only (authenticated) or service_role.';
comment on column public.accounts.keep_scans is 'MPC-9817. true = this person is signed up, so their scans are kept (they are not on the free 7-day deletion path).';

alter table public.accounts enable row level security;
alter table public.accounts force row level security;
revoke all on public.accounts from public, anon, authenticated;
grant select on public.accounts to authenticated;
grant all on public.accounts to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'accounts' and policyname = 'own account read') then
    create policy "own account read" on public.accounts for select to authenticated using (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'accounts' and policyname = 'service role full access') then
    create policy "service role full access" on public.accounts for all to service_role using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------- account <-> saved scan
create table if not exists public.account_scans (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  web_scan_id  uuid not null references public.web_scans(id) on delete cascade,   -- the scan number; a purged scan drops its link
  scans_id     uuid,                                                                -- public.scans.id of the email request (no foreign key: scans purge on their own clock)
  claim_method text not null check (claim_method in ('current', 'claim', 'confirm')),
  linked_at    timestamptz not null default now(),
  primary key (account_id, web_scan_id)
);
create index if not exists account_scans_web_scan_idx on public.account_scans (web_scan_id);
comment on table public.account_scans is 'MPC-9817. Which saved scans (web_scans.id = scan number) belong to which account. claim_method: current = attached at sign-in, claim = typed scan number + signed-in email, confirm = the one-step tick at report time. No IP. Cascades from the account and from the saved scan.';

alter table public.account_scans enable row level security;
alter table public.account_scans force row level security;
revoke all on public.account_scans from public, anon, authenticated;
grant all on public.account_scans to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_scans' and policyname = 'service role full access') then
    create policy "service role full access" on public.account_scans for all to service_role using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------- the one-step tick
alter table public.web_scan_contacts add column if not exists account_requested_at timestamptz;
comment on column public.web_scan_contacts.account_requested_at is 'MPC-9817. Set when the visitor ticked "Keep my scan and create my free account" (one step). The account is created only when the click-to-confirm email proves the inbox (MPC-9813).';

-- ---------------------------------------------------------------- entitlement data (Free values only; MPC-9818 fills the rest)
create table if not exists public.capability_min_tier (
  key       text primary key check (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  min_tier  text not null check (min_tier in ('free', 'basic', 'pro', 'executive')),
  cost      text check (cost is null or cost in ('none', 'third_party')),
  status    text check (status is null or status in ('live', 'planned')),
  note      text,
  -- the pricing principle (Chris 2026-11-07, F2 spec rule 2): a check MPT pays a third party for is never free
  constraint capability_third_party_not_free check (cost is distinct from 'third_party' or min_tier <> 'free')
);
comment on table public.capability_min_tier is 'MPC-9817. Entitlement data from the Paid Exposure Report spec section 3: one row per capability, the lowest tier that has it (order free < basic < pro < executive). Only the free rows are wired here; MPC-9818 adds the paid rows. Unknown keys are denied by mpt_can.';
alter table public.capability_min_tier enable row level security;
alter table public.capability_min_tier force row level security;
revoke all on public.capability_min_tier from public, anon, authenticated;
grant all on public.capability_min_tier to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capability_min_tier' and policyname = 'service role full access') then
    create policy "service role full access" on public.capability_min_tier for all to service_role using (true) with check (true);
  end if;
end $$;

insert into public.capability_min_tier (key, min_tier, cost, status) values
  ('scan.browser_hexagons',       'free', null,   'live'),
  ('scan.email_checks',           'free', null,   'live'),
  ('report.score',                'free', null,   'live'),
  ('report.hexagon_guides',       'free', null,   'live'),
  ('report.optout_guides',        'free', null,   'live'),
  ('broker.listing_check_pasted', 'free', 'none', 'live')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- functions (service_role only)
create or replace function public.mpt_tier_rank(p_tier text) returns int
language sql immutable as $$ select case p_tier when 'free' then 0 when 'basic' then 1 when 'pro' then 2 when 'executive' then 3 else null end $$;

-- Creates the account row for a verified auth user (idempotent) and carries the consent from the scan it signed up on, when that scan belongs to the same email.
create or replace function public.mpt_ensure_account(p_user uuid, p_email text, p_scan uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(trim(p_email)); v_ver text; v_at timestamptz; a public.accounts;
begin
  if p_user is null or v_email is null or v_email = '' then raise exception 'user and email required' using errcode = '22023'; end if;
  insert into public.accounts (id, email) values (p_user, v_email) on conflict (id) do nothing;
  if p_scan is not null then
    select c.save_consent_version, c.save_consent_at into v_ver, v_at
      from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
     where c.web_scan_id = p_scan and c.channel = 'email' and lower(s.email_scanned) = v_email and c.save_consent_version is not null
     limit 1;
    if v_ver is not null then
      update public.accounts
         set consent_version = v_ver, consent_at = v_at, consent_scan_id = p_scan,
             consent_hash = encode(sha256(convert_to(v_ver || '|' || v_at::text || '|' || p_scan::text, 'UTF8')), 'hex')
       where id = p_user and consent_version is null;
    end if;
  end if;
  select * into a from public.accounts where id = p_user;
  return jsonb_build_object('id', a.id, 'email', a.email, 'plan', a.plan, 'keep_scans', a.keep_scans, 'created_at', a.created_at,
                            'consent_version', a.consent_version, 'consent_at', a.consent_at);
end $$;

-- Attaches one saved scan to an account. The signed-in email (proved by the sign-in link) must be the email the scan was requested with.
-- A linked scan leaves the free 7-day deletion path: its public.scans row gets no expiry.
create or replace function public.mpt_link_scan_to_account(p_account uuid, p_web_scan uuid, p_method text default 'claim')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text; v_scans uuid; n int;
begin
  if p_method not in ('current', 'claim', 'confirm') then raise exception 'bad method' using errcode = '22023'; end if;
  select email into v_email from public.accounts where id = p_account;
  if v_email is null then return jsonb_build_object('linked', false, 'reason', 'no_account'); end if;
  select s.id into v_scans
    from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
   where c.web_scan_id = p_web_scan and c.channel = 'email' and lower(s.email_scanned) = v_email
   limit 1;
  if v_scans is null then return jsonb_build_object('linked', false, 'reason', 'not_your_scan'); end if;   -- same answer whether the number exists or not
  insert into public.account_scans (account_id, web_scan_id, scans_id, claim_method) values (p_account, p_web_scan, v_scans, p_method) on conflict do nothing;
  get diagnostics n = row_count;
  update public.scans set expires_at = null where id = v_scans and expires_at is not null;
  return jsonb_build_object('linked', true, 'already', n = 0, 'scan_number', p_web_scan);
end $$;

create or replace function public.mpt_list_account_scans(p_account uuid)
returns table (scan_number uuid, created_at timestamptz, hexagon_count int, linked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.created_at, w.hexagon_count, l.linked_at
    from public.account_scans l join public.web_scans w on w.id = l.web_scan_id
   where l.account_id = p_account order by w.created_at desc;
$$;

-- "Open": the saved result of one of the account's own scans (nothing for a scan that is not linked to this account).
create or replace function public.mpt_get_account_scan(p_account uuid, p_web_scan uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('scan_number', w.id, 'created_at', w.created_at, 'hexagon_count', w.hexagon_count, 'results', w.results)
    from public.account_scans l join public.web_scans w on w.id = l.web_scan_id
   where l.account_id = p_account and l.web_scan_id = p_web_scan;
$$;

-- Really deletes (not unlinks): every linked saved scan (cascades to contact links, listing checks, events, returns), the linked email-request scans (cascades to signals
-- and hexagon scores), then the account row. Counts only come back. The caller then deletes the auth user.
create or replace function public.mpt_delete_account(p_account uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_web int := 0; n_scans int := 0; n_acc int := 0; ids_web uuid[]; ids_scans uuid[];
begin
  select coalesce(array_agg(web_scan_id), '{}'), coalesce(array_agg(scans_id) filter (where scans_id is not null), '{}') into ids_web, ids_scans
    from public.account_scans where account_id = p_account;
  delete from public.web_scans where id = any(ids_web);
  get diagnostics n_web = row_count;
  delete from public.scans where id = any(ids_scans);
  get diagnostics n_scans = row_count;
  delete from public.accounts where id = p_account;
  get diagnostics n_acc = row_count;
  return jsonb_build_object('account_deleted', n_acc > 0, 'web_scans_deleted', n_web, 'scans_deleted', n_scans, 'deleted_at', now());
end $$;

-- can(account, capability): reads capability_min_tier. Unknown keys and unknown accounts are denied. Free values only exist until MPC-9818.
create or replace function public.mpt_can(p_account uuid, p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_plan text; v_min text;
begin
  select plan into v_plan from public.accounts where id = p_account;
  if v_plan is null then return jsonb_build_object('allowed', false, 'min_tier', null, 'reason', 'no_account'); end if;
  select min_tier into v_min from public.capability_min_tier where key = p_key;
  if v_min is null then return jsonb_build_object('allowed', false, 'min_tier', null, 'reason', 'unknown_capability'); end if;
  if public.mpt_tier_rank(v_plan) >= public.mpt_tier_rank(v_min) then return jsonb_build_object('allowed', true, 'min_tier', v_min, 'reason', 'tier_ok'); end if;
  return jsonb_build_object('allowed', false, 'min_tier', v_min, 'reason', 'tier_too_low');
end $$;

revoke all on function public.mpt_tier_rank(text), public.mpt_ensure_account(uuid, text, uuid), public.mpt_link_scan_to_account(uuid, uuid, text),
  public.mpt_list_account_scans(uuid), public.mpt_get_account_scan(uuid, uuid), public.mpt_delete_account(uuid), public.mpt_can(uuid, text) from public, anon, authenticated;
grant execute on function public.mpt_tier_rank(text), public.mpt_ensure_account(uuid, text, uuid), public.mpt_link_scan_to_account(uuid, uuid, text),
  public.mpt_list_account_scans(uuid), public.mpt_get_account_scan(uuid, uuid), public.mpt_delete_account(uuid), public.mpt_can(uuid, text) to service_role;
