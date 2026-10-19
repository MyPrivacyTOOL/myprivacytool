# MPC-8299: Stage 2 HK Spam go-live, deployment plan

**Status:** plan for approval. Nothing in this file has been executed. No flag has been changed and no email has been sent.
**Unblocks:** Stage 3 (marketing) and registrations follow-up, which both depend on Stage 2 being live.
**Gate:** Stage 1 sign-off (Chris, MPC-7545). Do not start section 4 until the sign-off is recorded on MPC-8299.

## 0. Scope and assumptions

The repo has no document that names "Stages". This plan reads them from what is in the code and docs:

| Stage | Meaning here | State in the repo |
|---|---|---|
| 1 | `/HongKongSpam` page public: `indexable: true`, HK cards on, registrations open (MPC-7446, launched 2026-10-14, approved by Chris) | Done in code (`src/data/hkSpam.json`, `IVR_VERIFIED = true`). Chris's sign-off on the consent wording and day-10 copy (MPC-7545) is not recorded in the repo. |
| 2 | **Real sending of the day-10 "you are now protected" email** to consenting registrants (MPC-7448). This is the only part of the HK Spam funnel still in test mode. | `HK_SPAM_EMAILS_LIVE = "false"` in `workers/scan-report/wrangler.toml` |
| 3 | Marketing push and registrations follow-up | Blocked on Stage 2 |

If Stage 2 means something else, stop and correct section 1 before running anything.

The switch is a one-line change to a plain-text var, deployed by merging to `main`. There is no new service, no new URL and no new migration.

## 1. What is deployed

| # | Service | Identifier | Change in Stage 2 |
|---|---|---|---|
| 1 | Cloudflare Worker `mpt-scan-report` (account `35cb17172c65a20f5cf1baf131485382`) | `workers/scan-report`, deployed by `.github/workflows/deploy-scan-report.yml` | `HK_SPAM_EMAILS_LIVE = "true"` in `wrangler.toml` |
| 2 | Supabase `xmdmkumwxpgahmlweuug` | view `hk_spam_due_reminders`, table `hk_spam_registrations`, table `email_suppressions` | None, but must already be migrated (pre-flight 2.2) |
| 3 | Resend, sender `hello@myprivacytool.io` | sends the email | None, must be verified (pre-flight 2.3) |
| 4 | Site on Cloudflare Pages `wwwmyprivacytool` | `https://myprivacytool.io/HongKongSpam`, `/scan`, `/unsubscribe` | None. The email links to these three pages, so they must load. |

Public URLs involved:
- Page: `https://myprivacytool.io/HongKongSpam` (and `?lang=zh`)
- Email button: `https://myprivacytool.io/scan?utm_source=hk_spam&utm_medium=email&utm_campaign=day10`
- Email opt-out link: `https://myprivacytool.io/HongKongSpam?lang=<en|zh>#hk-optout`
- Unsubscribe: `https://myprivacytool.io/unsubscribe?e=&t=` (signed, plus `List-Unsubscribe` one-click headers)

## 2. Pre-flight checks (all must be green; record the result on MPC-8299)

### 2.1 Approvals
- [ ] Chris has signed off Stage 1 (MPC-7545). Link or quote the sign-off.
- [ ] Chris has approved the EN and Traditional Chinese email copy in `src/data/hkSpamEmailCopy.json` (MPC-7545 / MPC-7542). Changing the copy after approval needs a new approval.
- [ ] Scan go-live is done (MPC-7385). Confirm `https://myprivacytool.io/scan` works end to end, because the email's only call to action points at it.

### 2.2 Database (Supabase)
Migrations are not applied by the merge. Confirm in production:
```sql
select column_name from information_schema.columns
 where table_name = 'hk_spam_registrations' and column_name in ('reminder_sent_at','reminder_consent','marketing_consent');
select to_regclass('public.email_suppressions') as email_suppressions, to_regclass('public.hk_spam_due_reminders') as due_view;
```
Expect all three columns and both objects. Required migrations: `20261011120000`, `20261011140000`, `20261012120000`, `20261013000000` (all `*_hk_spam_*`). If any is missing, apply it through `deploy-supabase.yml` first and stop here until it is verified.

### 2.3 Worker secrets and sender
`mpt-scan-report` must hold `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`. Secrets are write-only, so check names only:
```bash
cd workers/scan-report && npx wrangler secret list      # names only
```
Without `UNSUBSCRIBE_SECRET` the job sends nothing (safe failure). Confirm in Resend that `hello@myprivacytool.io` (domain `myprivacytool.io`) is verified.

### 2.4 Test-mode dry run (the real rehearsal)
With the flag still `false`:
1. Set the secret `HK_SPAM_TEST_INBOXES` to internal addresses only (`npx wrangler secret put HK_SPAM_TEST_INBOXES`).
2. Register one EN and one ZH test row on the live page with today as `protection_date` and `reminder_consent = true`, or insert them with the service role.
3. After the 09:00 HKT run (01:00 UTC), confirm one `[TEST]` and one `【測試】` sample arrived, the button goes to the scan URL, and the unsubscribe link works (the address's hash lands in `email_suppressions`).
4. In Workers Observability confirm a `hk_spam_reminder_run` line with `sent: 0` for real registrants and no errors.
5. Delete the test rows afterwards.

### 2.5 Code and CI
- [ ] `main` is green and the last `Deploy scan-report Worker` run is green.
- [ ] `node workers/scan-report/hk-spam.test.mjs` and `node workers/scan-report/worker.test.mjs` pass locally.
- [ ] `RECIPIENT_ALLOWLIST` is `""` (already open, per MPC-7261). It is shared with the scan emails: if it were non-empty, held HK rows would not be claimed or sent. Do not change it in this release.
- [ ] Rollback drill is healthy: the latest Monday `Rollback Worker` run for `scan-report` passed.

### 2.6 Kill-switch rehearsal
Confirm who can merge a one-line revert to `main` out of hours, and that `workflow_dispatch` works on `deploy-scan-report.yml`.

## 3. Volume and timing facts that shape the rollout

- The job runs only on the cron ticks at 01:00, 02:00, 03:00 and 04:00 UTC (09:00 HKT first run, three hourly retries). The view is "protection date is today in Hong Kong" only.
- Cap: 20 rows per run, so at most about 80 per day with the default batch. If a day has more due rows, the rest are not mailed (they roll off the "today only" view). Check the expected count first:
  ```sql
  select protection_date, count(*) from hk_spam_registrations
   where reminder_consent and reminder_sent_at is null and email is not null and protection_date >= (now() at time zone 'Asia/Hong_Kong')::date
   group by 1 order by 1 limit 14;
  ```
  If any day exceeds about 80, raise `HK_SPAM_BATCH` (max 20, so this means a code change) or agree a manual catch-up before go-live.
- Registrations from before go-live whose date has already passed will never be mailed. That is by design in MPC-7448. If Chris wants a catch-up, it is a separate decision.
- Deploy outside 01:00 to 04:59 UTC, so a deploy never lands mid-run.

## 4. Rollout sequence

Do these in order. Do not skip the waits.

| Step | Action | Who | Check before moving on |
|---|---|---|---|
| 1 | Confirm section 2 is all green and Chris's sign-off is on MPC-8299 | Owner | Checklist ticked in the ticket |
| 2 | Pick the go-live day D. Choose a day with a small due count from the query in section 3 (aim for under 20 so the first live run fits in one batch). | Owner | Count noted |
| 3 | On D-1, open a PR changing only `HK_SPAM_EMAILS_LIVE = "false"` to `"true"` in `workers/scan-report/wrangler.toml`, with the comment line updated to cite MPC-8299 and the date. Get review. | Owner | PR approved, CI green |
| 4 | Merge between 05:00 and 23:59 UTC on D-1. The merge triggers `deploy-scan-report.yml`. | Owner | Deploy run green; `wrangler deploy` output shows the new version |
| 5 | Verify the live var took effect: Cloudflare, Workers, `mpt-scan-report`, Settings shows `HK_SPAM_EMAILS_LIVE = true`; `HK_SPAM_ENABLED = true`. | Owner | Both true |
| 6 | Smoke checks: `https://myprivacytool.io/HongKongSpam` returns 200 in both languages; `/scan` and `/unsubscribe` return 200; `smoke-site.yml` is green. | Owner | All 200 |
| 7 | Watch the first live run at 01:00 UTC on D (09:00 HKT): find `hk_spam_reminder_run` in Workers Observability. Expect `sent` close to the due count, `failed` 0, `held` 0. | Owner | Matches the section 3 count |
| 8 | Confirm in Supabase that sent rows have `reminder_sent_at` set, and that a real inbox (a consenting colleague who registered) received exactly one email. | Owner | One email, correct language |
| 9 | Watch the 02:00, 03:00 and 04:00 UTC retries: counts drop to 0 and nobody is mailed twice (idempotency key `hk-spam-day10-<registration id>`). | Owner | No duplicates |
| 10 | Day 2 and day 3: review `sent`, `suppressed`, `failed`, Resend bounce and complaint rates, and unsubscribe volume. | Owner | See stop conditions below |
| 11 | Mark Stage 2 live on MPC-8299. Only then release Stage 3 (marketing) and registrations follow-up. | Owner | Ticket updated |

### Stop conditions (go straight to section 5)
- `failed` greater than 0 on two consecutive runs, or any run that mails a row twice.
- Resend complaint rate above 0.1% or bounce rate above 5% on the first day.
- Any report of the email reaching someone who did not consent, or in the wrong language.
- The scan button or unsubscribe link returns an error.

## 5. Rollback procedure

Fastest first. All three are safe to run at any time and none of them touches secrets or data.

| Level | Action | Effect | Time |
|---|---|---|---|
| A. Back to test mode (preferred) | PR setting `HK_SPAM_EMAILS_LIVE = "false"`, merge to `main` (or run `deploy-scan-report.yml` after merging). | Nobody real is mailed; rows stay unmarked, so nothing is lost | About 5 min including CI |
| B. Stop the job entirely | PR setting `HK_SPAM_ENABLED = "false"` | The job does nothing, with no database read | About 5 min |
| C. Roll back the Worker version | Actions, `Rollback Worker`, worker `scan-report`. Run once with `dry_run` on to list versions, then off to roll back (optionally with a `version_id`). It re-verifies secret names and smoke-tests. CLI: `cd workers/scan-report && npx wrangler rollback`. | Restores the previous code and vars | About 5 min |

Notes:
- Do not edit the var in the Cloudflare dashboard: the next `wrangler deploy` overwrites dashboard variables (`docs/INFRASTRUCTURE.md`).
- Emails already sent cannot be recalled. If a wrong or unapproved email went out, pause with level A, then write a corrective note and have Chris approve it before anything else is sent.
- Rows that were claimed but failed to send are released automatically and retried by the next run. If a run is stopped halfway, no row is left claimed without a send.
- A suppressed address (`email_suppressions`) stays suppressed after any rollback. That is intended.
- The site-side kill switch is separate: `VITE_HK_SPAM_ENABLED=false` (Pages build variable) hides the whole HK surface, and `indexable: false` in `src/data/hkSpam.json` takes the page out of search. Neither is needed for a Stage 2 rollback.

## 6. Communications
- Post in the launch channel when step 4 merges, when step 7 completes and when Stage 2 is marked live.
- If a stop condition triggers, post the rollback level used and the number of emails already sent.
- No outside announcement is part of Stage 2. Stage 3 owns marketing.

## 7. Open items for the ticket owner
1. Confirm the Stage 1 / Stage 2 / Stage 3 meaning in section 0.
2. Provide the Stage 1 sign-off link (MPC-7545) and the approved email copy version.
3. Provide production confirmation of the three checks that cannot be done from the repo: migrations applied (2.2), Worker secret names present (2.3), Resend sender verified (2.3).
4. Decide whether a catch-up send is wanted for registrants whose protection date passed while the job was off.
