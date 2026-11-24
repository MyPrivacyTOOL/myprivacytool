# MPC-9796 (EXT-09): connected accounts: what is kept, for how long, and where the code says so

Checked 2026-11-18 against main HEAD 388c3b6.

| Claim (Privacy 6B and the Connect GitHub page) | Code | Verdict |
|---|---|---|
| `read:user` scope only | workers/github-channel/index.js header (MPC-115) | TRUE |
| Encrypted access token and refresh token kept until disconnect | `saveToken` stores `access_token_enc` and `refresh_token_enc` (AES-256-GCM, key version, AAD per subject) in `channel_tokens`, workers/github-channel/lib/store.js 31-43; deleted by `deleteToken` (store.js 69) on revoke, and when GitHub answers 401 (index.js 158-160) | TRUE |
| 24-hour copy of the derived snapshot | `CACHE_TTL_SECONDS = 24 * 60 * 60`, KV `expirationTtl`, also checked on read (lib/cache.js 2-21); only the sanitised snapshot, never tokens or raw responses | TRUE |
| 7-day signed session cookie | `SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`, `mpt_gh_session` (index.js 25, 96-99) | TRUE |
| Snapshot holds derived values only | lib/papit.js header: language names, topic slugs, counts, a role label; email, real name, login, location, company, blog, avatar and raw bio are never copied | TRUE |
| Disconnect deletes the token, revokes at GitHub, clears the copy and the session | `DELETE /channels/github` (index.js header line 8) | TRUE |
| Reddit works the same way | reddit-routes.js: `saveToken` (88, 142), `putCached` (151), `deleteToken` and `deleteCached` (155-156, 174), 7-day session (26) | TRUE |
| Google keeps only a 1-hour signed cookie; nothing stored on our servers | workers/oauth-poc/session.js header: Google's token is revoked after consent, only MPT's HMAC-signed session cookie (1 h) is kept; `wrangler.toml` binds no KV, D1 or R2 | TRUE for the sign-in (session) mode |

## Item 4: does the Google PoC "stores nothing" hold for logs and caches?

No server-side storage binding exists (no KV, D1 or R2 in workers/oauth-poc/wrangler.toml). Logs are `console.log(JSON.stringify({event, ...fields}))` (index.js 38) with event names and a link state; two events add an error message cut to 80 characters (`oauth_callback_failed`, index.js 168). That text comes from our own error handling, not from Google's token or profile, but a provider error string could appear in it. Verdict: **TRUE for stored data, PARTIAL for logs** (Workers keep platform logs outside this repo's control; the repo cannot say how long).

## Found, not changed

- The Connect GitHub page shows "Snapshot valid for 30 days" from `privacy_boundaries.data_retention_days: 30` (workers/github-channel/lib/papit.js 110, reddit-papit.js 140), while we cache for 24 hours. Both are true of different things, but the page does not say what the 30 days is. Needs a decision on what the field means to a recipient (filed as a follow-up).
- Revoking needs the 7-day session cookie (`DELETE /channels/github` reads the session). After the cookie expires the stored token remains until the person connects again and disconnects. The page now says so (session_ended state).
- Whether the Workers' platform logs are retained, and for how long, is not in the repo.

Update 2026-11-24 (MPC-10833): the 30 days now means something. Profiles carry `expires_at` and `POST /papit/verify` refuses a stale one; the page shows the date. The token is not used 90 days after the person last connected (`reconsent_required`). See `docs/papit-expiry-mpc-10833.md`.
