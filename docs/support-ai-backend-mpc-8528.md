# AI support backend scaffold (MPC-8528)

**Status: scaffold only. LOCAL/PR, not deployed, not wired to any channel, no model provider, no production data.**
MPC-8530 (approved knowledge, action policies, identity flow, cost caps) has no delivered outputs as of 2026-10-26. This
change was built under an explicit instruction from the task owner to build the policy-independent scaffold anyway. It
invents no policy: the shipped policy approves nothing, every action tool is disabled, and no knowledge is bundled.

## What exists (shared/support/)

| Module | Contract |
|---|---|
| `types.ts` | `InboundEvent` (the one shape adapters must produce), `SupportCase`, `ActionReceipt`, and the ports `CaseStore`, `KnowledgeSource`, `Model`, `Notifier`, `Verifier`. |
| `intake.ts` | `receive()`: validate, dedupe on `(channel, providerEventId)`, attach to a thread or create a case, reopen resolved/closed cases. Returns `unavailable` on any store error, so no reference is ever issued for an unsaved request. Bare HELP (`helpOnly`) creates nothing. |
| `states.ts` | Explicit state machine: new, triage, diagnosing, action_running, waiting_customer, waiting_system, resolved, closed, reopened, blocked. No "escalated to a person" state. |
| `identity.ts` | `anonymous` < `channel_asserted` < `verified`. A platform sender id or a yes/no reply is at most `channel_asserted`. Only a `Verifier` result carrying subject and tenant is `verified`; verifier errors fail closed. |
| `policy.ts` | `DEFAULT_POLICY` (no tool approved), `ToolPolicy` (approved version, required identity, hourly call cap, daily cost cap, timeout), `SENSITIVE_ACTIONS` (names that must stay disabled). |
| `gateway.ts` | `ToolGateway.execute()`: policy, identity, case-subject/tenant match, forbidden subject args, idempotency, rate/cost caps, write-ahead `unknown` marker for side-effecting tools, timeout, receipt for every call including denials. Decisions never read model text. |
| `tools.ts` | Two read-only tools, `get_case_status` and `diagnose_report_status` (behind a `ReportStatusReader` port that is not implemented). No recovery/resend/refund/export/delete tool exists. |
| `knowledge.ts` | Retrieval keeps only `approved` entries with a version and an approver. |
| `reply.ts` | Fixed honest templates, AI disclosure, and a guard that drops model text promising a human, a response time, or an action with no success receipt (defence in depth, not the control). |
| `service.ts` | `handleInbound()` ties it together. Duplicate event: no second model call, tool run or reply. Model/knowledge/tool/delivery failure: case stays open as `waiting_system` with a reason. A case is never auto-resolved here. |
| `memory-store.ts` | In-memory store with fault injection. **Tests only.** |
| `rest-store.ts` | `RestCaseStore`: the `CaseStore` over Supabase PostgREST (Workers have fetch, not a Postgres driver). Any non-2xx, timeout or malformed body throws, so intake answers "not recorded". Filter values are URL-encoded and only whitelisted case columns are patched. |
| `supabase/migrations/20261027140000_mpc_8528_support_cases.sql` | Proposed Postgres schema (service_role only, RLS forced) plus two atomic functions, `support_create_case_from_event` and `support_append_inbound`, using a `(channel, provider_event_id)` primary key for race-safe dedupe. |

## Update 2026-10-26 (second PR): real store and evidence

- `RestCaseStore` and the atomic SQL functions were added. The SQL passed its assertions on a throwaway local Postgres 16, and 20 parallel sessions sending the same event produced 1 case, 1 message and 1 event row. A true simultaneous race on the same thread would raise a unique violation (fail-closed, the caller replies "not recorded" and the customer's retry dedupes); that exact interleaving was not forced.
- `RestCaseStore` is tested against a FAKE fetch only (request shape and failure behaviour). It has never talked to a Supabase project.
- **GitHub write access:** no blocker was observed from this session. It pushed a branch, opened a PR and merged it (PR #548) using the GitHub integration. The criterion's "actual blocker" is therefore "none observed here"; access from other runtimes is unknown.
- **MPC-8530 is quarantined.** At 13:20Z its page shows `Status_Readiness = Needs_Info` and a REAPER blocker reason: "Quarantined, non-conforming task ... missing_due_date: Priority 2 task has no Due Date." It has no run receipt, outputs or recorded decisions. Fix: someone with authority sets a Due Date and re-sets readiness to Ready. This session did not edit that record.

## Update 2026-10-26 (fourth PR): adapters and hosting Worker (all OFF)

Built to the recommended answers the task owner authorised as **build targets**. They are not approved policy and nothing is enabled.

| Piece | What it does | What keeps it off |
|---|---|---|
| `shared/support/faq-knowledge.ts` | Keyword retrieval over the published FAQ (`src/data/faqs.ts`). | Every entry is a DRAFT unless the FAQ owners supply a version and approver (`SUPPORT_FAQ_APPROVAL_VERSION`/`SUPPORT_FAQ_APPROVED_BY`); `retrieve()` drops drafts, so the service answers nothing from the FAQ until then. |
| `shared/support/report-status.ts` | Read-only status of one account's latest scan report (`scans.user_id`, four columns), coarse wording, never claims delivery or a retry. | Used only by the `diagnose_report_status` tool, which the shipped policy does not approve and which needs a verified identity. Assumes verified subject id = `public.users.id` (open identity-flow decision). |
| `shared/support/email-notifier.ts` | Resend reply to the inbound sender only, threaded, idempotent, throws unless Resend returns an id. In-band notifier for web (the reply rides the HTTP response; "delivered" means only that). | No API key or sender configured means no email notifier; an unsupported channel throws and is recorded undelivered. |
| `shared/support/openai-compatible-model.ts` | Chat-completions adapter: customer text as delimited untrusted data, only gateway-allowed tools offered, other tool names dropped. | Not constructed without `MODEL_*` configuration; a provider that receives customer text needs its DPA and Privacy listing first. |
| `workers/support/` | `POST /intake`, `GET /health`. 503 unless `SUPPORT_AI_ENABLED=1`, all bindings present AND a rate limiter bound; bearer-token auth; 32 KB cap; stored-before-reference; never logs message text. | No route, `workers_dev = false`, no deploy workflow, flag `"0"`. The verifier is wired but nothing issues proofs, so in practice every caller is `channel_asserted`, and the policy approves no tool. |

**Identity verifier (built, issuing deliberately NOT wired):** `shared/support/proof.ts` + `support_proofs` and two SQL functions. A proof is a random 43-character token whose SHA-256 hash is stored; `support_redeem_proof` is atomic and single-use (8 parallel redemptions: exactly one winner), expires, and ties to the subject and tenant it was issued for. `ProofVerifier` is the only path to `verified`; a malformed token never reaches the database, and any database error fails closed to `channel_asserted`. The Worker accepts an optional `proof` and passes it to the verifier. **Nothing issues proofs yet:** looking up an account by email and sending a message is an approval-gated action, and whoever wires it must answer identically whether or not the account exists (no enumeration) and rate-limit per address. Limitation: a proof verifies one message (single use); a longer session would need its own design.

**AI provider (finding, nothing enabled):** `docs/AI-PROVIDERS.md` (policy of 2026-10-14) allows any provider and requires the DPA sub-processor list and Privacy Policy section 5 to be right before one receives personal data. `src/pages/DPA.tsx` already lists "AI model providers (any provider; currently Alibaba Cloud, Qwen models)", and core-brain already calls an OpenAI-compatible Qwen endpoint. So the recommended choice is that same provider through the same kind of configuration. Still outstanding before any key is set: record the provider's data-retention and training-on-customer-data terms and processing countries on the task, and check Privacy Policy section 5 still matches what the support service sends. The model adapter now redacts email addresses and phone numbers before sending (`redactForModel`, same rules as core-brain), because the policy says every call sends the minimum; names and free text a customer types cannot be reliably stripped.

**Retention (proposed, not scheduled, not applied):** `support_purge_expired()` removes raw message text after 90 days, deletes cases inactive for 6 months in any state (unresolved cases do not keep personal data forever), expired proofs after a day and usage rows after 7 days. The periods are the task owner's recommended answer; they still need legal sign-off and the matching privacy-notice wording. The cron line is left commented.

**To enable (all required):** approved MPC-8530 decisions; production approval to move `supabase/migrations/20261027140000_mpc_8528_support_cases.sql` into migrations; a rate-limiter binding; the secrets in `workers/support/EXPECTED_SECRETS.txt`; a listed provider if `MODEL_*` is set; an approved FAQ version; a route and a deploy workflow; the MPC-8531 review. None of these exists today.

## Routing and intake trace (from code; mailbox side is unverified)

| Path | What the code does | Durable case? |
|---|---|---|
| Contact form (`src/pages/Contact.tsx`) | Client-side POST to the HubSpot Forms API (portal 246502821, form id from `VITE_HUBSPOT_CONTACT_FORM_ID`) via `src/lib/hubspot.ts`. If the form id is unset it opens `mailto:privacy@myprivacytool.io`. | No. No case, no reference, no reply thread. HubSpot receives the form data; what happens next is outside this repo. |
| Contact page mailboxes | mailto links for `privacy@`, `dpo@`, `legal@`, `accessibility@`. | No. |
| `support@myprivacytool.io` | Appears as text or mailto in `src/data/faqs.ts`, About, Terms, AcceptableUse and Developers. It is not used by Contact.tsx. | No. |
| `privacy@` | Rights, deletion and consent requests (FAQ, Privacy, Cookies, Trust, GDPR rights pages, report email footer in `workers/scan-report/lib/email.js`). | No. |
| Social channels | core-brain routes intents and writes best-effort state/`interaction_log`. | No (best-effort by its own docs). |

Findings for the owners of those tasks (no change made here): the Contact page text says "we'll get back to you by email", which this service cannot promise under the no-staff constraint; and nothing in the repo shows whether the support@/privacy@ mailboxes are monitored or forwarded. Both belong to MPC-8530 (inventory) and the FAQ/legal owners (MPC-7560/7561). No route was removed or changed.

## Adapter and configuration map

| Setting / port | Owner | State |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for `RestCaseStore` | the Worker that hosts the service | Not configured here. No Worker exists yet. |
| `SupportPolicy` (`policy.ts`) | MPC-8530 decisions | Shipped as `unapproved-0`: no tool approved. |
| `KnowledgeSource` | MPC-7560/7561 content, MPC-8530 approval | `FaqKnowledgeSource` built; drafts only until an owner approves a version. |
| `Model` | provider decision plus DPA/Privacy sub-processor listing first | `ChatCompletionsModel` built; off without configuration. |
| `Verifier` | MPC-8530 identity flow | Not implemented. |
| `Notifier` per channel | MPC-8532 (and email via the existing scan-report mail path) | `ResendNotifier` (email) and `InBandNotifier` (web) built; other channels unsupported. |
| `ReportStatusReader` | MPC-8530 (what status may be read) | `ScansReportStatusReader` built, unwired to any enabled tool. |

## Existing components reused or deliberately not reused

- **core-brain** (`workers/core-brain`) stays the router. Its `interaction_log` and `mpt_conversation_state` are best-effort by design and its `trust_level` rises on a yes/no reply, so they are not used as the case record or as authentication. That is the evidenced reason for new `support_*` tables.
- `src/lib/hubspot.ts`, `src/pages/Contact.tsx`, the FAQ and the support@/privacy@ addresses are untouched. `support@myprivacytool.io` (contact/FAQ) and `privacy@myprivacytool.io` (rights, deletion) remain; no route is removed or changed. Whether the mailboxes are monitored or routed anywhere is **unverified** (needs the MPC-8530 inventory).
- FAQ text and its gates (MPC-7560/7561) are untouched.

## Contracts for other tasks (not implemented here)

- **MPC-8527 (website HELP):** build an `InboundEvent` with `channel: "web"`, a unique `providerEventId`, and `helpOnly: true` for a bare open. Do not put personal data or report tokens in `journeyRef`.
- **MPC-8532 (channel adapters):** authenticate the provider first, then map to `InboundEvent` (stable `threadKey` for reply continuity), implement `Notifier` (throw on a failed send; never swallow it) and `Verifier`. Repeated provider callbacks must reuse the same `providerEventId`.
- **MPC-8529 (follow-up/watchdog):** operates on `support_cases.state`/`state_reason` and `support_messages.delivery = 'failed'`, and owns resolution. `waiting_system` with reason `reply_delivery_failed`, `ai_unavailable` or `no_approved_answer_or_action` is its work queue. This task provides no scheduler.

## Gates that remain open (nothing below is approved by this change)

1. MPC-8530 outputs and decisions: approved knowledge, action policies, identity/verification flow, cost caps, retention and notices, the exceptional-decision route.
2. Production migration: moving `supabase/migrations/20261027140000_mpc_8528_support_cases.sql` into `supabase/migrations/` is a production action, because `.github/workflows/deploy-supabase.yml` runs `supabase db push` on merge to main.
3. A hosting Worker, plus a real `Model`, `Verifier`, `Notifier`, `KnowledgeSource` and `ReportStatusReader`, none of which exist yet. (`RestCaseStore` now exists but has only been tested with a fake fetch.)
4. Each sensitive action (recovery, resend, entitlements, refunds, export, deletion, repair) needs approved policy, an identity check and a tool implementation. All stay disabled.
5. Real-channel verification. Everything here is synthetic.

## Tests

`npx vitest run shared/support` runs 35 isolated tests (29 service, 6 `RestCaseStore` with a fake fetch) against the in-memory store (no network, no provider, no production
backing). `supabase/tests/proposed-mpc-8528-support-cases.test.sql` runs inside `supabase/tests/run.sh` (`npm run test:db`) against the throwaway Postgres
after the `supabase/proposed/` loop has applied the schema. Neither proves real channel delivery or live behaviour.

## Update 2026-10-27: model-spend guard (MPC-8530 decision D-7)

The tool gateway caps TOOL calls only. Nothing capped the model. `shared/support/model-budget.ts` now reserves spend before every model call
(`reserveModelCall`) and the service refuses to call the model when a cap is hit, answering with the honest "AI unavailable" reply and leaving the
case `waiting_system` / `ai_unavailable`.

- Caps (approved by Chris 2026-10-27, `APPROVED_MODEL_BUDGET`, now part of `DEFAULT_POLICY.modelBudget`): 5 model calls per case, US$0.05 per case, US$5 per rolling 24 h.
  Units are micro-USD. Each call reserves `estimatedMicroUsdPerCall` (US$0.01) because the true cost is only known afterwards; a response that reports a higher
  `costMicroUsd` has the difference recorded. **These are placeholders until two weeks of measured data.**
- Counters use the existing `support_usage` table (keys `model:case:<id>` and `model:day`), so no schema change and they survive restarts.
- Fails closed: an invalid budget, a store error or an exceeded cap all mean no model call.
- Known limitation: check-then-record is not atomic across concurrent requests, so a burst can overshoot by about one call per concurrent request. The edge rate
  limiter bounds it; an atomic database-side reserve would remove it. Not built.
- Not done: the cap is only as good as the estimate. If the real per-call cost is above US$0.01, the day cap is reached sooner than intended only once the provider
  reports `costMicroUsd`; `ChatCompletionsModel` does not report it yet, so today the reserved estimate is the whole accounting.
- Still blocking enablement: D-5 provider terms, D-6 notice and legal sign-off, schema migration (production approval), identity-proof flow, MPC-8531 review.

Tests: `npx vitest run shared/support` (7 new tests in "model spend guard (D-7)").

## Update 2026-10-27: schema moved into migrations, purge scheduled (PR, not yet merged)

On Chris's explicit approval of the schema migration and the purge schedule, the support schema moved from `supabase/proposed/` to
`supabase/migrations/20261027140000_mpc_8528_support_cases.sql`, and `20261027140100_mpc_8528_support_purge_pg_cron.sql` schedules
`support_purge_expired()` daily at 03:17 UTC (skipped where pg_cron is absent). Merging that PR runs `supabase db push` on the live project, which creates
new, empty, service_role-only tables and functions and the cron job; no existing table is touched and nothing writes to them until the support Worker is enabled.
The 8529 follow-up SQL stays in `supabase/proposed/`. Still unmet for enablement: the rate-limiter binding and secrets, an approved FAQ version, the Worker route and
deploy workflow, a recorded D-5 (provider terms), MPC-8531 review, and a real-channel receipt.

## Update 2026-10-27: identity-proof request flow (MPC-8530 decision D-3), dormant

`shared/support/proof-request.ts` adds `requestProof()`: the customer gives the email of their account; if an account exists a single-use code (15 minutes) is emailed
to that address. It is **not wired to any route and has no production account lookup**, so nothing can call it and no email can be sent.

- **No enumeration:** the answer is `accepted` for a hit and a miss alike, and it is returned before the lookup, issue and send run (`defer`, e.g. `ctx.waitUntil`), so timing matches too. Errors after the answer are swallowed and reported as a reason code only.
- **Limits (D-3):** 3 requests per address and 20 per IP per rolling hour, counted on every attempt whether or not the account exists. Counters use hashed keys in `support_usage`, so no address or IP is stored. A limiter read/write failure means no lookup and no mail.
- **Mail:** `ResendProofMailer` (same contract as `ResendNotifier`) throws unless Resend confirms; the code is in the URL fragment, so it is not sent to any server or log. The email never asks for a password or a texted code.
- **Tests:** 12 in `proof-request.vitest.ts`. Mutation-checked: awaiting the work before answering, a looser address limit, and a raw address in the usage key each fail a test.

Not built, and needed before this can run:
1. `AccountLookup` for production. It must resolve an email to the subject id the report-status reader expects (`public.users.id` is still an assumption, per the open identity decision).
2. The route and the verify page that reads the fragment and passes the code as `proof`.
3. A real run against Resend with an approved test address (sending is an approval-gated action), then MPC-8531 review.
4. Known gap: `support_usage` rows are purged after 7 days, so a per-case model-call counter restarts for a case older than 7 days. Acceptable for now; fix before launch by keeping model counters longer.
