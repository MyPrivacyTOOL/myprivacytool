# MPC-6971 — Phase 5: OAuth & Permission APIs

**Status:** Done. Tech stack defined; Google PoC built, unit-tested and **verified live on 2026-10-05** (see "Live result").
Builds on MPC-6959 (landscape) and MPC-6960 (Google feasibility spike, `docs/phase5-google-access-spike.md`).

> Provider API claims below come from public documentation and prior knowledge, not calls made in this task. Items marked **Pending Live Verification** (future sprint) need confirming on the test account or with the provider.

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Worker (`workers/oauth-poc`), plain JS, no dependencies | Same platform as the existing webhook workers; WebCrypto and `fetch` are enough |
| Flow | OAuth 2.0 authorization code + **PKCE (S256)**, confidential client | OAuth 2.1 direction (MPC-6959 standards table); PKCE also protects against code interception |
| Scopes | `openid email profile` only, `access_type=online` | Non-sensitive: no Google verification review, no CASA, no refresh token to protect |
| State / PKCE storage | HMAC-signed, HttpOnly, 10-minute cookie | Stateless; nothing server-side to leak |
| Token handling | In memory for one request, **revoked before the response is returned** | MPT never stores a user token (Strategy 2.7 trust risk) |
| Secrets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STATE_SIGNING_KEY` via `wrangler secret put` | Repo convention; depends on the open secret-rotation item |
| Data model (later) | Tables for agents linked to user, grants, dated snapshots (MPC-6811 / Strategy 2D step 2) | Not built here |

## 2. Proof of concept (Google)

Code: `workers/oauth-poc/` (`google.js` helpers, `index.js` routes, `oauth.test.mjs`).

- `GET /oauth/google/start` → consent redirect with PKCE challenge and signed state cookie.
- `GET /oauth/google/callback` → verifies state, exchanges the code, calls `tokeninfo` and `userinfo`, then revokes MPT's own token and clears the cookie. The JSON response records what the token can and cannot see, which is the evidence MPC-6960 steps 3–4 need.
- Tests (`node --test workers/oauth-poc/oauth.test.mjs`, 5 passing, mocked `fetch`; the session and permission API adds `api.test.mjs`, see section 8): RFC 7636 PKCE vector, scope/`S256`/online-access on the auth URL, tamper and expiry rejection of signed state, state-mismatch rejection, and revoke-on-completion.

**Not yet done:** a live run. To finish: create a Web OAuth client in a Google Cloud project, add the test account as a test user, set the redirect URI and secrets, `wrangler dev`, open `/oauth/google/start`, and record the JSON output in the MPC-6960 doc.

**Expected result (per MPC-6960):** the token authenticates the user and reveals its own scopes only. No endpoint lists or revokes other apps' grants for a consumer account. The PoC therefore proves the OAuth foundation (consent, identity, safe token handling) that the guided audit and Workspace mode both need, and is honest about the wall.

## 3. Provider permission APIs

| Provider | List third-party app grants | Revoke | Verdict for Phase 5 |
|---|---|---|---|
| Google, consumer | None. UI only (`myaccount.google.com/connections`) | Only tokens MPT holds | Guided audit (MPC-6960) |
| Google Workspace | Admin SDK `tokens.list` (admin scope, needs verification + CASA) | `tokens.delete` | Conditional, only with a committed customer |
| Microsoft (Entra / Graph) | `oauth2PermissionGrants` and `appRoleAssignments` on the signed-in user (`DelegatedPermissionGrant.Read.All` needs admin consent for org-wide; user-level grants readable via `/me/oauth2PermissionGrants`) **Pending Live Verification** | `DELETE /oauth2PermissionGrants/{id}` **Pending Live Verification** | Best candidate for a true list-and-revoke PoC #2 |
| GitHub | Authorised OAuth Apps / GitHub Apps of a user: no public REST endpoint for a user's own list; OAuth Apps can revoke their own grant (`DELETE /applications/{client_id}/grant`) **Pending Live Verification** | Own grant only | Guided audit (`github.com/settings/applications`) |
| Slack | Workspace admin `admin.apps.*` (Enterprise Grid) **Pending Live Verification**; no member-level list | Admin only | Guided audit / conditional |

Pattern: the only provider with a member-level list-and-revoke API is likely Microsoft. Everyone else needs an admin or the user's own settings page.

## 4. Outcomes, benefits, risks, mitigations

**Outcomes**
- Stack defined and running as code; Google PoC built and tested, live run pending.
- Confirms the MPC-6959 recommendation (build on OAuth) with a narrower scope: authenticate and revoke own tokens everywhere, list/revoke other apps only where the provider allows it.
- Phase 5 product shape: guided audit first, Microsoft list-and-revoke as the first automated provider, Workspace mode on demand.

**Benefits**
- Consent flow, PKCE, signed state and revoke-on-finish are reusable for every provider.
- No sensitive scopes, so no provider review and no CASA cost.
- Zero stored tokens supports the privacy-first brand and shrinks breach impact.

**Risks and mitigations**

| Risk | Mitigation |
|---|---|
| Consumer APIs do not expose grants (Google, likely GitHub/Slack) | Guided audit with deep links; self-reported input to the risk score; re-check quarterly |
| MPT holding OAuth access is itself a trust risk | Online access, no storage, revoke on completion, clear consent copy; fix secret rotation before launch |
| Client secret exposure | Worker secrets only; rotate before go-live |
| Provider verification or policy changes | Keep scopes non-sensitive; provider adapters behind one interface |
| Unverified API claims in this doc | Run the **Pending Live Verification** checks on test accounts before committing to Microsoft PoC #2 |
| Focus risk against the Phase 2 KPI | Experiments only (Strategy 2D guardrail) |

## 5. Next steps
1. Live-run the Google PoC on the test account; mark the MPC-6960 [verify] items confirmed or refuted.
2. Microsoft Graph PoC #2 to confirm user-level list and revoke.
3. Product sign-off on guided-audit scope; then create implementation tickets.

## 6. Deployment (updated 2026-10-05)

The PoC Worker lives in the **MyPrivacyTOOL Cloudflare account** (`35cb17172c65a20f5cf1baf131485382`), not the personal cransford account (see Notion "MPT Infrastructure - GitHub, Cloudflare & Supabase (Ops)"). It deploys on merge to `main` via `.github/workflows/deploy-oauth-poc.yml`, using the same repo Actions secrets as `deploy-mpt-leads.yml`. Live URL: `https://myprivacytool-oauth-poc.myprivacytool.workers.dev`.

Secret values are set only in the Cloudflare dashboard (Workers & Pages > myprivacytool-oauth-poc > Settings > Variables and Secrets). Secret names are in `workers/oauth-poc/EXPECTED_SECRETS.txt`: `GOOGLE_CLIENT_SECRET` and `STATE_SIGNING_KEY` (64 hex chars). `GOOGLE_CLIENT_ID` (public) and `REDIRECT_URI` (`https://myprivacytool-oauth-poc.myprivacytool.workers.dev/oauth/google/callback`, also an authorised redirect URI on the Google **Web application** client) are plain `[vars]` in `wrangler.toml`, because `wrangler deploy` overwrites plain-text dashboard variables. The workflow warns, but does not fail, when a secret name is missing on the first deploy.

## 7. Live result (2026-10-05)

Consent completed as `myprivacytool@gmail.com` against `https://myprivacytool-oauth-poc.myprivacytool.workers.dev/oauth/google/start`. The callback returned:

```json
{
  "ok": true,
  "user": { "email": "myprivacytool@gmail.com", "verified": true },
  "token": {
    "scope": "email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid",
    "expires_in": "3599",
    "aud_matches_client": true
  },
  "finding": "tokeninfo/userinfo describe this token only; no endpoint lists other apps' grants (MPC-6960 step 3)."
}
```

What this confirms: authorization code + PKCE, signed state cookie, token exchange, and revoke-on-finish work end to end with non-sensitive scopes only. It also confirms the MPC-6960 finding that the consumer Google token describes only itself; there is no endpoint to list other apps' grants. Microsoft, GitHub and Slack claims in section 3 remain **Pending Live Verification** (future sprint).

## 8. Session, permission scoping and Supabase link (added 2026-10-06)

The PoC proved the OAuth foundation. This increment adds what a product needs on top of it, without storing a provider token: `/oauth/google/start?mode=session` ends in an MPT-signed session cookie; `GET/DELETE /v1/session` validate and end it; `GET /v1/permissions` and `GET /v1/grants` expose MPT scopes (`identity:read` held, `grants:read` and `grants:revoke` defined but not grantable, because no consumer provider API lists other apps' grants); a verified email is linked to a confirmed Supabase auth user through a service_role-only function. The probe flow and its verified response are unchanged. Contract, task record (goal, scope, acceptance criteria, rollback) and limits: [phase5-oauth-api-contract.md](phase5-oauth-api-contract.md). Tests: `node --test workers/oauth-poc/oauth.test.mjs workers/oauth-poc/api.test.mjs` (25 passing).

Not done here, by design: setting `SUPABASE_SERVICE_ROLE_KEY` on the Worker (blocked by the MPC-6950 key audit; the link reports `not_configured` until then), applying the migration to the live project, and the Microsoft/GitHub/Slack verification (own task).
