# Learning decisions and outcome checks (CK-8493)

Status: **built and tested against synthetic data only. Nothing live.** Live aggregation is blocked by CK-8492 (event pipeline release gates, Not started on 2026-10-26) and the consent/retention gates. Master strategy: https://app.notion.com/p/40428547eaa7813db913c019c0612ab3 · Task: https://app.notion.com/p/40428547eaa7814ca241efe1d219d8ec

## What was reused, what was added
| Piece | Where | Status |
|---|---|---|
| Counting rules (one vote per person/hexagon/window, response rate, 30 responders, 95% Wilson, proposals only) | `src/lib/learning/aggregate.ts` (MPC-7915, merged) | reused unchanged |
| Event ledger, config versions, proposals, daily purge | `mpt_hexagon_events`, `confidence_config`, `confidence_proposals` (MPC-7915; applied to production 2026-10-23) | reused unchanged |
| Cohorts by tile kind and config version, withdrawn inputs, freshness, warnings | `src/lib/learning/measure.ts` | new (pure, read-only) |
| Decision record, approval rules, outcome check | `src/lib/learning/decisions.ts`, `decisionStore.ts` | new |
| Decision tables | `supabase/proposed/20261027090000_learning_decisions.sql` | new, **not applied anywhere**; kept out of `supabase/migrations/` because `deploy-supabase.yml` runs `db push` on every merge to main when its secrets are set |
| Read-only review | `src/lib/learning/review.ts`, `npm run learning:review -- --fixture` | new |

No second metrics store: the decision tables hold counts and reasoning only. `src/lib/learning/aggregate.ts` and the MPC-7915 tables are not modified. MPC-7911's weekly collector (`workers/mpt-metrics-collector`, scan drop-off) is a different measurement (saved-scan funnel); it was inspected and not touched.

## Rules in force (read from code and the MPC-7915 decision log, 2026-10-19)
- Minimum **30 distinct responders per tile kind**, **95% Wilson** interval; a proposal only when the interval **excludes** the confidence shown. Below that: report-only. `aggregate.ts` `MIN_RESPONDERS = 30`, `Z_95 = 1.96`; the table check `responders >= 30` repeats it.
- Reaching 30 is **not** treated as sufficiency: every proposal prints its response rate and the response-bias note, and is a "candidate for human review".
- Approver: **Chris alone** for a confidence change; the **80% dispute threshold also needs a second, different approver**. Who that second approver is has **not been decided**; `DEFAULT_POLICY.secondApprovers` is empty, so such a change cannot be approved or implemented until one is named (fails closed).
- `kept` is the fifth answer (labelled "Keep it" button); disputes are `disputed / (disputed + kept)`; guess rejection is `not_me`. They are separate cohorts and are never pooled.

Note for the record: `summarise()` in `aggregate.ts` tests the 30-responder minimum against all responders in a hexagon/source group, not per tile kind. `measure.ts` groups by tile kind and config version *before* calling it, so the agreed "30 per kind" holds. `aggregate.ts` was deliberately left alone.

## Decisions are an audit chain, not an edit
`learning_decisions` is an immutable header (hypothesis, baseline counts + window + input digest, one bounded change, guardrails, evidence, owner, approver rule, next outcome-check date). `learning_decision_events` is append-only: `decided` (keep / change / stop / insufficient_evidence) → `approved` / `rejected` → `implemented` (config version) → `outcome_checked` → optionally `rolled_back`. State is derived from the events. Raw observations are never written. The same rules run in `decisions.ts` and in a database trigger (implementing needs the primary approval, and for the threshold a second different person; nothing follows a rejection). Recording `implemented` does **not** switch `confidence_config.active`; that remains a separate, approved production action.

## Outcome check
Question asked: is the confidence now shown inside the interval the follow-up answers support? Results: `calibrated`, `still_miscalibrated`, `insufficient_evidence` (fewer than 30 responders, no data, or blocking data-quality warnings). Always labelled non-causal. A guardrail that was not measured is reported as unknown, never "held".

## Operating
Manual, read-only: `npm run learning:review -- --fixture` (synthetic ledger + synthetic trace). Without `--fixture` it refuses and exits 2. **Scheduling: PENDING.** No job ID, timezone, next run or missed-run alert exists; none is claimed. Report freshness limit (48 h) is a report setting, not a measurement rule.

Proposed (not installed) once the gates clear: a daily run after the 19:40 UTC purge (`mpt-purge-hexagon-events`, job 12), with an independent missed-run alert, to be recorded with its real job ID and next run.

## Rollback
- Code: revert the PR; nothing else depends on it.
- Migration (if ever applied): `drop table if exists public.learning_decision_events; drop table if exists public.learning_decisions; drop function if exists public.learning_decisions_guard();`
- A decision that was implemented: append `rolled_back` (to the earlier `confidence_config` version, normally 0) and make that version active by the approved production action; the next outcome check then reads that version.

## Tests
`npx vitest run src/lib/learning` (measure, decisions incl. rejection/rollback/unauthorised/absent review, synthetic trace, review rendering); `DATABASE_URL=… npm run test:db` against a **throwaway** local Postgres (decision table controls). Neither touches production.

## Not done, and why
- No live reader (PostgREST/Supabase) is connected: waits for CK-8492 and the consent/retention gates, and for the privacy-owner review of Privacy 2.4A and the collection switches, which are still OFF.
- Second approver for the 80% threshold: needs a name from Chris.
- Withdrawn-person handling after the 90-day rollup cannot be retracted (rollups carry no person key); the report warns when a window reaches past raw retention.
- Migration not applied and not in `supabase/migrations/` (moving it there is the production release step); schedule not installed; nothing deployed.
