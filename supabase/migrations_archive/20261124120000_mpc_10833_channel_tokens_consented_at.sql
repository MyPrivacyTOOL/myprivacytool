-- MPC-10833: remember WHEN the person last consented to a channel connection, so a stored token can be refused after 90 days.
-- Approved by Chris 2026-11-23 (Notion MPC-11120): "token re-consent after 90 days".
--
-- consented_at is set by the github-channel Worker only when the person goes through the OAuth consent screen (the callback).
-- A token refresh leaves it alone (the Worker omits the column from that upsert), so a refresh never renews consent.
-- The Worker refuses to use a token whose consented_at is 90 days old (401 {"error":"reconsent_required"}) and does not delete it.
--
-- Backfill: existing rows get consented_at = created_at (the day they first connected; a refresh was never a new consent).
-- The oldest channel_tokens row is from the 2026-10 launch, so no existing row is past 90 days when this is applied.
--
-- Additive and reversible. Not applied by this commit: deploy-supabase.yml runs only by manual dispatch.
-- Rollback:
--   alter table public.channel_tokens drop column if exists consented_at;
--   (the Worker falls back to created_at when the column is missing from a row, but it SELECTs the column, so roll the Worker back first)

alter table public.channel_tokens add column if not exists consented_at timestamptz;

update public.channel_tokens set consented_at = created_at where consented_at is null;

alter table public.channel_tokens
  alter column consented_at set default now(),
  alter column consented_at set not null;

comment on column public.channel_tokens.consented_at is
  'MPC-10833: when the person last went through the provider consent screen. Not changed by a token refresh. The Worker refuses the token 90 days after this.';
