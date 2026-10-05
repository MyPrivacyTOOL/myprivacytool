# Reddit channel (MPC-116)

Extracts behavioral/interest signals from a user's Reddit account and maps them to the PaPIT `behavioral` schema. **No raw post or comment text is ever stored, logged, cached or returned.**

## Setup
1. Create an app at <https://www.reddit.com/prefs/apps> — type **web app**, redirect URI `http://localhost:3000/api/auth/callback/reddit`.
2. Set environment variables (never commit real values):
   ```
   REDDIT_CLIENT_ID=
   REDDIT_CLIENT_SECRET=
   REDDIT_USER_AGENT=MyPrivacyTOOL/1.0 (by /u/YOUR_REDDIT_USERNAME)
   CHANNEL_TOKEN_ENCRYPTION_KEY=   # base64, 32 bytes: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
3. Apply `supabase/migrations/20261006120000_channel_tokens.sql`.

## OAuth
`src/modules/oauth/providers/reddit.ts` — next-auth v5-shaped provider. Scopes are limited to `identity read history`; `duration=permanent` returns a refresh token. Tokens are encrypted (AES-256-GCM, `src/modules/storage/encryption.ts`) by `src/modules/channels/token-store.ts` before insertion into `channel_tokens` (unique on `user_id, platform`; RLS on, service-role only).

## Rate limiting
`withRateLimit` (`channels/middleware/rate-limiter.ts`) runs calls strictly sequentially, one start per second (Reddit allows 60/min). Calls queue, never drop; one failure doesn't block the queue. Events log only queue length and wait time.

## Extraction plan
`getMe()` → account age/karma; `getUser().getComments({limit:100})`; `getUser().getSubmissions({limit:50})`. Subreddits are ranked by activity count; engagement: <3 lurker, 3–9 occasional, 10–29 active, ≥30 power_user.

## Privacy pipeline
Text is PII-stripped (emails, phones, zips, street addresses, "I live in…" locations, `u/` mentions, the user's own handle), then reduced to ≤5 stopword-filtered keywords per subreddit and ≤20 overall topics. Raw text exists only inside the transformer call.

## Endpoint
`GET /api/channels/reddit/behavior` (`src/app/api/channels/reddit/behavior/route.ts`) is a Web `Request`→`Response` handler built with `createBehaviorHandler({getUserId, getClient})`. The default `GET` export is **unwired** (always 401) until the host app supplies session and token deps.

## Rollback
Revert the commit; `DELETE FROM channel_tokens WHERE platform='reddit';`; revoke tokens at reddit.com/prefs/apps; remove the env vars.
