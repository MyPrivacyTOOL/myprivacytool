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
| `supabase/proposed/mpc_8528_support_cases.sql` | Proposed Postgres schema (service_role only, RLS forced, dedupe and receipt-idempotency unique indexes). |

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
3. A real Postgres `CaseStore`, a real `Model`, `Verifier`, `Notifier` and `ReportStatusReader`, none of which exist yet.
4. Each sensitive action (recovery, resend, entitlements, refunds, export, deletion, repair) needs approved policy, an identity check and a tool implementation. All stay disabled.
5. Real-channel verification. Everything here is synthetic.

## Tests

`npx vitest run shared/support` runs 29 isolated tests against the in-memory store (no network, no provider, no production
backing). `supabase/proposed/mpc_8528_support_cases.test.sql` is run by hand on a throwaway Postgres after
`supabase/tests/bootstrap.sql`. Neither proves real channel delivery or live behaviour.
