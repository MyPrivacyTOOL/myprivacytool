-- CK-8502 (owner decision D1, 2026-10-28: record every data point, one hexagon per point). Additive.
--
-- social_events.data holds the hexagon values the platform sent with ONE event, keyed by hexagon id (shared/hexagon-registry/channels.js, e.g.
-- {"x.screen_name": "...", "x.message_text": "..."}). The Worker writes it ONLY when its flag X_CAPTURE_HEXAGONS is "on" (default off), so applying this
-- changes nothing by itself. Bounded: an object with at most 40 keys, 4 kB. It lives with the event, so erase (mpt_erase_social_contact, events cascade)
-- and the 2 year contact expiry remove it. Legal sign-off and the wording change are required BEFORE the flag is turned on for real people.
--
-- mpt_social_record gains one trailing parameter (p_data). The 8-argument version is dropped in the same transaction and the new one has a default, so the
-- Worker already deployed (8 named arguments) keeps working.
--
-- ROLLBACK:
--   drop function if exists public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb);
--   alter table public.social_events drop column if exists data;
--   then re-run the function from 20261028100000_ck_8502_social_event_idempotency.sql
begin;
alter table public.social_events
  add column if not exists data jsonb check (data is null or (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096));
comment on column public.social_events.data is 'CK-8502: hexagon values sent with this event, keyed by hexagon id. Written only with the Worker flag X_CAPTURE_HEXAGONS=on. Removed with the contact.';
drop function if exists public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text);
create or replace function public.mpt_social_record(
  p_platform text, p_user_id text, p_handle text, p_event text, p_follows_us boolean default null,
  p_event_key text default null, p_occurred_at timestamptz default null, p_source_ref text default null, p_data jsonb default null
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

  insert into public.social_events (contact_id, event_type, event_key, occurred_at, source_ref, data, created_at)
    values (v_id, p_event, p_event_key, p_occurred_at, nullif(p_source_ref, ''), p_data, now())
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

revoke all on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb) to service_role;
commit;
