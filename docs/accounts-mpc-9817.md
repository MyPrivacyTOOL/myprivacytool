# Accounts and sign-in (MPC-9817, F3)

Scope: accounts and sign-in only. Entitlements and allowances are MPC-9818, Stripe checkout MPC-9819, the family add-on MPC-9820.

## What a visitor can do
- Sign in with an emailed link at `/account`. No password. The link opens `/account/verify#t=<token>`; one press of **Sign in** redeems it (a mail scanner opening the page changes nothing). The link works once.
- Tick **Keep my scan and create my free account** (consent version `2026-11-08-v1`) at the contact step. The click-to-confirm email (MPC-9813) proves the inbox, so the same click signs the person in and attaches that scan.
- `/account` shows email, plan (read only), their scans (number, date, open), lets them add an earlier scan by number (must have been requested with their signed-in email), sign out, and **Delete my account and all scans**, which deletes (not unlinks) the account, every linked saved scan, the matching email-request scans and the sign-in identity.

## Rules that hold
- Identity is Supabase Auth, driven from the scan-report Worker (`workers/scan-report/lib/accounts.js`). The browser never talks to Supabase Auth, so no visitor IP reaches its auth log. `public.accounts` and `public.account_scans` have no IP column (a test fails if one appears).
- A linked scan leaves the free 7-day deletion path (`scans.expires_at` is cleared). The saved scan still contains the browser values the person consented to keep, IP included (Director decision A, 2026-11-08: no strip rule).
- `can(account, capability)` reads `public.capability_min_tier`. Only the six Free rows exist; MPC-9818 adds the paid rows. Unknown capabilities are denied. A third-party-cost capability can never be `free` (table constraint).
- Switches: Worker `ACCOUNTS_ENABLED`, site `VITE_ACCOUNTS_ENABLED` (`.env.production`). Anything but `"true"` is off; the routes answer 404. Rollback: set either to `"false"` and merge. Existing accounts are untouched.

## Routes (all POST unless noted; Bearer = the Supabase access token, checked against Supabase Auth on every call)
`/api/account/signin` `{email, scan_number?}` always `{sent:true}` · `/verify` `{token_hash, scan_number?}` · `/me` (GET) · `/scan` `{scan_number}` · `/link-scan` `{scan_number}` · `/delete` `{confirm:"delete"}` · `/refresh` · `/signout` · `/can` `{key}`

## Tests
`supabase/tests/mpc-9817-accounts.test.sql` (via `npm run test:db`), `workers/scan-report/accounts.test.mjs`, `src/pages/Account.test.tsx`, `e2e/accounts.spec.ts`, and the live synthetic run `scripts/accounts-live-check/run.mjs` (workflow `accounts-live-check.yml`, push an `accounts-check/**` branch or dispatch).

## Migration
`supabase/migrations/20261108120000_mpc_9817_accounts_and_signin.sql`: idempotent, additive. Rollback text is in its header.
