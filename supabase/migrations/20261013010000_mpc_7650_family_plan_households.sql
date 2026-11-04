-- MPC-7650 (Family Plan): a household is one paid subscription that covers up to 5 profiles (the owner plus 4 members).
--
-- Permissions (Input Spec): the primary account holder (owner) invites members by email. The owner can view a CHILD member's reports;
-- adults, the owner included, have privacy from each other. So read access to a member's scan history is decided by
-- mpt_household_can_view_reports(viewer, subject), which is true only for yourself, or for the owner looking at a child.
-- The +$5/month per additional member price lives in billing (not built yet); this migration holds no price or payment data.
-- This migration only adds the tables, the cap and the permission rule. Scans are not yet tied to a user account, so wiring a profile's
-- scan history to these rows comes with accounts and billing.
-- Rollback: drop function if exists public.mpt_household_can_view_reports(uuid, uuid);
--           drop table if exists public.household_members; drop table if exists public.households;
--           drop function if exists public.mpt_household_member_cap();

create table if not exists public.households (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table if not exists public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,   -- null until an invited person signs up
  email        text,                                                 -- set for invites; the invite is matched to the account by email
  display_name text not null check (char_length(display_name) between 1 and 80),
  role         text not null check (role in ('owner', 'adult', 'child')),
  status       text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_at   timestamptz not null default now(),
  joined_at    timestamptz,
  check (user_id is not null or email is not null),
  check (role <> 'owner' or user_id is not null)
);
create unique index if not exists household_members_one_owner_idx on public.household_members (household_id) where role = 'owner';
create unique index if not exists household_members_email_idx on public.household_members (household_id, lower(email)) where email is not null and status <> 'removed';
create unique index if not exists household_members_user_idx on public.household_members (user_id) where user_id is not null and status <> 'removed';   -- one household per person
create index if not exists household_members_household_idx on public.household_members (household_id);

-- Cap: at most 5 profiles (invited or active) per household.
create or replace function public.mpt_household_member_cap() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'removed'
     and (select count(*) from public.household_members m
           where m.household_id = new.household_id and m.status <> 'removed' and m.id is distinct from new.id) >= 5 then
    raise exception 'a household holds at most 5 profiles' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists household_members_cap on public.household_members;
create trigger household_members_cap before insert or update on public.household_members
  for each row execute function public.mpt_household_member_cap();

-- Who may read whose reports: yourself, or the owner reading a child. Adults (the owner too) cannot read each other.
create or replace function public.mpt_household_can_view_reports(p_viewer uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_viewer is not null and p_subject is not null and (
    p_viewer = p_subject
    or exists (
      select 1
        from public.household_members o
        join public.household_members c on c.household_id = o.household_id
       where o.user_id = p_viewer  and o.role = 'owner' and o.status = 'active'
         and c.user_id = p_subject and c.role = 'child' and c.status = 'active'
    )
  );
$$;
revoke all on function public.mpt_household_can_view_reports(uuid, uuid) from public, anon;
grant execute on function public.mpt_household_can_view_reports(uuid, uuid) to authenticated, service_role;

-- RLS. Owners manage their own household; a member sees only their own row (no adult sees another adult's profile).
alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.household_members enable row level security;
alter table public.household_members force row level security;
revoke all on public.households, public.household_members from anon, authenticated;
grant select, insert, update, delete on public.households, public.household_members to authenticated;

create policy households_owner_all on public.households for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy household_members_owner_all on public.household_members for all to authenticated
  using (exists (select 1 from public.households h where h.id = household_id and h.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.owner_user_id = auth.uid()));

create policy household_members_self_read on public.household_members for select to authenticated
  using (user_id = auth.uid());

comment on table public.households is 'MPC-7650. One Family Plan subscription. Up to 5 profiles. No payment data.';
comment on table public.household_members is 'MPC-7650. Profiles in a household: owner, adult or child. Capped at 5 non-removed rows.';
