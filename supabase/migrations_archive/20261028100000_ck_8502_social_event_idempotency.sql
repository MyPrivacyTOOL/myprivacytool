-- CK-8502: make the X activity feed safe against platform retries and reordering. Additive; no existing row or function changes.
--
-- Gap: public.mpt_social_touch() counted every delivery. X (and Telegram) resend an event on any non-2xx, so a retry inflated
-- event_count, appended a duplicate social_events row and re-synced HubSpot. There was also no platform-origin id or timestamp on the row.
--
-- public.mpt_social_record() is the idempotent form. The Worker passes the platform's own event id (p_event_key), the platform's
-- timestamp (p_occurred_at) and the id of the public post it relates to (p_source_ref: a tweet id, never text). A second delivery of
-- the same event_key for the same contact changes nothing and returns duplicate = true. last_seen_at only moves forward, so a late
-- (reordered) event cannot make the contact look older. The Worker falls back to mpt_social_touch() while this function does not exist.
-- Still no message text. Same retention (2 years), same erase path (mpt_erase_social_contact; events cascade). service_role only.
--
-- ROLLBACK (leaves the feed exactly as before):
--   drop function if exists public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text);
--   drop index if exists public.social_events_contact_event_key_idx;
--   alter table public.social_events drop column if exists source_ref, drop column if exists occurred_at, drop column if exists event_key;

alter table public.social_events
  add column if not exists event_key   text check (event_key is null or char_length(event_key) between 1 and 200),
  add column if not exists occurred_at timestamptz,
  add column if not exists source_ref  text check (source_ref is null or char_length(source_ref) between 1 and 64);

create unique index if not exists social_events_contact_event_key_idx on public.social_events (contact_id, event_key) where event_key is not null;

comment on column public.social_events.event_key   is 'CK-8502: the platform''s own id for this event (or a key built from its fields). Unique per contact: a redelivery is a no-op.';
comment on column public.social_events.occurred_at is 'CK-8502: platform timestamp of the event (not our receive time).';
comment on column public.social_events.source_ref  is 'CK-8502: platform id of the public post the event relates to (content correlation). An id only, never text.';

create or replace function public.mpt_social_record(
  p_platform text, p_user_id text, p_handle text, p_event text, p_follows_us boolean default null,
  p_event_key text default null, p_occurred_at timestamptz default null, p_source_ref text default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_event uuid;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_event is null or p_event not in ('dm','follow','like','share','mention','mirror_consent') then
    raise exception 'unknown social event: %', p_event using errcode = '22023';
  end if;
  -- ensure the contact exists; counters move only when an event row is actually added below
  insert into public.social_contacts (platform, platform_user_id, handle, follows_us, event_count, first_seen_at, last_seen_at)
    values (p_platform, p_user_id, nullif(p_handle, ''), p_follows_us, 0, least(v_at, now()), least(v_at, now()))
  on conflict (platform, platform_user_id) do update set platform = excluded.platform
  returning id into v_id;

  insert into public.social_events (contact_id, event_type, event_key, occurred_at, source_ref, created_at)
    values (v_id, p_event, p_event_key, p_occurred_at, nullif(p_source_ref, ''), now())
  on conflict (contact_id, event_key) where event_key is not null do nothing
  returning id into v_event;

  if v_event is null then
    return jsonb_build_object('contact_id', v_id, 'duplicate', true);
  end if;

  update public.social_contacts c
     set handle = coalesce(nullif(p_handle, ''), c.handle),
         follows_us = coalesce(p_follows_us, c.follows_us),
         first_seen_at = least(c.first_seen_at, v_at),
         last_seen_at = greatest(c.last_seen_at, least(v_at, now())),
         event_count = c.event_count + 1,
         retain_until = now() + interval '2 years',
         hubspot_synced_at = null
   where c.id = v_id;
  return jsonb_build_object('contact_id', v_id, 'duplicate', false);
end $$;

revoke all on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text) to service_role;
