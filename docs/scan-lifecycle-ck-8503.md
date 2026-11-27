# CK-8503: scan request lifecycle through verified delivery

Session: https://claude.ai/code/session_01BHPYccHcoP4fwyCMGm6xz5 · branch `claude/scan-lifecycle-delivery-q5ua2t` (myprivacytool only; the MPT repo was not touched)
Base: `main` at `baf7f50` (re-checked against `58399dc`, no overlap) · written 2026-10-26 08:20 UTC

**Scope of this document: a bounded sprint slice, the web scan-to-report lifecycle. It is not completion of CK-8503.** The other channel criteria are listed as PENDING in section 8 and are not removed.

Evidence levels used throughout: **PREPARED** (written, not run) · **TESTED** (run in this session against stubs, result stated) · **MERGED** · **DEPLOYED** · **VERIFIED LIVE**. At the time of writing nothing here is MERGED, DEPLOYED or VERIFIED LIVE.

---

## 1. Eligibility and prerequisite

| Item | Finding (read 2026-10-26) |
|---|---|
| CK-8503 row | Status `Not started`, Status_Readiness `Ready`, Write Lock `NO`, Assigned Actor `ClaudeKing`, Surface `claude-code`, due 2026-11-03. Amendments empty. `Next_Steps`: "Map existing scan paths and inbound handoff contract; prepare mocks and lifecycle tests now." |
| Inbound prerequisite | `Blocked_By` is **CK-8502** (https://app.notion.com/p/40428547eaa78169b8cff601356ce8dc), "Capture supported channel interactions into attributed leads". Its row is `Not started`, Result Summary empty, no output link, no accepted contract or evidence. |
| Consequence | The channel to request handoff contract is **not accepted**. Anything that depends on it (a channel adapter creating a scan request, correlation IDs carried from a channel event) stays gated. This session did only what the row permits: mapping, mocks, lifecycle tests, a docs-level contract. |
| Not bypassed | MPC-7385 (closed, go-live preconditions), MPC-7902 (WhatsApp proof-of-possession, hard go-live gate), MPC-7904/7905/7906 (consent/STOP, replay/spend, kill switches) are untouched. No flag, secret or channel was changed. |

## 2. Active work checked (no duplication, no file takeover)

Checked 2026-10-26 ~08:00 UTC. Sessions and branches are other sessions' work: read only, nothing messaged, nothing edited.

| Owner | State | Files that could overlap | Action here |
|---|---|---|---|
| MPC-7535 delivery verification (session_01UiVy6F…, requires action) | Posted a verification note to its Notion page. No code, no new PR. #292 merged earlier. | `src/pages/Scan.tsx`, `scanReport` client, `scan-gap.js` | Not touched. Its "provider acceptance is not inbox receipt" finding is the same as G4 below. |
| MPC-7557 nightly scan-to-report tests | Idle, stopped: dependency not cleared. Branch identical to `main`. No code. | would add CI/runner files | Not touched. `lifecycle.test.mjs` uses the same stub style it proposed (offline, CI-only). |
| MPC-7471-F1/F2/F3/F4 popup, counts, pipeline, score | Running, no pushed code seen. | front end popup/score | Not touched. This work changes nothing in `src/`. |
| MPC-8528/8529 support cases and watchdogs | #532 docs-only prep (draft), #533 HELP entry (merged into main as 58399dc). | support/HELP | Not touched. |
| MPC-8538 e2e/drift | #531 merged. Nightly live drift `e2e-live-drift.yml`, GET-only guard. | e2e, workflows | Not touched. No second nightly schedule created. |
| MPC-7891 Telegram baseline scan | #535 draft, test accounts, default off, not applied. | `social-listeners` | Not touched. |
| MPC-8536 router continuation | idle | not inspected | Not touched. |

Other open draft PRs in myprivacytool at the time: #450, #532, #534, #535, #536. A file-list diff of their branches against `main` shows none touches `workers/scan-report/`.

## 3. Existing path / state / owner matrix

Everything below already exists. **No new queue, request ledger or scheduler was added.**

| Stage | Where it lives today | Persisted state | Owner / history |
|---|---|---|---|
| Entry (web) | `POST /api/scan` in `workers/scan-report/index.js` (`/scan` page). Email only. Origin check, 5/min per IP limiter, Turnstile (enforcing since 2026-10-23), body caps. | `users`, `leads` (consent evidence), `scans` row (`report_status='pending'`) | MPC-6677 (pipeline), MPC-7350 (hardening), MPC-8430 (Turnstile) |
| Consent | `consent === true` required, never defaulted. Scan-save has its own consent (`save_consent`, versioned) | `users.consent_*`, `web_scan_contacts.save_consent_*` | MPC-7470 / D12 |
| Dedupe | One scan per address per 24h (check then insert) | `scans` | MPC-6677 |
| Queue | The `scans` table is the queue. Cron `*/5`, 5 scans per run, oldest first, atomic claim by `report_status` | `report_status` pending / processing / sent / failed, `report_attempts` (max 5), `report_claimed_at`, `report_last_error` | MPC-6677, MPC-7406 (held scans, stale reset) |
| Recovery | Stale claim (30 min) back to pending, or failed after 5 attempts. Held (allowlist, HIBP down) leaves the row untouched | same columns | MPC-7406, MPC-7616 (retry-safe rewrite) |
| Scan | HIBP, brokers (always "not checked"), email hexagons, score | `signals`, `hexagon_scores` | MPC-6677, MPC-7467, MPC-7487 |
| Report | Two-part email + JSON attachment | `scans.mirror_report`, `privacy_score`, `report_sent_at` | MPC-7468, MPC-7261 |
| Delivery | Resend API, `Idempotency-Key: report-<scan id>`; confirmation `confirm-<scan id>` | `scans.resend_message_id`, `confirmation_sent_at` | MPC-6677 |
| Recipient gate | `RECIPIENT_ALLOWLIST` (production value: empty, i.e. open) | none | MPC-7385 go-live |
| Live results | Stream token (15 min, redacted) and email-link token (7 days, inbox proof, detail) | none (HMAC, nothing stored) | MPC-8452 |
| Cancellation | Unsubscribe (POST, signed). Report job cancels scans unsubscribed since the request | `users.email_opt_out_at`, `email_suppressions`, `scans.report_last_error='cancelled: …'` | MPC-7491, MPC-7385-F1 (#200) |
| Deletion / retention | `web-scan-admin.mjs`, `mpt_dsar_erase/export`, pg_cron purge | `web_scan_deletion_log` (counts) | MPC-7488, MPC-7470 |
| Alerts | pg_cron `mpt-scan-report-alert` (pending > 15 min, failures, no confirmation), daily scan-gap collector, 48h log ALERT | none | MPC-8406, MPC-7535 |
| WhatsApp deep dive / RESULTS | `workers/webhook-receiver/deepDive.ts`: start (server secret + proof of possession), web confirm, `finalize`, `RESULTS`/`STATUS` pull reply | `mpt_conversation_state` (24h hard life), `mpt_hexagon_interactions`, `mpt_user_engagement` | MPC-8309, MPC-8320, MPC-7902 gate |
| Channel intent routing | `workers/core-brain` (intent, `new → awaiting_confirmation → confirmed/declined`, localized message keys); `social-listeners` forwards X / Telegram / LinkedIn after signature check | `conversation_states`, `interaction_log` | MPC-7640, MPC-8301, MPC-8601 |
| Legacy channel handlers | `webhook-receiver` `/webhook/telegram|messenger|instagram|whatsapp|sms|email`: first hexagon, Y/N | `mpt_conversation_state` | MPC-7350 (auth) |

Stable ID: **`scans.id` (uuid)** is already the request/correlation ID. It is the Resend idempotency suffix, the live-token subject and `web_scan_contacts.contact_id`. It is deliberately not the scan number (that is the visitor's deletion handle).

## 4. The lifecycle, and what each word means

Derived **only** from persisted columns by `requestLifecycle(row)` in `workers/scan-report/lib/lifecycle.js`. It is read-only and not wired into any runtime path (no behaviour change, not a second ledger). An LLM's or a page's wording is not an input.

| State | Persisted condition | Delivery | What may be said to the person |
|---|---|---|---|
| queued | `pending`, no failed try (includes "held" by the allowlist or HIBP) | not_sent | "We have your request." The request is acknowledged only after the `scans` insert, so **received = queued** on the web path. |
| recovering | `pending`, `report_attempts > 0`, error on the row | not_sent | "It can take a little longer." No claim of progress beyond that. |
| running | `processing` | not_sent | Nothing more than the above. |
| completed | `sent`, `resend_message_id` stored, no provider receipt (yet) | **provider_accepted** | "We've sent your report." Not "delivered". |
| delivered | `sent` and `delivery_status` = `delivered` (or `complained`, which implies arrival), set by the signed Resend webhook | **delivered** | "Your report was delivered" is allowed only here. |
| delivery_failed | `sent` and `delivery_status` = `bounced` or `failed` | **undeliverable** | The person did NOT get the report; an operator must look (no automatic resend to a bounced address). |
| failed | `failed` (5 tries used, or stuck) | not_sent | An operator must act (section 7). |
| cancelled | `failed` with `cancelled: …` (unsubscribed) | not_sent | Nothing is sent. |

Distinctions the code now respects: accepted request ≠ completed scan ≠ generated report ≠ pending delivery ≠ provider acceptance ≠ provider delivery receipt ≠ owner-seen inbox receipt. **`delivered` needs a receipt.** Since part 2 (section 12) the Worker can record Resend's signed delivered / bounced / complained events (`POST /api/resend-webhook`), but that endpoint is **off (404) until `RESEND_WEBHOOK_SECRET` is set**. Without it a row stays `completed` for ever and `receipt` reads `not_observed`, which means "no receipt seen", not "not delivered". Clarification/verification-needed is not a web state: the only target is the email address, and the report goes only to that address; inbox ownership is proved by the emailed link, and only for the live detail.

## 5. Gaps found, owner, smallest change, status

| ID | Gap | Evidence | Owner | Change | Status |
|---|---|---|---|---|---|
| G1 | Unsubscribing **while** a scan is running (after the queue read, before the send) still got the report; the unsubscribe page promises no more report emails. | Test failed before the fix (`withdrawn consent: unsubscribing while the scan is running…`). | scan-report (MPC-7491 / MPC-7385-F1 lineage; no active owner) | One extra read of `users.email_opt_out_at` right before the send; cancel with the existing `cancelled: unsubscribed before the report was sent` reason. 4 lines in `index.js`. | **Fixed. TESTED.** Mutation check: removing it fails that test. |
| G2 | No STOP / consent-withdrawal / deletion on messaging channels; the WhatsApp path has no STOP handler. | Searched `webhook-receiver`, `core-brain`, `social-listeners`. | MPC-7904 (consent/STOP/DELETE), MPC-7905, MPC-7906 | none here | **PENDING (owner exists).** |
| G3 | After 5 failed tries a scan is `failed` and is never retried, even when the fault clears. That is deliberate (bounded recovery) but needs a documented operator step. | Test `generation failure: … stays failed`. | scan-report / ops | Runbook step in section 7. No code. | **Documented.** |
| G4 | **No delivery receipt.** `sent` only meant the provider accepted the email. | No Resend webhook existed. | scan-report | Built in part 2: signed webhook `POST /api/resend-webhook` (Svix signature, 5-minute replay window, 64 KB cap, off without a secret), `scans.delivery_status` set by `mpt_record_email_receipt()` (ranked in SQL, never moves backwards), lifecycle states `delivered` / `delivery_failed`. | **BUILT, MERGED when this PR merges, INACTIVE.** Needs the Resend webhook created and its signing secret stored as GitHub secret `SCAN_REPORT_RESEND_WEBHOOK_SECRET` (section 12). Until then no copy may say "delivered" for email. |
| G5 | Truly simultaneous requests for one address all passed the 24h check (check-then-insert, no database constraint). | Barrier test: 3 scans, 3 confirmations; on real Postgres without the lock, 8 parallel sessions created 2 scans. | scan-report | Built in part 2: `public.mpt_request_scan()` takes a per-user advisory lock, then checks and inserts in one transaction. The Worker calls it and falls back to the old path only while the function does not exist (404). | **FIXED once the migration is applied.** Proven on real Postgres: 8 parallel sessions create exactly 1 scan. Until the migration runs, the old behaviour (bounded, low exposure) remains. |
| G6 | Legacy `webhook-receiver` Y/N handler replies "Your full Privacy Report is being prepared. You'll receive it here within 60 seconds." No code anywhere creates a report job from that stage (searched). The promise has nothing behind it. | `handleConfirmation`, `workers/webhook-receiver/index.js:363-373`. The newer core-brain copy ("You run the scan in your browser") is truthful. | webhook-receiver channel owners, under MPC-7385 / MPC-7902 gates | Replace the copy or route to the web flow. **Not changed** (not my component, channels not live-verified). | **ROUTED. OPEN.** |
| G7 | Channel sends did not check the provider response: `sendWhatsApp`, `sendTelegram`, `sendMessenger` ignored `res.ok`, so a refused send looked like a sent one. | `workers/webhook-receiver/index.js`. | MPC-8309 (RESULTS), MPC-7902-7906 | Built in part 2: `send.js` records channel + HTTP status only (never the URL, token or message) and returns `{ok,status}`. Behaviour otherwise unchanged. | **FIXED (visibility only).** A provider "ok" still only means accepted; WhatsApp/Telegram delivery receipts are not handled. |
| G8 | No correlation between a channel event and the `scans` row. Today a channel hands the person to the browser; there is no machine link. | core-brain keys, `/api/scan` body | **CK-8502** (the inbound contract) | Define the handoff to carry/produce `scans.id`. Waiting on CK-8502. | **BLOCKED on prerequisite.** |

## 6. Tests: expected versus actual

Command: `node workers/scan-report/lifecycle.test.mjs` (also in `npm run test:workers:node`, which CI runs).

Safety: before any test runs the file asserts that a request to the production Supabase host is **refused inside the process** and that the Worker env points at a `.invalid` host. Fetch is replaced by a sandbox that throws on any host not in a list of stubs (Resend, HubSpot, HIBP, DNS/profile lookups, the test database). The real application code runs; only the outside world is stubbed.

| Scenario | Expected | Actual |
|---|---|---|
| Contract mapping, no row reads "delivered", sent-without-id is `unknown` | as stated | PASS (3) |
| Journey: accept, consent record, durable rows, one confirmation, running seen from inside the scan, completed/provider_accepted, one report, replay sends nothing | | PASS (9) |
| Duplicate within 24h and after report | no second scan or email | PASS (2) |
| Three simultaneous requests (read barrier) | ideal 1 scan | **3 scans, 3 confirmations (G5, documented, asserted as current behaviour)**; each scan 1 report (PASS) |
| Worker killed after claim | row running; younger claim not stolen; stale after 30 min completes once | PASS (3) |
| Worker killed after provider accepted, before the write | retry reuses the same idempotency key; provider holds 1 report; row records the first message id | PASS (3) |
| Breach lookup down / recovers | held, no attempt burned, no report; then completes once | PASS (2) |
| Report-generation failure x5 | each try recorded, no report; 5th is `failed`; not retried after the fault clears | PASS (7) |
| Delivery failure after scan success | saved, state recovering (never "sent"); retry sends once, no doubled signals | PASS (2) |
| Timeout after provider acceptance | recovering; retry returns the original message; one email | PASS (2) |
| Withdrawn consent before the report; while the scan runs | cancelled, nothing sent | PASS (1) / **FAIL before G1 fix, PASS after** |
| Expired handoff | stream token 401 at 16 min; emailed link 401 at 8 days | PASS (2) |
| Unsupported/ambiguous target (handle, phone, profile URL, free text, two addresses, double @, empty), missing/non-boolean consent | 400, nothing stored or sent | PASS (2) |
| Wrong-user access | A's tokens never return B's data; B's own link does; swapped id refused; stream token has no detail; each person gets only their own two emails | PASS (5) |
| Recipient gate | unlisted address stored and held, nothing sent, no attempt burned | PASS (1) |

Totals this session: `lifecycle.test.mjs` 48 PASS / 0 FAIL. Existing suites unchanged: `worker.test.mjs` 225 (identical to before the refactor, compared line by line), `live` 55, `turnstile` 17, `report-email` 50, `hk-spam` 58, `recognise` 44, `email-hexagons` 70, `referral` 68, all 0 FAIL. `npm run test:workers:node` exit 0. Vitest `workers/webhook-receiver workers/core-brain workers/social-listeners`: 269 passed. eslint on the changed files: clean. Mutation checks: reverting G1 fails 1 test; making the report idempotency key unique per attempt fails 4 tests.

Not tested (stated, not hidden): the real database (RLS, constraints, cascade on deletion; the existing `supabase/tests/run.sh` covers web-scan deletion and purge, and was not re-run), real Resend/HIBP behaviour, Cloudflare cron timing, the browser UI, any channel send.

Refactor note: the stub backend inside `worker.test.mjs` moved unchanged to `test-support/fake-backend.mjs` so the new file could reuse it. Added there: a scan_id filter on reads (as PostgREST does), a provider-side idempotency map, an `onRequest` fault hook. All off by default; the old suite's output is identical.

## 7. Operator runbook (authorised live owner test, failure, rollback)

**Nothing below has been run.** Every step needs the named authority.

### 7.1 Before anything
- Approved test identity: a mailbox the owner controls. MPC-7471 designates the `testingnt69` plus-address aliases; **reconfirm with Chris** (the MPC-7535 and MPC-7557 sessions both record that approval of a named address for a live submission is not yet on file).
- Approval for: one submission through the production `/scan` page, the stored rows, and the two emails (confirmation, report).
- Production reality to know first: `RECIPIENT_ALLOWLIST = ""` in `workers/scan-report/wrangler.toml` (open to everyone), Turnstile `ENFORCE = "true"`, referrals/recognition/scan-saving switches on. The test therefore sends from the real, open pipeline.
- **Merging any change under `workers/scan-report/**` auto-deploys the production Worker** (`deploy-scan-report.yml`). Merging this PR is a production action needing release authority. It is a draft.

### 7.2 Steps and what you should see
| # | Action | Expected state (`requestLifecycle`) | Receipt evidence |
|---|---|---|---|
| 1 | Open `https://myprivacytool.io/scan`, run the scan, enter the approved address, tick consent (and the save box only if testing saving). Submit. | page shows the thank-you with a live view; `queued / not_sent` | DevTools Network: `POST /api/scan` is 200 |
| 2 | Within seconds | `queued`; `confirmation_sent_at` set | Resend dashboard: message for key `confirm-<scan id>` shows accepted; owner sees the "Your privacy scan is starting" email |
| 3 | Next 5-minute tick (about 4 minutes) | `running` briefly, then `completed / provider_accepted` | `report_sent_at`, `resend_message_id` on the row; Resend dashboard status for that message id (Delivered/Bounced if the account shows it); **owner confirms inbox receipt**, and that is the only true receipt |
| 4 | Submit the same address again | `duplicate: true`, no new scan, no new email | row count unchanged |
| 5 | Optional: unsubscribe from the report email link, then submit a different approved address and unsubscribe before the 5-minute tick | `cancelled`, nothing sent | row `report_last_error` starts `cancelled:` |

Read-only check (operator with database access; counts and one row, no other users):
```sql
select report_status, report_attempts, report_last_error, confirmation_sent_at, report_sent_at, resend_message_id is not null as provider_id
from public.scans where id = '<scan id>';
```
Record in the task: scan id (not the address), timestamps, the Resend message id, "owner saw it in inbox: yes/no".

### 7.3 Failure and disable
- **Stop all report sends without losing requests:** set `RECIPIENT_ALLOWLIST` to the test address only (scans for others are stored and held, no attempt burned, per MPC-7406). Because it is a `wrangler.toml` var, that is a PR plus merge (production action). A dashboard edit is overwritten by the next deploy.
- **Stop new requests at the site:** set `VITE_SCAN_API_URL` as documented in the scan-report README (Pages project `wwwmyprivacytool`, owner action; a blank value is treated as "use the default" since MPC-7535, so use the documented off switch, not an empty string).
- **A scan is `failed`** (5 tries): the alert fires. First check the provider did not already accept it: Resend dashboard, key `report-<scan id>` (keys are honoured for 24h, so a re-send inside 24h is deduplicated by Resend; after 24h it is not, so check). If nothing was accepted, an operator with authority may reset it once:
  ```sql
  update public.scans set report_status='pending', report_attempts=0, report_last_error=null, report_claimed_at=null
  where id = '<scan id>' and report_status='failed' and report_last_error not like 'cancelled:%';
  ```
  Never reset a `cancelled:` row: that person unsubscribed.

### 7.4 Rollback
- **Rollback owner:** the release owner, Chris, to be confirmed in the task (this document does not assign a person).
- **Method:** revert this PR on `main`. The revert deploys automatically (production action). The only behaviour changed by this PR is G1 (one extra read before sending, plus a cancel branch). No migration, no secret, no flag.
- Cost of the change: one more PostgREST read per processed scan (at most 5 per run).

## 8. Channel coverage (nothing activated, nothing added)

| Adapter | Lifecycle integration today | Synthetic test evidence | Missing prerequisites | Live state | Owner |
|---|---|---|---|---|---|
| Web `/scan` to email report | Full: queue, states, recovery, cancel, retention | **48 lifecycle + 225 worker tests, TESTED** | G4 receipt, G5 race (open, bounded) | Pipeline is live and open per config. A live pass on 2026-10-23 is recorded by MPC-7616 and quoted by the MPC-7535 session; **not independently verified here**. Fresh live owner test: PENDING (7.2). | scan-report, MPC-7535 |
| WhatsApp deep dive / RESULTS | Own 24h state (`mpt_conversation_state`); pull reply; no link to `scans` | `deepDive.vitest.ts` 10 tests incl. PoP, expired, own-scan-only, TESTED (pre-existing, not re-authored) | MPC-7902 hard gate, STOP/DELETE (7904), replay/spend (7905), kill switches (7906), credentials/number, G7 | Not verified live. MPC-8495 records that it still needs account, number and credentials | MPC-8309 / 7902-7906 |
| Telegram | core-brain intent + state; honest browser hand-off; baseline scan #535 draft | core-brain 46, social-listeners tests, TESTED (pre-existing) | consent/STOP, #535 unmerged, legacy handler G6 | Not verified live | MPC-7891, MPC-8301 |
| X DM | intent + state through social-listeners | x-webhook/x-probe tests (pre-existing) | CK-8502 contract | Not verified live | MPC-8301 |
| LinkedIn | intent only; payload shape is an assumption in the code comment, partner-gated | core-brain routing/parsing tests (pre-existing) | partner approval | Not verified live | MPC-7640 |
| Messenger / Instagram / SMS / inbound email | legacy first-hexagon + Y/N only; Instagram is a stub; copy G6 | none for lifecycle | Meta/Twilio/Postmark approvals | Not live | webhook-receiver owners |

**Pending, not satisfied, not removed:** synthetic end-to-end traces and exact live steps for every supported adapter other than web.

## 9. User-copy review package (for Chris; wording unchanged by this work)

| Surface | Text | Verdict |
|---|---|---|
| Confirmation email | "Your report usually arrives within a few minutes. If a check has to be retried, it can take a little longer." | Truthful: states usual time and retry. Never says "delivered". |
| Confirmation preheader | "Your report is on its way…" | Acceptable for provider acceptance of the confirmation; keep. |
| Live view | Redacted status for an unverified visitor; detail only through the emailed link | Truthful and low sensitivity (MPC-8452). |
| core-brain `bot.confirmed_y.*` | "You run the scan in your browser… When it's done, give your email and we'll send you your report." | Truthful: routes to the user-operated web flow. |
| Legacy handler (G6) | "Your full Privacy Report is being prepared. You'll receive it here within 60 seconds." | **Untruthful**: no job exists. Do not enable those routes with this text. |
| WhatsApp RESULTS | "Your MPT Deep Dive is complete… Tap here for your secure dashboard" / "still processing" / "link expired" | States are read from stored state, not narrative. Send success unchecked (G7). |

Rule going forward: use "sent" or "on its way" for provider acceptance; "delivered" only for a row whose state is `delivered` (a provider receipt exists, G4).

## 10. Sprint slice versus full-task acceptance

| CK-8503 acceptance criterion | Web slice | Full task |
|---|---|---|
| 1. Inspect paths, supported scan types, handoff paths; no promise of unsupported scans | Mapped; unsupported targets refused honestly (TESTED) | PARTIAL: channel handoff contract waits on CK-8502 |
| 2. States, IDs, truthful acknowledgments from receipts | Defined and TESTED | PENDING for channels (G6, G7) |
| 3. Ownership/PoP, consent, authorised recipient, minimal disclosure, expiring handoff, channel reply rules | TESTED for web (email-only target, report to that address only, tokens expire, stream token redacted, consent never defaulted) | PARTIAL: WhatsApp PoP exists but its gate (MPC-7902) is open |
| 4. Only missing queue/recovery/limits/dedupe/STOP/deletion; tests for duplicates, restart, failures, withdrawn consent, expired link, unsupported target | Done for web; G1 fixed; G5 open | PENDING: STOP/deletion on channels (MPC-7904) |
| 5. Synthetic traces for every supported adapter; exact live owner steps | Web trace and live steps PREPARED | PENDING for other adapters |

**CK-8503 is not complete and must not be marked Done.** Status was not changed in Notion.

## 11. Remaining release gates (exact, updated after part 2)
1. CK-8502 accepted (inbound contract) before any channel-to-request linkage. Not started.
2. Activate delivery receipts: create the Resend webhook (URL and events in section 12) and store its signing secret as GitHub secret `SCAN_REPORT_RESEND_WEBHOOK_SECRET`; the next deploy syncs it. Needs the Resend dashboard and repository secret settings.
3. G6: replace the legacy "within 60 seconds" text. It is a visitor-facing copy change, so the PR template requires the swarm run and real-people check first.
4. MPC-7902, 7904, 7905, 7906 remain hard gates for WhatsApp; STOP / consent / deletion on channels (G2) belongs to MPC-7904.
5. Channel adapters other than web stay PENDING.

Signed: Claude (Anthropic), Claude Code session for CK-8503, 2026-10-26 (part 2 appended below).

## 12. Part 2 (2026-10-26): G4 receipts, G5 atomic dedupe, G7 send visibility

What was added, all additive, all tested before merge:

| Change | Where | Active when |
|---|---|---|
| Atomic one-scan-per-24h | migration `20261026220000_ck_8503_scan_receipts_and_dedupe.sql` (`mpt_request_scan`), `index.js` `requestScan` | when the migration is applied (the Worker falls back until then) |
| Delivery receipts | same migration (`scans.delivery_status`, `mpt_record_email_receipt`), `lib/receipts.js`, route `POST /api/resend-webhook`, lifecycle states `delivered` / `delivery_failed` | only when `RESEND_WEBHOOK_SECRET` is set |
| Send visibility | `workers/webhook-receiver/send.js` | on deploy (logging only) |
| Deploy workflow | `deploy-scan-report.yml` runs the lifecycle test before deploy and syncs the optional receipt secret | on deploy |

**Activating receipts (the only part that needs an outside system):** (1) in the Resend dashboard create a webhook to `https://mpt-scan-report.myprivacytool.workers.dev/api/resend-webhook` for `email.sent`, `email.delivery_delayed`, `email.delivered`, `email.bounced`, `email.failed`, `email.complained`; (2) store the signing secret (`whsec_…`) as GitHub repository secret `SCAN_REPORT_RESEND_WEBHOOK_SECRET`; (3) re-run the "Deploy scan-report Worker" workflow (the secret-sync step sets it, nothing is printed). Rollback: delete the webhook in Resend or remove the Worker secret; the endpoint goes back to 404 and rows simply stop receiving receipts. Resend retries for events it could not deliver.

**Interplay with MPC-7471-F3 (`request_id`):** `mpt_request_scan` also takes the optional `request_id` and returns the existing scan's, so F3's rule is unchanged: a retry carrying the same `request_id` gets the original outcome (replay), anyone else just learns "duplicate". Simultaneous copies of one request collapse into one scan plus replays; simultaneous different requests still make exactly one scan (tested in JS and on real Postgres with 8 parallel sessions and 8 different ids). The function reads `request_id` through `to_jsonb()` and writes it by dynamic SQL only when supplied, so it works even before F3's migration is applied; the previous check-then-insert path remains as the fallback while the function is missing.

**Tests:** `lifecycle.test.mjs` 71 checks (was 48): adds receipts (signature, replay window, size cap, off by default, unknown message id, late/duplicate events, complaint, bounce is not overwritten, migration-missing 500), the fixed race (3 simultaneous requests -> 1 scan, 1 confirmation) and the rollout fallback. `supabase/tests/run.sh` on real Postgres 16: permissions, ranking, 24h window and **8 parallel sessions -> exactly 1 scan** (removing the advisory lock makes it create 2, so the test can fail). Mutation checks on the Worker: signature check forced true, replay window removed, endpoint on without a secret: each fails tests. `send.vitest.mjs` 3 tests: status-only logging, no URL/token/message in logs. All existing scan-report suites unchanged (worker 225, referral 68 after a one-line test fix so its fake answers 404 for unknown RPCs like PostgREST).

**Not done, and why:** the channel adapters other than web (CK-8502 not started; hard gates MPC-7902/7904/7905/7906); G6 copy (needs the copy review process); the Resend webhook registration (outside this repository).
