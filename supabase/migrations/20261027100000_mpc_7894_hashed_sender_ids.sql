-- MPC-7894 gate 3: allow a keyed hash in place of a plain Telegram id in the scan tables' sender_id columns.
-- Stored value is either the plain numeric id (test accounts, as before) or "h1:" + 64 lowercase hex characters (HMAC-SHA256 of "telegram:<id>" under the Worker secret
-- TELEGRAM_ID_HMAC_KEY; see workers/social-listeners/src/sender-key.ts). Nothing else changes: unique indexes, RLS, cascades and the delete functions work on either form.
-- Additive and safe to run any time: it only widens a CHECK (every existing row already satisfies the new one). NOT applied to production by the PR that adds it:
-- apply by hand after approval, BEFORE setting TELEGRAM_ID_HMAC_KEY. Without it, writes with a hashed id are rejected by the old check (nothing is stored in plain form instead).
-- Rollback (only valid while no hashed ids are stored; delete those rows first with mpt_delete_profile_snapshots('h1:...')):
--   alter table public.profile_snapshots drop constraint profile_snapshots_sender_id_check, add constraint profile_snapshots_sender_id_check check (sender_id ~ '^[0-9]{1,20}$');
--   (same for fix_wizard_items, dashboard_links, dashboard_sessions)
alter table public.profile_snapshots drop constraint if exists profile_snapshots_sender_id_check;
alter table public.profile_snapshots add constraint profile_snapshots_sender_id_check check (sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$');

alter table public.fix_wizard_items drop constraint if exists fix_wizard_items_sender_id_check;
alter table public.fix_wizard_items add constraint fix_wizard_items_sender_id_check check (sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$');

alter table public.dashboard_links drop constraint if exists dashboard_links_sender_id_check;
alter table public.dashboard_links add constraint dashboard_links_sender_id_check check (sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$');

alter table public.dashboard_sessions drop constraint if exists dashboard_sessions_sender_id_check;
alter table public.dashboard_sessions add constraint dashboard_sessions_sender_id_check check (sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$');
