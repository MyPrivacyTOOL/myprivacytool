-- MPC-7261: "First 100 Users" onboarding flow (scan -> risk score -> mirror report -> email follow-up).
-- Additive only. Same access model as MPC-6677: tables keep forced RLS with no policies, so only the
-- scan-report Worker (service_role) can read or write these columns.

alter table public.users
  add column if not exists cohort_number    integer unique check (cohort_number between 1 and 100),
  add column if not exists email_opt_out_at timestamptz;      -- follow-up emails stop once set

alter table public.scans
  add column if not exists mirror_report         jsonb,        -- structured Mirror Report (what we could and could not see)
  add column if not exists followup_stage        integer not null default 0 check (followup_stage between 0 and 2),
  add column if not exists followup_last_sent_at timestamptz;

create index if not exists scans_followup_idx on public.scans (report_status, followup_stage, report_sent_at);

-- Hands out cohort numbers 1..100 in order, once per user, race-free (advisory lock).
-- Returns the user's number, or null when the cohort is full.
create or replace function public.claim_onboarding_cohort(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(7261);
  select cohort_number into n from public.users where id = p_user_id;
  if n is not null then return n; end if;
  select coalesce(max(cohort_number), 0) + 1 into n from public.users;
  if n > 100 then return null; end if;
  update public.users set cohort_number = n, updated_at = now() where id = p_user_id;
  return n;
end $$;

revoke all on function public.claim_onboarding_cohort(uuid) from public, anon, authenticated;
grant execute on function public.claim_onboarding_cohort(uuid) to service_role;

comment on column public.users.cohort_number is 'MPC-7261. 1..100 = first-100 onboarding cohort, assigned when the first report is delivered.';
comment on column public.users.email_opt_out_at is 'MPC-7261. Set by the signed unsubscribe link; follow-up emails never go to these users.';
comment on column public.scans.mirror_report is 'MPC-7261. Structured Mirror Report; unchecked categories are listed as not_checked, never scored.';
