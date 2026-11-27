-- MPC-9893 (Open Tracker design 1.6): "Deleting the scan deletes the rows."
-- public.scan_recipient_log (MPC-9885) is keyed by the server scan id (scans.id), while the visitor deletes by SCAN NUMBER (web_scans.id, mpt_delete_web_scan).
-- This trigger makes the per-scan "who saw what" rows go with the saved scan, whichever path deletes it (the visitor's delete, the retention purge, the DSAR
-- erase): before a web_scans row is removed, the log rows for its scan number and for the scan rows linked to it through web_scan_contacts are removed in the
-- same transaction. A scans.id still linked to ANOTHER web scan keeps its rows until that scan goes too.
-- MPC-9890 adds the free-user deletion job and keeps this table in its deletion transaction; this trigger is the part that needs no scheduler.
-- Rollback:  drop trigger if exists web_scans_recipient_log_follow on public.web_scans;  drop function if exists public.mpt_recipient_log_follow_scan();

create or replace function public.mpt_recipient_log_follow_scan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  delete from public.scan_recipient_log l
   where (l.scan_id = old.id::text
          or l.scan_id in (select c.contact_id::text from public.web_scan_contacts c where c.web_scan_id = old.id and c.channel = 'email'))
     and not exists (select 1 from public.web_scan_contacts o where o.contact_id::text = l.scan_id and o.web_scan_id <> old.id);
  return old;
end
$f$;

revoke all on function public.mpt_recipient_log_follow_scan() from public, anon, authenticated;

drop trigger if exists web_scans_recipient_log_follow on public.web_scans;
create trigger web_scans_recipient_log_follow
  before delete on public.web_scans
  for each row execute function public.mpt_recipient_log_follow_scan();
