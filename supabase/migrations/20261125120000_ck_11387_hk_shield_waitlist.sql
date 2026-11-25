-- CK-11387 (MPC-7647-A1): Spam Shield waitlist on /HongKongSpam. Additive only (one new table).
-- The demand gate needs a count of people who want the paid app. Nothing is for sale; this only records interest.
-- Access model, copied from hk_spam_registrations (MPC-7450): anon may INSERT only (no select, update or delete), so the
-- public key can never read emails back; service_role reads. No phone number is stored, here or anywhere.
-- Consent is a hard requirement of the row: consent = true is checked by the table, not just by the page.
-- Duplicate address (case-insensitive) is rejected by the unique index; the page treats that as "already on the list".
-- The demand count for MPC-7647-A1 is: select count(*) from public.hk_shield_waitlist;
-- Retention: the page promises deletion on request and after 12 months; a purge job is a separate task, and deleting rows is
-- never done by this migration. Rollback: drop table if exists public.hk_shield_waitlist;
create table if not exists public.hk_shield_waitlist (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  language     text not null check (language in ('en', 'yue')),
  platform     text not null check (platform in ('android', 'ios', 'other')),
  email        text not null check (char_length(email) <= 254 and email like '%_@_%.__%'),
  consent      boolean not null check (consent = true),
  utm_source   text check (char_length(utm_source) <= 100),
  utm_medium   text check (char_length(utm_medium) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  source_page  text check (char_length(source_page) <= 200)
);

create unique index if not exists hk_shield_waitlist_email_uidx on public.hk_shield_waitlist (lower(email));
create index if not exists hk_shield_waitlist_created_idx on public.hk_shield_waitlist (created_at);

comment on table public.hk_shield_waitlist is 'CK-11387. Spam Shield waitlist from /HongKongSpam. Interest only, nothing is for sale. No phone number. anon insert-only. Count = demand signal for MPC-7647-A1.';

alter table public.hk_shield_waitlist enable row level security;
alter table public.hk_shield_waitlist force row level security;

revoke all on public.hk_shield_waitlist from public, anon, authenticated;
grant insert on public.hk_shield_waitlist to anon;
grant all on public.hk_shield_waitlist to service_role;

drop policy if exists "anon can insert waitlist signups" on public.hk_shield_waitlist;
create policy "anon can insert waitlist signups" on public.hk_shield_waitlist
  for insert to anon with check (consent = true);
drop policy if exists "service role full access" on public.hk_shield_waitlist;
create policy "service role full access" on public.hk_shield_waitlist
  for all to service_role using (true) with check (true);
