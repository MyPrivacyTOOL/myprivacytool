# Channel OSINT bot MVP: X "Mirror" (MPC-7628)

A user DMs **MIRROR** to the bot account on X. The bot asks for consent, reads the public profile of the sender's own account,
and DMs back an educational "mirror": what a stranger can see without logging in, what is worth a second look, and what is not
visible. It ends with a link to the website scan. Code: `workers/social-listeners/src/mirror-bot.ts`, wired in `x-webhook.ts`.

## Flow

1. X Account Activity webhook delivers the DM to `social-listeners` `/webhook/x` (signature already verified, MPC-8301).
2. `MIRROR` -> bot stores a `pending` marker (10 min) and DMs the consent text. No lookup yet.
3. `YES` (while pending) -> marker replaced by a 60 s `cooldown`; bot calls `GET /2/users/:id` with the app bearer for **the sender's id only**, builds the message in memory, DMs it.
4. `NO` (while pending) -> marker deleted, bot DMs a decline note. Nothing was looked up.
5. Any other DM, and a YES/NO with nothing pending, is forwarded to core-brain exactly as before.

The webhook answers 200 first; the X API calls run in `waitUntil`, so a slow call never makes X redeliver.

## No-data-retention guarantee (what the code enforces)

- The scan result is never written anywhere. It exists in memory while the DM is built and sent.
- The only stored value is `pending` / `cooldown`, under a key made from an HMAC of the sender id (`X_CONSUMER_SECRET` as key), so the raw id is not stored. TTL 10 min / 60 s.
- Logs carry event names only (`mirror_consent_requested`, `mirror_consent_given`, `mirror_declined`, `mirror_delivered`, ...). Tests assert no id, handle or text is logged.
- MIRROR DMs are not forwarded to core-brain, so they never reach its `interaction_log`.
- Only the DM sender's own account is scanned. There is no way to ask the bot about someone else.

## Configuration (the bot is OFF until all are set)

| Secret | What it is | Where in the X developer portal |
|---|---|---|
| `X_CONSUMER_SECRET` | API Key Secret (already used for the webhook) | Keys and tokens |
| `X_API_KEY` | API Key (consumer key) | Keys and tokens |
| `X_BEARER_TOKEN` | App-only bearer, reads public profiles | Keys and tokens |
| `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Bot account's user tokens, Read + Write + **Direct Messages** permission | Keys and tokens, generate after enabling DM permission |

Add them as GitHub Actions secrets and re-run "Deploy core-brain & social-listeners"; unset ones are not pushed.
Optional `MIRROR_KV` binding (see `wrangler.toml`) gives one global consent store; without it the Cache API is used, which is per
data centre, so a YES can very occasionally land in a different data centre than its MIRROR and be ignored (the user just sends MIRROR again).

## Still needed from a human (blocks the live test)

- **Paid X API tier** (MPC-7473): the Account Activity API and DM sending need it. Without it nothing can be received or sent.
- Create/choose the bot X account, enable DM permission, generate the five secrets above, register the webhook (`/webhook/x`), subscribe the bot account.
- Legal read of the consent and no-retention wording (MPC-6798 covers the policy side).
- Test with the 10 internal users the original MPC-024 scope asked for, before any public announcement.

## Not in this MVP

English only (the other locales are not written for this flow); no mention-based trigger (DM only); no broker or breach lookups
(the CTA hands off to the existing website scan).
