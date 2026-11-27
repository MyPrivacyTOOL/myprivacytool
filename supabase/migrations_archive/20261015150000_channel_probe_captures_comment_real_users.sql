-- Comment-only change (the already-applied 20261014190000 migration is not edited).
-- channel_probe_captures holds raw Telegram updates and public-lookup results. With PROBE_MODE=on that is allow-listed test accounts only
-- (7 day expiry); with PROBE_MODE=all (decision D-A) it holds REAL-USER Telegram data (PII), expiring per PROBE_RETENTION_DAYS (default 90).
-- PROBE_MODE=all must stay off until the stored-data rules and privacy wording are aligned. See docs/channel-probe.md.
-- Rollback: re-run the original `comment on table` text from 20261014190000_channel_probe_captures.sql.
comment on table public.channel_probe_captures is 'Channel probe reader. Raw platform payloads and public-lookup results. PROBE_MODE=on: allow-listed TEST accounts only, 7 day expiry. PROBE_MODE=all: REAL-USER Telegram data (PII), expires_at per PROBE_RETENTION_DAYS (default 90). service_role only.';
