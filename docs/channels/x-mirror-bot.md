# X "MIRROR" bot (MPC-7628)

Channel OSINT bot MVP on X. A user DMs the keyword and gets an educational "mirror" of what a stranger can see about their
account from public data. Code: `workers/social-listeners/src/mirror-bot.ts`, wired into `x-webhook.ts`.

## Flow

| User DM | Bot action |
|---|---|
| `MIRROR` | Sends the consent message (what is read, what is never read, no retention). **Scans nothing.** |
| `MIRROR YES` | Consent. Looks up the sender's public profile, builds the mirror, DMs it. |
| `MIRROR NO` | Confirms nothing was scanned or stored. |
| anything else | Forwarded to core-brain as before. |

Commands are case/punctuation-insensitive; our own DM echoes (`sender_id == for_user_id`) are ignored.

## Consent and no-retention guarantee

- **Consent is stateless.** The explicit `MIRROR YES` message is the consent; the scan only ever runs on that message, so there is
  no pending-consent store to keep. Consent events are logged as event names only (`mirror_consent_requested|granted|declined`).
- **No data retention.** The profile is held in memory for one request, sent to the user and dropped. Nothing is written to
  Supabase, KV or Notion; logs carry no handles, ids or profile content (metadata event names only).
- **Public data only:** `GET /2/users/:id` with an app bearer token. The bot never reads DMs, email, phone or private activity.

## What the mirror shows

Visible: bio, location, link, account creation date, follower/following/post counts, photo/name, pinned post, and whether the
account is protected. Protected (never seen): DMs, email, phone, IP, login history, contacts. Ends with the CTA to
`https://myprivacytool.io/scan`.

## Setup

1. X developer app with Account Activity API; webhook registered at `https://<social-listeners>/webhook/x` (already live for MPC-8301) and the bot account subscribed.
2. Secrets on `social-listeners`: `X_BEARER_TOKEN` (app-only bearer) and `X_USER_ACCESS_TOKEN` (OAuth 2.0 user token of the
   bot account with `dm.read dm.write users.read tweet.read offline.access`). `X_CONSUMER_SECRET` must already be set.
   See `/SECRETS.md`. Without either token the bot is silent (DMs go nowhere) and logs `mirror_scan_failed`.
3. Test: DM `MIRROR` to the bot account from a second account, reply `MIRROR YES`, expect the mirror DM.

## Known limits (MVP)

- English only (messages are constants in `mirror-bot.ts`; move to `locales/` keys when localising).
- `X_USER_ACCESS_TOKEN` expires (OAuth 2.0); there is no refresh job yet.
- X API tier/rate limits for `users/:id` and DM sends apply; failures send an apology DM and are logged.
- Tests in `workers/social-listeners/mirror-bot.vitest.ts`.
