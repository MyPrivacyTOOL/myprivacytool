-- MPC-9893: deleting a saved scan deletes its scan_recipient_log rows (trigger web_scans_recipient_log_follow). Throwaway database only.
-- Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

insert into public.recipients_registry (key, body, registry_hash, synced_at)
  values ('ga4', '{}'::jsonb, repeat('a', 64), now()), ('supabase', '{}'::jsonb, repeat('a', 64), now())
  on conflict (key) do nothing;

do $$
declare
  w1 uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); w3 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s_shared uuid := gen_random_uuid(); s_other uuid := gen_random_uuid();
  untouched int;
begin
  insert into public.web_scans (id, hexagon_count, results, results_bytes) values
    (w1, 1, '[{}]'::jsonb, 4), (w2, 1, '[{}]'::jsonb, 4), (w3, 1, '[{}]'::jsonb, 4);
  -- w1 -> s1 (its own scan row) and s_shared (also linked to w2); w3 -> s_other
  insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values (w1, 'email', s1), (w1, 'email', s_shared), (w2, 'email', s_shared), (w3, 'email', s_other);
  insert into public.scan_recipient_log (scan_id, recipient_key, items, status, at) values
    (s1::text, 'supabase', '{email}', 'ran', now()),
    (w1::text, 'supabase', '{}', 'skipped_disabled', now()),
    (s_shared::text, 'ga4', '{}', 'skipped_disabled', now()),
    (s_other::text, 'supabase', '{email}', 'ran', now());

  delete from public.web_scans where id = w1;

  perform pg_temp.assert((select count(*) from public.scan_recipient_log where scan_id in (s1::text, w1::text)) = 0, 'rows keyed by the deleted scan''s own scan id and scan number are gone');
  perform pg_temp.assert((select count(*) from public.scan_recipient_log where scan_id = s_shared::text) = 1, 'rows of a scan id still linked to another web scan stay');
  select count(*) into untouched from public.scan_recipient_log where scan_id = s_other::text;
  perform pg_temp.assert(untouched = 1, 'another scan''s rows are untouched');

  delete from public.web_scans where id = w2;
  perform pg_temp.assert((select count(*) from public.scan_recipient_log where scan_id = s_shared::text) = 0, 'once the last linked web scan goes, the shared scan id''s rows go too');
  perform pg_temp.assert((select count(*) from public.scan_recipient_log where scan_id = s_other::text) = 1, 'still untouched after the second delete');
end $$;
rollback;
