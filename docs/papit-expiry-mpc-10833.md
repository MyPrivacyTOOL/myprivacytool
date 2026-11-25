# MPC-10833: PaPIT profile expiry and token re-consent

Decision: Chris, 2026-11-23 (Notion MPC-11120): "add an expiry date to PaPIT profiles and refuse stale ones; token re-consent after 90 days."
Follow-up of MPC-9794 (`docs/papit-limits-mpc-9794.md`). Builds on main 5e37037.

## What changed

| Item | Before | After |
|---|---|---|
| Profile validity | `data_retention_days: 30` declared, nothing enforced it | `expires_at` = `generated_at` + 30 days, inside the receipt. `POST /papit/verify` refuses a profile past it (`410 profile_expired`). The Worker's cache never serves a profile past it |
| Stale profile | no answer | `410 {"error":"profile_expired","expires_at":"..."}` |
| Altered or odd profile | no check | `422 {"error":"invalid_profile"}`: not v1, receipt mismatch, or `expires_at` before `generated_at` / more than 30 days after it |
| Profiles issued earlier | n/a | no `expires_at`; judged by `generated_at` + 30 days |
| Stored token | kept until disconnect, no expiry | not used 90 days after the person last connected: `401 {"error":"reconsent_required"}`. A token refresh does not restart the 90 days |
| Existing token rows | n/a | migration backfills `consented_at = created_at` |
| Reddit | same gaps | same changes |

## Code

- `workers/github-channel/lib/papit.js`: `PROFILE_VALIDITY_DAYS`, `CONSENT_MAX_DAYS`, `profileExpiry`, `profileStatus`, `consentExpired`; `expires_at` in the payload.
- `workers/github-channel/lib/reddit-papit.js`: same `expires_at`.
- `workers/github-channel/lib/verify.js` and `index.js`: `POST /papit/verify`.
- `workers/github-channel/lib/store.js`: `consentedAt` written only by the OAuth callbacks; read back with `created_at` as fallback.
- `workers/github-channel/lib/cache.js`: an entry is not served after its profile expired or after the consent behind it aged out.
- `index.js` and `lib/reddit-routes.js`: the 90-day check, after the token row is loaded.
- `supabase/migrations/20261124120000_mpc_10833_channel_tokens_consented_at.sql` and `supabase/tests/schema.test.sql`.
- Wording: `/developers` (`src/data/developerDocs.ts`), Connect GitHub page, Privacy 6B, GitHub profile guide, schema-v1.md, channel docs.

## Decisions I made inside the approval (change them if you disagree)

1. **Where "refuse" lives.** Profiles are produced on request and nothing takes one back in, so there was nowhere to refuse a stale one. I added the stateless `POST /papit/verify`. It stores nothing, reads no secrets and logs nothing; since 2026-11-24 it is covered by the zone's Cloudflare rate-limiting rule (5 per 10 s per IP and location, approximate on the Free plan; see `docs/channels/github.md` "Rate limits").
2. **Re-consent does not delete.** After 90 days the Worker stops using the token and says so; it does not delete the row or revoke the grant (deleting user data is a held item). Connecting again replaces it; Disconnect removes it.
3. **Reachability.** The 7-day session cookie is only issued at connect, so with real cookies a request is always within 7 days of consent and the 90-day check cannot fire today. It is a backstop. The control that would bound a token at rest is an automatic purge of rows past 90 days; that is a deletion and needs Chris's go-ahead (not built).
4. **Not a security boundary.** The receipt is unkeyed. Editing both dates and recomputing the receipt passes verify. Signing remains deferred.

## Release order (nothing here is automatic)

Both deploys are manual workflows. Order: (1) apply the migration to production (deploy-supabase.yml, type DEPLOY), (2) deploy the Worker (GitHub channel Worker, workflow_dispatch). Deploying the Worker first breaks connect and profile calls (it reads and writes `consented_at`). The site (/developers, Connect GitHub, Privacy) deploys on merge and describes the new behavior, so the Worker deploy should follow soon after merge.

Rollback: roll the Worker back, then `alter table public.channel_tokens drop column if exists consented_at;`.
