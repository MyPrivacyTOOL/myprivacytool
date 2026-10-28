-- MPC-8737 M3: erase parity. The three live erase functions also erase the person's ledger record, so the ledger honours deletion from day one
-- (design MPC-7898 section 10, step M3; backfill refuses to run until public.mpt_dsar_erase calls ledger.erase_person).
-- Replaces public.mpt_dsar_erase, public.mpt_erase_chat_sender and public.mpt_erase_social_contact. Signatures and return types are UNCHANGED, except that
-- mpt_dsar_erase's jsonb gains one key (ledger_persons). Every legacy delete runs exactly as before; the ledger erase is added after it.
-- The ledger person is found by the identifiers the person had BEFORE the legacy rows disappear (email_hash, user_id, lead_id, scan_id, web_scan_id for the DSAR;
-- wa_id / telegram_id / conversation_id for a chat sender; social_x for an X contact). No identifier match means no ledger person: nothing to erase, no error.
-- If a ledger erase raises, the whole erase fails loudly (never a silent partial erase). Idempotent: create or replace.
--
-- Rollback (tested by supabase/tests/run.sh, which extracts the lines below): restores the three functions exactly as they were in production on 2026-10-28.
-- ROLLBACK
--   create or replace function public.mpt_dsar_erase(p_email text) returns jsonb language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $f$
--   declare
--     e text := lower(btrim(p_email));
--     h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');
--     n_users int; n_leads int; n_subs int; n_base int; n_scans int; n_web int; n_ref int;
--   begin
--     select count(*) into n_scans from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e;
--     delete from public.web_scans where id in (
--       select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
--       where c.channel = 'email' and lower(u.email) = e);              get diagnostics n_web   = row_count;
--     delete from public.referrals where invitee_hash = h;             get diagnostics n_ref   = row_count;
--     delete from public.users where lower(email) = e;                 get diagnostics n_users = row_count;
--     delete from public.leads where lower(email) = e;                 get diagnostics n_leads = row_count;
--     delete from public.subscribers where lower(email) = e;           get diagnostics n_subs  = row_count;
--     delete from public.mpt_score_baselines where email_hash = h;     get diagnostics n_base  = row_count;
--     return jsonb_build_object('erased_at', now(), 'users', n_users, 'scans_cascaded', n_scans,
--                               'leads', n_leads, 'subscribers', n_subs, 'score_baselines', n_base, 'web_scans', n_web, 'referral_invitations', n_ref);
--   end $f$;
--   create or replace function public.mpt_erase_chat_sender(p_channel text, p_sender_id text) returns integer language plpgsql set search_path to 'public', 'pg_temp' as $f$
--   declare n integer;
--   begin
--     delete from public.conversation_states where channel = p_channel and sender_id = p_sender_id;
--     get diagnostics n = row_count;
--     return n;
--   end $f$;
--   create or replace function public.mpt_erase_social_contact(p_platform text, p_user_id text) returns integer language plpgsql set search_path to 'public', 'pg_temp' as $f$
--   declare n integer;
--   begin
--     delete from public.social_contacts where platform = p_platform and platform_user_id = p_user_id;
--     get diagnostics n = row_count;
--     return n;
--   end $f$;

create or replace function public.mpt_dsar_erase(p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');
  n_users int; n_leads int; n_subs int; n_base int; n_scans int; n_web int; n_ref int;
  lp uuid[] := '{}'; p uuid; n_ledger int := 0;
begin
  select count(*) into n_scans from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e;
  -- MPC-8737 M3: find this person's ledger record(s) BEFORE the legacy rows (and so their ids) disappear.
  if to_regprocedure('ledger.erase_person(uuid)') is not null then
    select coalesce(array_agg(distinct ledger.root_person(pi.person_id)), '{}') into lp
    from ledger.person_identifier pi
    where (pi.id_type = 'email_hash' and pi.id_value = h)
       or (pi.id_type = 'user_id' and pi.id_value in (select u.id::text from public.users u where lower(u.email) = e))
       or (pi.id_type = 'lead_id' and pi.id_value in (select l.id::text from public.leads l where lower(l.email) = e))
       or (pi.id_type = 'scan_id' and pi.id_value in (select s.id::text from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e))
       or (pi.id_type = 'web_scan_id' and pi.id_value in (
            select c.web_scan_id::text from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
            where c.channel = 'email' and lower(u.email) = e));
  end if;
  -- MPC-7470: saved web scans first (web_scan_contacts.contact_id has no foreign key to scans, so deleting users does not reach them).
  -- Deleting a web_scans row cascades to its web_scan_contacts rows.
  delete from public.web_scans where id in (
    select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
    where c.channel = 'email' and lower(u.email) = e);              get diagnostics n_web   = row_count;
  -- MPC-7645: an invitation addressed to this person but never taken up has no users row, so it is found by the hash. Rows tied to a user go with the user (ON DELETE CASCADE).
  delete from public.referrals where invitee_hash = h;             get diagnostics n_ref   = row_count;
  delete from public.users where lower(email) = e;                 get diagnostics n_users = row_count;
  delete from public.leads where lower(email) = e;                 get diagnostics n_leads = row_count;
  delete from public.subscribers where lower(email) = e;           get diagnostics n_subs  = row_count;
  delete from public.mpt_score_baselines where email_hash = h;     get diagnostics n_base  = row_count;
  -- MPC-8737 M3: erase the ledger record(s) (identifiers, data points, shown events, risk decisions, render log). Raises on failure: never a silent partial erase.
  foreach p in array lp loop perform ledger.erase_person(p); n_ledger := n_ledger + 1; end loop;
  return jsonb_build_object('erased_at', now(), 'users', n_users, 'scans_cascaded', n_scans,
                            'leads', n_leads, 'subscribers', n_subs, 'score_baselines', n_base, 'web_scans', n_web, 'referral_invitations', n_ref,
                            'ledger_persons', n_ledger);
end $function$;

create or replace function public.mpt_erase_chat_sender(p_channel text, p_sender_id text)
 returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare n integer; conv text[]; cid text; p uuid; seen uuid[] := '{}';
begin
  select coalesce(array_agg(id::text), '{}') into conv from public.conversation_states where channel = p_channel and sender_id = p_sender_id;
  delete from public.conversation_states where channel = p_channel and sender_id = p_sender_id;
  get diagnostics n = row_count;
  -- MPC-8737 M3: the sender's ledger record, found by platform id (WhatsApp number or Telegram id) and by the conversation ids just deleted.
  if to_regprocedure('ledger.erase_person(uuid)') is not null then
    if p_channel = 'whatsapp' then p := ledger.resolve_person('wa_id', p_sender_id, false);
    elsif p_channel = 'telegram' then p := ledger.resolve_person('telegram_id', p_sender_id, false);
    end if;
    if p is not null then seen := seen || p; perform ledger.erase_person(p); end if;
    foreach cid in array conv loop
      p := ledger.resolve_person('conversation_id', cid, false);
      if p is not null and not (p = any (seen)) then seen := seen || p; perform ledger.erase_person(p); end if;
    end loop;
  end if;
  return n;
end $function$;

create or replace function public.mpt_erase_social_contact(p_platform text, p_user_id text)
 returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare n integer; p uuid;
begin
  delete from public.social_contacts where platform = p_platform and platform_user_id = p_user_id;
  get diagnostics n = row_count;
  -- MPC-8737 M3: an X contact's ledger record (identifier social_x).
  if p_platform = 'x' and to_regprocedure('ledger.erase_person(uuid)') is not null then
    p := ledger.resolve_person('social_x', p_user_id, false);
    if p is not null then perform ledger.erase_person(p); end if;
  end if;
  return n;
end $function$;
