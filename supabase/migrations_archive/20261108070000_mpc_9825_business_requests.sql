-- MPC-9825: queue for the staffed Business "results within 48 hours" service. One row per /business form submission (the mpt-leads Worker,
-- POST /business-request, writes it with the service_role key). Chris (reviewer and approver until the first paying Business customer) moves
-- status New -> In review -> Approved -> Sent; the Worker marks Late when due_at passes and posts a daily Slack digest.
-- PRODUCTION MIGRATION: .github/workflows/deploy-supabase.yml runs `supabase db push` on merge to main. Adds ONE new table; touches nothing existing.
-- Access: RLS enabled and forced, no policies, no anon/authenticated grants: service_role only. Holds a contact name and work email, so it is personal data:
-- retention 24 months from created_at, the same as the Notion leads database (Privacy Policy lead-record retention); a purge job is a follow-up, see the runbook.
-- Rollback: drop table if exists public.mpt_business_requests;

create table if not exists public.mpt_business_requests (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique check (ref ~ '^BIZ-[A-Z2-9]{8}$'),
  status           text not null default 'New' check (status in ('New','In review','Approved','Sent','Late')),
  contact_name     text check (contact_name is null or char_length(contact_name) <= 100),
  contact_email    text not null check (char_length(contact_email) <= 254),
  company          text not null check (char_length(company) between 1 and 200),
  team_size        text check (team_size is null or team_size in ('1-10','11-50','51-200','200+')),
  consent_source   text not null default 'business_page',
  source           text not null default 'business_form',   -- 'business_form' now; MPC-9824 intake writes 'employee_consent' / 'admin_invite'
  created_at       timestamptz not null default now(),       -- SLA clock start
  due_at           timestamptz not null default (now() + interval '48 hours'),
  reviewed_at      timestamptz,
  approved_at      timestamptz,
  sent_at          timestamptz,
  late_notified_at timestamptz,                              -- set once, when the Worker first marks the row Late and alerts
  delay_notice_sent_at timestamptz,                          -- set once, when the Worker sends the requester the honest T+36h delay email (not Approved or Sent by then)
  notes            text check (notes is null or char_length(notes) <= 4000)
);
create index if not exists mpt_business_requests_open_due_idx on public.mpt_business_requests (due_at) where status <> 'Sent';
create index if not exists mpt_business_requests_dedupe_idx on public.mpt_business_requests (contact_email, company, created_at);

alter table public.mpt_business_requests enable row level security;
alter table public.mpt_business_requests force row level security;
revoke all on public.mpt_business_requests from anon, authenticated;
grant all on public.mpt_business_requests to service_role;

comment on table public.mpt_business_requests is 'MPC-9825. Staffed Business 48-hour results queue. created_at starts the clock, due_at = created_at + 48h (calendar hours, weekends count).';
