-- MPC-7494 (inbound funnels F5, the open mirror): the candidate lookup for "welcome back, we recognised your device".
--
-- mpt_recognition_candidates(p_hashes, p_limit) returns saved web scans that
--   1. have a contact link carrying the specific save consent (web_scan_contacts.save_consent_at is not null, MPC-7470 / D12), and
--   2. are inside the retention period (web_scan_retention.months), and
--   3. share at least one of the given hash values (canvas or audio fingerprint) with the visitor's new scan.
-- The consent and retention checks live HERE, not only in the Worker, so no caller can read an unconsented or expired scan through this
-- function. It returns scan number, time and results only: no contact, email or user id is joined, so nothing here can say who a visitor is.
-- Read-only (stable). service_role only. The Worker does the scoring (workers/scan-report/lib/recognise.js).
-- Rollback: drop function if exists public.mpt_recognition_candidates(jsonb, integer);

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
     and exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id and c.save_consent_at is not null)
     and w.created_at >= now() - make_interval(months => coalesce((select r.months from public.web_scan_retention r where r.id), 12))
     and exists (select 1 from jsonb_array_elements(p_hashes) h where jsonb_typeof(h) = 'object' and w.results @> jsonb_build_array(h))
   order by w.created_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.mpt_recognition_candidates(jsonb, integer) from public, anon, authenticated;
grant execute on function public.mpt_recognition_candidates(jsonb, integer) to service_role;

comment on function public.mpt_recognition_candidates(jsonb, integer) is 'MPC-7494. Saved web scans with the specific save consent, inside retention, sharing a fingerprint hash with the given values. Read-only. No contact or user data. service_role only.';
