# MPC-8529 — Support follow-up watchdog, outage fallback and journey tests

**Status: design (merged in #532) plus a PROVISIONAL, isolated-tested build (section 9).** Nothing is installed in production, scheduled or verified live.
MPC-8529 is **not claimed**. Two of its three prerequisites have no delivered outputs as of 2026-10-26 (see §1), so
acceptance stays open. This file is a separately bounded, docs-only preparation: no code, no migrations,
no schedules, no live messages, no new infrastructure, no spend.

## 1. Prerequisite evidence (checked 2026-10-26; MPC-8527 row re-checked after main moved)

| Prerequisite | Needed output | Found |
|---|---|---|
| MPC-8530 policy pack | Evidence matrix, runbooks, action/cost/retry policy, approvals | None (Result Summary empty, Not started) |
| MPC-8528 AI backend | Durable case model, delivery receipts, tool gateway PR | None (no PR, no code, Needs_Info) |
| MPC-8527 HELP shell | Shared HELP component and route tests PR | **Delivered to main** as #533 (`HelpButton.tsx`, `HelpButton.test.tsx`; source + isolated tests only, `AI_SUPPORT_AVAILABLE = false`, deployed behaviour not verified, task not Done) |

Everything below that depends on those outputs is marked **[BLOCKED-ON]** and must be re-validated against
the real contracts before any implementation.

## 2. Existing system to reuse (inspected, not modified)

| Need | Existing mechanism | Evidence |
|---|---|---|
| E2E harness | Playwright, desktop + Pixel 7 projects, vite preview, hermetic network mocks | `playwright.config.ts`, `e2e/fixtures.ts` (`net` auto fixture aborts any non-localhost request) |
| CI | `.github/workflows/ci.yml`; test layers and run commands | `docs/ci-cd-testing.md` |
| Standing health probe | Live smoke test, every 6 h + on push, read-only | `.github/workflows/smoke-site.yml`, `scripts/ci/smoke-test.mjs` |
| Scheduling in the DB | `pg_cron`, idempotent unschedule/schedule by job name, skipped where pg_cron is absent | `supabase/migrations/20261019160000_mpt_conversation_state_pg_cron.sql` |
| Why not Worker cron | Cloudflare account is at the Workers Free limit of 5 cron triggers (error 10072) | same migration header |
| DB integration tests | Throwaway Postgres 16, refuses `*.supabase.co` | `supabase/tests/`, `npm run test:db` |
| Contact paths | `privacy@` via mailto (Contact.tsx); FAQ names `support@` — **inconsistent, owned by MPC-8528/8530** | `src/pages/Contact.tsx:21`, `src/pages/Faq.tsx:52` |
| Routes | 40 `<Route path=…>` entries (including the `*` NotFound and 5 redirects; counted by grep, to be generated from the router in tests) | `src/App.tsx:56-107` |

Not found in the repo: any support-case table, support scheduler, delivery-receipt store, status page or
metrics dashboard for support. The reuse rule therefore means: schedule through pg_cron, test through the
existing Playwright/Vitest/pg harnesses, probe through the existing smoke workflow. No new queue or dashboard.

## 3. Proposed follow-up design **[BLOCKED-ON MPC-8528 case schema]**

Columns expected on the case record (names provisional; map to the real schema):
`state`, `next_action_at`, `next_action_kind`, `next_update_due_at`, `attempt_count`, `last_attempt_at`,
`lock_owner`, `lock_expires_at`, `idempotency_key` per outbound action, `reopened_count`.

States (follow-up scope only): `open` → `waiting_customer` | `waiting_system` | `update_scheduled` →
`resolution_proposed` → `resolved_verified`; side states `unresolved_exhausted`, `delivery_failed`,
`engineering_handoff`, `reopened`. There is no `closed_by_silence`: silence moves a case to
`waiting_customer`, never to resolved.

Rules:
1. An update is promised to a customer only after `next_update_due_at` is persisted and the row is committed.
2. "Sent" ≠ "delivered": an attempt records `attempted`; only a provider receipt or confirmed read sets `delivered`.
3. Claim work with `FOR UPDATE SKIP LOCKED` plus a lease (`lock_expires_at`); expired leases are reclaimable.
4. Every outbound action carries an idempotency key `(case_id, action_kind, sequence)`; a retry reuses it.
5. Backoff is bounded (proposal: 3 attempts at 15 min / 1 h / 6 h, then `unresolved_exhausted`). **Numbers are a proposal needing MPC-8530 approval.**
6. Resolution requires an outcome check (re-run the permitted read-only diagnostic) — not the customer's silence or the tool's "ok".
7. A reply on a resolved case sets `reopened`, resets attempts, keeps history.
8. Defect handoff: sanitised, no PII/tokens, routed to the existing engineering workflow (Notion task / GitHub issue by an authorised path). Never an automatic production fix. Never a default founder message.
9. Exhaustion is shown honestly to the customer ("we could not complete this automatically; here is the reference and what to try") — no invented human reply.

## 4. Proposed schedule (NOT activated; needs approval)

Primary: one `pg_cron` job (name `mpt-support-watchdog`, every 5 min), calling one SQL/RPC entry point that
claims due cases and enqueues actions — same pattern and idempotent registration as
`mpt-purge-conversation-state`. Worker cron triggers are unavailable (limit of 5).

Independent dead-man check: a GitHub Actions `schedule` job (extend `smoke-site.yml`, no new workflow) that
reads a sanitised heartbeat/overdue count and fails when the watchdog last-run is older than N minutes.
This detects "scheduler/worker stopped" from outside the Supabase failure domain.

**Run command (proposed, once implemented):** `npm run test:support` (unit + db) and
`npm run test:e2e -- e2e/support-*.spec.ts` (journey). Not yet existing.

**Rollback / disable:** `select cron.unschedule('mpt-support-watchdog');` stops processing; cases stay
durable and visible as overdue. Revert the PR for code. No data migration to undo in the disable path.

## 5. Failure boundaries and honest fallback

| Boundary | What the customer sees | Intake preserved? | Independent of the failed dep? |
|---|---|---|---|
| Website down | Needs a fallback outside the site's host | Only if the fallback has its own capture | Today: **no known independent fallback**. Site is on Cloudflare Pages; a static status/help page on a different provider (e.g. GitHub Pages) would be independent of Cloudflare **only if** it also uses a different DNS path. Proposal, needs approval. |
| AI unavailable | FAQ-only help plus "AI assistant unavailable" and a durable intake form | Yes, if the case store is up | Shares the site and DB; independent of the AI provider only |
| Support backend / DB down | Truthful "we could not save this; retry later / use the mailbox shown" | **No** — must never say saved | Mail fallback shares neither, but is a human mailbox and must not be described as staffed or SLA-bound |
| Email/messaging transport down | Case stays `delivery_failed`, retried with backoff, shown as unconfirmed | Yes | Shares the DB, not the transport |
| Scheduler/worker stopped | Cases accumulate as overdue; external dead-man check alerts | Yes | External check is independent of Supabase |

A fallback that shares the failed dependency is described as degraded mode, not as independent.

## 6. Acceptance test plan (mapped to the brief; all **[BLOCKED-ON]** for the real components)

Isolation: synthetic users (`*@example.invalid`), a throwaway Postgres 16, `net` fixture aborting external
traffic, an assertion at suite start that no configured URL matches `*.supabase.co` or a production host.

1. Main journey: missing report → HELP → FAQ/AI → permitted diagnosis → case reference → promised follow-up → verified outcome → reopen.
2. HELP on every route pattern from `src/App.tsx` (generated from the router list so new routes fail the test), incl. redirects, 404, `:slug` deep links; desktop + mobile; keyboard; cookie banner/dialog interaction; scan/form state preserved; no token/email in URL.
3. Policy: broken login, wrong-user access, disputed finding, billing/rights boundary.
4. Reliability: duplicate intake, retries, two concurrent workers, timeout after a successful action (no double action), stale jobs, missed deadlines, exhausted retries.
5. Adversarial/cost: unknown knowledge, prompt injection, AI/tool/DB/transport failure, rate/cost cap exhaustion.
6. Negative assertions: no default founder escalation, no "saved" message without a committed row, no `closed_by_silence`.

Channel-specific adapters (Telegram, WhatsApp, SMS, email) belong to MPC-8532. This task shares the contracts
and fixtures and does not claim any channel works.

Receipts: timestamped, versioned JSON with expected vs actual, labelled `mocked` / `integration` /
`real-channel`. Real-channel runs need approved recipients.

## 7. Metrics (definitions)

- **Time to first response**: `first_response_delivered_at − created_at` (delivered, not attempted).
- **Case age**: `now − created_at` for non-resolved cases.
- **Overdue action**: `next_action_at < now − grace` and not locked.
- **Unresolved**: state in `waiting_*`, `unresolved_exhausted`, `delivery_failed`.
- **Reopen rate**: reopened cases ÷ `resolved_verified` in window.
- **Delivery failure / retry exhaustion**: counts by transport.
Aggregate counts only in shared logs and artifacts; no email, token or free text.

## 8. Open decisions and gates

1. Real case schema and delivery-receipt contract (MPC-8528). 2. Approved retry, backoff and cost numbers
(MPC-8530). 3. Whether an independent static fallback host is approved (new infrastructure). 4. `support@` vs
`privacy@` routing. 5. Approval to activate any schedule, merge/deploy, run live tests, or spend.

| Operating state | Now |
|---|---|
| Prepared | This design |
| Tested | No |
| Installed | No |
| Scheduled | No |
| Verified | No |

## 9. Provisional build and test receipts (added after the owner chose to build on provisional contracts)

Built on the section 3 design **without** MPC-8528 / MPC-8530. Treat as provisional: re-point `case_ref` and re-run the tests
when MPC-8528 lands a real case schema, and replace the proposed backoff and bound when MPC-8530 approves numbers.

| Piece | File | State |
|---|---|---|
| Follow-up engine (tables, lease claim, idempotent attempts, bounded backoff, exhaustion, verify, reopen, sweep, metrics view) | `supabase/sql/mpc-8529-support-followup.sql` | Tested on a throwaway Postgres 16. **Not applied to production.** Deliberately not in `supabase/migrations/`, which auto-deploys. |
| Sweep schedule (`mpt-support-followup-sweep`, every 5 min) | same file, commented out | **Not scheduled.** Needs approval. |
| Honest outage wording and bound helpers | `src/lib/supportFollowup.ts` (+ test) | Unit-tested; **not wired into any UI or worker yet**. |
| HELP-under-outage browser checks (11 routes incl. 404, desktop + mobile, keyboard, focus return, no token/email in requests) | `e2e/support-degraded.spec.ts` | Run on a production build with all non-local traffic blocked. |

Run command: `npm run test:support` (needs `DATABASE_URL` of a disposable Postgres and a built `dist/`; see `docs/ci-cd-testing.md`).
Disable: `select cron.unschedule('mpt-support-followup-sweep');` (nothing to undo while it is unscheduled). Remove: drop the objects in the SQL file.

Receipts (run 2026-10-26 on this branch; expected = pass):

| Check | Expected | Actual |
|---|---|---|
| `supabase/tests/run.sh` incl. `support-followup.test.sql` | all assertions pass | pass (10 RLS rows, schema assertions, 58 follow-up assertion calls) |
| `vitest` supportFollowup + HelpButton | pass | 63 / 63 |
| eslint (changed files), `tsc --noEmit -p tsconfig.app.json` | clean | clean |
| Playwright `support-degraded.spec.ts` | pass | 24 / 24 |

Evidence class: **mocked / isolated integration only.** No real channel, no production database, no live message.

### Acceptance criteria against this build

| Criterion | Status |
|---|---|
| Persistent next-action / next-update scheduling, bounded retries, backoff, idempotency, lease against duplicate workers | Met in isolated DB tests (provisional schema) |
| Orphan and stalled-lease detection; explicit waiting / unresolved / exhausted states; no close-on-silence; verification; reopen | Met in isolated DB tests |
| Sanitised defect handoff to the engineering workflow | **Unmet.** Only the `engineering_handoff` state exists; no sender. |
| Failed acknowledgement / reply detection from a real transport | **Unmet.** Needs MPC-8528 delivery receipts and a worker. |
| Independently reachable help/status/intake fallback | **Unmet.** Needs an approved host other than Cloudflare Pages. `describeAvailability` only labels shared-host fallbacks as not independent. |
| HELP across routes, desktop/mobile, keyboard, honest copy | Met for the current HELP (11 routes in browser, all route patterns in HELP's own unit test) |
| Full main journey (diagnosis, action, case reference, delivered follow-up, verified outcome, reopen) | **Unmet.** Needs MPC-8528 backend; only the follow-up state transitions are tested. |
| Wrong-user access, broken login, disputed finding, billing boundary, malicious prompts, cost exhaustion | **Unmet.** Belong to the MPC-8528 gateway and MPC-8530 policy. |
| Production schedule, live tests, load test | **Not done; approval required.** |

So acceptance is **not** met overall. The task cannot honestly be marked Done until MPC-8528 / MPC-8530 land and the unmet rows are re-tested.
