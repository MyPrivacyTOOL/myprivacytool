-- MPC-7538 (Gate B): consent and retention for the /HongKongSpam sign-up. Additive only.
--
-- 1. (MPC-7450 already added hk_spam_registrations.marketing_consent, default false, with its anon insert grant.) The separate,
--    unticked-by-default "MyPrivacyTOOL privacy tips" box stores there; reminder_consent is the day-10 reminder box.
-- 2. hk_spam_marketing_recipients: the ONLY source a marketing send may read. marketing_consent = true, an address, and not on
--    email_suppressions (unsubscribe). service_role only. hk_spam_due_reminders (day-10) is unchanged and needs reminder_consent.
-- 3. hk_spam_retention: the ONE place the retention period is set (single row, 90 days after protection_date).
-- 4. hk_spam_deletion_log: one row per purge run. Counts only, never an address.
-- 5. mpt_purge_expired_hk_spam(p_dry_run): first ends marketing consent for anyone on email_suppressions (an unsubscribe), then deletes every
--    row (email and row together) whose protection_date is more than 90 days ago AND marketing_consent is not true. Logged either way.
-- 6. mpt_delete_hk_spam_by_email / mpt_export_hk_spam_by_email: the deletion and access routes for a request sent to privacy@myprivacytool.io.
-- 7. daily pg_cron job mpt-purge-expired-hk-spam (19:20 UTC = 03:20 HKT); skipped where pg_cron is absent (local test databases).
--
-- All functions are service_role only. Rollback (new migration, do not edit this one):
--   select cron.unschedule('mpt-purge-expired-hk-spam');   -- if pg_cron is present
--   drop function if exists public.mpt_purge_expired_hk_spam(boolean), public.mpt_delete_hk_spam_by_email(text), public.mpt_export_hk_spam_by_email(text);
--   drop view if exists public.hk_spam_marketing_recipients; drop table if exists public.hk_spam_deletion_log, public.hk_spam_retention;

-- The marketing_consent column, its "needs an email" check and the anon insert grant came from MPC-7450
-- (20261012120000_mpc_7450_hk_spam_marketing_consent.sql). This migration only documents it and builds on it.
comment on column public.hk_spam_registrations.marketing_consent is 'MPC-7538. Ticked "Send me MyPrivacyTOOL privacy tips" box, unticked by default. No marketing email goes out unless true (read hk_spam_marketing_recipients). Rows with true are kept past the 90 days until unsubscribe or deletion.';

create or replace view public.hk_spam_marketing_recipients
  with (security_invoker = true) as
select r.id, r.email, r.language, r.platform, r.created_at
from public.hk_spam_registrations r
where r.marketing_consent = true
  and r.email is not null
  and not exists (
    select 1 from public.email_suppressions s
     where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex')
  );
revoke all on public.hk_spam_marketing_recipients from public, anon, authenticated;
grant select on public.hk_spam_marketing_recipients to service_role;
comment on view public.hk_spam_marketing_recipients is 'MPC-7538. The only list a marketing send may use: marketing_consent = true and not unsubscribed.';

create table if not exists public.hk_spam_retention (
  id         boolean primary key default true check (id),
  days       integer not null default 90 check (days between 1 and 3650),
  updated_at timestamptz not null default now()
);
insert into public.hk_spam_retention (id, days) values (true, 90) on conflict (id) do nothing;
comment on table public.hk_spam_retention is 'MPC-7538. Single row: days after protection_date that an HK Stop Spam row (email and row) is deleted unless marketing_consent is true.';

create table if not exists public.hk_spam_deletion_log (
  id            bigint generated always as identity primary key,
  logged_at     timestamptz not null default now(),
  kind          text not null check (kind in ('purge', 'purge_dry_run', 'by_email')),
  rows_deleted  integer not null check (rows_deleted >= 0),
  consent_ended integer not null default 0 check (consent_ended >= 0),
  note          text
);
comment on table public.hk_spam_deletion_log is 'MPC-7538. One row per run. Counts only: no email address is ever written here.';

alter table public.hk_spam_retention enable row level security;
alter table public.hk_spam_retention force row level security;
alter table public.hk_spam_deletion_log enable row level security;
alter table public.hk_spam_deletion_log force row level security;
revoke all on public.hk_spam_retention, public.hk_spam_deletion_log from public, anon, authenticated;
grant all on public.hk_spam_retention, public.hk_spam_deletion_log to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hk_spam_retention' and policyname = 'service role full access') then
    create policy "service role full access" on public.hk_spam_retention for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hk_spam_deletion_log' and policyname = 'service role full access') then
    create policy "service role full access" on public.hk_spam_deletion_log for all to service_role using (true) with check (true);
  end if;
end $$;

create or replace function public.mpt_purge_expired_hk_spam(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days int; n_ended int := 0; n_del int := 0;
begin
  select days into v_days from public.hk_spam_retention where id;
  if v_days is null then v_days := 90; end if;

  -- An unsubscribe ends marketing consent, so the 90-day rule applies to that row again.
  if p_dry_run then
    select count(*) into n_ended from public.hk_spam_registrations r
     where r.marketing_consent and r.email is not null
       and exists (select 1 from public.email_suppressions s where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex'));
    select count(*) into n_del from public.hk_spam_registrations r
     where r.protection_date <= (now() at time zone 'Asia/Hong_Kong')::date - v_days
       and (not r.marketing_consent
            or (r.email is not null and exists (select 1 from public.email_suppressions s where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex'))));
  else
    update public.hk_spam_registrations r set marketing_consent = false
     where r.marketing_consent and r.email is not null
       and exists (select 1 from public.email_suppressions s where s.email_hash = encode(sha256(convert_to(lower(r.email), 'UTF8')), 'hex'));
    get diagnostics n_ended = row_count;
    delete from public.hk_spam_registrations r
     where r.protection_date <= (now() at time zone 'Asia/Hong_Kong')::date - v_days
       and not r.marketing_consent;
    get diagnostics n_del = row_count;
  end if;

  insert into public.hk_spam_deletion_log (kind, rows_deleted, consent_ended, note)
  values (case when p_dry_run then 'purge_dry_run' else 'purge' end, n_del, n_ended, v_days || ' days after protection_date');
  return jsonb_build_object('dry_run', p_dry_run, 'days', v_days, 'rows_deleted', n_del, 'marketing_consent_ended', n_ended);
end $$;

create or replace function public.mpt_delete_hk_spam_by_email(p_email text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  delete from public.hk_spam_registrations where lower(email) = lower(trim(p_email));
  get diagnostics n = row_count;
  insert into public.hk_spam_deletion_log (kind, rows_deleted, note) values ('by_email', n, 'deletion request');
  return n;
end $$;

create or replace function public.mpt_export_hk_spam_by_email(p_email text)
returns table (created_at timestamptz, platform text, language text, protection_date date, email text,
               reminder_consent boolean, marketing_consent boolean, reminder_sent_at timestamptz, utm_source text, utm_medium text, utm_campaign text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select created_at, platform, language, protection_date, email, reminder_consent, marketing_consent, reminder_sent_at, utm_source, utm_medium, utm_campaign
  from public.hk_spam_registrations where lower(email) = lower(trim(p_email)) order by created_at;
$$;

revoke all on function public.mpt_purge_expired_hk_spam(boolean), public.mpt_delete_hk_spam_by_email(text), public.mpt_export_hk_spam_by_email(text) from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_hk_spam(boolean), public.mpt_delete_hk_spam_by_email(text), public.mpt_export_hk_spam_by_email(text) to service_role;

-- Daily at 19:20 UTC (03:20 HKT). Idempotent. Skipped where pg_cron is not installed.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-expired-hk-spam';
    perform cron.schedule('mpt-purge-expired-hk-spam', '20 19 * * *', 'select public.mpt_purge_expired_hk_spam();');
  end if;
end $$;
