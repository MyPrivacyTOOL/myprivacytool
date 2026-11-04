# MPC-7261 — "First 100 Users" onboarding flow

Journey: **Scan → Risk Score → Mirror Report → Email follow-up.** Lives in the `mpt-scan-report` Worker (`workers/scan-report`), reusing the MPC-6677 pipeline and templates.

| Step | Where | Notes |
|---|---|---|
| Scan | `POST /api/scan` | Unchanged. Consent required, one scan per address per 24h. |
| Risk score | `lib/score.js` | MPC-076 v1.0. `null` when nothing was checked; never a guessed number. |
| Mirror Report | `lib/mirror.js` | Structured object saved to `scans.mirror_report` and rendered in the report email ("Your mirror"): per-category `checked` / `not_checked`, findings, ordered next steps. |
| Cohort | `claim_onboarding_cohort()` (migration `20261007040000`) | First 100 delivered reports get `users.cohort_number` 1..100, race-free. Skipped while `RECIPIENT_ALLOWLIST` is set so test inboxes do not use real slots. Failure never blocks the report. |
| Follow-up | `runFollowUpJob`, same 5-minute cron | Day 3 "your next step" (from the mirror), day 7 "was it useful?" feedback ask. Cohort members only (allowlisted test inboxes in test mode). |

## Safety gates
- Follow-ups are **off until `UNSUBSCRIBE_SECRET` is set** (Worker secret, deliberately not in `EXPECTED_SECRETS.txt` so deploys do not fail first). Every follow-up carries a signed unsubscribe link and a `List-Unsubscribe` header; `GET /api/unsubscribe` sets `users.email_opt_out_at`.
- Each stage is claimed before sending (at most once) and uses a Resend idempotency key; a failed send releases the stage for retry.
- `RECIPIENT_ALLOWLIST` still gates every send. Copy is DRAFT for Chris to approve and makes no claim of automatic removal or checks we do not run.
- Optional `PUBLIC_URL` overrides the Worker URL used in unsubscribe links.

## To go live
1. Apply the migration. 2. `wrangler secret put UNSUBSCRIBE_SECRET`. 3. Chris approves copy in `lib/email.js` / `lib/onboarding.js`. 4. Empty `RECIPIENT_ALLOWLIST` once MPC-6545 is live. Before that, reset any test cohort numbers: `update users set cohort_number = null`.

## Not in this change
- MPC-8302 (core-brain Mirror and Risk call, chat surface) is separate. The ticket is "Blocked by MPC-7260", which is not in this repo; this change does not depend on it.
- No front-end change; the report and follow-ups are email-delivered.

## Test
`node workers/scan-report/worker.test.mjs`
