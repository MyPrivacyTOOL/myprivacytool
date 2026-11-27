# Plan entitlements and monthly scan allowances (MPC-9818)

Entitlements are DATA. Nothing below is a price, and no threshold lives in code.

| Where | What |
| --- | --- |
| `public.capability_min_tier` | 20 rows: `key`, lowest tier that has it (`free < basic < pro < executive`), `cost` (`third_party` rows can never be Free: check constraint), `status` (`live` / `planned`). Source: Paid Exposure Report spec s3. |
| `public.plan_scan_allowance` | Scans per calendar month (UTC): Free 1, Basic 5, Pro 25, Executive NULL (= unlimited: no cap, no fair-use text). Decided by Chris 2026-11-07. |
| `public.scan_consumption` | One row per counted scan, idempotent on the scan number. Keyed by a **hash** of the lower-cased confirmed email (no address, no IP), so the allowance follows the address whether or not the person is signed in. An unconfirmed scan counts for 24 hours only, so typing someone else's address cannot use up their month. Rows older than 100 days are purged. |
| `public.account_plan_log` | Every plan change made through `mpt_set_plan`. |

Functions (all `service_role` only): `mpt_can(account, key)` (MPC-9817), `mpt_consume_scan(scan, email, confirmed, account)`, `mpt_confirm_scan_consumption(scan)`,
`mpt_get_entitlements(account, email)`, `mpt_set_plan(account, plan, reason)`.

## Behaviour
- `POST /api/scan` counts the scan BEFORE anything is saved or sent. Refused => HTTP 429, `code: scan_allowance_exhausted`, a plain message (what happened, when it resets, what the next plan includes, once). The just-made request row is removed; nothing is sent. A repeat inside 24h is still the old "duplicate" and never counts twice.
- Click-to-confirm marks the scan as counted for the whole month.
- The report asks `sectionState(entitlements, key)` BEFORE building a gated section. A Free reader always SEES the section in an honest "not checked, paid coverage" state (never hidden, never blurred or truncated: the paid check is not run for them). A Basic+ reader sees `included_not_live` while the check is not built (status `planned`), and content once it is `live`. No upgrade prompt for an account that already has the section.
- Scan history: Free lists and opens the latest saved scan; Basic and up list every scan inside retention. Cancellation is not deletion: older scans are kept and reappear on resubscribe.
- Executive: unlimited. `limit` is `null`, `remaining` is `null`, and no text mentions fair use.

## Changing things (data changes, not deploys)
- Move a capability to another tier: `update public.capability_min_tier set min_tier = 'pro' where key = 'breach.check'`. Unknown keys are denied.
- Change an allowance: `update public.plan_scan_allowance set per_month = 10 where plan = 'basic'`. `/pricing` copy that quotes the number must change in the same step.
- Grant or change a plan (manual grant now; the Stripe webhook in MPC-9819 calls the same function; no UI): `select public.mpt_set_plan('<account uuid>', 'basic', 'manual grant: <reason>')` with the service-role key (PostgREST: `POST /rest/v1/rpc/mpt_set_plan`). Idempotent; a real change is logged.

## Switch and rollback
`SCAN_ALLOWANCE_ENABLED` ("true" in `workers/scan-report/wrangler.toml`). Anything else = nothing counted, nothing refused. While `mpt_consume_scan` is missing (HTTP 404) nothing is enforced; any other database error is logged and the scan goes ahead. SQL rollback is at the top of `supabase/migrations/20261108140000_mpc_9818_entitlements_and_scan_allowances.sql`.

## Tests
`supabase/tests/mpc-9818-entitlements.test.sql` (real Postgres: the 20 rows pinned, all four tiers, window, idempotency, hash key, grants), `workers/scan-report/entitlements.test.mjs` (the same rules through the Worker, the seed pinned against the migration file, the gated sections, history), `src/pages/AccountAllowance.test.tsx`, `e2e/scan-allowance.spec.ts` (Free exhaustion message in a real browser), and the live check `scripts/accounts-live-check/run.mjs` steps 6b-6h (`.github/workflows/accounts-live-check.yml`).
