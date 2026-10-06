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
| `session` | Sets `mpt_oauth_session`. `302` to `SUCCESS_REDIRECT` if configured, else `200 {ok:true,session:true}` | Same codes below; with `SUCCESS_REDIRECT` set they arrive as `302 …?oauth_error=<code>` |

Session-mode refusals (no session is created): `400 aud_mismatch` (token not issued to this client), `403 email_not_verified`, `403 insufficient_provider_scope` (no email scope), `502 missing_subject`, plus the shared `invalid_state` / `missing_code` / `502`.

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

`public.mpt_find_auth_user_by_email(p_email)` (migration `20261006140000_oauth_find_auth_user.sql`): returns the id of a **confirmed, non-deleted** `auth.users` row matching the email case-insensitively, else `NULL`. `SECURITY DEFINER`, empty `search_path`, `EXECUTE` for `service_role` only, so `anon` and `authenticated` cannot use it to probe which emails have accounts. The Worker only reads; it never creates or edits auth users. Verified locally against a scratch Postgres 16 with a stubbed `auth.users` (case-insensitive match, unconfirmed and deleted rows ignored, `anon`/`authenticated` denied). **Not applied to the live project.**

## Known limits

- The email link trusts Google's `email_verified` plus Supabase's `email_confirmed_at`. Linking is informational (`uid` in the session); nothing authorises Supabase data access from it yet. RLS policies keyed to `auth.uid()` still need a real Supabase session, which is a separate decision.
- No consumer provider API lists other apps' grants, so `grants:*` cannot be granted; the contract exists so adapters (Microsoft first) can add it without changing clients.
- Session cookie holds the user's own email in a signed, not encrypted, value.

## Status (2026-10-06)

| Item | State |
|---|---|
| Worker code, 25 tests, contract | Done on `main`. CI (`npm run test:workers:node`) now runs `api.test.mjs` as well as `oauth.test.mjs`; before, only the deploy workflow ran it. |
| Migration `mpt_find_auth_user_by_email` | **Not applied.** Read-only check of project `xmdmkumwxpgahmlweuug` on 2026-10-06 found no such function. Apply after review; rollback is the `drop function` line above. |
| `SUPABASE_SERVICE_ROLE_KEY` on the Worker | Not set, by design (MPC-6950). Sessions report `link: "not_configured"`. |
| Live run of `?mode=session` | Pending: needs a human Google consent (the probe flow was verified live on 2026-10-05). |
