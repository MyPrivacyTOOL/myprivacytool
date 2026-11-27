# MPC-9833 (F10): what a visitor receives, and when — promise map and timed proof

Written 2026-11-08 HKT. Ledger claims C06 / C07. Harness: `scripts/report-delivery-proof/run.mjs` (workflow `report-delivery-proof.yml`, on demand or a push to `measure/**`). Same pattern as MPC-9813: F1 synthetic Worker (Cloudflare TEST Turnstile secret, confirm gate ON like production, no cron, no HubSpot), `testingnt69+proof-*` alias only, throwaway signing key, test record erased at the end. All times are server timestamps from the database.

**Evidence limits.** No real inbox is read. "Report sent" = the provider accepted it; "delivered" = the provider's webhook said so. Inbox placement and client rendering are not provable here. The pre-gate runs (section 3) come from the `scans` rows of the nightly chain and earlier test sends, not from this harness.

## 1. Promise map (before this change) → what the code does

| Location | Sentence (before) | What the code does |
|---|---|---|
| /start (`Start.tsx`) | "Join the list and we'll email you when your free privacy report is ready." | **False.** The form is a HubSpot list sign-up. It runs no scan and creates no report request, so no report is ever "ready" for that address. The report pipeline is reached only from /scan and the home-page report popup. |
| /start after "Join the list" | "Enter your email and we'll let you know as soon as your free privacy report is ready." | Same. |
| /thank-you?source=start | "We'll email you when your free privacy report is ready." | Same. |
| Home-page report popup (`EmailCaptureModal.tsx`) | "A first email straight away, then your report within a few minutes" and "a first email comes straight away and your report follows within a few minutes" | Since `EMAIL_CONFIRM_GATE_ENABLED=true` (production `wrangler.toml`), the report waits for the visitor to press the button in the first email. "Straight away, then a report" omitted the step that holds it. Unconfirmed requests get no report, ever. |
| /scan thank-you (`Scan.tsx`) | "We'll email … with your next steps." | True and vague. (The live panel says to confirm in the email.) |
| Confirmation email | "Once you have confirmed, your report usually arrives within a few minutes." | True: report job runs every 5 minutes (`crons = ["*/5 * * * *"]`). Left as approved. |
| Developer docs (`developerDocs.ts`, 2 places) | "confirmation email is sent once, then a privacy report is emailed, normally within a few minutes" | Omitted the confirm step. |
| /business (`Business.tsx`, 3 places) | "send an exposure report within 48 hours" / "Results in 48 hours" | **No code behind it.** Submitting posts a HubSpot form; nothing scans a team or sends a report. Now carries the Planned marker (F6). |
| Worker README / report job | "48 hours" `report_due_at` | Internal alert threshold, not told to visitors. Unchanged. |
| FAQ, Privacy, Terms (12 months) | "kept for 12 months, then deleted automatically" (saved scan) | True for `web_scans` (section 4). See the gap on the `scans` row. |

## 2. Timed runs, gate ON (what a visitor gets today)
Three runs on the deployed system, through the F1 synthetic Worker, a simulated click 60 s after the confirmation email (a person is not instant), production cron sending the report. Times HKT (UTC+8), server clocks.

| Run | Submit | Confirmation email sent | Click | Report sent | Provider "delivered" | Submit→confirmation | Click→report | Submit→report |
|---|---|---|---|---|---|---|---|---|
| 1 | 03:41:58 | 03:42:00 | 03:43:02 | 03:45:11 | 03:45:13 | 2.1 s | 128.9 s | 193.2 s |
| 2 | 03:47:16 | 03:47:21 | 03:48:24 | 03:50:13 | 03:50:15 | 4.8 s | 108.6 s | 176.9 s |
| 3 | 03:50:51 | 03:50:55 | 03:51:57 | 03:55:09 | 03:55:12 | 4.0 s | 192.3 s | 258.4 s |

Median: confirmation email 4.0 s (max 4.8 s); click→report 129 s (max 192 s, design cap one 5-minute cron tick); report "delivered" webhook 2.1 to 2.8 s after it was sent. All reports: first attempt, status `sent`, `delivered`.

**Limit, stated plainly: the three gated runs were within 14 minutes of each other (03:41 to 03:55 HKT), not at three different hours.** Different hours were not possible in one session. The click→report time depends on where the click falls in the 5-minute cron cycle, not on the hour; the three runs landed at different points of the cycle (about 2.2, 1.8 and 3.2 minutes to the tick). Section 3 supplies the different-hours evidence for the ungated path.

What the confirmation email said (read back from the provider): subject "Confirm your email to get your privacy report"; "Until you press the confirm button on this page, I send no report and run no checks that use your details."; "Once you have confirmed, your report usually arrives within a few minutes." Matches the measurement.

What the report contained (read back from the provider, same each run): subject "Your MyPrivacyTOOL privacy report", 41,972 bytes of HTML; Part 1 (the saved web scan, all hexagons) and Part 2 (email hexagons) present; 6 FOUND, 9 CHECKED AND CLEAR, 52 NOT CHECKED; **no score** ("No privacy score yet: we only score what we actually checked"); no "Listings you showed us" block (these runs gave no listing page); scan number present.

## 3. Pre-gate history (ungated synthetic requests, 2026-10-28 to 2026-11-07)
17 reports, all `sent` on the first attempt. Submit → confirmation email: median 2.8 s, max 5.1 s. Submit → report: median 3.2 min, p90 4.4 min, max 4.7 min. They span 9 distinct UTC hours (06:56 to 23:11), so this is not one time of day.

## 4. Retention (12 months)
Evidence from code and the production database (2026-11-08):

- **Saved web scan (`web_scans`): 12 months, enforced.** `web_scan_retention.months = 12`. pg_cron job `mpt-purge-expired-web-scans` runs daily 19:30 UTC (`select public.mpt_purge_expired_web_scans(false)`); `web_scan_deletion_log` shows 27 daily purge runs (last 2026-11-07 19:30 UTC), all deleting 0 rows. Zero is expected: the oldest saved scan is under 5 weeks old, so **no scan has yet reached 12 months and the age-based deletion has never deleted a real row.** The mechanism is covered by tests on real Postgres (`supabase/tests`) but not yet observed in production. Foreign keys on `web_scans` are `ON DELETE CASCADE` for `web_scan_contacts`, `web_scan_events`, `web_scan_returns` and `web_scan_listing_checks`, so the typed listing details go with the scan.
- **Deletion by scan number works.** `web_scan_deletion_log` has 2 earlier `by_scan_number` deletions; in each of the 3 runs above `mpt_delete_web_scan(<scan number>)` returned `found: true` and the scan row was gone afterwards.
- **What the visitor is told.** FAQ, Privacy (section on Saved Web Scans) and the home page say 12 months, then deleted automatically; earlier deletion by scan number or by writing to privacy@myprivacytool.io. The report email carries the scan number and "Quote this number if you want this scan deleted." There is no self-service delete button, and the FAQ says so.
- **Gap: the `scans` row (the report request: email address, report status, delivery status) is not covered by the 12-month job.** Its `expires_at` is set to created_at + 30 days, but the only scan purge job (`mpt-purge-expired-scan-results`) deletes from a different table (`mpt_osint_scan_results`). Nothing deletes `scans` rows by age; they are removed only by `mpt_dsar_erase` or an erasure request. The Privacy page states no retention period for them. Recorded as a fix task (see the Notion task).
