-- Cleanup after the RESULTS pull model (PR #389): the Meta template send is gone, so its three log columns on mpt_user_engagement go too.
-- Checked on production 2026-10-19: all 7 rows are NULL in all three columns, nothing on main reads or writes them, and no view, index or
-- policy uses them. Dropping the column also drops its CHECK constraint (mpt_user_engagement_whatsapp_notify_error_check).
-- Keeps `channel` (20261017070000) and the nullable user_id. Idempotent: safe to run twice, and safe where the columns never existed.
alter table public.mpt_user_engagement
  drop column if exists whatsapp_notify_message_id,
  drop column if exists whatsapp_notify_error,
  drop column if exists whatsapp_notified_at;

-- Rollback (empty columns, so nothing is lost either way):
--   alter table public.mpt_user_engagement
--     add column if not exists whatsapp_notify_message_id text,
--     add column if not exists whatsapp_notify_error text check (whatsapp_notify_error is null or char_length(whatsapp_notify_error) <= 300),
--     add column if not exists whatsapp_notified_at timestamptz;
