# scan-report Worker (MPC-6677)

Makes the "report within 48 hours" promise true. One Worker owns **both** the confirmation email and the report.

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

## What the report really contains when every check runs (and the confirmation email must say only what is delivered)
- Breaches for the email (Have I Been Pwned). Needs `HIBP_API_KEY`; without it reports are **held**, not sent half-built (`ALLOW_PARTIAL_REPORT=true` overrides, breaches then labelled "not yet checked").
- Spokeo, Whitepages, BeenVerified, MyLife, Intelius: always **"not yet checked"**. The form collects an email only; these sites search by name and location and prohibit automated lookups. Removal links come only from `src/data/optOutGuides.json` (verified guides); MyLife and Intelius have none yet, so the email says so.
- Score 0-100 per MPC-076 v1.0, over checked categories only, labelled partial. Multipliers for email (1.5) and search (1.2) are our interpolation; broker/AI/social come from the spec.

## Safety gates
- `RECIPIENT_ALLOWLIST` (wrangler.toml) limits sends to test inboxes until the privacy policy (MPC-6545) is live and Chris approves a real-user send. Empty = open to everyone. Scans for other addresses stay `pending` and untouched (no email, no attempt counted) and never count against the per-run limit of 5, so they cannot block allowlisted scans; once the allowlist is emptied they are reported oldest first, 5 per run (MPC-7406).
- Consent must be `true` in the request; it is never defaulted. One scan per address per 24h.
- To avoid duplicate senders set `CONFIRMATION_OWNER=scan-report` as a var on `mpt-leads`, and turn off any HubSpot workflow that sends "Scan confirmed".

## First-100 onboarding (MPC-7261)
Mirror Report, cohort numbers and day 3 / day 7 follow-ups: see `docs/first-100-onboarding-mpc-7261.md`. Follow-ups stay off until the optional `UNSUBSCRIBE_SECRET` secret is set.

Unsubscribe (needs `UNSUBSCRIBE_SECRET`): the website page `/unsubscribe` is the user-facing flow. Email bodies link to `https://myprivacytool.io/unsubscribe?e=<address>&t=<signed token>` (override the base with `SITE_URL`), which shows a confirm button; pressing it calls `POST /api/unsubscribe?e=&t=` with `Accept: application/json`. A visitor without a link types their address on the page, which calls `POST /api/unsubscribe-request {email}`; we email a confirmation link to that address only and answer the same way whether or not it is on our list. `GET /api/unsubscribe` never opts anyone out (mail scanners open links); it shows a confirm page, and the `List-Unsubscribe` header uses the POST one-click form. The opt-out sets `users.email_opt_out_at`, which the follow-up job checks. The report job also checks it: a scan whose user unsubscribed after requesting it is cancelled (`report_status='failed'`, `report_last_error='cancelled: unsubscribed before the report was sent'`) and never emailed; a scan requested after an unsubscribe still gets its report. It does not yet update the newsletter `subscribers` table or HubSpot (follow-up).

## HK Spam day-10 email (MPC-7448)
On the 5-minute cron's ticks at 01:05 to 04:05 UTC (no separate cron: Workers Free allows 5 crons per account) the HK job instead of the report job reads `hk_spam_due_reminders` and sends the bilingual "you are now protected" email. **Off** (dry run, counts only) unless `HK_SPAM_EMAIL_ENABLED = "true"`. Opt-outs also write `email_suppressions` (hash only). Full design and go-live steps: `docs/hk-spam-day10-email-mpc-7448.md`. Test: `node workers/scan-report/hk-spam.test.mjs`.

## Secrets (names only; set with `wrangler secret put`)
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIBP_API_KEY`, `HUBSPOT_TOKEN`.

## Deploy (per the MPT Infrastructure Ops page)
Merge to `main` runs `.github/workflows/deploy-scan-report.yml` (same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets as `deploy-mpt-leads`; MPT account 35cb17172c65a20f5cf1baf131485382). Expected URL: `https://mpt-scan-report.myprivacytool.workers.dev`. Worker secrets are write-only and set by a human in the dashboard (Workers & Pages -> mpt-scan-report -> Settings -> Variables and Secrets). The Cloudflare connector is read-only, so it can confirm the Worker exists but not deploy.

## Frontend flag
On by default since MPC-7385: `src/pages/Scan.tsx` posts to `https://mpt-scan-report.myprivacytool.workers.dev` unless `VITE_SCAN_API_URL` (Cloudflare Pages project `wwwmyprivacytool`, env var) overrides it. Set that variable to an empty string to turn the feature off (HubSpot-only). Emails are still gated by `RECIPIENT_ALLOWLIST`.

## Test
`node workers/scan-report/worker.test.mjs` (stubbed fetch, no network).
