# GitHub channel integration (MPC-115, Phase 1)

A Cloudflare Worker (`workers/github-channel`) that connects a user's GitHub account, derives a
sanitized PaPIT v1 profile ([schema](../papit/schema-v1.md)) and caches it for 24h.

Decisions recorded on the MPC-115 Notion task (2026-10-05): Worker not Next.js (A), Cloudflare is the
host (B), Workers KV cache (C), `read:user` only (D), tokens kept until the user revokes (E), fixed activity
and role rules (F, G), sorted-key canonical receipt (H), `key_version` column (I), RLS service-role only (J).

## Flow

```
SPA                      Worker (github-channel)                  GitHub            Supabase
 | "Connect GitHub" ->    |                                        |                 |
 |  GET /oauth/github/start                                        |                 |
 |  <- 302 (state+PKCE verifier in signed HttpOnly 10-min cookie)  |                 |
 |  ------------------------------- consent (scope: read:user) --> |                 |
 |  <- 302 /oauth/github/callback?code&state                       |                 |
 |                        | verify state; POST code+verifier ----> |                 |
 |                        | <-- access token                       |                 |
 |                        | GET /user (keep id only)  -----------> |                 |
 |                        | AES-256-GCM encrypt -> upsert ciphertext ---------------> |
 |  <- 302 SUCCESS_REDIRECT + signed session cookie (7 days)       |                 |
 |  GET /channels/github/profile (cookie, CORS)                    |                 |
 |                        | KV hit? -> return                      |                 |
 |                        | else load+decrypt token, 4 reads ----> |                 |
 |                        | transform -> PaPIT, KV put (24h)       |                 |
 |  <- 200 PaPIT JSON                                              |                 |
 |  DELETE /channels/github (Origin must equal ALLOWED_ORIGIN)     |                 |
 |                        | delete row, clear KV, revoke grant --> |                 |
```

## Endpoints

| Route | Notes |
|---|---|
| `GET /oauth/github/start` | Redirect to GitHub. Scope `read:user`, PKCE S256. |
| `GET /oauth/github/callback` | On success 302 to `SUCCESS_REDIRECT`; on failure 302 with `?channel_error=<code>` (`access_denied`, `invalid_state`, `missing_code`, `connect_failed`). If the token cannot be stored it is revoked at GitHub. |
| `GET /channels/github/profile` | `200` PaPIT JSON, header `X-Cache: HIT|MISS`. `401 unauthenticated` (no session), `401 reauthorize` (token revoked at GitHub; our copy is deleted), `404 not_connected`, `502 upstream_error`. |
| `DELETE /channels/github` | User revoke: deletes the token row first, clears the cache, then revokes the grant at GitHub. |
| `GET /health` | `{status:"ok"}` |

The session cookie is `HttpOnly; Secure; SameSite=None` so the SPA (different origin) can call the Worker with
`credentials: "include"`. CORS only allows `ALLOWED_ORIGIN`; `DELETE` additionally rejects any other `Origin` (CSRF).

## Security

- **Zero plaintext tokens.** Access/refresh tokens are AES-256-GCM encrypted (`lib/encryption.js`) before the Supabase call:
  random 96-bit IV, `v<key_version>.<iv>.<data>`, AAD `github:<user_id>:<column>` binds a ciphertext to its row.
  Tested: the request bodies sent to Supabase contain no plaintext (`test/worker.test.mjs`).
- **Key rotation.** `ENCRYPTION_KEY` is the current key (`ENCRYPTION_KEY_VERSION`). To rotate: set `ENCRYPTION_KEY_V<old>` to the old key,
  put the new key in `ENCRYPTION_KEY`, bump `ENCRYPTION_KEY_VERSION`. Old rows decrypt via their stored `key_version`; they are re-encrypted
  the next time the user reconnects.
- **RLS.** `channel_tokens` has RLS enabled and forced, no policies, and no grants for `anon`/`authenticated`. Rows are keyed `(user_id = GitHub user id, provider = 'github')`.
- **Minimal scope.** `read:user` only. Public repos and public starred repos need no extra scope.
- **Logs** hold event names and status codes only. The adapter's errors carry the HTTP status, never a URL, token or body.
- **Cache** holds the sanitized PaPIT snapshot only, never tokens or raw GitHub responses.

## SPA: "Connect GitHub"

`/connect/github` (`src/pages/ConnectGitHub.tsx`, `src/components/ConnectGitHub.tsx`, client in `src/lib/githubChannel.ts`).
The button is a plain link to the Worker's `/oauth/github/start`; after the GitHub round trip the Worker redirects back to
`SUCCESS_REDIRECT` (`https://www.myprivacytool.io/?channel=github`). The page then reads `GET /channels/github/profile` with
`credentials: "include"`, shows the sanitized profile, and offers **Disconnect** (`DELETE /channels/github`). `?channel_error=`
codes are mapped to friendly copy and the raw code is never shown.

- **Unlisted on purpose:** `noindex`, not in the sitemap or nav. Link to it when the channel is ready to launch.
- After login the Worker redirects to `SUCCESS_REDIRECT` (`https://www.myprivacytool.io/connect/github`).
- Override the Worker URL with `VITE_GITHUB_CHANNEL_URL` (e.g. for a custom domain).
- **Served from `channels.myprivacytool.io`** (a Workers custom domain, `routes` in `wrangler.toml`), the same site as
  `www.myprivacytool.io`, so the session cookie is not a third-party cookie and Safari/Firefox send it. The GitHub OAuth app's
  callback URL must equal `REDIRECT_URI` (`https://channels.myprivacytool.io/oauth/github/callback`); GitHub allows only one.
  `workers_dev` stays on until the custom domain is verified, then set it to `false` to retire the old `*.workers.dev` address.

## Token expiry and refresh

The OAuth app has GitHub's "expiring user tokens" on, so access tokens last about 8 hours and come with a refresh token
(valid about 6 months). On a profile cache miss the Worker uses the stored access token. If GitHub answers `401` and a refresh
token is stored, the Worker trades it once for a new pair (`grant_type=refresh_token`), encrypts and saves the new pair
(refresh tokens rotate: each use invalidates the old one), and retries the request. If there is no refresh token or GitHub
rejects it (`bad_refresh_token`, e.g. the user revoked the app), the token row is deleted and the endpoint returns
`401 reauthorize`, so the SPA sends the user back to `/oauth/github/start`. Logs record only `token_refreshed` or the GitHub
error code. Two requests refreshing at the same moment can race (the second sees `bad_refresh_token`); the 24h profile cache
makes this rare, and the cost is one extra reconnect.

## Rate limits

GitHub allows 5,000 requests/hour per user token. A cold profile build costs at most 9 requests
(`/user`, up to 3 pages of repos, 2 of starred, 3 of events). With a 24h cache one user uses about 9 requests per day.

## Setup

1. **GitHub OAuth App** (github.com/settings/developers): Authorization callback URL = `REDIRECT_URI`
   (`http://localhost:8787/oauth/github/callback` for local dev). Enable PKCE-capable flow (default). Request no extra scopes.
2. **Supabase**: `public.channel_tokens` already exists (created by migration `create_channel_tokens`, 20261006060503). Apply `supabase/migrations/20261006120000_channel_tokens_worker_columns.sql`, which adds `key_version`, relaxes the ciphertext CHECKs for key rotation and forces RLS. It is additive and leaves existing rows alone.
3. **KV**: `npx wrangler kv namespace create PROFILE_CACHE`, put the id in `wrangler.toml`.
4. **Config**: fill the `REPLACE_*` vars in `workers/github-channel/wrangler.toml`.
5. **Secrets** (names in `EXPECTED_SECRETS.txt`), from `workers/github-channel`:
   ```sh
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put STATE_SIGNING_KEY          # openssl rand -hex 32
   npx wrangler secret put ENCRYPTION_KEY             # openssl rand -hex 32  (64 hex chars)
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
   Local dev: copy `.dev.vars.example` to `.dev.vars` (gitignored), then `npx wrangler dev`.
6. **Deploy**: run the "GitHub channel Worker" workflow manually (it refuses to deploy while `REPLACE_*` remain).

## Verifying tokens are ciphertext (manual acceptance check)

After one live connect, in Supabase SQL editor:
```sql
select user_id, provider, left(access_token_enc, 12) as prefix, key_version, scope from public.channel_tokens;
```
`prefix` must look like `v1.` + base64url, never `gho_`.

## Tests

`node --test workers/github-channel/test/*.test.mjs` (28 tests; no network). GitHub, Supabase and KV are mocked, the cache TTL
test advances a mocked clock past 24h.

## Rollback

1. Revert the commit adding `workers/github-channel`, the workflow, migration and docs.
2. `alter table public.channel_tokens drop column if exists key_version;` (do not drop the table: it predates this task and may hold other rows)
3. Revoke test tokens: GitHub > Settings > Applications > Authorized OAuth Apps, or `DELETE /channels/github`.
4. `npx wrangler delete` the Worker, delete the `PROFILE_CACHE` KV namespace, remove the OAuth App secrets.
