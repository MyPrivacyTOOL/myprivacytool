# Footprint Path: live check and test-account setup (MPC-10621)

How to check that the Footprint Path shows **5** arrival prints for an allow-listed test account and **4** for everyone else, and how the allow-list is wired.

## Live check (about 2 minutes)

1. From the test account, send `dashboard` to the bot. (Not `footprint`: its `/f/` link sets a different session that `/api/dashboard` refuses, so the path can never show prints from it.)
2. Open the `/d/...` link in Chrome and press **Open my dashboard**. The link works once and expires after 15 minutes.
3. In the same browser open `https://www.myprivacytool.io/?path=1`.
4. Scroll to **Behind you**. Real Telegram values (no "sample data" label) and "5 things known about you" mean the flag is true. 4 means it is false.

A normal account cannot get a dashboard link (the bot only issues them to allow-listed accounts), so the 4-print case is covered by tests: `src/components/FootprintPathHost.test.tsx` and `shared/dashboard/dashboard.vitest.ts`.

## How the flag works

- `/api/dashboard` returns `baseline.allow_listed_test_account` (a boolean, only on an available baseline).
- It is true when the session's sender is in `PROBE_TELEGRAM_IDS` (comma-separated numeric Telegram ids). If the bot Worker sets `TELEGRAM_ID_HMAC_KEY`, stored sender ids are hashed and the same key is used to match them.
- The list and the ids are never in the response. Anything missing or unreadable means a real user.

## Keeping the two copies in step

The bot Worker (`social-listeners`) and the Pages project (`wwwmyprivacytool`) each hold their own copy of these secrets. Cloudflare never shows a secret's value back, so they cannot be compared automatically. When you change one, change the other, then **retry the latest Production deployment** (new Pages secrets only apply to the next deploy):

| Secret | Worker `social-listeners` | Pages `wwwmyprivacytool` (Production) |
|---|---|---|
| `PROBE_TELEGRAM_IDS` | required for the bot commands | required for the flag |
| `TELEGRAM_ID_HMAC_KEY` | only if sender ids are hashed | same value, or hashed senders show 4 prints |

## Finding a test account's id

Send `/start` to `@userinfobot` from that account and copy the number after **Id:**. The bot's own `/probeid` only answers while the Worker has `PROBE_MODE=on`.
