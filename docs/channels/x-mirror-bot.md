# X "MIRROR" bot (MPC-7628)

Channel OSINT bot MVP on X. A user DMs the keyword and gets an educational "mirror" of what a stranger can see about their
account from public data. Code: `workers/social-listeners/src/mirror-bot.ts`, wired into `x-webhook.ts`.

## Flow

| User DM | Bot action |
|---|---|
| `MIRROR` | Sends the consent message (what is read, what is never read, no retention). **Scans nothing.** |
| `MIRROR YES`, or just `Y` / `YES` | Consent. Looks up the sender's public profile, builds the mirror, DMs it. |
| `MIRROR NO`, or just `N` / `NO` | Confirms nothing was scanned or stored. |
| anything else | Forwarded to core-brain as before. |

Commands are case/punctuation-insensitive (`y`, `Y`, `Yes` all work); our own DM echoes (`sender_id == for_user_id`) are ignored.

## Consent and no-retention guarantee

- **A bare Y/N counts only as an answer to our consent request.** Still stateless: `isConsentPending` asks X for the last 5 DMs in that conversation and requires that OUR most recent message to the sender is the consent request (it starts with `🪞 MyPrivacyTOOL Mirror`) and was sent in the last 15 minutes. Anything else (no request, an older one, or the mirror result was the last thing we sent) is treated as an ordinary message and goes to core-brain as before. The lookup is rate limited like any Mirror command and needs the `dm.read` scope.
- **Consent is stateless.** The explicit `MIRROR YES` message is the consent; the scan only ever runs on that message, so there is
  no pending-consent store to keep. Consent events are logged as event names only (`mirror_consent_requested|granted|declined`).
- **No data retention.** The profile is held in memory for one request, sent to the user and dropped. Nothing is written to
  Supabase, KV or Notion; logs carry no handles, ids or profile content (metadata event names only).
- **Public data only:** `GET /2/users/:id` with an app bearer token. The bot never reads DMs, email, phone or private activity.

## What the mirror shows

Visible: bio, location, link, account creation date, follower/following/post counts, photo/name, pinned post, and whether the
account is protected. Protected (never seen): DMs, email, phone, IP, login history, contacts. Ends with the CTA to
`https://myprivacytool.io/scan`.

## Setup (current, 2026-10-13)

Account: **@myprivacytool** (never @ToolMyprivacy). X app `33528075` (console https://console.x.com/accounts/2109699365371514965/apps/33528075):
App permissions "Read and write and Direct message", type "Web App, Automated App or Bot", pay-per-use credits.

1. Webhook (Webhooks tab): `https://social-listeners.myprivacytool.workers.dev/webhook/x?app=2` (the `?app=2` is only there because X refuses a URL already used by another app's webhook; the worker ignores it).
2. Subscription (Subscriptions tab): category DM, event type DM Received (`dm.received`), user `@myprivacytool`, webhook above. (The "Subscribe" event type needs `follows.read` and is not used.)
3. GitHub Actions secrets, then Actions > "Deploy core-brain & social-listeners" > Run workflow (see `/SECRETS.md`):
   `X_CONSUMER_SECRET`, `X_BEARER_TOKEN`, `X_USER_ACCESS_TOKEN`, and for token refresh `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN`.
4. Test: DM `MIRROR` to the bot from a second account, reply `MIRROR YES`, expect the mirror DM.

## Token refresh (MPC-7628)

X access tokens last about 2 hours and each refresh returns a new single-use refresh token. `src/x-oauth.ts` therefore keeps the
latest pair in Supabase (`public.mpt_x_oauth_tokens`, one row `id = 'mirror'`, service_role only, migration
`20261013120000_mpc_7628_x_oauth_tokens.sql`, applied automatically on merge by "Deploy Supabase migrations"). Order: in-memory copy,
stored row, refresh (stored refresh token, else the `X_REFRESH_TOKEN` secret, which only seeds the table), then the static
`X_USER_ACCESS_TOKEN`. A 401 on a DM triggers one forced refresh and one retry. Logs: `x_token_refreshed`, `x_token_refresh_rejected`
(status only), never token values.

If the bot goes silent with `x_token_refresh_rejected`: generate a new OAuth 2.0 access token on the app's Keys & Tokens page, put its
refresh token in `X_REFRESH_TOKEN`, delete the row (`delete from public.mpt_x_oauth_tokens;`) and re-run the deploy.

## Event formats

`extractMirrorDms` walks the payload for DM-shaped objects, so the legacy Account Activity shape (`direct_message_events[].message_create`)
and the newer `dm.received` shape are both read. Our own echoes are skipped, and a post that merely says "mirror" is never a command.
Anything that is not a MIRROR command is forwarded to core-brain as before. For events we do not recognise the worker logs
`x_event_received` with the event type and top-level key names only (no ids or text), so a new shape can be diagnosed from the logs.

## Limits and cost

Each scan spends X API credits. Workers Rate Limiting bindings (`wrangler.toml`): per sender 3 Mirror commands / 60 s, global 30 / 60 s;
over the limit the DM is dropped without a reply. Fails open if the binding is missing. There is no daily credit cap yet; watch the
balance in the X console (Billing > Credits) and the Master Cost Ledger.

## Analytics

Links sent to the main site carry `utm_source=x&utm_medium=channel_osint&utm_campaign=bot_reply` (MPC-7641 convention), so GA4 clicks and
scans from X are attributed. The funnel counters that come from `interaction_log` (`dms_received`, `scan_requests`, `consents_given`) do
not include Mirror DMs, because they are answered here and never reach core-brain; the Mirror flow is counted by its log events only.

## Known limits

- English only (messages are constants in `mirror-bot.ts`; move to `locales/` keys when localising).
- Only the MIRROR flow is answered on X. Other DMs reach core-brain but nothing sends core-brain's reply back on X yet.
- Tests in `workers/social-listeners/mirror-bot.vitest.ts` and `x-oauth.vitest.ts`.
