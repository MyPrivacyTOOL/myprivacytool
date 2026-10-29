# MPC-7557: nightly end-to-end test and rendering checks

Written 2026-10-28 (HKT). Task: https://app.notion.com/p/3f728547eaa781d09ebbd34bab21a95c · Strategy: https://app.notion.com/p/3f628547eaa78157aae5f46b4822c3c6

Evidence words used here: **TESTED** = run in CI/sandbox against stubs. **NOT VERIFIED LIVE** = needs production, which the build sandbox cannot reach. Nothing in this document is VERIFIED LIVE yet. The first real night's result is recorded on the Notion task after the first scheduled run.

## 1. Design: what the nightly run proves, and the choice made

Constraints (do not rediscover): production `POST /api/scan` enforces Cloudflare Turnstile (403 without a valid token) and must never be bypassed; the home-page scan never completes headless in the sandbox; the build sandbox cannot reach production.

Two candidate designs:

| | A. Staging path with Turnstile TEST keys (chosen) | B. Fixture scan straight into the database + report request |
|---|---|---|
| Real code exercised | the real `/api/scan` handler: Origin check, rate limit, consent rules, user + lead upsert, request dedupe, scan save, consent record, link, first email; then the **production** cron and provider send the report | only the report cron and provider; the entry point, consent handling and first email are skipped |
| Production bypass | none. Production's Turnstile is untouched. | none, but it is not the real chain |
| What can still go wrong unseen | the real Turnstile widget on the live page (a real browser is needed; the nightly drift job and MPC-7471 cover the page itself) | everything before the cron |

**Chosen: A.** It proves the most of the real chain (the 2026-10-12 failure was in the first hop) with no production bypass. Mechanics:

1. `workers/scan-report/wrangler.synthetic.toml` deploys the **same Worker code** as `mpt-scan-report-synthetic`: no cron, `RECIPIENT_ALLOWLIST` = the test mailbox, no HubSpot token (no CRM contact is created), Cloudflare's public always-passes test secret as `TURNSTILE_SECRET_KEY`. `lib/turnstile.js` skips only the hostname check for exactly that public test secret (tests prove the real secret still enforces it).
2. It writes to the **production** database. The real production cron (every 5 minutes) then sends the real report through the real provider, because the production allowlist is open.
3. The runner (`scripts/nightly-chain/run.mjs`, GitHub Actions `nightly-chain.yml`, 23:30 HKT) sends a consented, synthetic scan for the alias `testingnt69+nightly-<YYYYMMDD>@gmail.com` and checks, in order:

| # | Step | Evidence |
|---|---|---|
| 1 | `scan_request` | synthetic Worker answers success + scan number |
| 2 | `saved_scan` | `web_scans` row with the sent hexagon count |
| 3 | `linked_contact_consent` | `web_scan_contacts` row with `save_consent_at` and wording version |
| 4 | `report_request` | `scans` row, source `web_scan`, attached to a test address (refuses to continue otherwise) |
| 5 | `first_email_accepted` | `scans.confirmation_sent_at` set (the provider accepted it; **accepted is not inbox receipt**) |
| 6 | `report_sent` | `report_status = sent` and `resend_message_id` (waits up to 15 min for the cron) |
| 7 | `report_checks` | sent HTML/text read back from Resend (falls back to a rebuild from the saved scan, flagged in the result): two parts, bridge line, honest statuses, scan number in HTML + text + JSON, JSON valid and agreeing with the scan, HTML under 100 KB, no unsupported markup, plain-text parity |
| 8 | `links_resolve` | every https link in the report answers 2xx (the signed unsubscribe link is not fetched) |

The first failing step stops the run; later steps are recorded as **skipped**, never as passed.

**Limits stated honestly.** (a) The JSON attachment is validated on a rebuild from the saved scan with the Worker's own builder, because it is NOT VERIFIED that Resend's retrieve-email endpoint returns attachment bytes; the rebuilt tally is compared with the sent HTML. (b) Inbox receipt and real-client rendering (Gmail, Outlook, Apple Mail) are not machine-checkable; MPC-7471 did them by hand once. (c) The real Turnstile widget is exercised by a human or the headless drift job, not by this run.

## 2. Rendering checks in CI

`workers/scan-report/lib/renderChecks.js` + `email-render.test.mjs`, part of `npm run test:workers:node`, which CI runs on **every** pull request (a superset of "every email-code change"). For every email the Worker builds (report with and without a saved scan, confirmation, unsubscribe request, unsubscribed, day-3, day-7): HTML under 100 KB, no unsupported tags or CSS (script, iframe, form, flex/grid, position, floats, background images, event handlers), https images with alt text, plain-text part present with every link and the same status tags, scan number in both parts, Part 1 / Part 2 and the bridge line. 16 mutation checks prove each rule can fail. Static checks do not prove real-client rendering.

## 3. Weekly: unsubscribe and deletion on a test record

Sunday 23:45 HKT, alias `testingnt69+weekly-<day>`: scan on the synthetic Worker, signed unsubscribe `POST` to the **synthetic Worker** (MPC-8748: signed with a throwaway key the weekly run puts on that Worker itself; production's own secret is not needed), check `users.email_opt_out_at` and the `email_suppressions` hash, `mpt_delete_web_scan(<scan number>)`, verify gone, then `mpt_dsar_erase` for the alias (and for nightly aliases 3 to 10 days old) and removal of the suppression row. The cleanup runs even if an earlier weekly step failed. Every destructive call is guarded by `isTestAddress` (the mailbox `testingnt69` and its `+aliases` only).

## 4. Alerts, no duplicates

* The runner writes one counts-only row to `mpt_raw_metrics` (`source=nightly_chain`; the table itself rejects email addresses).
* The existing daily collector (`mpt-metrics-collector`, 00:15 HKT, after the 23:30 run) reads it (`collectors/nightly-chain.js`) and posts to the **usual Slack channel**, naming the failed step. It also alerts on **no result for 30 hours** (missed run), on **not configured**, and on a weekly result older than 9 days.
* Reused, not rebuilt: the collector and its Slack path, the scan-gap collector (unchanged), the MPC-8406 stuck-request alert (also watches the test scan, unchanged), `report-email.test.mjs` (100 KB), `web-scan-admin` deletion (`mpt_delete_web_scan`), `e2e-live-drift.yml` (MPC-8538, owner MPC-8540; read-only, not touched: this is the only job that writes).
* Test records never count in KPIs: `shared/test-records.js` defines them; `supabase-counts.js` excludes them from `counts` and reports `test_counts` separately; the synthetic Worker has no HubSpot token.

## 5. Proposed defaults for the five approvals (your 2026-10-26 note); change any you disagree with

| Approval | Proposed default |
|---|---|
| Recipient | `testingnt69+nightly-<YYYYMMDD>@gmail.com` and `+weekly-<YYYYMMDD>` aliases of the existing test mailbox (Gmail delivers all to one inbox, one new alias per day so the 24h rule never blocks). Nothing else is ever emailed. |
| Send authority | The runner may cause at most two emails a night (first email + report) to that mailbox, plus the unsubscribe confirmation weekly. It creates no HubSpot contact. Merging this PR deploys the synthetic Worker and starts the schedule; that is the activation. |
| Schedule | Nightly 23:30 HKT (15:30 UTC), weekly Sunday 23:45 HKT. Chosen so the 00:15 HKT collector reports the same night and it does not overlap the 03:17 HKT drift job. |
| Alert destination | The usual MPT Slack channel (via the existing collector), nothing new. |
| Stop procedure | Disable the "Nightly chain test" workflow (Actions tab) or revert this PR; to stop the synthetic path delete Worker `mpt-scan-report-synthetic`. Neither touches production's Worker, cron or Turnstile. |

## 6. What activation needs (tracked as Notion tasks, not asks to Chris)

* The synthetic Worker takes `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from existing GitHub secrets on first deploy. Weekly run: needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (already used by the deploy workflows). Each weekly run makes a throwaway key, puts it on the synthetic Worker as `UNSUBSCRIBE_SECRET` and signs the unsubscribe with it, so no UNSUBSCRIBE_SECRET repo secret is needed. It never reads or sets production's secret. If `SCAN_REPORT_UNSUBSCRIBE_SECRET` exists it is only a fallback.
* The metrics collector must be redeployed (automatic on merge) before its alert path exists.
