-- Pull model (user texts RESULTS): proactive Meta template sends are gone, so their log columns on mpt_user_engagement go too.
-- Keeps `channel` and the nullable user_id from 20261015200000 (still used by the finalize log). No phone number was ever stored here.
-- NOT applied by the code change: a human applies it with the Worker deploy.
alter table public.mpt_user_engagement
  drop column if exists whatsapp_notify_message_id,
  drop column if exists whatsapp_notify_error,
  drop column if exists whatsapp_notified_at;

-- Rollback:
--   alter table public.mpt_user_engagement
--     add column whatsapp_notify_message_id text,
--     add column whatsapp_notify_error text check (whatsapp_notify_error is null or char_length(whatsapp_notify_error) <= 300),
--     add column whatsapp_notified_at timestamptz;
