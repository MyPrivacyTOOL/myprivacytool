-- MPC-7470: retention for saved web scans, as stated in the privacy policy (Chris approved 2026-10-11):
--   scans linked to a contact are deleted 12 months after the scan; scans never linked to a contact, 90 days after the scan.
-- This only creates the purge function (service_role only). Scheduling is a separate step (see the MPC-7470 task): call
-- select public.mpt_purge_expired_web_scans(); daily from the mpt-scan-report cron or an operator.
-- Rollback: drop function if exists public.mpt_purge_expired_web_scans();

create or replace function public.mpt_purge_expired_web_scans()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n_unlinked int; n_linked int;
begin
  delete from public.web_scans w
   where w.created_at < now() - interval '90 days'
     and not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = w.id);
  get diagnostics n_unlinked = row_count;
  delete from public.web_scans w where w.created_at < now() - interval '12 months';
  get diagnostics n_linked = row_count;
  return jsonb_build_object('purged_unlinked', n_unlinked, 'purged_linked', n_linked, 'ran_at', now());
end $$;

revoke all on function public.mpt_purge_expired_web_scans() from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_web_scans() to service_role;

comment on function public.mpt_purge_expired_web_scans() is 'MPC-7470. Deletes saved web scans: 90 days if never linked to a contact, 12 months otherwise. service_role only.';
comment on table public.web_scans is 'MPC-7465. One row per completed web scan. id = random scan number. results = per-hexagon {id,label,value,icon,confidence,risk,confirmed,category} as sent by the browser (untrusted text); these values include browser-reported IP addresses, so a saved scan is personal data. No email or user id column. Retention (MPC-7470): 90 days unlinked, 12 months linked; purge with public.mpt_purge_expired_web_scans(). service_role only.';
