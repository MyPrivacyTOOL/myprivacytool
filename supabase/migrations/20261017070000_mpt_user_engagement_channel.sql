-- WhatsApp deep dive (RESULTS pull model): the Worker logs each finalized scan to mpt_user_engagement with the channel it came from.
-- Additive and nullable: one text column, no default, no backfill, no change to existing rows, policies or constraints.
-- The Meta template log columns (whatsapp_notify_*) from 20261015200000 are NOT needed any more; that migration was never applied
-- to production and should stay unapplied. Production already has user_id nullable.
-- Applied to production by hand (auto-migration is off); the Worker is fail-soft without it.
alter table public.mpt_user_engagement add column if not exists channel text;
comment on column public.mpt_user_engagement.channel is 'Channel the session came from (e.g. whatsapp). Written by the webhook Worker when a deep dive is finalized. Never holds a phone number.';

-- Rollback:
--   alter table public.mpt_user_engagement drop column if exists channel;
