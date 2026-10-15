# Channel probe reader

Measures what a channel really delivers, so the Verified ticks in the Notion "Channel Signal Availability" database can rest on evidence.
Telegram first; the same pattern extends to the other `social-listeners` routes.

## Modes
`PROBE_MODE` is `off` (default; unset or any other value), `on` (allow-listed test accounts) or `all` (every non-bot sender, see "Mode all").

## What it does (mode on)
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
- In mode `on` it only ever holds our own test accounts. Mode `all` captures real users: see below.

## Mode all (decision D-A, "capture everywhere")
**Off by default. This mode captures real users and holds personal data (PII).** Before `PROBE_MODE=all` is switched on, the stored-data rules
(task "Align stored-data rules and user-facing wording with D-A") and the privacy wording must be aligned; the bot copy that says it
"can't see your profile" is untrue for public profiles and is a follow-up.

- **Who:** every real user (never a bot) on any update type: message, edited_message, callback_query, inline_query, chosen_inline_result,
  my_chat_member, chat_member, chat_join_request, business_message, edited_business_message, message_reaction, shipping_query,
  pre_checkout_query, poll_answer. No allow-list is needed. `/probeid` is not handled in this mode.
- **What is saved** (all rows carry `expires_at`): `update` (the raw update as delivered), then, in parallel, `lookup:getChat`,
  `lookup:getUserProfilePhotos` (limit 100), `lookup:getUserProfileAudios`, `lookup:getUserPersonalChatMessages` (limit 20) and
  `lookup:getChatMember` (only when the update carries a group chat id). Then `lookup:getChat(personal_chat)` when the profile shows a
  personal channel, and `lookup:getFile` for up to 5 of the largest profile photos (file_path metadata only; image bytes are never downloaded or stored).
  Each lookup row is the raw `{status, response}`, so Telegram's refusals are evidence too.
- **Throttle:** if the same sender had a `lookup:getChat` row within `PROBE_LOOKUP_HOURS` (default 24), only the raw `update` is saved. If the check errors, the lookups run.
- **Retention:** `expires_at = now + PROBE_RETENTION_DAYS` (default 90, clamped 1-365). Purge with `select public.mpt_purge_expired_channel_probe_captures()`.
- **Safety:** every Telegram call and the save are wrapped with a 5s timeout; the webhook always forwards to core-brain and returns 200. The bot token is never written to a row or a log.
- **Rollback:** unset `PROBE_MODE`. Stored rows expire on their own, or delete them: `delete from public.channel_probe_captures where expires_at > now() + interval '7 days';`.
- The table comment was updated by migration 20261015150000; the original migration header (already applied) still says test accounts only.

## Full event log
**Mode `on` only.** A complete record of one conversation, for allow-listed or opted-in accounts. Mode `all` never writes to it (no message-content, outbound or brain logging there) and mode `off` does nothing.

- **Who:** `PROBE_MODE=on` AND the sender (any update type `updateActor` supports, never a bot) is in `PROBE_TELEGRAM_IDS` or `PROBE_LOG_OPTIN_IDS` (comma-separated numeric Telegram ids). Anyone else is not logged and costs no extra call.
- **Table:** `public.telegram_event_log` (migration `20261015170000_telegram_event_log.sql`, service_role only, RLS enabled and forced). Columns: `id, created_at, platform, direction, kind, sender_id, chat_id, update_id, session_id, payload, expires_at`.
  - `direction = 'in'`: the raw update, untrimmed (`kind` = update type, e.g. `message`).
  - `direction = 'out'`: every Telegram API call this Worker makes for the logged chat: `payload = {method, request, status, response}` (`kind` = method; a method used twice in one update gets `#2`). Status 0 means no answer.
  - `direction = 'brain'`: the core-brain answer used to pick the reply (`kind = 'core-brain'`, `payload = {outcome: 'ok', status, body}`). A failure is stored under its own kind, `decision_unavailable` (core-brain down or refused) or `decision_rate_limited`, so a successful retry of the same `update_id` still logs its own decision and `out` rows.
  - **Extra `out` rows for allow-listed senders.** The existing mode-`on` probe lookups (`getChat`, `getUserProfilePhotos`, and `getChat` for a personal channel) are Telegram calls made for the logged chat, so senders in `PROBE_TELEGRAM_IDS` get those as `out` rows too, besides `sendMessage`. Senders only in `PROBE_LOG_OPTIN_IDS` get no probe lookups, so their `out` rows are the bot's own replies (`sendMessage`).
  - `update_id` links the in, out and brain rows of one update. A retried `update_id` is not logged twice (unique `(direction, update_id, kind)`, insert is `ON CONFLICT DO NOTHING`).
- **Sessions:** `session_id = <chat_id>:<sender_id>:<n>`. `n` starts at 1 and goes up after 30 minutes without an inbound message from that chat and sender. If the lookup fails, a new session is started (numbered by the clock) rather than failing.
- **Retention:** `PROBE_LOG_RETENTION_DAYS`, default 90, clamped 1-365, or `forever` (`expires_at` null). Purge with `select public.mpt_purge_expired_telegram_event_log();`.
- **Safety:** every write is `ctx.waitUntil`, has a 5s timeout and swallows errors; the webhook still returns 200 for a logging failure and always forwards to core-brain. The bot token is never in a row (it is only in request URLs, and rows are scrubbed of it anyway) or a log.
- **Personal data:** rows hold full message content. Only add ids of people who agreed (`PROBE_LOG_OPTIN_IDS`).
- **Read a session:** `select created_at, direction, kind, payload from public.telegram_event_log where session_id = '<chat>:<sender>:<n>' order by created_at;`
- **Rollback:** unset `PROBE_MODE` (or the two id lists). Remove: `drop function public.mpt_purge_expired_telegram_event_log(); drop table public.telegram_event_log;`.

## Deploy order
1. Apply `supabase/migrations/20261014190000_channel_probe_captures.sql` (additive, safe before the code).
2. Deploy `social-listeners`.
3. Set plain vars on the Worker (dashboard > Settings > Variables, not secrets): `PROBE_MODE=on`, `PROBE_TELEGRAM_IDS=<ids>` (or `PROBE_MODE=all`, see above; optional `PROBE_LOOKUP_HOURS`, `PROBE_RETENTION_DAYS`). For the full event log add `PROBE_LOG_OPTIN_IDS` and optionally `PROBE_LOG_RETENTION_DAYS`, and apply `20261015170000_telegram_event_log.sql` first.
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
