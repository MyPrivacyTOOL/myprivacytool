# X "MIRROR" bot (MPC-7628)

Channel OSINT bot MVP on X. A user DMs the keyword and gets an educational "mirror" of what a stranger can see about their
account from public data. Code: `workers/social-listeners/src/mirror-bot.ts`, wired into `x-webhook.ts`.

## Flow

| User DM | Bot action |
|---|---|
| `MIRROR` | Sends the consent message (what is read, what is never read, no retention). **Scans nothing.** |
| Just `Y` (or `yes`, `yeah`, `yep`, `yup`, any case; `MIRROR YES` also works) | Consent. Looks up the sender's public profile, builds the mirror, DMs it. |
| `N` / `no` / `MIRROR NO` (accepted quietly; the consent message does not ask for it, ignoring it is a no) | Confirms nothing was scanned or stored. |
| anything else | Forwarded to core-brain as before. |

Commands are case/punctuation-insensitive (`y`, `Y`, `Yes` all work; the consent message only asks the user to reply Y); our own DM echoes (`sender_id == for_user_id`) are ignored.

## Voice, welcome and intent (instant reply)

Every DM we send opens with who we are and ends with the same signature, so it is easy to find in the inbox and the brand is remembered:

`Hello @username, this is @MyPrivacyTOOL 👋` ... body ... `— @MyPrivacyTOOL · myprivacytool.io`

The @handle comes from a public lookup of the sender (`fetchUsername`, bearer token); if it fails the greeting simply leaves the handle out.

Any DM that is not a Mirror command gets the welcome straight away (`WELCOME_BODY`): what we do in one line, that this is an automated assistant, a "what brought you here?" question (reply 1, 2 or 3, or free text), then two simple options: reply **Y** for the Mirror, or the UTM-tagged free scan, and a thank-you. A plain **Y** (any case) right after the welcome, a 1/2/3 reply or the full consent request counts as consent: the Mirror offer carries the same `🪞 MyPrivacyTOOL Mirror` heading that `isConsentPending` looks for in our last message (15 minute window). Typing `MIRROR` still works. The welcome and the mirror result also carry a one-tap follow link (`FOLLOW_LINE`, X's follow intent page): a reply cannot make someone follow us, so we link it.

1/2/3 get a tailored reply (`INTENT_REPLIES`). No LLM; same per-sender and global rate limits as Mirror; never sent for our own messages or when the webhook does not carry our own account id.

### CRM feed: who got in touch (decision, 2026-10-13)

HubSpot is the CRM. X people mostly have no email, so they cannot arrive through the lead form. `social.ts` writes every follow, DM, like, share, mention and Mirror consent to the Supabase **feed** (`public.social_contacts` + `social_events`, via `mpt_social_touch`): the X user id, the public @handle, whether they follow us (`connection_status`), first/last seen, an event count, and the event type and time. **Never message text, never the scan result.** **HubSpot sync (`hubspot-sync.ts`):** right after a row is written, the person is created or updated in HubSpot as a contact (found by the custom property `x_user_id`; `firstname` = `@handle`, `lastname` = `(X)`), carrying `x_user_id`, `x_handle`, `x_follows_us`, `x_last_event`, `x_last_activity`, then `hubspot_synced_at` is set. The five custom properties are created automatically the first time (needs the token's `crm.schemas.contacts.write`). No scheduled job is used (the Cloudflare free plan is at its cron limit). It runs only when the GitHub secret `HUBSPOT_SOCIAL_TOKEN` is set: a dedicated HubSpot private app `MPT X activity sync` with ONLY crm.objects.contacts.read/write and crm.schemas.contacts.read/write. `DELETE` removes the person from HubSpot too (archive). Message text is never sent to HubSpot.

- **Events:** `dm`, `mirror_consent`, plus `follow`, `like`, `share`, `mention` from the Account Activity shapes (`follow_events`, `favorite_events`, `tweet_create_events`). The newer `dm.received` / activity shapes are only recognised for DMs; other new shapes are logged by name (`x_event_received`) so they can be added. Views of our profile are not available from X. Likes need the person's consent or follow in X's rules and may not arrive.
- **Wording:** the Mirror no longer says "I store nothing". It says it keeps none of the profile data or messages and only notes that the person got in touch (@handle and date), and that sending `DELETE` removes it.
- **DELETE:** `DELETE` / `delete my data` calls `mpt_erase_social_contact` (events cascade) and confirms. Contacts also expire after 2 years (`retain_until`, `mpt_purge_expired_social_contacts`).
- **Funnel counts** (below) are separate and anonymous: no id at all.

### Intent and funnel counting (decision, 2026-10-13)

What people type is never stored, and neither is who sent it. Each inbound DM we answer writes ONE row to `public.interaction_log` through `mpt_brain_record` (`funnel.ts`): channel `x`, **no sender id** (X is log-only), **no message text**, intent bucket, and an event key, kept 90 days. That row is what the Channel OSINT dashboard (`mpt_channel_osint_daily`, platform `x`) counts as `dms_received`, and consent rows count as `scan_requests`. So the Mirror's "I store nothing" stays true: only an anonymous counter row exists.

| Event | intent | `response_key` |
|---|---|---|
| `MIRROR` | help | `x.mirror.request` |
| consent (`Y`, `MIRROR YES`) | scan | `x.mirror.consent` |
| decline | help | `x.mirror.decline` |
| reply `1` / `2` / `3` | help | `x.intent.1` / `.2` / `.3` |
| anything else | help | `x.welcome.<theme>`, theme = `safety`, `scam`, `exposure`, `business`, `curious` or `other` (keyword match, only the theme word is kept) |

Because every DM we answer is counted here, it is not also forwarded to core-brain (it would be logged twice, and its text would go to the LLM). `consents_given` stays 0 for X (it needs a conversation state, which X does not have); use `scan_requests`.

## Alice clip on DMs

The welcome reply and the mirror DM carry a 6 s clip of Alice opening the curtain (`public/media/alice-curtain.mp4`, served at `https://myprivacytool.io/media/alice-curtain.mp4`). The worker fetches it, uploads it to X with the chunked v2 flow (`x-media.ts`, `media_category=dm_video`) and attaches the media id to the DM. X's console does not offer `media.write` on the OAuth 2.0 user token (the upload answered 403, `x_media_init_rejected`), so the upload is signed with OAuth 1.0a instead: the app's API key + the account's access token and secret (secrets `X_CONSUMER_KEY`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, plus the existing `X_CONSUMER_SECRET`; `oauth1Header` in `x-media.ts`). Without those four the OAuth 2.0 call is tried and the DM goes out as text. If the upload fails for any reason (missing scope, X error, clip unreachable) or X refuses the attachment, the same DM is sent as text alone. Set `MEDIA_VIDEO_URL=off` to turn the clip off.

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

If the bot goes silent with `x_token_refresh_rejected`: generate a new OAuth 2.0 access token on the app's Keys & Tokens page (logged in to x.com as @myprivacytool, with `dm.read` and `dm.write`), put its access and refresh tokens in `X_USER_ACCESS_TOKEN` and `X_REFRESH_TOKEN`, and re-run the deploy. When X refuses the stored refresh token, the bot now tries the `X_REFRESH_TOKEN` secret once, so the stored row no longer has to be deleted by hand. Then re-create the `dm.received` subscription on the Subscriptions tab if X says the user has not authorised `dm.read`.

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
