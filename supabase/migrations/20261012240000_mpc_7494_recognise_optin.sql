-- MPC-7494 (the open mirror): recognising a device is its OWN consent, separate from "save my scan result" (MPC-7491 wording:
-- "If you choose to ... Recognising a device is only used with your consent").
--
-- 1. web_scan_contacts gets recognise_consent_at / recognise_consent_version, written by the Worker only when the visitor ticked the
--    separate "Recognise this device" box at the contact step (and the save box). Null = no recognition consent. Additive, nullable, idempotent.
-- 2. mpt_recognition_candidates returns a scan ONLY if its contact link has BOTH save_consent_at and recognise_consent_at (and it is inside
--    retention and shares a hash). Scans saved before this change have no recognise consent, so they are no longer candidates.
-- Read-only (stable), service_role only, no contact or user data returned. Same signature and grants as before.
-- Rollback: put back the function body from 20261012230000_mpc_7494_recognition_candidates.sql, then
--   alter table public.web_scan_contacts drop column if exists recognise_consent_at, drop column if exists recognise_consent_version;

alter table public.web_scan_contacts
  add column if not exists recognise_consent_at      timestamptz,
  add column if not exists recognise_consent_version text check (recognise_consent_version is null or recognise_consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$');

comment on column public.web_scan_contacts.recognise_consent_at is 'MPC-7494. When the visitor ticked the separate "Recognise this device?" box at the contact step (Worker clock). Null = no recognition consent: the scan is never a recognition candidate.';
comment on column public.web_scan_contacts.recognise_consent_version is 'MPC-7494. Version of the recognition tick-box wording the visitor saw, e.g. 2026-10-12-v1.';

create or replace function public.mpt_recognition_candidates(p_hashes jsonb, p_limit integer default 200)
returns table (web_scan_id uuid, scanned_at timestamptz, results jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select w.id, w.created_at, w.results
    from public.web_scans w
   where jsonb_typeof(p_hashes) = 'array'
     and jsonb_array_length(p_hashes) between 1 and 4
     and exists (select 1 from public.web_scan_contacts c
                  where c.web_scan_id = w.id and c.save_consent_at is not null and c.recognise_consent_at is not null)
     and w.created_at >= now() - make_interval(months => coalesce((select r.months from public.web_scan_retention r where r.id), 12))
     and exists (select 1 from jsonb_array_elements(p_hashes) h where jsonb_typeof(h) = 'object' and w.results @> jsonb_build_array(h))
   order by w.created_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.mpt_recognition_candidates(jsonb, integer) from public, anon, authenticated;
grant execute on function public.mpt_recognition_candidates(jsonb, integer) to service_role;
