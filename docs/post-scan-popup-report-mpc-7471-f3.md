# MPC-7471-F3: the post-scan popup uses the report pipeline

Status: **LOCAL, then PUSHED / draft PR.** Not approved, not merged, not deployed, no live test. Wording and flow need Chris's approval before merge (task requirement, separate from his 2026-10-13 approval of option A).

## What changed (option A: one route)

Before: the popup (`src/components/EmailCaptureModal.tsx`) posted to the `mpt-leads` Worker. That route stored a score baseline and a newsletter/CRM lead. It created no report request, no saved scan, no scan number, and then said "You're on the list".

Now: the popup sends the **same request as `/scan`**: `POST /api/scan` on the `scan-report` Worker, through the existing `requestScanReport()` (`src/lib/scanReport.ts`). No second report service, no parallel newsletter route from this popup.

| Part | Change |
| --- | --- |
| `src/components/EmailCaptureModal.tsx` | Form/submit block only: report consent (the existing `/scan` wording), the separate unticked save box (MPC-7470 wording, version `2026-10-12-v1`), honest success and failure, scan number, bounded retry, per-form `request_id`. Uses the report Worker's Turnstile key (MPC-8430). |
| `src/lib/scanReport.ts` | `requestScanReport(..., { consentSource, requestId })` returns `{ scanNumber, scanSaved, duplicate, liveToken }`. `/scan` calls it unchanged. |
| `workers/scan-report/index.js` | The scan is saved **before** the first email (so the email can carry its number). `request_id` replay. The save moved from the route into `handleScan`. |
| `workers/scan-report/lib/email.js` | First email shows `Your scan number: <n>. Quote this number if you want this scan deleted.` (same sentence as the report, MPC-7488) only when a scan was really saved. |
| `workers/scan-report/lib/webScan.js` | `parseRequestId`, `requestIdEnabled`. |
| `supabase/migrations/20261026200000_mpc_7471_f3_scans_request_id.sql` | `scans.request_id uuid` + partial unique index. **NOT APPLIED.** |
| `workers/scan-report/wrangler.toml` | `REPORT_REQUEST_ID_ENABLED = "false"` (rollback value; flip only after the migration). |

Not touched: scan detection, `mpt-leads`, `/scan` page behaviour, report generation, unsubscribe and follow-up cancellation.

## Consent and save contract

- Three things stay separate: **requesting the report** (required box), **saving the scan** (optional box, unticked, only offered when saving is on and this browser holds a finished scan), **marketing** (this popup no longer asks for it; see open decision 3).
- Save ticked: scan stored under a server-issued scan number (`web_scans.id`), linked through `web_scan_contacts` (channel `email`, `contact_id` = the report request), consent time and wording version on the link, one report request.
- Save not ticked: report request only. `web_scans`, `web_scan_contacts`, `web_scan_events` get nothing. The report is built from the email address, as it is today for `/scan` visitors with no saved scan. **No storage conflict found:** report generation does not need the optional saved-scan record.
- One logical consent record per submit: one `users` consent update, one `leads` row (409-deduped), one link with the save consent. A replay writes none of these again.

## One request, honest status

| Situation | Result |
| --- | --- |
| Worker accepts | "Your report is on its way." Scan number shown only if the Worker said `scan_saved: true`. |
| Save ticked but the save failed | Report requested; popup says the scan was not saved, no number. The partly written scan is removed by the existing clean-up. |
| Repeat request for the address within 24h (no `request_id` match) | "We already have a report request for this address." Nothing new created or saved. No number is returned, so typing someone's address does not reveal their scan number. |
| Answer lost after the Worker saved, visitor presses again | Same `request_id`, so the Worker returns the original outcome including the scan number (`replay: true`). Nothing is written twice and no second email. |
| 429 / 4xx / 5xx / network | No success screen, message from MPC-7535 (`REPORT_WAIT_MESSAGE` / `REPORT_FAILED_MESSAGE`), address and ticks kept, Turnstile reset, `console.error` logs kind and status only. After 3 failed tries the button stops and points to hello@myprivacytool.io. |

## Tests (all synthetic, stubbed network, no real send possible)

- Worker `node workers/scan-report/worker.test.mjs`: 251 checks pass, 26 new F3 checks (save/no-save, first email number, replay, wrong requester, wrong user, invalid `request_id`, switch off, partial failure, logs contain no address, opt-out kept and no follow-up). Mutation check: disabling the replay match fails 2 of them.
- Popup unit tests `src/components/EmailCaptureModal.test.tsx` (25), contract tests `src/lib/scanReport.contract.test.ts` (19): the body the popup sends is run through the Worker's own validators.
- DB `npm run test:db` on a throwaway local Postgres 16: new migration applies, unique and null behaviour asserted.
- Playwright `e2e/popup-report.spec.ts` (desktop): drives a real finished scan in the production build into the **real Worker code** with in-memory Supabase/Resend/HubSpot; reads the stored rows and captured email bodies. Fails on any call to an unexpected host.
- Screenshots (synthetic): `docs/screenshots/mpc-7471-f3/`.

Not covered: the real Supabase, Resend and HubSpot; a mobile run of the full-scan journey; deployed behaviour.

## Copy and flow for Chris to approve

Changed words in the popup. MPC-7471-F1 is merged (#538): its header, "You finished your scan", and its dialog shell are kept. F3 changes only the lines below it so they match what the pipeline delivers:

- Form heading (F1 left it as the old text): ~~Get your full privacy fix guide~~ -> **Get your privacy report**
- Sub-line: ~~We'll send step-by-step instructions based on your scan results.~~ -> **We'll email you a report based on your scan results.**
- Bullets: ~~Personalised fix plan... / One-click data broker removal checklist / Privacy Check, our monthly newsletter~~ -> **Your browser findings, replayed with what each one found / What your email address reveals / A first email straight away, then your report within a few minutes**
- Report box: ~~Email me my fix guide and Privacy Check, the monthly newsletter. I can unsubscribe at any time.~~ -> **Email me my results and occasional privacy tips. I can unsubscribe at any time.** (the existing `/scan` wording)
- Save box (unchanged, MPC-7470): "Save my scan result with my email, including technical details from my browser such as my IP address, so my report can show it." plus the existing line under it.
- Button: ~~Send My Privacy Check~~ -> **Send my report**
- Confirmation: ~~You're on the list. Check your inbox for your fix guide.~~ -> **Your report is on its way. Check your inbox: a first email comes straight away and your report follows within a few minutes.**
- With a saved scan: **Your scan number / <number> / Quote this number if you want this scan deleted.**
- Without: **Your scan was not saved, so there is no scan number and nothing from your scan is stored.**
- Footer: **Your email is never sold or shared. Unsubscribe in one click.** (+ " If you save your scan, quote its scan number to have it deleted." only when the save box is offered)

Flow: scan finishes -> popup -> email + report box (+ optional save box) -> send -> confirmation with scan number (if saved) -> first email (same number) -> report (same number).

## Open decisions and conflicts (need Chris or the owning task)

1. **MPC-7471-F1 is merged (#538) and merged into this branch.** The popup score and label now come from F1's page score (`src/lib/scanResult.ts`); F3 does not change them. The screenshots in `docs/screenshots/mpc-7471-f3/` were taken BEFORE that merge, so they show the old header and score; they need to be retaken for the approval review. Criterion 5 is expected to be met but is not separately verified by an F3 test. F1's tests were updated for the F3 wording (consent box text, button name, two tick boxes).
2. **Scan reference format.** The spec says "for example the first 8 characters". The deletion route (MPC-7488, `mpt_delete_web_scan`) takes the full scan number, and the report and `ScanNumberNotice` already show the full one. I kept **one** reference everywhere (the full server-issued number). A short code would be a different identifier and would need either a new column or a deletion route that accepts a prefix, which would make deletion easier to guess. Decide: keep the full number, or approve a short code with a migration.
3. **Newsletter and the score baseline.** The old popup route also signed people up for the newsletter and stored the baseline score ("Baseline saved: 85/100"). Under one route the popup no longer does either. The baseline feature (MPC-7173) is **not shown in the popup any more**; `mpt-leads` is unchanged and nothing else calls it for baselines. Decide whether baselines move into the report pipeline, or stay dropped. A separate newsletter box would need its own approved wording and a Worker field; none exists.
4. **Migration approval.** Without `scans.request_id` the Worker still works (switch off), but a lost answer cannot be replayed safely; a retry then shows "already have a report request" without the scan number. Apply the migration, then set `REPORT_REQUEST_ID_ENABLED = "true"`.
5. **Order change.** The scan is now saved before the first email. If the save is slow the first email waits a little. If it fails the first email still goes out without a number.
6. **Existing behaviour, not changed:** an explicit report request for an unsubscribed address still gets the first email and report (transactional); follow-ups stay cancelled and the opt-out is not lifted (tested).
7. **ID policy.** The page keeps `MPC-7471-F3` as its `task_id`; its row number is 7533. The database defines `ID_Check` as flagging a mismatch and `ID_Legacy_Accepted` as the checkbox that keeps a hand-typed ID on purpose ("do not tick for new rows"). Nothing was renamed or ticked. Chris decides whether to tick it (the ID is cited by F1, F2, the parent and Approval_Notes).

## Live test (PENDING, not run)

Needs: Chris's exact test address (a `+` address on the test mailbox), written approval for one submission, the stored rows, scan activity and the email sends; the migration applied if the replay path is to be tested; the site flag `VITE_SAVE_WEB_SCANS=true` (already how the site is built for MPC-7470). Check counts afterwards: `users` +1, `leads` +1, `scans` +1 (with `request_id`), `web_scans` +1 and `web_scan_contacts` +1 when saved (0 and 0 when not), one first email carrying the same number as the popup and the report. Record provider acceptance (Resend id) separately from delivery in the mailbox.

## Deploy and rollback

- Merging to `main` is a production action: the site deploys, and `.github/workflows/deploy-scan-report.yml` deploys the `scan-report` Worker on any push to `main` that touches `workers/scan-report/**` (this PR does). The Worker change is safe before the migration (the new switch is off).
- Order: (1) apply the migration (separate approval), (2) merge, (3) set `REPORT_REQUEST_ID_ENABLED = "true"`.
- Rollback: set `REPORT_REQUEST_ID_ENABLED = "false"`; revert this PR (the popup then posts to `mpt-leads` again). Migration rollback is in its header; it is safe to leave applied.
