# HK Spam Stage 2: engine and pages go live (MPC-8299)

**Status:** rollout spec only. Nothing in this document has been executed. Every production change below needs Chris's explicit approval (Stage 1 decision, 2026-10-19: "Going live needs Chris's explicit approval and is a separate step").
**Chain:** MPC-7539 (Stage 1, technical testing, due 2026-10-23) -> **MPC-8299 (Stage 2, this, due 2026-10-27)** -> Stage 3 (marketing amplification, spec to follow, see MPC-7624) -> MPC-7543 (Stage 4, proof it works, due 2026-10-30) -> MPC-7536 (rollout master, due 2026-11-15).

## 1. What goes live

| Component | Where | Switch | State in `main` today |
|---|---|---|---|
| Page `/HongKongSpam` (EN + Traditional Chinese), homepage and scan-result HK cards | Cloudflare Pages `wwwmyprivacytool` (built from `main`) | `indexable` in `src/data/hkSpam.json`; kill switch `VITE_HK_SPAM_ENABLED` (Pages build variable) | `indexable: true`, `IVR_VERIFIED = true`, kill switch on (docs/hk-spam-flags-mpc-7446.md says launched 2026-10-14) |
| Registration insert (anon key, publishable) | Supabase `xmdmkumwxpgahmlweuug`, table `hk_spam_registrations` | none (fails soft if the table is missing) | Migrations in repo; **production presence must be confirmed** (see 3.1) |
| Day-10 "you are now protected" email | Worker `mpt-scan-report`, cron `*/5` slots 01:00-04:00 UTC (09:00 HKT + retries) | `HK_SPAM_ENABLED` (`"true"`), `HK_SPAM_EMAILS_LIVE` (`"false"` = test mode) in `workers/scan-report/wrangler.toml` | Job on, **real sending OFF** |
| Retention purge | pg_cron `mpt-purge-expired-hk-spam` (90 days) | n/a | Live since MPC-7538 (PR #290) |
| Unsubscribe / suppression | `/api/unsubscribe` + `email_suppressions` (hash only) | n/a | Code merged (MPC-7448, PR #289) |

Out of scope: marketing channels and paid spend (Stage 3 / MPC-7624), the paid Spam Shield app (MPC-7647, `HK_SHIELD_ENABLED = false`, stays off).

## 2. Entry gates (all must be true before step 1)

| # | Gate | Owner | Evidence |
|---|---|---|---|
| G1 | Stage 1 (MPC-7539) closed with all AC evidenced, any finding raised as its own task and resolved | Stage 1 tester | Result Summary on MPC-7539 |
| G2 | Chris's explicit go for Stage 2 (written on this task: Approval_Status = Approved) | Chris | Notion |
| G3 | MPC-7545: wording sign-off (page consent text, privacy section, EN + zh day-10 email copy) after MPC-7542 Chinese review | Chris | Notion |
| G4 | Scan go-live MPC-7385 done (precondition for real sends, per the day-10 email doc) | Chris / Claude | MPC-7385 |
| G5 | Legal check items listed in MPC-7538 Result Summary cleared | Chris | MPC-7538 |
| G6 | `main` CI green on the commit being deployed; no open HK PRs | Claude | Actions |

If G3-G5 are not met, steps 1-3 and 5 may still run (they send nothing to real users); **step 4 (real email) must not**.

## 3. Pre-checks (read-only, run first, record results on the task)

1. **Database objects exist in production.** The 2026-10-05 audit and the MPC-7624 note both say `hk_spam_registrations` and the `reminder_sent_at` column were missing. Confirm now (Supabase SQL editor or MCP, read only):
   - tables/objects: `hk_spam_registrations` (with `reminder_sent_at`, `reminder_consent`, `marketing_consent`), `email_suppressions`, view `hk_spam_due_reminders`, cron job `mpt-purge-expired-hk-spam`.
   - If any is missing: Chris applies the four migrations in order (`20261011120000`, `20261011140000`, `20261012120000`, `20261013000000`) via `deploy-supabase.yml` (manual run, dry run first) or the SQL editor. Migration history drift (28 remote vs repo) means `db push` can refuse: use the dry-run output, do not `repair` without Chris. Migrations are additive; undo with a new migration.
2. **RLS/grants:** anon can INSERT only on `hk_spam_registrations` and cannot set `reminder_sent_at` (column-level grant). `supabase/tests/schema.test.sql` covers this in CI; re-confirm on production with a read of `information_schema.role_table_grants`.
3. **Worker secrets present** on `mpt-scan-report` (names only): `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET`; `HK_SPAM_TEST_INBOXES` for the test run. Resend sender `hello@myprivacytool.io` verified.
4. **Flags on the deployed build:** `curl -s https://myprivacytool.io/HongKongSpam` returns 200 without `noindex`; `/sitemap.xml` lists `/HongKongSpam`; `/robots.txt` has no `Disallow: /HongKongSpam`.
5. **Baseline snapshot** (so rollback and Stage 4 have a before/after): row count of `hk_spam_registrations`, the test rows from Stage 1 (listed in the MPC-7539 Result Summary for Chris to remove; do not delete them), latest `hk_spam_reminder_run` log line, last good Pages deployment id, last good `mpt-scan-report` version id (`wrangler deployments list`).
6. **Cookie consent:** Stage 1 found the CMP modal blocking clicks in automation. Confirm it does not block real users on a 360px phone (manual check, EN and zh).

## 4. Sequence

Each step is independently reversible (section 6). Do one at a time, run the check, record it, then continue. Stop at the first failed check.

| Step | Action | Needs approval | Check before moving on |
|---|---|---|---|
| 0 | Run section 3 pre-checks. Post results on the task. | G1, G2 | All pre-checks pass or are explicitly waived by Chris |
| 1 | **Database ready.** Apply any missing migration from 3.1 (Chris only). | Chris | Objects from 3.1 exist; schema tests green |
| 2 | **Site live.** If pre-check 3.4 shows the page is already indexable on `main`, no deploy is needed (record the deployed commit sha). Otherwise set `indexable: true` in `src/data/hkSpam.json` and `VITE_HK_SPAM_ENABLED` unset/true, PR -> CI green -> merge -> check the Pages deploy. | Chris (G3) | Page 200 at `https://myprivacytool.io/HongKongSpam` and `?lang=zh`, full UI rendered at 360px, six IVR keys shown, homepage and scan-result HK cards visible for HK visitors, sitemap + robots correct, `smoke-site.yml` green, GA4 `hk_spam_*` events in DebugView |
| 3 | **Engine live (registration path).** One registration with a test address (`test.stage2@myprivacytool.io`), consent ticked, no phone number. | none beyond G2 | Row appears in `hk_spam_registrations` with the right `protection_date` (10 working days, HK calendar), `reminder_consent`/`marketing_consent` as ticked, **no phone column/value**; list the row for Chris to remove |
| 4 | **Email live (day-10).** (a) Test run: `HK_SPAM_TEST_INBOXES` set, `HK_SPAM_EMAILS_LIVE` stays `"false"`; confirm the `[TEST]` / `【測試】` samples at 09:00 HKT in both languages, unsubscribe link works and writes `email_suppressions`. (b) Only after Chris's go: in `workers/scan-report/wrangler.toml` set `HK_SPAM_EMAILS_LIVE = "true"` (never a dashboard variable, it is overwritten on deploy), PR -> merge -> check `deploy-scan-report.yml`. | Chris (G3, G4) | Next 09:00 HKT `hk_spam_reminder_run` log shows `sent` > 0 only for expected rows, `failed = 0`; one real unsubscribe round trip; `RECIPIENT_ALLOWLIST` handled as in the day-10 doc |
| 5 | **Kill switch proven in production.** Rehearse on a Cloudflare Pages **preview** build with `VITE_HK_SPAM_ENABLED=false` (page redirects to `/`, cards hidden, route out of sitemap and disallowed in robots), then on = restored. Do **not** flip the production variable as a rehearsal; Chris decided kill-switch tests never edit production. The email side switch (`HK_SPAM_ENABLED="false"`) is proven by the test-mode run in step 4a. | none | Preview behaves as described; production untouched |
| 6 | **First organic registrations.** Watch for the first non-test rows over 24-72 h (organic only; no paid or outbound promotion before Stage 3). Hand the count and log lines to Stage 4 (MPC-7543). | none | At least one real row confirmed in the database, or an explicit "none yet" note |
| 7 | **Closeout.** Result Summary with evidence for each success criterion, rows to remove, open findings as new tasks; ask Chris to review. | Chris to mark Done | See section 7 |

Suggested timing (all dates need Chris's confirmation): Stage 1 closes by Thu 2026-10-23; steps 0-3 and 4a on Fri 2026-10-23 or Mon 2026-10-26 so the 09:00 HKT test email can be observed the next morning; 4b and 5-6 by Tue 2026-10-27 (due date). Do not deploy during a Cloudflare zone email-routing change.

## 5. Success criteria mapping (from the task)

| Criterion | Verified by |
|---|---|
| 1. Engine deployed, verified via API endpoint test | Step 3: registration insert through the production Supabase REST endpoint returns 201 and the row exists; pre-check 3.2 grants |
| 2. Pages queryable and live with full UI | Step 2 checks (200, both languages, 360px, cards, sitemap, robots) |
| 3. Email pipeline operational, sending real responses to test submissions | Step 4a (test mode samples to test inboxes in EN + zh). Real sends to registrants only after 4b approval |
| 4. Kill switch functional, tested, no downtime | Step 5 (preview) + 4a; rollback timings in section 6 |
| 5. All Stage 1 findings resolved, sign-off | Gates G1-G5 |
| 6. First organic registrations in the database | Step 6 |

Note on criteria 3 and 4: "real responses" is read as "a real email through the real pipeline to a test inbox", which respects the standing rule of no sends to real users before sign-off. Chris to confirm this reading.

## 6. Rollback (fastest first)

| Layer | Action | Time | Downtime |
|---|---|---|---|
| Email | Set `HK_SPAM_EMAILS_LIVE = "false"` (test mode) or `HK_SPAM_ENABLED = "false"` (job does nothing) in `workers/scan-report/wrangler.toml`, merge; or Actions -> *Rollback Worker* -> `mpt-scan-report`. Rows already claimed and sent stay marked sent; failed sends release their claim. | ~5 min | none |
| Whole feature (UI) | Pages build variable `VITE_HK_SPAM_ENABLED=false` and redeploy: route redirects to `/`, cards hide, sitemap/robots follow. Or Pages -> Deployments -> last good -> Rollback. | ~5-10 min | none (static) |
| SEO only | `indexable: false` in `src/data/hkSpam.json`, merge: noindex, out of sitemap, disallowed. Page still reachable by link. | ~5-10 min | none |
| Registration path | Revoke anon INSERT on `hk_spam_registrations` (new migration, Chris). Page then fails soft; dial flow still works. | ~10 min | none |
| Data | Migrations are additive; undo with a new migration. Delete test rows only by Chris. Retention job purges after 90 days regardless. | n/a | n/a |

Rollback triggers (any one): 5xx or failed registration inserts above a handful, an email sent to a non-consenting or suppressed address, any phone number found stored, a wrong IVR key reported by a real user, `smoke-site.yml` red after a deploy, or Chris says stop.

## 7. Evidence to record on the task at closeout

Deployed commit sha and Pages deployment id; `mpt-scan-report` version id; SQL results for 3.1/3.2; screenshots of the page at 360px in EN and zh; GA4 DebugView capture; the registration test row id; the `[TEST]` emails received (both languages); the `hk_spam_reminder_run` log lines; the preview kill-switch results; the unsubscribe round trip; the count of first organic rows; the list of test rows for Chris to delete.

## 8. Open questions for Chris

1. `main` already has `indexable: true` and `IVR_VERIFIED = true` (launched 2026-10-14 per `docs/hk-spam-flags-mpc-7446.md`), and Stage 1 tested the live page. Does "pages go live" in Stage 2 therefore mean only confirming and announcing what is already deployed, or should the page be pulled back (`indexable: false`) until Stage 2 approval? This spec assumes it stays as is.
2. Confirm the production database objects: the 2026-10-05 audit and MPC-7624 say they are missing; has anyone applied the four HK migrations since?
3. Real day-10 sends: go on 2026-10-27, or hold until after MPC-7385 / MPC-7545?
4. Is the "real responses to test submissions" reading in section 5 right?
5. Who removes the Stage 1 and Stage 2 test rows from production?

## 9. Related

`docs/hk-spam-flags-mpc-7446.md`, `docs/hk-spam-day10-email-mpc-7448.md`, `docs/hk-dnc-ivr-procedure.md`, `docs/INFRASTRUCTURE.md` (deploy and rollback), `docs/SUPABASE-AUDIT.md` (migration drift), `workers/scan-report/README.md`.
