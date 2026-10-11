# HK Spam day-10 "you are now protected" email (MPC-7448)

Part of the /HongKongSpam funnel: tap to register, leave email, **day-10 email**, free privacy scan.
Engine and table: MPC-7450 (`hk_spam_registrations`, view `hk_spam_due_reminders`). Runs inside the existing `mpt-scan-report` Worker.

## Status: sending is OFF
`HK_SPAM_EMAIL_ENABLED = "false"` in `workers/scan-report/wrangler.toml`. Anything other than the exact string `true` is a **dry run**:
the cron reads only the ids of today's due rows, logs the count (`{"event":"hk_spam_reminder_run","dry_run":true,"due":N,"sent":0}`)
and sends and claims nothing. Nothing was sent to a real address while building this; only stubbed tests ran.

## How it works
- The `*/5` cron's ticks at 01:05, 02:05, 03:05 and 04:05 UTC (09:05 to 12:05 HKT) call `runHkSpamReminderJob` (`lib/hkSpam.js`, `isHkSpamSlot`) instead of the report and follow-up jobs; every other tick runs those as before. There is no separate cron because Workers Free allows only 5 per account (deploy error 10072).
- The view lists rows whose `protection_date` is today in Hong Kong, with an email, `reminder_consent = true`, and `reminder_sent_at is null`.
- Per run at most 20 rows (2 subrequests each, stays under the free-plan limit of 50). Later hourly runs drain any rest; each row is claimed first, so extra runs never double-send. Override with `HK_SPAM_BATCH` (max 20).
- Per row: skip if suppressed, then **claim** (`PATCH ... reminder_sent_at=is.null`, atomic), then send via Resend with idempotency key `hk-spam-day10-<registration id>`. If the send fails the claim is released and the next run retries.
- Email: one language only, as chosen on the page (`en`, or `yue` = Traditional Chinese, Hong Kong wording). Says: now protected from marketing SMS and pre-recorded calls; live calls from a person and companies you consented to are NOT covered; one call to action, the free scan at `https://myprivacytool.io/scan?utm_source=hk_spam_email&utm_medium=email&utm_campaign=day10`. Copy is a DRAFT for Chris to approve.
- Unsubscribe in every email: the existing signed link (`/unsubscribe?e=&t=`, HMAC with `UNSUBSCRIBE_SECRET`) in the body, plus `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Without `UNSUBSCRIBE_SECRET` the job sends nothing.
- `RECIPIENT_ALLOWLIST` is honoured (held rows are not claimed), same as the scan emails.

## Suppression design (what was chosen and why)
`users.email_opt_out_at` is keyed by a `users` row. HK registrants have none, so the existing opt-out `PATCH users?email=eq.X` would match nothing and the unsubscribe would be lost.
Chosen: new table `email_suppressions (email_hash, created_at, source)`, keyed by SHA-256 of the lower-cased address, service_role only, no readable address.
- `/api/unsubscribe` (POST, signed link) now also inserts the hash (duplicates ignored). One extra write; the existing `users` update is unchanged.
- The HK job skips an address if **either** `users.email_opt_out_at` is set (someone who also ran a scan) **or** its hash is in `email_suppressions`.
- Not changed: the report and follow-up jobs still use only `users.email_opt_out_at`. The website "unsubscribe me" form (`/api/unsubscribe-request`) still only mails addresses that have a `users` row; an HK registrant unsubscribes from the link in the email.

## Data and privacy
- No phone numbers are stored or logged (none exist in the table). Logs carry counts and registration ids only; error text is scrubbed of email-like strings.
- Migration `20261011140000_mpc_7448_hk_spam_reminder_sent.sql` (additive): `reminder_sent_at` column; view now excludes sent rows; `email_suppressions`; anon keeps INSERT-only and can no longer set `reminder_sent_at` (column-level grant). Tested in `supabase/tests/schema.test.sql`.
- A registration whose protection date passes while the job is off, or the Worker is down for the whole 01:05 to 04:05 UTC window, is not mailed late (the view is "today only"). Say if a catch-up is wanted.

## Funnel measurement
- Sent: `hk_spam_reminder_run` log line per run (`sent`, `suppressed`, `held`, `failed`, `by_language`), visible in Workers Observability.
- Click and scan start: UTM on the single link. GA4 attributes visits with `utm_source=hk_spam_email`, `utm_campaign=day10` (cookie-consenting visitors only, no tracking pixel). Opens are not tracked (no pixel, by design).

## Go-live checklist (needs Chris's word first)
Launch gate from the brief: MPC-7445 confirms the IVR keys AND the scan go-live (MPC-7385 / PR #162) is cleared.
1. Migration applied to Supabase (merge to `main` runs `deploy-supabase.yml`; confirm `reminder_sent_at` and `email_suppressions` exist).
2. Worker secrets present on `mpt-scan-report`: `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET` (the Worker's `UNSUBSCRIBE_SECRET` must be the one the website unsubscribe page works with). Resend sender `hello@myprivacytool.io` verified.
3. Chris approves the EN and Traditional Chinese copy in `lib/hkSpam.js` (`COPY`).
4. Test first: set `RECIPIENT_ALLOWLIST` to a test inbox, register a row for that address with today's protection date, set the flag to `"true"`, deploy, and check the email in both languages and the unsubscribe link.
5. Go live: clear `RECIPIENT_ALLOWLIST` only if the scan emails are also open (it is shared), set `HK_SPAM_EMAIL_ENABLED = "true"` **in `workers/scan-report/wrangler.toml`** (a dashboard variable is overwritten on the next deploy, see `docs/INFRASTRUCTURE.md`), merge to `main`, check the deploy run, then watch the next `hk_spam_reminder_run` log.
6. Switch off again: set the flag back to `"false"` and merge.
