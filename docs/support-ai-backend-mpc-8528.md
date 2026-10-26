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
| `supabase/proposed/mpc_8528_support_cases.sql` | Proposed Postgres schema (service_role only, RLS forced) plus two atomic functions, `support_create_case_from_event` and `support_append_inbound`, using a `(channel, provider_event_id)` primary key for race-safe dedupe. |

## Update 2026-10-26 (second PR): real store and evidence

- `RestCaseStore` and the atomic SQL functions were added. The SQL passed its assertions on a throwaway local Postgres 16, and 20 parallel sessions sending the same event produced 1 case, 1 message and 1 event row. A true simultaneous race on the same thread would raise a unique violation (fail-closed, the caller replies "not recorded" and the customer's retry dedupes); that exact interleaving was not forced.
- `RestCaseStore` is tested against a FAKE fetch only (request shape and failure behaviour). It has never talked to a Supabase project.
- **GitHub write access:** no blocker was observed from this session. It pushed a branch, opened a PR and merged it (PR #548) using the GitHub integration. The criterion's "actual blocker" is therefore "none observed here"; access from other runtimes is unknown.
- **MPC-8530 is quarantined.** At 13:20Z its page shows `Status_Readiness = Needs_Info` and a REAPER blocker reason: "Quarantined, non-conforming task ... missing_due_date: Priority 2 task has no Due Date." It has no run receipt, outputs or recorded decisions. Fix: someone with authority sets a Due Date and re-sets readiness to Ready. This session did not edit that record.

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
| `KnowledgeSource` | MPC-7560/7561 content, MPC-8530 approval | Not implemented. |
| `Model` | provider decision plus DPA/Privacy sub-processor listing first | Not implemented. |
| `Verifier` | MPC-8530 identity flow | Not implemented. |
| `Notifier` per channel | MPC-8532 (and email via the existing scan-report mail path) | Not implemented. |
| `ReportStatusReader` | MPC-8530 (what status may be read) | Not implemented. |

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
2. Production migration: moving `supabase/proposed/mpc_8528_support_cases.sql` into `supabase/migrations/` is a production action, because `.github/workflows/deploy-supabase.yml` runs `supabase db push` on merge to main.
3. A hosting Worker, plus a real `Model`, `Verifier`, `Notifier`, `KnowledgeSource` and `ReportStatusReader`, none of which exist yet. (`RestCaseStore` now exists but has only been tested with a fake fetch.)
4. Each sensitive action (recovery, resend, entitlements, refunds, export, deletion, repair) needs approved policy, an identity check and a tool implementation. All stay disabled.
5. Real-channel verification. Everything here is synthetic.

## Tests

`npx vitest run shared/support` runs 35 isolated tests (29 service, 6 `RestCaseStore` with a fake fetch) against the in-memory store (no network, no provider, no production
backing). `supabase/proposed/mpc_8528_support_cases.test.sql` is run by hand on a throwaway Postgres after
`supabase/tests/bootstrap.sql`. Neither proves real channel delivery or live behaviour.
