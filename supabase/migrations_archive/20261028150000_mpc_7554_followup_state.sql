-- MPC-7554: follow-ups driven by what was found for each report, for every user. Two additive, nullable columns on public.scans:
--   fixed_at       when the person pressed "I have fixed this" (stops the follow-ups for that report; it is NOT an unsubscribe)
--   followup_ended why the follow-ups for this report ended without being sent: 'fixed' or 'unsubscribed'
-- The Worker reads and writes them only when FOLLOWUP_STATE_ENABLED = "true" (workers/scan-report/wrangler.toml), so this migration can be applied before or after the code.
-- ROLLBACK: alter table public.scans drop column if exists followup_ended, drop column if exists fixed_at;
alter table public.scans
  add column if not exists fixed_at       timestamptz,
  add column if not exists followup_ended text check (followup_ended in ('fixed','unsubscribed'));
comment on column public.scans.fixed_at is 'MPC-7554: the person said they fixed what the report found (signed link). Ends follow-ups for this report only.';
comment on column public.scans.followup_ended is 'MPC-7554: follow-ups ended without being sent (fixed | unsubscribed).';
