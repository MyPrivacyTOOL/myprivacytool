# Channel probe reader (test-only)

Measures what a channel really delivers, so the Verified ticks in the Notion "Channel Signal Availability" database can rest on evidence.
Telegram first; the same pattern extends to the other `social-listeners` routes.

## What it does
Reuses the existing bot (@MyPrivacyTOOL_Bot) and its Worker (`workers/social-listeners`). When **PROBE_MODE=on** and the sender is on the
**PROBE_TELEGRAM_IDS** allow-list (our own test accounts), it saves to `public.channel_probe_captures`:
1. `message`: the raw Telegram update exactly as delivered (what the message gives us).
2. `lookup:getChat`: the raw `getChat` answer for the sender (bio, birthdate, business details, personal channel; or Telegram's refusal).
3. `lookup:getUserProfilePhotos`: the raw answer (profile photos).
4. `lookup:getChat(personal_chat)`: the personal channel, when the profile shows one.

That is the two-part test: what the message delivers, then what a public lookup of the sender returns (the OSINT step), with no login.

## What it does not do
- Anyone not on the allow-list takes the normal path untouched: nothing is saved, no extra calls.
- Default is off (PROBE_MODE unset). The change to the live path is one guarded block in `src/telegram-webhook.ts`.
- Rows expire after 7 days (`expires_at`; purge with `select public.mpt_purge_expired_channel_probe_captures()`), service_role only.
- The bot token is never written to a row or a log.
- This is not the production data rule: it only ever holds our own test accounts. Capturing real users stays blocked on the stored-data
  decision (task "Align stored-data rules and user-facing wording with D-A").

## Deploy order
1. Apply `supabase/migrations/20261014190000_channel_probe_captures.sql` (additive, safe before the code).
2. Deploy `social-listeners`.
3. Set plain vars on the Worker (dashboard > Settings > Variables, not secrets): `PROBE_MODE=on`, `PROBE_TELEGRAM_IDS=<ids>`.
4. First time: set only `PROBE_MODE=on`, message the bot `/probeid` from each test account (it replies with that account's numeric id), then add the ids.
5. Message the bot from a test account; read the rows; compare with the database rows.
6. Finished: unset `PROBE_MODE` (or leave the allow-list empty). Rows expire on their own.

## Reading the results
```sql
select kind, created_at, payload from public.channel_probe_captures
where platform = 'telegram' and sender_id = '<id>' order by created_at desc;
```
Tick a database row Verified only when a saved payload shows the field; record the capture date in the row's Notes.

## Rollback
Unset `PROBE_MODE`. To remove: `drop function public.mpt_purge_expired_channel_probe_captures(); drop table public.channel_probe_captures;`
and revert the guarded block in `src/telegram-webhook.ts`.
