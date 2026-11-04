-- MPC-7450: Hong Kong Do-not-call funnel. One row per "I registered" tap on /HongKongSpam (MPC-7446);
-- the day-10 "you're now protected" email (MPC-7448) reads hk_spam_due_reminders.
--
-- NO phone number is stored, here or anywhere: the user dials the hotline from their own phone and we never
-- see the number. Email is optional and only used when reminder_consent is true.
-- Access model: anon may INSERT only (no select, update or delete, so no one can read emails back with the
-- public key). service_role (the MPC-7448 job) reads. Rollback:
--   drop view public.hk_spam_due_reminders; drop table public.hk_spam_registrations;
create table if not exists public.hk_spam_registrations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  platform         text not null check (platform in ('android', 'ios', 'other')),
  language         text not null check (language in ('en', 'yue')),
  utm_source       text check (char_length(utm_source) <= 100),
  utm_medium       text check (char_length(utm_medium) <= 100),
  utm_campaign     text check (char_length(utm_campaign) <= 100),
  protection_date  date not null,                      -- computed client-side by protectionStartDate() (HK time)
  email            text check (email is null or (char_length(email) <= 254 and email like '%_@_%.__%')),
  reminder_consent boolean not null default false,
  source_page      text check (char_length(source_page) <= 200),
  check (email is not null or reminder_consent = false)  -- consent without an address is meaningless
);

comment on table public.hk_spam_registrations is 'MPC-7450. HK DNC registrations. No phone number by design. anon insert-only.';
comment on column public.hk_spam_registrations.protection_date is 'First protected day: 10th HK working day after registration (src/lib/hkWorkingDays.ts). Weather days are adjusted manually.';

create index if not exists hk_spam_registrations_protection_date_idx on public.hk_spam_registrations (protection_date);

alter table public.hk_spam_registrations enable row level security;
alter table public.hk_spam_registrations force row level security;

revoke all on public.hk_spam_registrations from anon, authenticated;
grant insert on public.hk_spam_registrations to anon;
grant all on public.hk_spam_registrations to service_role;

create policy "anon can insert registrations" on public.hk_spam_registrations
  for insert to anon with check (true);
create policy "service role full access" on public.hk_spam_registrations
  for all to service_role using (true) with check (true);

-- Rows whose protection starts today (Hong Kong date), with an address and consent to be emailed.
-- security_invoker so it runs with the caller's rights; only service_role is granted.
create or replace view public.hk_spam_due_reminders
  with (security_invoker = true) as
select id, email, language, platform, protection_date, utm_source, utm_medium, utm_campaign
from public.hk_spam_registrations
where protection_date = (now() at time zone 'Asia/Hong_Kong')::date
  and email is not null
  and reminder_consent = true;

revoke all on public.hk_spam_due_reminders from public, anon, authenticated;
grant select on public.hk_spam_due_reminders to service_role;
