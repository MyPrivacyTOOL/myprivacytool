-- MPC-7465 (report email B2, strategy decisions D7, D8, D9): every completed web scan is saved in full under a random
-- scan number, with or without a contact, so drop-off at the contact step can be seen and fixed.
--
-- public.web_scans          one row per completed home-page scan. id IS the scan number (random uuid, no personal key).
--                           No email or user id is stored here, and no connection IP column. BUT results holds what the browser
--                           reported, per hexagon, exactly as sent (untrusted text, validated and size-capped by the Worker), and
--                           that includes IP addresses (e.g. WebRTC and DNS-leak values) and fingerprint-style values. A saved scan
--                           is personal data, not anonymous (MPC-7488 corrected this comment; it said no IP was stored).
-- public.web_scan_contacts  links a web scan to a contact row once the visitor gives one. channel + contact_id is
--                           generic on purpose (D8): 'email' points at public.scans.id today; 'mobile', 'telegram' and
--                           others can be added later as new channel values with no schema change.
-- public.web_scan_funnel    daily counts: scans completed vs scans with a contact linked (drop-off, from the tables alone).
--
-- Access: RLS forced, no anon/authenticated grants, service_role only (the mpt-scan-report Worker).
-- Written idempotently so it is safe whether applied by the Supabase MCP or by `supabase db push`.
-- Rollback:
--   drop view if exists public.web_scan_funnel; drop table if exists public.web_scan_contacts; drop table if exists public.web_scans;

create table if not exists public.web_scans (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  source         text not null default 'web' check (source ~ '^[a-z0-9_-]{1,32}$'),
  hexagon_count  integer not null check (hexagon_count between 1 and 100),
  results        jsonb not null check (jsonb_typeof(results) = 'array' and jsonb_array_length(results) = hexagon_count),
  results_bytes  integer not null check (results_bytes between 2 and 65536)
);

comment on table public.web_scans is 'MPC-7465. One row per completed web scan. id = random scan number. results = per-hexagon {id,label,value,icon,confidence,risk,confirmed,category} as sent by the browser (untrusted text); these values include browser-reported IP addresses, so a saved scan is personal data. No email or user id column. service_role only.';
comment on column public.web_scans.id is 'The random scan number returned to the browser and carried to the contact step.';
comment on column public.web_scans.results is 'Untrusted browser-reported values. Never render without escaping.';

create index if not exists web_scans_created_at_idx on public.web_scans (created_at);

create table if not exists public.web_scan_contacts (
  id           uuid primary key default gen_random_uuid(),
  web_scan_id  uuid not null references public.web_scans (id) on delete cascade,
  channel      text not null check (channel ~ '^[a-z][a-z0-9_]{1,31}$'),
  contact_id   uuid not null,
  linked_at    timestamptz not null default now(),
  unique (web_scan_id, channel, contact_id)
);

comment on table public.web_scan_contacts is 'MPC-7465. Links a web scan to the contact row given afterwards. channel=email -> contact_id is public.scans.id. New channels (mobile, telegram) are new channel values, not new columns.';
comment on column public.web_scan_contacts.contact_id is 'Id of the contact row for this channel. email: public.scans.id.';

create index if not exists web_scan_contacts_web_scan_id_idx on public.web_scan_contacts (web_scan_id);
create index if not exists web_scan_contacts_contact_idx on public.web_scan_contacts (channel, contact_id);

alter table public.web_scans enable row level security;
alter table public.web_scans force row level security;
alter table public.web_scan_contacts enable row level security;
alter table public.web_scan_contacts force row level security;

revoke all on public.web_scans from public, anon, authenticated;
revoke all on public.web_scan_contacts from public, anon, authenticated;
grant all on public.web_scans to service_role;
grant all on public.web_scan_contacts to service_role;

drop policy if exists "service role full access" on public.web_scans;
create policy "service role full access" on public.web_scans
  for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.web_scan_contacts;
create policy "service role full access" on public.web_scan_contacts
  for all to service_role using (true) with check (true);

-- Drop-off by UTC day: scans completed, scans with any contact linked, and the share without one.
create or replace view public.web_scan_funnel
  with (security_invoker = true) as
select date_trunc('day', s.created_at)::date as day,
       count(*)                                                    as scans_completed,
       count(*) filter (where exists (select 1 from public.web_scan_contacts c where c.web_scan_id = s.id)) as scans_with_contact,
       count(*) filter (where not exists (select 1 from public.web_scan_contacts c where c.web_scan_id = s.id)) as scans_without_contact
from public.web_scans s
group by 1;

revoke all on public.web_scan_funnel from public, anon, authenticated;
grant select on public.web_scan_funnel to service_role;
