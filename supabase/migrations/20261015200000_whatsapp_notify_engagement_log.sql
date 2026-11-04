-- ARCHIVED 2026-10-17: SUPERSEDED, DO NOT APPLY. The Meta template send was removed (PR #389).
-- Applied to production 2026-10-17 (by hand, Supabase version 20261017080044). The live columns are mpt_user_engagement.channel
-- and three whatsapp_notify_* columns (mpt_user_engagement_channel.sql handles the schema change via the pull model).
-- Kept for history only.
-- WhatsApp deep dive: log the "deep dive complete" template send (Meta message id or error) on mpt_user_engagement.
-- Additive: 4 nullable columns, plus user_id becomes nullable because a WhatsApp-only person has no auth.users row
-- (with NOT NULL + FK, every channel write from the webhook worker was being rejected). Rows with a null user_id are
-- invisible to the owner-read policy and stay service_role only. No phone number, name or finding is stored here.
-- NOT applied by the code change: a human applies it before WhatsApp notifications go live (the worker is fail-soft without it).
alter table public.mpt_user_engagement alter column user_id drop not null;
alter table public.mpt_user_engagement
  add column if not exists channel                    text,
  add column if not exists whatsapp_notify_message_id text,
  add column if not exists whatsapp_notify_error      text check (whatsapp_notify_error is null or char_length(whatsapp_notify_error) <= 300),
  add column if not exists whatsapp_notified_at       timestamptz;
comment on column public.mpt_user_engagement.whatsapp_notify_message_id is 'Meta Graph API messages[0].id of the mpt_deep_dive_ready template send; null if it failed.';
comment on column public.mpt_user_engagement.whatsapp_notify_error      is 'Meta error code and message (or network_error) when the template send failed. Never holds a phone number.';

-- Rollback:
--   alter table public.mpt_user_engagement drop column channel, drop column whatsapp_notify_message_id,
--     drop column whatsapp_notify_error, drop column whatsapp_notified_at;
--   (user_id NOT NULL can be restored only after deleting rows where user_id is null.)
