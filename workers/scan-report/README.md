# scan-report Worker (MPC-6677)

Delivers the report: normally within a few minutes of the request (the report job runs every 5 minutes, up to 5 scans per run, oldest first). A report that is still unsent after 48 hours (`report_due_at`) is logged as an ALERT; 48 hours is that internal deadline, not what users are told. One Worker owns **both** the confirmation email and the report.

```
/scan form --POST /api/scan--> mpt-scan-report
   -> Supabase: users, leads (UTM + consent evidence, 3y retention), scans (also the job queue)
   -> HubSpot contact upsert, lead_source_platform=web_scan
   -> confirmation email (Resend, idempotent, once per scan)
cron */5 min -> for each pending scan:
   HIBP breaches -> 5 brokers (never guessed) -> MPC-076 v1.0 score -> signals + hexagon_scores -> report email
```
GA4 `generate_lead` already fires client-side from `trackStartSignup` in `src/pages/Scan.tsx`.

## Free mode (current default, no paid services)
HIBP's Core plan only searches domains you have proven you own, so it cannot look up arbitrary visitor emails; no free equivalent exists. Default is therefore `ALLOW_PARTIAL_REPORT=true` with no `HIBP_API_KEY`: the report carries removal steps for the five brokers and a link to HIBP's free self-check, shows **no score** (nothing was checked) and says "not yet checked" everywhere else. The confirmation copy is a DRAFT for Chris to approve. Setting `HIBP_API_KEY` later switches on real breach checks and a partial score with no code change.

## What the report really contains when every check runs (and the confirmation email must say only what is delivered: since MPC-7469 it promises two things, the browser findings replayed and what the email address reveals, and no username, phone or address search)
- Breaches for the email (Have I Been Pwned). Needs `HIBP_API_KEY`; without it reports are **held**, not sent half-built (`ALLOW_PARTIAL_REPORT=true` overrides, breaches then labelled "not yet checked").
- Spokeo, Whitepages, BeenVerified, MyLife, Intelius: always **"not yet checked"**. The form collects an email only; these sites search by name and location and prohibit automated lookups. Removal links come only from `src/data/optOutGuides.json` (verified guides); MyLife and Intelius have none yet, so the email says so.
- Score 0-100 per MPC-076 v1.0, over checked categories only, labelled partial. Multipliers for email (1.5) and search (1.2) are our interpolation; broker/AI/social come from the spec.

## Report email, two parts (MPC-7468)
`buildReportEmail` (lib/email.js) renders Part 1, the user's saved web scan replayed (all 54 web hexagons), the bridge line, and Part 2, the email hexagons, using one compact hexagon block (`lib/reportHex.js`). Each hexagon is FOUND (real value, with a one-line change tip and a guide link tagged `utm_content=<hexagon id>`), CHECKED AND CLEAR, or NOT CHECKED; estimates are labelled. Hexagons come from `lib/hexagons.generated.js` (`node workers/scan-report/scripts/sync-hexagons.mjs`; reads the shared registry `shared/hexagon-registry/registry.js`, MPC-7487). The full data goes out as a JSON attachment, shape in `docs/report-json-shape.md`. The saved web scan comes from `lib/webScanLoader.js` (MPC-7465 tables); with none, the report still sends and says so. HTML is held under 100 KB (target 80 KB) by `report-email.test.mjs`. US people-search guides appear in the body only when a finding makes them relevant, otherwise as a link.

## HIBP pacing, HubSpot activity (MPC-6677)
- Calls to HIBP are spaced `HIBP_MIN_INTERVAL_MS` apart (default 6500 ms, under the 10/min paid limit). A 429 is retried with `Retry-After`; if it persists the scan stays `pending` for the next 5-minute run, no attempt is counted and no report is sent (it is never reported as "not checked"). No `HIBP_API_KEY`: a clear error is logged each run and processing continues per `ALLOW_PARTIAL_REPORT`; the Worker never crashes.
- When a report is sent, `lib/hubspot.js` adds a note (counts only, no email address) to the contact's timeline. Best effort: a HubSpot failure never affects the report.
- Status vocabulary: `scans.report_status` is `pending | processing | sent | failed` (`sent` = complete); results are delivered by the report email, not a results page.

## Safety gates
- `RECIPIENT_ALLOWLIST` (wrangler.toml) limits sends to test inboxes until the privacy policy (MPC-6545) is live and Chris approves a real-user send. Empty = open to everyone. Scans for other addresses stay `pending` and untouched (no email, no attempt counted) and never count against the per-run limit of 5, so they cannot block allowlisted scans; once the allowlist is emptied they are reported oldest first, 5 per run (MPC-7406).
- Consent must be `true` in the request; it is never defaulted. One scan per address per 24h.
- To avoid duplicate senders set `CONFIRMATION_OWNER=scan-report` as a var on `mpt-leads`, and turn off any HubSpot workflow that sends "Scan confirmed".

## First-100 onboarding (MPC-7261)
Mirror Report, cohort numbers and day 3 / day 7 follow-ups: see `docs/first-100-onboarding-mpc-7261.md`. Follow-ups stay off until the optional `UNSUBSCRIBE_SECRET` secret is set.

Unsubscribe (needs `UNSUBSCRIBE_SECRET`): the website page `/unsubscribe` is the user-facing flow. Email bodies link to `https://myprivacytool.io/unsubscribe?e=<address>&t=<signed token>` (override the base with `SITE_URL`), which shows a confirm button; pressing it calls `POST /api/unsubscribe?e=&t=` with `Accept: application/json`. A visitor without a link types their address on the page, which calls `POST /api/unsubscribe-request {email}`; we email a confirmation link to that address only and answer the same way whether or not it is on our list. `GET /api/unsubscribe` never opts anyone out (mail scanners open links); it shows a confirm page, and the `List-Unsubscribe` header uses the POST one-click form. The opt-out sets `users.email_opt_out_at`, which the follow-up job checks. The report job also checks it: a scan whose user unsubscribed after requesting it is cancelled (`report_status='failed'`, `report_last_error='cancelled: unsubscribed before the report was sent'`) and never emailed; a scan requested after an unsubscribe still gets its report. A confirmed unsubscribe also (1) writes a SHA-256 hash of the address to `email_suppressions`, which is the one list every sender must check (`suppressedAmong` in `lib/suppression.js`), so the newsletter `subscribers` table needs no column of its own: any future newsletter send must filter through it; and (2) sets `hs_email_optout=true` on the HubSpot contact (`pushEmailOptOut`, best effort: a HubSpot failure is logged without the address and never blocks the opt-out; needs the token to allow contact updates).

## HK Spam day-10 email (MPC-7448)
On the 5-minute cron's ticks at 01:00 to 04:00 UTC (09:00 HKT daily run + retries) (no separate cron: Workers Free allows 5 crons per account) the HK job instead of the report job reads `hk_spam_due_reminders` and sends the bilingual "you are now protected" email. Two switches: `HK_SPAM_ENABLED` (off = does nothing) and `HK_SPAM_EMAILS_LIVE` (default `false` = test mode, samples to `HK_SPAM_TEST_INBOXES` only). Opt-outs also write `email_suppressions` (hash only). Full design and go-live steps: `docs/hk-spam-day10-email-mpc-7448.md`. Test: `node workers/scan-report/hk-spam.test.mjs`.

## Referral programme (MPC-7645)
Off unless `REFERRALS_ENABLED = "true"`. Adds `ref` on `/api/scan`, `POST /api/referral/status` and `/api/referral/invite`, an invite block in the report email, and a free-Pro-month ledger credited when a referred friend's report is delivered. Needs `UNSUBSCRIBE_SECRET`. Design, privacy rules and go-live steps: `docs/referral-program-mpc-7645.md`. Test: `node workers/scan-report/referral.test.mjs`.

## Secrets (names only; set with `wrangler secret put`)
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIBP_API_KEY`, `HUBSPOT_TOKEN`.

## Deploy (per the MPT Infrastructure Ops page)
Merge to `main` runs `.github/workflows/deploy-scan-report.yml` (same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets as `deploy-mpt-leads`; MPT account 35cb17172c65a20f5cf1baf131485382). Expected URL: `https://mpt-scan-report.myprivacytool.workers.dev`. Worker secrets are write-only and set by a human in the dashboard (Workers & Pages -> mpt-scan-report -> Settings -> Variables and Secrets). The Cloudflare connector is read-only, so it can confirm the Worker exists but not deploy.

## Frontend flag
On by default since MPC-7385: `src/pages/Scan.tsx` posts to `https://mpt-scan-report.myprivacytool.workers.dev` unless `VITE_SCAN_API_URL` (Cloudflare Pages project `wwwmyprivacytool`, env var) overrides it. Set that variable to an empty string to turn the feature off (HubSpot-only). Emails are still gated by `RECIPIENT_ALLOWLIST`.

## Test
`node workers/scan-report/worker.test.mjs` (stubbed fetch, no network).

## Web scan saving (MPC-7465, MPC-7488, MPC-7470 / decision D12)

A saved scan is **personal data, not anonymous**: `results` holds what the browser reported per hexagon, which includes IP addresses and fingerprint-style values. There is no connection-IP column, no email and no user id on `web_scans`; the contact is linked only through `web_scan_contacts`. (An earlier comment and doc said no IP is stored; that was wrong.)

**When a scan is saved (D12).** Only when the visitor gives an email address at the contact step (the `/scan` form only; the home-page email modal does not save a scan and does not create a scan-report request, because with `RECIPIENT_ALLOWLIST` empty that would send the confirmation, report and follow-up emails to every modal visitor) AND ticks the separate, required, unticked-by-default box "Save my scan result with my email, including technical details from my browser such as my IP address, so my report can show it." Until then the finished scan lives only in the visitor's browser (sessionStorage `mpt_pending_scan`) and is never sent. A visitor who gives no email, or arrives at `/scan` with no scan in the browser, has nothing saved and the form works as before. This replaces "save every completed scan, with or without a contact" (D7) and the banner-purpose gate (MPC-7488: `hasScanSaveConsent`, `VITE_SCAN_SAVE_CONSENT_PURPOSE`, both removed: the consentmanager.net Free package cannot create custom purposes).

**API.** `POST /api/scan` `{email, consent:true, consent_source, scan:[{id,label,value,...}], save_consent:true, save_consent_version, started_ms?, previous_scan_number?}` (the last two, MPC-7493, travel only with the scan). The Worker validates the scan, inserts `web_scans`, links it to the new request in `web_scan_contacts` (`channel='email'`, `contact_id=scans.id`) and stores the consent record on that link (`save_consent_at` = Worker clock, `save_consent_version`), and records the MPC-7493 steps `scan_finished`, `scan_started` (from `started_ms`), `contact_given` and the return link (`previous_scan_number`). Answer: `{success, duplicate, scan_saved, scan_number?}`. Rules:
- A request that carries `scan`, `save_consent` or `save_consent_version` but not `save_consent === true`, a wording version listed in `SAVE_CONSENT_VERSIONS` (`lib/webScan.js`) and a valid scan is **rejected with 400**; nothing is stored or sent. Add a version there whenever the label in `src/lib/saveConsent.ts` changes.
- No save fields = the usual email request, nothing saved. A repeat request within 24h is answered normally and not saved again (it sends no new report).
- If the link (and so the consent record) cannot be written, the scan row is deleted again; the email request still succeeds.
- The old `POST /api/web-scan` (save at completion, no contact) no longer exists (404). `POST /api/web-scan/step` (MPC-7493) stays; under D12 a browser has a scan number to report against only after it saved at the contact step, so earlier calls send nothing.
- **The learning-loop numbers (`mpt_learning_loop`, docs/learning-loop-mpc-7493.md) now cover ONLY visitors who gave a contact and ticked the box.** Drop-off before the contact step must come from the GA4 events (`scan_started`, `privacy_scan_completed`, `funnel_step`, `report_requested`).
- Body cap: 8 KB, or 72 KB while saving is on; the scan itself may be at most 64 KB (`web_scans.results_bytes`).
Other channels later = new `channel` values, no schema change.

Switch: Worker var `WEB_SCAN_SAVE_ENABLED` (default `"false"`; only `"true"` saves) and site build flag `VITE_SAVE_WEB_SCANS`. Off, the save fields are ignored and the site shows no box and no saving line. Migration `20261012200000_mpc_7470_web_scan_save_consent.sql` (two nullable columns on `web_scan_contacts`) must be applied before the switch goes on.
**Drop-off without personal data.** Not stored in the database. GA4 events, consent-gated (they reach GA4 only after the visitor accepted analytics): `scan_started`, `privacy_scan_completed` (all hexagons confirmed), `funnel_step`, and `report_requested` (fired on `/scan` only; `source` = `scan_page`, `scan_save_ticked` true/false; no email, no scan content, no scan number). The old `web_scan_funnel` view still exists but is no longer fed by scans without a contact; the 90-day rule for unlinked scans (`web_scan_retention.unlinked_days`) is now unused and may be set to null.
**Scan number.** Shown after saving (on the `/scan` thank-you and on the results screen on that device: "Quote this number if you want this scan deleted."), kept in the visitor's browser (localStorage, `mpt_web_scan_number`), and in the report email (text, HTML and the JSON attachment `web_scan.id`).
**Deletion, export, clean-up** (service_role only; counts are logged to `web_scan_deletion_log`, never a scan number, contact or value):
- `node scripts/web-scan-admin.mjs delete <scan-number>` deletes the scan and its contact link(s); `export <scan-number>` prints it; `purge [--dry-run]` runs the clean-up now. Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. Tests: `node scripts/web-scan-admin.test.mjs`.
- Database functions: `mpt_delete_web_scan(uuid)`, `mpt_export_web_scan(uuid)`, `mpt_purge_expired_web_scans(p_dry_run boolean default false)`. An email-based request still goes through `mpt_dsar_export` / `mpt_dsar_erase` (`supabase/sql/mpt-dsar-erase-export.sql`), which cover linked web scans.
- Retention is one setting: the single row of `public.web_scan_retention` (`months` = 12; `unlinked_days` = 90 was the shorter rule for scans never linked to a contact approved in #249; since D12 no scan is saved without a contact, so it is unused and can be set to null). Change it with `update public.web_scan_retention set months = N`. A daily pg_cron job `mpt-purge-expired-web-scans` (19:10 UTC) runs the purge.

## Email hexagons (MPC-7467)
Name in address, mail provider and domain, public profile (Gravatar) run per scan; results are `signals` rows (`email-name`, `email-provider`, `email-profile`), never block the report, and do not affect the score. Services that receive the address or a hash of it, and the held breach check: `docs/email-hexagons-mpc-7467.md`. Test: `node workers/scan-report/email-hexagons.test.mjs`.

## Status per hexagon, decided at scan time (MPC-7487)
The site sets each hexagon's `status` (`found` | `clear` | `not_checked`, plus `estimate: true` for registry estimates) when it captures the value, with `captureStatus` in `shared/hexagon-registry/status.js`, and saves it with the scan (`web_scans.results`, no schema change). The report uses it: a real value shows FOUND; placeholders and failures (`Location detected`, `Unknown ISP`, an assumed `WiFi`, `Checking...`, `N/A`, `No input yet`, blocked) are NOT CHECKED; the 7 hexagons the registry marks `cannot_be_checked` are always NOT CHECKED; CHECKED AND CLEAR only where the registry allows it. The Worker re-checks the saved status against the registry (the browser is untrusted), and a scan saved before this change (no `status`) falls back to the strict behaviour above (the 29 `cannot tell` hexagons NOT CHECKED).
