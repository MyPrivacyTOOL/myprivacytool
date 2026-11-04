-- MPC-7448: day-10 "you are now protected" email for /HongKongSpam registrations. Additive only.
--
-- 1. hk_spam_registrations.reminder_sent_at: set (atomically, service_role only) by the scan-report Worker right before it
--    sends, so a row is mailed at most once. The Worker clears it again only if the send fails.
--    anon stays INSERT-only and can no longer set this column (column-level insert grant).
-- 2. hk_spam_due_reminders now hides rows already claimed/sent (same columns, same service_role-only access).
-- 3. email_suppressions: opt-outs keyed by SHA-256 of the lower-cased address. users.email_opt_out_at cannot cover
--    HK registrants because they have no users row. Holds no readable address. service_role only.
-- Rollback (new migration, do not edit this one):
--   drop table public.email_suppressions; alter table public.hk_spam_registrations drop column reminder_sent_at;
--   (then re-create the view without the reminder_sent_at filter, see 20261011120000_mpc_7450_hk_spam_registrations.sql)
alter table public.hk_spam_registrations
  add column if not exists reminder_sent_at timestamptz;

comment on column public.hk_spam_registrations.reminder_sent_at is 'MPC-7448. Set by the Worker (service_role) when it claims the day-10 email for sending; null = not sent. At-most-once guard.';

-- anon may insert every column except reminder_sent_at (RLS still allows insert only).
revoke insert on public.hk_spam_registrations from anon;
grant insert (platform, language, utm_source, utm_medium, utm_campaign, protection_date, email, reminder_consent, source_page)
  on public.hk_spam_registrations to anon;

create or replace view public.hk_spam_due_reminders
  with (security_invoker = true) as
select id, email, language, platform, protection_date, utm_source, utm_medium, utm_campaign
from public.hk_spam_registrations
where protection_date = (now() at time zone 'Asia/Hong_Kong')::date
  and email is not null
  and reminder_consent = true
  and reminder_sent_at is null;

revoke all on public.hk_spam_due_reminders from public, anon, authenticated;
grant select on public.hk_spam_due_reminders to service_role;

create table if not exists public.email_suppressions (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  source     text check (source is null or char_length(source) <= 64)
);
comment on table public.email_suppressions is 'MPC-7448. Marketing-email opt-outs by SHA-256(lower(email)). For people with no users row (e.g. hk_spam_registrations). service_role only.';

alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;
revoke all on public.email_suppressions from anon, authenticated;
grant all on public.email_suppressions to service_role;
create policy "service role full access" on public.email_suppressions
  for all to service_role using (true) with check (true);
