-- MPC-7450: separate marketing-email consent on hk_spam_registrations (MPC-7538 supplies the consent UI).
-- Distinct from reminder_consent (the one-off day-10 "you're protected" email). Default false; needs an address.
-- hk_spam_due_reminders is unchanged: it still keys on reminder_consent only. Rollback:
--   alter table public.hk_spam_registrations drop constraint hk_spam_registrations_marketing_needs_email;
--   alter table public.hk_spam_registrations drop column marketing_consent;
alter table public.hk_spam_registrations
  add column if not exists marketing_consent boolean not null default false;

alter table public.hk_spam_registrations
  add constraint hk_spam_registrations_marketing_needs_email
  check (email is not null or marketing_consent = false);

-- anon insert is column-level (MPC-7448 moved it off the table-level grant): the form now sends this column,
-- so without this grant every registration insert would fail with 42501.
grant insert (marketing_consent) on public.hk_spam_registrations to anon;
