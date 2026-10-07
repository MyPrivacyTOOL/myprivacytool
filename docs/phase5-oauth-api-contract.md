# Phase 5 OAuth & Permission API contract (MPC-6971)

Worker: `workers/oauth-poc` · Base URL: `https://myprivacytool-oauth-poc.myprivacytool.workers.dev` · Background: [phase5-oauth-permission-apis.md](phase5-oauth-permission-apis.md)

## Task record (FLEET-TASK-V4.2)

| Field | Value |
|---|---|
| Goal | Turn the verified Google PoC into a session, token-validation and permission-scoping API that links to Supabase auth users, with tests and a written contract. |
| Scope | `workers/oauth-poc/`, `supabase/migrations/20261006140000_oauth_find_auth_user.sql`, this doc. No change to the probe flow's response shape. No provider other than Google. |
| Out of scope | Installing `SUPABASE_SERVICE_ROLE_KEY` on the Worker or any key rotation (MPC-6950); Microsoft/GitHub/Slack adapters (tracked in the MPC-6960 follow-up task); the agent cutover (MPC-6965). |
| Acceptance criteria | (1) `/v1/session` validates a signed session and rejects forged, expired, malformed and wrong-type cookies. (2) Session creation refuses a token with a wrong audience, an unverified email or no email scope, and always revokes MPT's Google token. (3) Scopes are enforced: `/v1/grants` answers 403 `insufficient_scope` for a session without `grants:read`. (4) A verified email links to a confirmed `auth.users` row through a service_role-only function, and sign-in still works when the link is unavailable. (5) 25 tests pass (`node --test workers/oauth-poc/oauth.test.mjs workers/oauth-poc/api.test.mjs`). (6) The contract below matches the code. |
| Rollback plan | Revert the PR; the Worker redeploys the previous code on merge to `main`. The probe routes are unchanged, so nothing depends on the new routes. If the migration was applied: `drop function if exists public.mpt_find_auth_user_by_email(text);`. Sessions are stateless: to invalidate every issued session at once, rotate `STATE_SIGNING_KEY`. |

## Model

- **Provider token**: Google access token, in memory for one request, revoked before the response. Never stored, never in a cookie.
- **MPT session**: HMAC-signed cookie `mpt_oauth_session` (`HttpOnly; Secure; SameSite=None; Path=/`), 1 hour. Payload: `sub`, `email`, `scp` (MPT scopes), `uid` + `link` (Supabase link), `iat`, `exp`, `typ: "session"`, `aud: "myprivacytool-oauth"`.
- **MPT scopes** (what the session may do, independent of Google's scopes):

| Scope | Can be held today | Meaning |
|---|---|---|
| `identity:read` | yes | Read the user's own verified email and provider subject id. Granted when Google reports the `email` scope. |
| `grants:read` | no | List third-party app grants on the account. Needs a provider API that does not exist for consumer Google (MPC-6960). |
| `grants:revoke` | no | Revoke a third-party grant. Same reason. |

Cross-origin use needs the SPA origin in `ALLOWED_ORIGIN` and `fetch(..., { credentials: "include" })`.

## Endpoints

### `GET /oauth/google/start[?mode=session]`
`302` to Google (scope `openid email profile`, PKCE S256, `access_type=online`) and sets the 10-minute `mpt_oauth` state cookie, which records the mode. Without `mode=session` (or with any other value) the flow is the original probe.

### `GET /oauth/google/callback`
Verifies state, exchanges the code, calls `tokeninfo` and `userinfo`, then revokes MPT's token in every outcome.

| Mode | Success | Failure |
|---|---|---|
| probe (default) | `200` `{ ok, user: {email, verified}, token: {scope, expires_in, aud_matches_client}, finding }` (unchanged) | `400 {ok:false,error}` (`access_denied`-style provider error, `invalid_state`, `missing_code`), `502 {ok:false,error}` |
| `session` | Sets `mpt_oauth_session`. `302` to `SUCCESS_REDIRECT` if configured, else `200 {ok:true,session:true}` | With `SUCCESS_REDIRECT` set, every failure after the state cookie is verified is `302 …?oauth_error=<code>`; without it, the JSON shown below |

Session-mode failures (no session is created), as `oauth_error` codes: `access_denied` (user cancelled Google's consent), `provider_error` (any other `error` from Google; the provider's string is never echoed), `missing_code`, `connect_failed` (code exchange or token read failed), `aud_mismatch` (token not issued to this client), `email_not_verified`, `insufficient_provider_scope` (no email scope), `missing_subject`. The JSON statuses are `400` for the first three, `502` for `connect_failed` and `missing_subject`, `400` for `aud_mismatch`, `403` for `email_not_verified` and `insufficient_provider_scope`. If the state cookie is missing, forged or expired the mode is unknown, so `invalid_state` stays a plain `400` JSON page (nothing is trusted to redirect). Probe mode failures are unchanged JSON.

### `GET /v1/session`
`200` `{ authenticated: true, user: { sub, email, email_verified: true }, scopes: [..], supabase: { link, user_id }, expires_at }`
`401` `{ authenticated: false, error: "unauthenticated" }` for a missing, forged, expired, malformed, wrong-audience or wrong-type cookie.
`supabase.link` is one of `linked` (`user_id` set), `not_found`, `not_configured`, `error`.

### `DELETE /v1/session`
Clears the cookie. `200 {ok:true}`. `403 forbidden_origin` unless `Origin` is in `ALLOWED_ORIGIN` (CSRF: the cookie is `SameSite=None`). Sessions are stateless, so this does not invalidate a copy of the cookie someone already holds; the 1-hour lifetime and `STATE_SIGNING_KEY` rotation are the limits.

### `GET /v1/permissions`
Works with or without a session. `200`:
```json
{
  "authenticated": true,
  "granted": ["identity:read"],
  "scopes": [{ "name": "identity:read", "description": "…", "available": true, "granted": true }],
  "providers": [{ "id": "google", "account_type": "consumer", "verified": true, "can_list_grants": false, "can_revoke_grants": false, "mode": "guided_audit", "guided_audit_url": "https://myaccount.google.com/connections", "note": "…" }]
}
```
`providers[].verified` is true only for claims proven by a live call. Everything else is **Pending Live Verification**.

### `GET /v1/grants`
Scope-gated example of permission scoping. `401 {error:"unauthenticated"}`; `403 {error:"insufficient_scope", required:"grants:read", granted:[..], guided_audit_url}` for every session that can exist today; `501 not_implemented` would only occur if `grants:read` were ever granted before a provider adapter exists.

### `GET /health`
`200 {status:"ok"}`. Needs no secrets.

## Configuration

| Name | Kind | Notes |
|---|---|---|
| `GOOGLE_CLIENT_SECRET`, `STATE_SIGNING_KEY` | secret (required) | Unchanged. `STATE_SIGNING_KEY` signs state and session cookies. |
| `GOOGLE_CLIENT_ID`, `REDIRECT_URI` | var | Unchanged. |
| `ALLOWED_ORIGIN`, `SUCCESS_REDIRECT`, `SUPABASE_URL` | var (new) | In `wrangler.toml`. |
| `SUPABASE_SERVICE_ROLE_KEY` | secret (**optional**, new) | Not in `EXPECTED_SECRETS.txt`. Unset means `link: "not_configured"`. Do not set before the MPC-6950 rotation. |

## Supabase link

`public.mpt_find_auth_user_by_email(p_email)` (migration `20261006140000_oauth_find_auth_user.sql`): returns the id of a **confirmed, non-deleted** `auth.users` row matching the email case-insensitively, else `NULL`. `SECURITY DEFINER`, empty `search_path`, `EXECUTE` for `service_role` only, so `anon` and `authenticated` cannot use it to probe which emails have accounts. The Worker only reads; it never creates or edits auth users. Verified locally against a scratch Postgres 16 with a stubbed `auth.users` (case-insensitive match, unconfirmed and deleted rows ignored, `anon`/`authenticated` denied). Applied to the live project on 2026-10-06 (see Status).

## Known limits

- The email link trusts Google's `email_verified` plus Supabase's `email_confirmed_at`. Linking is informational (`uid` in the session); nothing authorises Supabase data access from it yet. RLS policies keyed to `auth.uid()` still need a real Supabase session, which is a separate decision.
- No consumer provider API lists other apps' grants, so `grants:*` cannot be granted; the contract exists so adapters (Microsoft first) can add it without changing clients.
- Session cookie holds the user's own email in a signed, not encrypted, value.

## Status (2026-10-06)

| Item | State |
|---|---|
| Worker code, 25 tests, contract | Done on `main`. CI (`npm run test:workers:node`) now runs `api.test.mjs` as well as `oauth.test.mjs`; before, only the deploy workflow ran it. |
| Migration `mpt_find_auth_user_by_email` | **Applied** to project `xmdmkumwxpgahmlweuug` as `20261006150233_oauth_find_auth_user`. Checked 2026-10-06: body matches the repo file, `SECURITY DEFINER`, empty `search_path`, `EXECUTE` for `service_role` only (`anon` and `authenticated` denied), no security advisor finding. Rollback: `drop function if exists public.mpt_find_auth_user_by_email(text);` as a new migration. |
| `SUPABASE_SERVICE_ROLE_KEY` on the Worker | Not set, by design (MPC-6950). Sessions report `link: "not_configured"`. |
| Live run of `?mode=session` | Verified live 2026-10-06 and 2026-10-07 (owner sign-in as the MPT Google account): `/v1/session`, `/v1/permissions`, `/v1/grants` (403 `insufficient_scope`) and `DELETE /v1/session` (cleared the cross-site cookie) all behaved as documented. |

## Site integration (header strip)

`myprivacytool.io` shows a slim strip under the header, **"Connected as <email> · Sign out"**, only while a session exists (`src/components/layout/SessionBadge.tsx`, client in `src/lib/oauthSession.ts`).

- **Sign-in entry:** link or open `<Worker>/oauth/google/start?mode=session` (exported as `OAUTH_START_URL`). The Worker redirects back to `SUCCESS_REDIRECT` (`https://www.myprivacytool.io/?channel=google`). A failed sign-in comes back as `?channel=google&oauth_error=<code>` and shows a dismissible message in the same strip (specific copy for `access_denied`, `email_not_verified`, `insufficient_provider_scope`, `missing_code`; a generic one otherwise; the raw code is never shown). In both cases the marker is then removed from the address bar (other query parameters and the hash are kept). No public page links to sign-in yet, because the Google consent screen is in Testing mode (only listed test users can complete it).
- **No call for ordinary visitors:** the strip asks `GET /v1/session` only if a `localStorage` hint (`mpt_oauth_hint`) exists. The hint is set when the page loads with `?channel=google` (and no `oauth_error`) and cleared on sign-out, on a 401, or when the session's `expires_at` passes. Without storage the strip simply does not appear.
- **Sign out:** `DELETE /v1/session` with `credentials: "include"` from an allowed origin; on success the strip disappears and the hint is cleared. On failure the strip stays and says so.
- **Setting:** `VITE_OAUTH_URL` overrides the Worker base URL (default the workers.dev URL above).
- **Known limits:** an expired or missing state cookie (for example a sign-in left open for more than 10 minutes) still ends on the Worker's JSON error page, because the Worker cannot trust the mode then. The session cookie is set by the Worker's own domain, so it is a third-party cookie from the site's point of view. Chrome with default settings sends it (verified live); Safari and Firefox block third-party cookies by default, so the strip will not appear there. Fix when needed: serve the Worker from a custom domain under `myprivacytool.io` (as `channels.myprivacytool.io` does for the GitHub channel), which also needs the Google redirect URI and `REDIRECT_URI` updated.
