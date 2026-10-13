-- MPC-7628: X (and later other platform) activity feed. NOT a second CRM: HubSpot is the CRM. This is the capture layer social-listeners
-- writes to (one contact row per platform user, one event row per follow / DM / like / share / mention) and that syncs into HubSpot.
-- Stores NO message text. Identity is the platform user id + public @handle only. Erase with mpt_erase_social_contact (a "delete my data"
-- DM calls it); rows also expire (retain_until, purge with mpt_purge_expired_social_contacts). service_role only.
-- Rollback: drop function public.mpt_social_touch(text, text, text, text, boolean), public.mpt_erase_social_contact(text, text),
--           public.mpt_purge_expired_social_contacts(); drop table public.social_events, public.social_contacts;
create table if not exists public.social_contacts (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  platform_user_id text not null check (char_length(platform_user_id) between 1 and 64),
  handle           text check (char_length(handle) between 1 and 64),
  follows_us       boolean,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  event_count      integer not null default 0 check (event_count >= 0),
  hubspot_synced_at timestamptz,
  retain_until     timestamptz not null default now() + interval '2 years',
  unique (platform, platform_user_id)
);

create table if not exists public.social_events (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.social_contacts (id) on delete cascade,
  event_type text not null check (event_type in ('dm','follow','like','share','mention','mirror_consent')),
  created_at timestamptz not null default now()
);
create index if not exists social_events_contact_idx on public.social_events (contact_id, created_at desc);
create index if not exists social_contacts_unsynced_idx on public.social_contacts (last_seen_at) where hubspot_synced_at is null;

alter table public.social_contacts enable row level security;
alter table public.social_contacts force row level security;
alter table public.social_events enable row level security;
alter table public.social_events force row level security;
revoke all on public.social_contacts from public, anon, authenticated;
revoke all on public.social_events from public, anon, authenticated;
grant select, insert, update, delete on public.social_contacts to service_role;
grant select, insert, update, delete on public.social_events to service_role;

comment on table public.social_contacts is 'MPC-7628. One row per platform user who followed, messaged, liked, shared or mentioned us. Public @handle + platform id only, no message text. Feeds HubSpot (the CRM). 2 year retention (retain_until). service_role only.';
comment on table public.social_events is 'MPC-7628. One row per activity (dm, follow, like, share, mention, mirror_consent). Type and time only, no text. Cascades with the contact. service_role only.';

-- One atomic call from the Worker: upsert the contact, bump counters, append the event.
create or replace function public.mpt_social_touch(
  p_platform text, p_user_id text, p_handle text, p_event text, p_follows_us boolean default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_event is null or p_event not in ('dm','follow','like','share','mention','mirror_consent') then
    raise exception 'unknown social event: %', p_event using errcode = '22023';
  end if;
  insert into public.social_contacts (platform, platform_user_id, handle, follows_us, event_count)
    values (p_platform, p_user_id, nullif(p_handle, ''), p_follows_us, 1)
  on conflict (platform, platform_user_id) do update
    set handle = coalesce(nullif(excluded.handle, ''), public.social_contacts.handle),
        follows_us = coalesce(excluded.follows_us, public.social_contacts.follows_us),
        last_seen_at = now(),
        event_count = public.social_contacts.event_count + 1,
        retain_until = now() + interval '2 years',
        hubspot_synced_at = null
  returning id into v_id;
  insert into public.social_events (contact_id, event_type) values (v_id, p_event);
  return jsonb_build_object('contact_id', v_id);
end $$;

create or replace function public.mpt_erase_social_contact(p_platform text, p_user_id text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.social_contacts where platform = p_platform and platform_user_id = p_user_id;   -- events cascade
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mpt_purge_expired_social_contacts()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.social_contacts where retain_until < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mpt_social_touch(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.mpt_erase_social_contact(text, text) from public, anon, authenticated;
revoke all on function public.mpt_purge_expired_social_contacts() from public, anon, authenticated;
grant execute on function public.mpt_social_touch(text, text, text, text, boolean) to service_role;
grant execute on function public.mpt_erase_social_contact(text, text) to service_role;
grant execute on function public.mpt_purge_expired_social_contacts() to service_role;
