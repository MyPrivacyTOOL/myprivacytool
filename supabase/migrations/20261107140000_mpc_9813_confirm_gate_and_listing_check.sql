-- MPC-9813 (F1 broker lookup, Chris Decision 7, 2026-11-07): two additive changes, nothing existing is rewritten.
--
-- 1. scans.email_confirm_required / scans.email_confirmed_at : the click-to-confirm gate. A scan created while the gate is on is marked
--    email_confirm_required = true and gets no emailed report and no identifier-based check until email_confirmed_at is set by the click.
--    Every existing row keeps email_confirm_required = false, so scans already in the database are unaffected.
-- 2. public.web_scan_listing_checks : the optional details a visitor typed about themselves (name, place, phone, up to 3 pages that list them)
--    and the result of reading each page. It hangs off public.web_scans (the scan number), so it follows the SAME rules as the saved scan
--    (MPC-7488): deleted with the scan by mpt_delete_web_scan, purged with it after public.web_scan_retention (12 months), included in the
--    access request through the cascade. No separate retention clock exists.
--
-- Access: service_role only (RLS forced, no policies for anon/authenticated).
-- Rollback:
--   drop table if exists public.web_scan_listing_checks;
--   alter table public.scans drop column if exists email_confirmed_at, drop column if exists email_confirm_required;

alter table public.scans add column if not exists email_confirm_required boolean not null default false;
alter table public.scans add column if not exists email_confirmed_at timestamptz;
comment on column public.scans.email_confirm_required is 'MPC-9813. true = the report and all identifier-based checks wait for the click-to-confirm (email_confirmed_at). false for every scan created before the gate existed.';
comment on column public.scans.email_confirmed_at is 'MPC-9813. When the person opened the confirmation link and pressed the confirm button.';

create table if not exists public.web_scan_listing_checks (
  id             uuid primary key default gen_random_uuid(),
  web_scan_id    uuid not null references public.web_scans(id) on delete cascade,   -- the scan number; cascade = deleted/purged with the saved scan
  scan_id        uuid not null,                                                       -- public.scans.id (no foreign key: scans rows are purged on their own, shorter clock)
  full_name      text check (full_name is null or char_length(full_name) <= 120),
  city_region    text check (city_region is null or char_length(city_region) <= 120),
  country        text check (country is null or char_length(country) <= 2),
  phone          text check (phone is null or char_length(phone) <= 32),
  listing_urls   text[] not null default '{}' check (cardinality(listing_urls) <= 3),
  results        jsonb,                                                                -- one object per URL, written by the check; null until it ran
  checked_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint web_scan_listing_checks_scan_key unique (scan_id)
);
create index if not exists web_scan_listing_checks_web_scan_idx on public.web_scan_listing_checks (web_scan_id);
comment on table public.web_scan_listing_checks is 'MPC-9813. Details a visitor typed about themselves for the "show us your listing" check, and the per-page results. PERSONAL DATA. Linked to the saved scan (web_scans.id); deleted with it by scan number and purged with it after the 12-month retention (MPC-7488). service_role only.';

alter table public.web_scan_listing_checks enable row level security;
alter table public.web_scan_listing_checks force row level security;
revoke all on public.web_scan_listing_checks from public, anon, authenticated;
grant all on public.web_scan_listing_checks to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'web_scan_listing_checks' and policyname = 'service role full access') then
    create policy "service role full access" on public.web_scan_listing_checks for all to service_role using (true) with check (true);
  end if;
end $$;
