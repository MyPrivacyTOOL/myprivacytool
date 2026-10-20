-- Ticket:   MPC-7385-F1
-- Purpose:  Remove exactly the test records created by seed-followup-test-records.sql.
-- STAGING ONLY. Target project ref: xmdmkumwxpgahmlweuug  (see the production-project warning in the seed file)
--
-- USAGE (identical for both files). Nothing real is stored in this file:
--   1. Edit the two guard lines near the top: uncomment mpt.seed_confirm, and replace REPLACE_ME+mpc7385@example.com with your own
--      test inbox in the form  name+mpc7385@your-domain  (plus-address; the "+mpc7385" tag is required and is the cleanup marker).
--      Derived addresses:  name+mpc7385-d3@domain, -d7, -d3-ctrl, -d7-ctrl.
--   2. Run in the Supabase SQL editor, or:  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--   Use the SAME mpt.seed_email_base in the seed and the cleanup: the cleanup marker is derived from it.
--   The script aborts with a clear message if the confirmation or the email base is unset or malformed.
--
-- Matches ONLY the +mpc7385 marker derived from mpt.seed_email_base: users.email like '<name>+mpc7385-%@<domain>'. scans (and signals/hexagon_scores/removal_tasks)
-- go with the user via ON DELETE CASCADE; scans are also deleted explicitly first so the counts are visible. Also removes an
-- email_suppressions row if someone clicked "unsubscribe" in a test email (keyed by SHA-256 of the lower-cased address).
-- Freed first-100 cohort numbers are NOT renumbered (claim_onboarding_cohort uses max+1; a gap is harmless).
-- Not covered: other tables keyed by these emails (e.g. leads, referrals) if you exercised those flows by hand.

begin;

-- ---- Guard 1: uncomment ONLY after confirming this project is staging / safe to receive test mail. ----
-- select set_config('mpt.seed_confirm', 'I-CONFIRMED-THIS-IS-STAGING', true);
-- ---- Guard 2: your test inbox. Edit the placeholder (must look like name+mpc7385@your-domain). ----
select set_config('mpt.seed_email_base', 'REPLACE_ME+mpc7385@example.com', true);

do $$
declare b text := coalesce(current_setting('mpt.seed_email_base', true), '');
begin
  if coalesce(current_setting('mpt.seed_confirm', true), '') <> 'I-CONFIRMED-THIS-IS-STAGING' then
    raise exception 'MPC-7385-F1 %: confirm the target project is staging, then uncomment the mpt.seed_confirm line.', 'cleanup refused';
  end if;
  if b = '' or b like 'REPLACE\_ME%' then
    raise exception 'MPC-7385-F1 %: mpt.seed_email_base is unset. Edit the set_config line to your inbox, e.g. name+mpc7385@your-domain.', 'cleanup refused';
  end if;
  if b !~ '^[A-Za-z0-9.-]+\+mpc7385@[A-Za-z0-9.-]+$' then
    raise exception 'MPC-7385-F1 %: mpt.seed_email_base must match name+mpc7385@domain (letters, digits, dot, hyphen only; no underscore or %%).', 'cleanup refused';
  end if;
end $$;

create temp table seed_emails on commit drop as
select k as kind, split_part(b, '@', 1) || '-' || k || '@' || split_part(b, '@', 2) as email,
       split_part(b, '@', 1) || '-%@' || split_part(b, '@', 2) as pattern
from (select current_setting('mpt.seed_email_base') as b) base,
     unnest(array['d3', 'd7', 'd3-ctrl', 'd7-ctrl']) as k;

with s as (
  delete from public.scans
  where email_scanned like (select min(pattern) from seed_emails)
  returning 1
), sup as (
  delete from public.email_suppressions
  where email_hash in (
    select encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') from seed_emails)
  returning 1
), u as (
  delete from public.users
  where email like (select min(pattern) from seed_emails)
  returning 1
)
select (select count(*) from s) as scans_deleted, (select count(*) from sup) as suppressions_deleted, (select count(*) from u) as users_deleted;

commit;
