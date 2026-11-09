-- MPC-9885 (Open Tracker design 1.3 / 3): public.scan_recipient_log. One row per outbound call a Worker made during a scan: scan id, recipient key,
-- the NAMES of the data items sent, time and status. Never a value, a URL or a header (the items column is checked against the closed vocabulary).
-- Rows come from what actually ran or was refused, so the per-scan "who saw what" panel (MPC-9893) renders from them. Deleting a scan deletes its rows
-- (MPC-9890 includes this table in the deletion transaction). recipient_key takes a foreign key to public.recipients_registry (MPC-9883), so a stale
-- key cannot be written. scan_id is text, not a foreign key: it is the client-generated scan id and must stay deletable without ordering constraints.
-- Access: service_role only (Workers). No anon or authenticated grant.
-- Rollback:  drop table if exists public.scan_recipient_log;

create table if not exists public.scan_recipient_log (
  id            bigint generated always as identity primary key,
  scan_id       text not null check (length(scan_id) between 1 and 64),
  recipient_key text not null references public.recipients_registry (key),
  items         text[] not null default '{}',
  status        text not null check (status in ('ran', 'failed', 'skipped_disabled', 'skipped_country', 'refused')),
  http_status   integer check (http_status is null or http_status between 100 and 599),
  code          text check (code is null or code ~ '^[A-Z_]{3,40}$'),
  at            timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint scan_recipient_log_items_vocab check (items <@ array['ip','user_agent','email','email_hash','email_domain','name','phone','username','country','city','device_profile','utm','referrer','scan_result','message_text','plan_name','password_hash_prefix','page_load']::text[])
);
create index if not exists scan_recipient_log_scan_idx on public.scan_recipient_log (scan_id, at);
comment on table public.scan_recipient_log is 'MPC-9885. Per-scan record of outbound calls: recipient key, data item NAMES, time, status. Never values.';

alter table public.scan_recipient_log enable row level security;
alter table public.scan_recipient_log force row level security;
revoke all on public.scan_recipient_log from anon, authenticated;
grant select, insert, delete on public.scan_recipient_log to service_role;
-- Append-only for the Workers: Supabase's default privileges also hand service_role update/truncate/references/trigger on a new table.
revoke update, truncate, references, trigger on public.scan_recipient_log from service_role;
