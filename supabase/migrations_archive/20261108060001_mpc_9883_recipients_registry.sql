-- MPC-9883 (Open Tracker rule 6, design 1.1): public.recipients_registry mirrors shared/recipients/recipients.json.
-- The file is the source of truth; scripts/sync-recipients.mjs upserts on merge to main and checks for drift nightly. Rows are never deleted
-- (entries carry since/until so history renders). scan_recipient_log.recipient_key will take a foreign key to `key` in MPC-9885.
--
-- Access: writes by service_role only. Anon reads the list through the read-only view public.recipients_registry_public.
-- The view is owned by the migration role and so reads the table on the caller's behalf (no policy for anon on the table itself).
-- Rollback:
--   drop view if exists public.recipients_registry_public;
--   drop table if exists public.recipients_registry;

create table if not exists public.recipients_registry (
  key           text primary key check (key ~ '^[a-z0-9][a-z0-9-]*$'),
  body          jsonb not null,
  registry_hash text not null check (registry_hash ~ '^[0-9a-f]{64}$'),
  synced_at     timestamptz not null default now()
);
comment on table public.recipients_registry is 'MPC-9883. Mirror of shared/recipients/recipients.json (one row per recipient). The file is authoritative; never edit rows by hand.';

alter table public.recipients_registry enable row level security;
alter table public.recipients_registry force row level security;
revoke all on public.recipients_registry from anon, authenticated;
grant select, insert, update on public.recipients_registry to service_role;

create or replace view public.recipients_registry_public as
  select key, body, registry_hash, synced_at from public.recipients_registry;
comment on view public.recipients_registry_public is 'MPC-9883. Read-only public list of recipients (what /what-we-see and the app read). Select only.';
revoke all on public.recipients_registry_public from anon, authenticated;
grant select on public.recipients_registry_public to anon, authenticated, service_role;
