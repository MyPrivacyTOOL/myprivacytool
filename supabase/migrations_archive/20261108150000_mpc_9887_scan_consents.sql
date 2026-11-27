-- MPC-9887 (Open Tracker design 2.1, 2.3): the scan consent store.
--
-- public.scan_consents       ONE row per scan id: the single consent the visitor gives by pressing Scan me. No IP, no email, no user agent.
--                            scan_id is client-generated (a uuid minted at the click) and becomes the scan number (web_scans.id) when the scan is saved.
--                            id is the consent id the gate returns; Workers present it to the recipient wrapper (check 4) for every post_click call.
-- public.scan_consent_counts after a consent row is deleted (free user's record deleted N hours after delivery, MPC-9890; DSAR erase) only a count per
--                            consent_version remains, until the lawyer says whether proof of consent must outlive the scan (MPC-6798, open question).
-- web_scans.consent_*        the same fields copied onto the saved scan (design 2.3).
-- scans.consent_id           which consent covers a report request, so the report job (a cron tick, no request) can present it to the wrapper.
--
-- Access: service_role only (Workers). RLS forced, no anon/authenticated grant. Append-only for the Workers: no update on scan_consents.
-- Written idempotently and additive only. Rollback:
--   drop trigger if exists scan_consents_count_on_delete on public.scan_consents; drop function if exists public.scan_consents_count_on_delete();
--   alter table public.scans drop column if exists consent_id;
--   alter table public.web_scans drop column if exists consent_id, drop column if exists consent_version, drop column if exists consent_text_sha256,
--     drop column if exists consent_locale, drop column if exists consent_registry_hash, drop column if exists consent_n_hours, drop column if exists consented_at;
--   drop table if exists public.scan_consent_counts; drop table if exists public.scan_consents;

create table if not exists public.scan_consents (
  id                  uuid primary key default gen_random_uuid(),
  scan_id             uuid not null unique,
  consent_version     text not null check (consent_version ~ '^[0-9]{4}-[0-9]{2}-v[0-9]{1,3}$'),
  consent_text_sha256 text not null check (consent_text_sha256 ~ '^[0-9a-f]{64}$'),
  locale              text not null check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  registry_hash       text not null check (registry_hash ~ '^[0-9a-f]{64}$'),
  n_hours             integer not null check (n_hours between 1 and 8760),
  consented_at        timestamptz not null default now()
);
comment on table public.scan_consents is 'MPC-9887. One row per scan id: the single consent given by pressing Scan me. No IP, no email, no user agent. Deleted with the scan (MPC-9890).';
comment on column public.scan_consents.id is 'The consent id returned to the browser and presented to the recipient wrapper for post_click calls.';
comment on column public.scan_consents.scan_id is 'Client-generated scan id (uuid). Becomes web_scans.id when the scan is saved.';
comment on column public.scan_consents.consent_text_sha256 is 'SHA-256 of the exact rendered consent text, including N and the locale.';
comment on column public.scan_consents.registry_hash is 'registry_hash of shared/recipients/recipients.json when consent was given: which recipients were enabled.';
comment on column public.scan_consents.n_hours is 'N in the consent text: hours from report delivery to deletion of a free user''s record.';

alter table public.scan_consents enable row level security;
alter table public.scan_consents force row level security;
revoke all on public.scan_consents from public, anon, authenticated;
grant select, insert, delete on public.scan_consents to service_role;
revoke update, truncate, references, trigger on public.scan_consents from service_role;

create table if not exists public.scan_consent_counts (
  consent_version text primary key check (consent_version ~ '^[0-9]{4}-[0-9]{2}-v[0-9]{1,3}$'),
  deleted_n       bigint not null default 0 check (deleted_n >= 0),
  updated_at      timestamptz not null default now()
);
comment on table public.scan_consent_counts is 'MPC-9887. Count of deleted scan_consents rows per consent_version. The only trace of a consent after its scan is deleted.';
alter table public.scan_consent_counts enable row level security;
alter table public.scan_consent_counts force row level security;
revoke all on public.scan_consent_counts from public, anon, authenticated;
grant select on public.scan_consent_counts to service_role;

create or replace function public.scan_consents_count_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.scan_consent_counts (consent_version, deleted_n, updated_at) values (old.consent_version, 1, now())
  on conflict (consent_version) do update set deleted_n = public.scan_consent_counts.deleted_n + 1, updated_at = now();
  return old;
end $$;
revoke all on function public.scan_consents_count_on_delete() from public, anon, authenticated;

drop trigger if exists scan_consents_count_on_delete on public.scan_consents;
create trigger scan_consents_count_on_delete after delete on public.scan_consents for each row execute function public.scan_consents_count_on_delete();

alter table public.web_scans
  add column if not exists consent_id uuid,
  add column if not exists consent_version text,
  add column if not exists consent_text_sha256 text,
  add column if not exists consent_locale text,
  add column if not exists consent_registry_hash text,
  add column if not exists consent_n_hours integer,
  add column if not exists consented_at timestamptz;

alter table public.scans add column if not exists consent_id uuid;
