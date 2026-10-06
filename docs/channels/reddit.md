# Reddit channel (MPC-116)

Extracts behavioral/interest signals from the signed-in user's own Reddit account and maps them to a PaPIT v1 `behavioral`
profile ([schema](../papit/schema-v1.md#reddit-channel-mpc-116)). **No raw post or comment text is ever stored, logged, cached or returned.**

It is served by the same Worker as the GitHub channel (`workers/github-channel`, live at `https://channels.myprivacytool.io`), so
it shares the AES-256-GCM encryption, the `public.channel_tokens` table (rows with `provider = 'reddit'`), the KV cache, the secrets
(`STATE_SIGNING_KEY`, `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and the same-site cookie setup. See [github.md](github.md) for those.

## Routes

| Route | Notes |
|---|---|
| `GET /oauth/reddit/start` | Redirect to Reddit. Scopes `identity read history`, `duration=permanent` (gives a refresh token). Signed `state` cookie; Reddit has no PKCE. |
| `GET /oauth/reddit/callback` | Verify state, exchange the code (HTTP Basic client credentials), store encrypted tokens, set the `mpt_rd_session` cookie, redirect to `REDDIT_SUCCESS_REDIRECT` (or return `{ok:true}`). Failures redirect with `?channel_error=...&stage=exchange\|reddit_user\|store`; a token that could not be stored is revoked at Reddit. |
| `GET /channels/reddit/behavior` | `200` PaPIT JSON, header `X-Cache: HIT\|MISS` and `X-PaPIT-Sanitization-Receipt`. `401 unauthenticated`, `401 reauthorize`, `404 not_connected`, `502 upstream_error`. |
| `DELETE /channels/reddit` | Deletes the token row first, clears the cache, then revokes the token at Reddit. `Origin` must be an allowed site origin (CSRF). |

Until `REDDIT_CLIENT_ID`, `REDDIT_REDIRECT_URI` and `REDDIT_CLIENT_SECRET` are all set, these routes answer `503 reddit_not_configured` and the GitHub channel is unaffected.

## Setup (needs a human with a Reddit account)
1. Create an app at <https://www.reddit.com/prefs/apps>: type **web app**, redirect URI `https://channels.myprivacytool.io/oauth/reddit/callback`. The client id is shown under the app name; the secret is the "secret" field.
2. In `workers/github-channel/wrangler.toml` uncomment the `REDDIT_*` vars (client id, redirect URI, a descriptive `REDDIT_USER_AGENT` such as `MyPrivacyTOOL/1.0 (by /u/<you>)`).
3. `npx wrangler secret put REDDIT_CLIENT_SECRET` (from `workers/github-channel`), then `npx wrangler deploy`.
4. Open `https://channels.myprivacytool.io/oauth/reddit/start`, authorize, then `https://channels.myprivacytool.io/channels/reddit/behavior`.
5. Check the token is ciphertext: `select provider, left(access_token_enc, 3) from public.channel_tokens;` shows `reddit | v1.`.

## Rate limiting and expiry
Calls run through a 1 request/second limiter (`lib/rate-limit.js`; Reddit allows about 60/min per client). A cold profile build is 3 requests
(me, 100 comments, 50 posts), about 2 seconds; the result is cached 24h. Reddit access tokens last 1 hour: on a `401` the Worker refreshes once
with the stored refresh token (Reddit does not rotate it, so the same one is kept), retries, and otherwise deletes the row and returns `reauthorize`.

## Privacy pipeline
Handle and account id are `restricted` records dropped by the bridge. Comment/post text is sanitized by the bridge, then PII-stripped
and reduced to at most 5 stopword-filtered keywords per subreddit and 20 overall topics. Logs carry event names and status codes only.

## Not verified live
Everything above is covered by mocked tests (`test/reddit-core.test.mjs`, `test/reddit-routes.test.mjs`). The live OAuth flow, the real
`oauth.reddit.com` response shapes and the `v1.` ciphertext check need the Reddit app credentials and a human login.

## Rollback
Revert the commit and redeploy. Remove the rows: `delete from public.channel_tokens where provider = 'reddit';`. Revoke the app at
reddit.com/prefs/apps and delete the `REDDIT_CLIENT_SECRET` secret.
