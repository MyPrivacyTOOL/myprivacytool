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
| `GET /channels/github/profile` | `200` PaPIT JSON, header `X-Cache: HIT|MISS`. `401 unauthenticated` (no session), `401 reauthorize` (token revoked at GitHub; our copy is deleted), `401 reconsent_required` (the person last connected 90 or more days ago; the stored token is not used and not deleted; MPC-10833), `404 not_connected`, `502 upstream_error`. The profile carries `expires_at` (generated_at + 30 days). |
| `POST /papit/verify` | MPC-10833. Stateless check of a profile the caller holds: `200 {valid,expires_at}`, `410 profile_expired`, `422 invalid_profile` (not v1, receipt mismatch, or `expires_at` outside generated_at..+30 days), `400 bad_request`, `413 too_large` (over 32 KB). No session, nothing stored or logged. |
| `DELETE /channels/github` | User revoke: deletes the token row first, clears the cache, then revokes the grant at GitHub. Needs the session cookie. |
| `GET /oauth/github/remove` | MPC-10825: revoke **without a session**. Same GitHub sign-in as `/start`, with `intent: "remove"` in the HMAC-signed state cookie (never in the URL). The callback verifies state, exchanges the code, reads only `/user` `id`, then deletes that account's row and cache and revokes the grant (`DELETE /applications/{client_id}/grant` ends every token of this app for the user, including the one just issued). It stores nothing, issues no session and clears `mpt_gh_session`. Success: 302 to `SUCCESS_REDIRECT?channel_removed=github&revoked=1\|0`. Failure: `?channel_error=remove_access_denied\|invalid_state\|missing_code\|remove_failed`; on `remove_failed` the row is kept and the page says nothing was removed. |
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
codes are mapped to friendly copy and the raw code is never shown. When the 7-day session has ended (`401 unauthenticated`) the page offers
**Remove my stored connection**, a plain link to `/oauth/github/remove` (MPC-10825); on return it reads `?channel_removed=github&revoked=` and says what was removed.
The Connect page's snapshot row reads "Connection kept: Until you disconnect" (MPC-10825). The `data_retention_days: 30` field stays in the PaPIT JSON as a declared
snapshot validity (see [MPC-10833](../papit-limits-mpc-9794.md)); person-facing pages no longer present it as how long we keep the connection.

- **Unlisted on purpose:** `noindex`, not in the sitemap or nav. Link to it when the channel is ready to launch.
- After login the Worker redirects to `SUCCESS_REDIRECT` (`https://www.myprivacytool.io/connect/github`).
- Override the Worker URL with `VITE_GITHUB_CHANNEL_URL` (e.g. for a custom domain).
- **Served from `channels.myprivacytool.io`** (a Workers custom domain, `routes` in `wrangler.toml`), the same site as
  `www.myprivacytool.io`, so the session cookie is not a third-party cookie and Safari/Firefox send it. The GitHub OAuth app's
  callback URL must equal `REDIRECT_URI` (`https://channels.myprivacytool.io/oauth/github/callback`); GitHub allows only one.
  `workers_dev` is `false`: the old `*.workers.dev` address is retired and the Worker is served only from `channels.myprivacytool.io`. Rollback: set `workers_dev = true`, redeploy, and re-add the `workers.dev` redirect URI in the GitHub OAuth app.

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

## Consent age (MPC-10833)

`channel_tokens.consented_at` is set when the person completes the OAuth consent screen (the callback) and is not touched by a token refresh. When a profile is
requested, a stored token whose `consented_at` is 90 or more days old is not used: `401 reconsent_required`, the cached copy is dropped, the row is kept. Connecting
again writes a new `consented_at`. A row without the column falls back to `created_at`; a row with neither is refused. The Reddit channel follows the same rule.
Needs `supabase/migrations/20261124120000_mpc_10833_channel_tokens_consented_at.sql` applied BEFORE this version of the Worker is deployed (the Worker selects and writes the column).

Reachability: the session cookie lasts 7 days and is only issued at connect, so a request with a valid cookie always comes within 7 days of consent. The 90-day check is a backstop
for a longer session or a changed cookie lifetime. What it does not do is clean up: a token the person never returns for stays stored (encrypted, unused) until they
disconnect or connect again.

### Purge of tokens unused for 90 days (MPC-11258): built, NOT scheduled, deletes nothing yet

`public.mpt_purge_stale_channel_tokens(p_dry_run boolean default true, p_days integer default 90)` (migration `20261126000000_mpc_11258_purge_stale_channel_tokens.sql`, service role only) finds
GitHub and Reddit rows whose `updated_at` is older than 90 days. "Unused" means this: the Worker rewrites `updated_at` only when it saves the token (at connect and on every refresh), and
access tokens last about 8 hours (GitHub) or 1 hour (Reddit), so `updated_at` is the last real use to within that lifetime. A profile served from the 24-hour cache does not touch the row and
is not use. The result is provider and counts only, never an id, token or email. **It is a dry run by default**; only `p_dry_run => false`, written out by a person, deletes. `p_days` under 30 is
refused, a null mode is refused, and no other provider is touched. No `pg_cron` job exists: scheduling it, and the delete run, wait for Chris's Y on the dry-run count recorded on the Notion
task MPC-11258. Privacy 6B states the 90-day purge only after the delete run is live. Dry run: `select * from public.mpt_purge_stale_channel_tokens();` (the migration is applied by hand, `deploy-supabase.yml`).

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
6. **Deploy**: the "GitHub channel Worker" workflow (`.github/workflows/deploy-github-channel.yml`) deploys **on merge to `main`** whenever `workers/github-channel/**`,
   `shared/recipients/**`, `scripts/ci/smoke-test.mjs` or the workflow itself changes, and can still be run by hand (workflow_dispatch). Never from a pull request.
   Order: tests, pre-deploy check (repo secrets set, no `REPLACE_*`, `EXPECTED_SECRETS.txt` names only), snapshot of the Worker's secret names, deploy, FAIL if any secret
   name changed or an expected one is missing, then a GET-only smoke test of the live Worker (`node scripts/ci/smoke-test.mjs github-channel`: `/health`; the GitHub sign-in
   and the no-session remove route must both be a 302 to GitHub with `read:user`, S256, an HttpOnly state cookie and no intent in the URL; Reddit remove 503 or a 302 to Reddit;
   profile without a session 401; POST to remove 404). If the smoke test fails the Worker is rolled back to the previous version and re-checked, and the job still ends red.
   The same smoke test runs every 6 hours in `smoke-site.yml`. **Database changes are not deployed by this workflow**: a Worker that reads or writes a new column needs its migration
   applied first (`deploy-supabase.yml` is manual), so check that before merging a Worker change. Manual rollback: `rollback.yml` is not wired to this Worker yet; use
   `npx wrangler rollback` in `workers/github-channel` (Cloudflare account `35cb1717...`).

## Verifying tokens are ciphertext (manual acceptance check)

After one live connect, in Supabase SQL editor:
```sql
select user_id, provider, left(access_token_enc, 12) as prefix, key_version, scope from public.channel_tokens;
```
`prefix` must look like `v1.` + base64url, never `gho_`.

## Tests

`node --test workers/github-channel/test/*.test.mjs` (no network). GitHub, Supabase and KV are mocked, the cache TTL
test advances a mocked clock past 24h.

## Rollback

1. Revert the commit adding `workers/github-channel`, the workflow, migration and docs.
2. Roll the Worker back first (it uses `consented_at`), then `alter table public.channel_tokens drop column if exists consented_at;` (MPC-10833) and `alter table public.channel_tokens drop column if exists key_version;` (do not drop the table: it predates this task and may hold other rows)
3. Revoke test tokens: GitHub > Settings > Applications > Authorized OAuth Apps, or `DELETE /channels/github`.
4. `npx wrangler delete` the Worker, delete the `PROFILE_CACHE` KV namespace, remove the OAuth App secrets.
