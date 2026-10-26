# Telegram web dashboard (MPC-7893)

Private dashboard for a Telegram baseline scan, on the existing site (Vite/React + Cloudflare Pages Functions + Supabase). **Default off. Test accounts only.** Needs MPC-7891 (`profile_snapshots`). Enhanced reads MPC-7892 (`deep_jobs`, `deep_osint_results`; note: NOT `osint_results`).

## Flow
1. Allow-listed sender (`PROBE_TELEGRAM_IDS`) sends exactly `dashboard` or `/dashboard` (flag `TELEGRAM_DASHBOARD_LINKS=on`). The Worker (`workers/social-listeners/src/dashboard-link.ts`) finds the sender's newest complete, unexpired snapshot, makes `crypto.randomUUID()`, stores only its SHA-256 in `dashboard_links` (15 minute expiry, table constraint), and replies `https://www.myprivacytool.io/d/<uuid>`. Max 5 links per sender per hour. Asking for a link starts no scan and no DEEP.
2. `GET /d/<uuid>` (`functions/d/[token].ts`) shows a page with one button. It is the same page for valid, used, expired, unknown and malformed links, redeems nothing, loads no third-party resource, and is `no-store`, `noindex`, `Referrer-Policy: no-referrer`. Link previews and crawlers stop here.
3. `POST /d/<uuid>` (button) calls `mpt_redeem_dashboard_link(hash, session_hash, 30)`: ONE statement marks the link redeemed and creates the session, so concurrent requests cannot both win; expiry and the scan's own expiry are checked in the database. Then `303 /dashboard` with `__Host-mpt_dash=<256-bit random>; HttpOnly; Secure; SameSite=Strict; Path=/`, 30 minutes. Only the cookie's SHA-256 is stored. Cross-site POSTs are refused (Origin / Sec-Fetch-Site).
4. `/dashboard` (React, `src/pages/TelegramDashboard.tsx`) calls `GET /api/dashboard`. Refresh and navigation use the session; the link stays single use.
5. `/api/dashboard` (`shared/dashboard/handlers.ts`) reads with the service key held by the Function (never in the browser), always filtered by the session's sender. It never returns the raw `get_chat`/`photos` payload.

## Views
- **Baseline**: the snapshot the link was issued for, never overwritten: risk (returned of 30), every hexagon state as text, versions (scan/risk/schema), timestamp, limits.
- **Enhanced**: latest DEEP job for the sender: not run / pending / partial / failed / complete / unavailable, per-site status, observed time, detector version, limitation. A username match is not identity; not found or blocked is not an all-clear. Opening the page never runs DEEP; the reminder says to type DEEP in Telegram.
- **Final**: newest later complete snapshot of the same sender. Compared only if scan, risk and schema versions all match, otherwise **incomparable** with the reasons. A gap counts as closed only when the bot received the field before and does not now; not-checked or failed on either side is inconclusive. Self-reported actions are a separate, currently empty list (no data source exists until the fix wizard, MPC-7894).
- Each view ends with the `/scan` call to action (`/scan`, no query string, no personal data). Help is plain text and triggers nothing.

## Not done / open
- "Pre-filled with Telegram context": `/scan` is NOT given any Telegram context. There is no approved server-side contract for it; putting it in a URL would break the no-personal-data rule. Decision needed.
- The global HELP header entry (PR #533) is not merged; this page has its own Help text.
- Link issuance needs the flag workflow (`.github/workflows/set-social-listeners-flags.yml`, PR #560 area) extended with `TELEGRAM_DASHBOARD_LINKS`; until then set it in the Cloudflare dashboard (a deploy can wipe dashboard-set variables).
- Retention of `dashboard_links` rows: expired rows are removed by `mpt_purge_dashboard_credentials()`; no pg_cron job is created by this change.
- Wording is English-only draft, like MPC-7891.

## Privacy and leakage controls
- The URL holds only the UUID; the DB holds only hashes; the cookie is HttpOnly. No analytics call is made by the dashboard page. The edge visit log redacts `/d/<token>` in path and referrer (`shared/edge-capture/capture.ts`, tested). The Functions log nothing.
- Deleting a person's snapshots (`mpt_delete_profile_snapshots`) cascades to their links and sessions.

## Deploy and rollback
Merging to `main` auto-deploys the site and the `social-listeners` Worker: treat the merge as a production action. Order: apply `supabase/migrations/20261026220000_mpc_7893_dashboard_links.sql` by hand (after approval) -> deploy -> set Pages variable `DASHBOARD_ENABLED=1` (plus `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` secrets on Pages) -> set `TELEGRAM_DASHBOARD_LINKS=on` on the Worker. Rollback: unset both flags; `drop function public.mpt_redeem_dashboard_link(text, text, integer); drop function public.mpt_purge_dashboard_credentials(); drop table public.dashboard_sessions; drop table public.dashboard_links;`

## Tests
`npx vitest run shared/dashboard shared/edge-capture src/pages/TelegramDashboard.test.tsx workers/social-listeners`; `DATABASE_URL=<throwaway postgres> bash supabase/tests/run.sh` (includes 8 concurrent redemptions on separate connections).
