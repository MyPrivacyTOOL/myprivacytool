-- Telegram data is kept until the person asks for deletion (owner direction, 2026-11-01: no automatic deletions for now). This REVERSES the
-- retention part of MPC-9018 (20261031190000), which kept Telegram capture 90 days after the last message and scheduled a daily purge.
--
-- What changes:
--   1. The daily pg_cron job 'mpt-purge-social-contacts' is unscheduled.
--   2. social_contacts.retain_until may be NULL. NULL means "no expiry"; mpt_purge_expired_social_contacts() (retain_until < now()) never matches it.
--   3. mpt_social_record: Telegram contacts get retain_until = NULL on every event; every other platform keeps 2 years, as before.
--   4. channel_probe_captures.expires_at may be NULL (PROBE_MODE=all rows with no expiry). Mode "on" rows still default to 7 days.
--   5. Existing Telegram contacts are set to NULL (this LENGTHENS what MPC-9018 shortened).
--
-- NOT RESTORABLE: any Telegram contact the MPC-9018 job already deleted. Check cron.job_run_details before applying. Erasure on request
-- (mpt_erase_social_contact, STOP in chat) is unchanged. Do not apply until the owner who ordered MPC-9018 has confirmed; the privacy page and bot reply
-- must say "kept until you ask us to delete it" first (draft PR: claude/retention-wording).
-- Idempotent. ROLLBACK: re-run 20261031190000_mpc_9018_telegram_capture_90_days.sql (this sets retain_until back to at most 90 days and re-schedules the job).
begin;
alter table public.social_contacts alter column retain_until drop not null;
alter table public.channel_probe_captures alter column expires_at drop not null;
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
         retain_until = case when c.platform = 'telegram' then null else now() + interval '2 years' end,
         hubspot_synced_at = null
   where c.id = v_id;
  return jsonb_build_object('contact_id', v_id, 'duplicate', false);
end $$;

revoke all on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.mpt_social_record(text, text, text, text, boolean, text, timestamptz, text, jsonb) to service_role;

update public.social_contacts set retain_until = null where platform = 'telegram' and retain_until is not null;
commit;

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-social-contacts';
  end if;
end $$;
