-- MPC-9018: Telegram capture is kept 90 days after the person's last message, and a daily job deletes what has expired.
--
-- Why: the live Privacy page says Telegram messaging data is "kept for up to 90 days, then deleted automatically". mpt_social_record set
-- retain_until = now() + 2 years for every platform, and nothing scheduled mpt_purge_expired_social_contacts() (pg_cron installed, 0 matching jobs,
-- checked 2026-10-31). So the promise was not kept.
--
-- What changes:
--   1. mpt_social_record: Telegram contacts get now() + 90 days on every recorded event (a sliding window: 90 days after the last message). Every other
--      platform keeps 2 years, exactly as before. Nothing else in the function changes.
--   2. Existing Telegram contacts are re-dated to at most 90 days after their last activity (never later than they were). This only shortens.
--   3. A daily pg_cron job calls mpt_purge_expired_social_contacts() (contacts whose retain_until has passed; their events go with them).
--
-- Not covered here: core-brain's conversation_states has its own hourly purge (20261019160000). Scan snapshots and deeper-scan data keep their own 90 day settings.
-- Idempotent. ROLLBACK: select cron.unschedule('mpt-purge-social-contacts'); then re-run mpt_social_record from 20261028110000_ck_8502_social_event_hexagon_data.sql.
--   Rows already purged cannot be restored.
begin;
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
         retain_until = now() + case when c.platform = 'telegram' then interval '90 days' else interval '2 years' end,
         hubspot_synced_at = null
   where c.id = v_id;
  return jsonb_build_object('contact_id', v_id, 'duplicate', false);
end $$;

revoke all on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb) to service_role;

-- Existing Telegram contacts: shorten only, never lengthen.
update public.social_contacts
   set retain_until = least(retain_until, last_seen_at + interval '90 days')
 where platform = 'telegram';
commit;

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-social-contacts';
    perform cron.schedule('mpt-purge-social-contacts', '50 19 * * *', 'select public.mpt_purge_expired_social_contacts();');
  end if;
end $$;
