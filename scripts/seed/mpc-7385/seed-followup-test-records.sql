-- Ticket:   MPC-7385-F1
-- Purpose:  Test records aged ~3 and ~7 days so the day-3 and day-7 follow-up emails (workers/scan-report, runFollowUpJob,
--           MPC-7261) can be verified, plus one negative control per day that must NOT be emailed.
-- STAGING ONLY. Target project ref: xmdmkumwxpgahmlweuug
--
-- !! WARNING: this repo has ONE Supabase project (xmdmkumwxpgahmlweuug) and ONE scan-report Worker (DEPLOYMENT_RUNBOOK.md: "no
-- !! separate staging Worker"). workers/scan-report/wrangler.toml points SUPABASE_URL at that same project with
-- !! RECIPIENT_ALLOWLIST = "" (live, open to everyone). If xmdmkumwxpgahmlweuug is also production, this script writes to
-- !! PRODUCTION. Confirm the project in the dashboard before running; the guard below will not run without a deliberate edit.
--
-- USAGE (identical for both files). Nothing real is stored in this file:
--   1. Edit the two guard lines near the top: uncomment mpt.seed_confirm, and replace REPLACE_ME+mpc7385@example.com with your own
--      test inbox in the form  name+mpc7385@your-domain  (plus-address; the "+mpc7385" tag is required and is the cleanup marker).
--      Derived addresses:  name+mpc7385-d3@domain, -d7, -d3-ctrl, -d7-ctrl.
--   2. Run in the Supabase SQL editor, or:  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--   Use the SAME mpt.seed_email_base in the seed and the cleanup: the cleanup marker is derived from it.
--   The script aborts with a clear message if the confirmation or the email base is unset or malformed.
--
-- How the job decides (workers/scan-report/index.js runFollowUpJob, lib/onboarding.js nextFollowUp):
--   scans.report_status = 'sent' AND followup_stage < 2 AND report_sent_at < now() - 3 days   -> candidate (oldest first, limit 20)
--   stage 1 (day-3) when followup_stage = 0 and report_sent_at <= now() - 3 days
--   stage 2 (day-7) when followup_stage = 1 and report_sent_at <= now() - 7 days
--   skipped when users.email_opt_out_at is set, or users.cohort_number is null (live mode, RECIPIENT_ALLOWLIST empty)
-- The Worker's */5 cron picks these up within ~5 minutes; no manual trigger. Needs UNSUBSCRIBE_SECRET + SUPABASE_SERVICE_ROLE_KEY set.
--
-- Rows (all marked: email <base>-<kind>@<domain> where base is name+mpc7385, AND scans.source = 'mpc-7385-seed'):
--   -d3       report 3d2h ago, followup_stage 0, cohort member            -> EXPECT day-3 email  ("Your next privacy step")
--   -d7       report 7d2h ago, followup_stage 1 (day-3 already sent)      -> EXPECT day-7 email  ("Was your privacy report useful?")
--   -d3-ctrl  report 3d2h ago, stage 0, users.email_opt_out_at set        -> must NOT be emailed
--   -d7-ctrl  report 7d2h ago, followup_stage 2 (both already sent)       -> must NOT be emailed
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, so re-running never duplicates AND never resets a row the job has already
-- advanced. To re-test from scratch run cleanup-followup-test-records.sql first, then this file again (timestamps are now()-relative).
-- Side effect: -d3 and -d7 each take the next first-100 cohort number via public.claim_onboarding_cohort() (needed for the live-mode
-- cohort check). Cleanup frees them. Run in the Supabase SQL editor (postgres role; RLS is forced with no policies, so only
-- service_role/postgres can write these tables).

begin;

-- ---- Guard 1: uncomment ONLY after confirming this project is staging / safe to receive test mail. ----
-- select set_config('mpt.seed_confirm', 'I-CONFIRMED-THIS-IS-STAGING', true);
-- ---- Guard 2: your test inbox. Edit the placeholder (must look like name+mpc7385@your-domain). ----
select set_config('mpt.seed_email_base', 'REPLACE_ME+mpc7385@example.com', true);

do $$
declare b text := coalesce(current_setting('mpt.seed_email_base', true), '');
begin
  if coalesce(current_setting('mpt.seed_confirm', true), '') <> 'I-CONFIRMED-THIS-IS-STAGING' then
    raise exception 'MPC-7385-F1 %: confirm the target project is staging, then uncomment the mpt.seed_confirm line.', 'seed refused';
  end if;
  if b = '' or b like 'REPLACE\_ME%' then
    raise exception 'MPC-7385-F1 %: mpt.seed_email_base is unset. Edit the set_config line to your inbox, e.g. name+mpc7385@your-domain.', 'seed refused';
  end if;
  if b !~ '^[A-Za-z0-9.-]+\+mpc7385@[A-Za-z0-9.-]+$' then
    raise exception 'MPC-7385-F1 %: mpt.seed_email_base must match name+mpc7385@domain (letters, digits, dot, hyphen only; no underscore or %%).', 'seed refused';
  end if;
end $$;

-- Derived test addresses (single source of truth for the rows below).
create temp table seed_emails on commit drop as
select k as kind, split_part(b, '@', 1) || '-' || k || '@' || split_part(b, '@', 2) as email
from (select current_setting('mpt.seed_email_base') as b) base,
     unnest(array['d3', 'd7', 'd3-ctrl', 'd7-ctrl']) as k;

insert into public.users (id, email, email_verified, tier, consent_given_at, consent_source, retain_until, created_at, email_opt_out_at)
select v.id, (select email from seed_emails where kind = v.kind), true, 'free', now() - interval '8 days', 'mpc-7385-seed',
       now() - interval '8 days' + interval '3 years', now() - interval '8 days', v.opt_out
from (values
  ('73850000-0000-4000-8000-0000000000a3'::uuid, 'd3',      null::timestamptz),
  ('73850000-0000-4000-8000-0000000000a7'::uuid, 'd7',      null::timestamptz),
  ('73850000-0000-4000-8000-0000000000b3'::uuid, 'd3-ctrl', now() - interval '1 day'),
  ('73850000-0000-4000-8000-0000000000b7'::uuid, 'd7-ctrl', null::timestamptz)
) as v(id, kind, opt_out)
on conflict do nothing;

-- Cohort numbers for the two rows that must be emailed (idempotent: returns the existing number if already set; null = cohort full).
do $$
declare u uuid; n integer;
begin
  foreach u in array array['73850000-0000-4000-8000-0000000000a3'::uuid, '73850000-0000-4000-8000-0000000000a7'::uuid] loop
    n := public.claim_onboarding_cohort(u);
    if n is null then raise exception 'first-100 cohort is full; cannot seed live-mode follow-up rows'; end if;
  end loop;
end $$;

insert into public.scans (
  id, user_id, email_scanned, privacy_score, scan_date, signals_found, risk_level, categories_checked, categories_unchecked,
  created_at, expires_at, source, confirmation_sent_at, report_status, report_due_at, report_attempts, report_sent_at,
  followup_stage, followup_last_sent_at, mirror_report
)
select v.id, v.user_id, (select email from seed_emails where kind = v.kind), 62, v.sent_at - interval '1 hour', 0, 'medium', array['email'], array['broker'],
       v.sent_at - interval '1 hour', now() + interval '30 days', 'mpc-7385-seed', v.sent_at - interval '55 minutes', 'sent',
       v.sent_at - interval '1 hour' + interval '48 hours', 1, v.sent_at,
       v.stage, v.last_sent,
       '{"next_steps":[{"title":"MPC-7385 test step: review your email privacy settings","url":"https://myprivacytool.io/"}]}'::jsonb
from (values
  ('73850000-0000-4000-8000-0000000000c3'::uuid, '73850000-0000-4000-8000-0000000000a3'::uuid, 'd3',      now() - interval '3 days 2 hours', 0, null::timestamptz),
  ('73850000-0000-4000-8000-0000000000c7'::uuid, '73850000-0000-4000-8000-0000000000a7'::uuid, 'd7',      now() - interval '7 days 2 hours', 1, now() - interval '4 days'),
  ('73850000-0000-4000-8000-0000000000d3'::uuid, '73850000-0000-4000-8000-0000000000b3'::uuid, 'd3-ctrl', now() - interval '3 days 2 hours', 0, null::timestamptz),
  ('73850000-0000-4000-8000-0000000000d7'::uuid, '73850000-0000-4000-8000-0000000000b7'::uuid, 'd7-ctrl', now() - interval '7 days 2 hours', 2, now() - interval '1 day')
) as v(id, user_id, kind, sent_at, stage, last_sent)
on conflict (id) do nothing;

-- Check: 4 users, 4 scans, expected stages.
select u.email, u.cohort_number, u.email_opt_out_at is not null as opted_out, s.followup_stage, s.report_sent_at, s.report_status
from public.users u join public.scans s on s.user_id = u.id
where s.source = 'mpc-7385-seed' order by u.email;

commit;
