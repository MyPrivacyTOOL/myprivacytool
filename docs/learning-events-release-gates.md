# Learning events: release gates, acceptance matrix and operator runbook (CK-8492)

Scope: the existing MPC-7915 event pipeline (PRs #451 aggregation, #453 schema, #458 write path; later #483 rate limit, #486/#499/#525 consent gate, #514, #518 Privacy 2.4A, #519 purge cron). This document and the PR that adds it **do not rebuild** any of that, add no personal-data capture, no paid service and no parallel ledger. Collection stays **OFF**.

Evidence labels: **LOCAL** (this branch only) · **PUSHED** · **PR OPEN** · **MERGED** · **DEPLOYED** · **VERIFIED OPERATING**. Everything below that this session produced is **LOCAL/PR OPEN, SYNTHETIC**. Nothing is DEPLOYED or VERIFIED OPERATING by this work.

Inspected 2026-10-26 (session `session_01URepj7ZcfAZXAw6LzrXZGb`), against `main` at `5a81624`.

## 1. Acceptance matrix

| # | Requirement | State | Evidence |
|---|---|---|---|
| 1 | Two off switches (site `VITE_LEARNING_EVENTS`, Worker `LEARNING_EVENTS_ENABLED`); Worker answers 404 when off | Implemented, MERGED, tested. **Operating state not verified**: no Cloudflare access from this session | `learningEvents.vitest.ts` "is OFF by default"; production table `mpt_hexagon_events` has **0 rows** (read-only count, 2026-10-26), consistent with OFF but not proof of the Cloudflare variable |
| 2 | Rate limiting (30/min per client address, 429 + Retry-After, fails open) | In source and unit-tested (#483). **Not verified operating**: needs the deployed binding. Fails open if the binding is absent, so a missing binding is silent | `learningEvents.vitest.ts`, `workers/ratelimit-config.vitest.mjs`, #514 namespace guard. Account-side namespace clash check never done (no Cloudflare access) |
| 3 | Schema validation (closed enums, known hexagon id, key shape, 0..1 confidence); unknown fields never stored | Implemented and verified | `validateLearningEvent`; trace test "no finding value, email, phone…" reads the persisted row and checks the exact column set |
| 4 | Payload-size bounds | **Gap found and fixed here**: cap counted characters, so multi-byte bodies could exceed 2048 bytes; declared `Content-Length` was only checked after reading the body | Now bytes, plus a `Content-Length` pre-check. Tests: unit + trace |
| 5 | Idempotency / replay: repeat `shown` | Implemented (unique index) and verified in the throwaway DB | schema.test.sql, trace |
| 5b | Idempotency / replay: repeat `answer` | **Missing, fixed here (migration, not applied)**: an exact replay created a second row | New unique index `mpt_hexagon_events_answer_once`; a changed answer is still kept (aggregation counts the first) |
| 6 | Answer links to the corresponding shown event | **Missing, fixed here (migration, not applied)**: link was implicit only; an answer with no shown row (or one for a different tile/window) was stored | New `shown_event_id` + trigger: refused (23514) when no shown row for the same person, tile, source and scan window exists |
| 7 | Expired events | **Missing, fixed here (migration, not applied)** | Answer more than 24 h after its shown event is refused. 24 h is a proposed value: see decisions |
| 8 | Closed dialog / plain tap is not an answer | Implemented and tested in the dashboard component; sender-level gates re-proved in the trace | `HexagonDashboard.learning.test.tsx` |
| 9 | Purpose-specific consent | Implemented: the site has one optional category (analytics) since #499; `hasConsent()` is true only after "Accept analytics"; learning events use it (#525 pins it). Consent is **browser-side only**: the Worker cannot see the choice and does not claim to | `cookieConsent.test.ts`, `events.test.ts` |
| 10 | Withdrawal | Sending stops immediately (consent is re-read on every send). Rows already stored stay until the 90-day purge or a manual delete by random code. **The browser keeps the random code after withdrawal**; clearing it would also remove the visitor's only handle for a deletion request. That trade-off is a privacy-owner decision (see section 5), not changed here | Trace "withdrawal after consent" |
| 11 | Deletion | Manual SQL delete on `person_key` only (what Privacy 2.4A promises). No endpoint added (new write surface needs approval) | Trace shows the delete removes the persisted rows |
| 12 | Purge / retention | pg_cron job `mpt-purge-hexagon-events` (id 12, 19:40 UTC daily, 90 days) exists in production (read-only check 2026-10-26: active). Function behaviour verified in the throwaway DB: raw rows deleted, rollup has no person column | schema.test.sql, trace |
| 13 | No finding value / email / phone / account id in payloads **or logs** | Payloads verified. **Log leak found and fixed**: `insertMptRow` logged up to 200 characters of the Postgres error, which for a duplicate quotes `person_key` (and would for any rejected row) | Now status only for `mpt_hexagon_events`. Trace asserts the captured logs contain no key, email, phone or account id |
| 14 | Privacy Policy 2.4A wording | MERGED (#518). **Privacy owner (MPC-6798) has not reviewed it** (per task record) | Gate |
| 15 | Real-people check of the dashboard | Not done | Gate (script referenced in the MPC-7915 record) |
| 16 | Browser → Worker → **staging** database trace | **Blocked: no staging database exists.** The only Supabase project is production (`MyPrivacyTOOL Project2`); this session did not write to it | Substituted by a synthetic local trace (section 3). Not a staging run |
| 17 | Named-consent follow-up | Already resolved by #499 (task record 2026-10-26); no duplicate task created | MPC-7915 follow-up page |

Overlaps reconciled: MPC-7908 (claims register) is a read-only review, not an implementation, and has no code here. MPC-7915 owns the pipeline; this work is a delta on it. CK-8493 (aggregation to decisions) and CK-8494 (customer journey) are **not** started.

## 2. What this change adds

- `supabase/migrations/20261027090000_hexagon_events_answer_integrity.sql`: `shown_event_id`, answer-replay unique index, link/expiry trigger. Idempotent, rollback in the header. **Not applied anywhere.**
- Worker: byte-accurate body cap with `Content-Length` pre-check; no database error text in logs for this table.
- Tests: new assertions in `supabase/tests/schema.test.sql`; new unit tests; a synthetic persistence trace (`workers/webhook-receiver/learningEvents.trace.vitest.ts`, skipped unless `LEARNING_TRACE_DATABASE_URL` is set) with `supabase/tests/make-trace-db.sh`.

Known limitation of the trigger: the browser sends `shown` and `answer` as separate fire-and-forget requests. If the `shown` request is rate-limited or lost, a later answer is refused and not stored (the visitor still sees 202). That is deliberate: an answer with no record of what was shown cannot be interpreted. It under-counts rather than mis-counts.

## 3. Synthetic trace (LOCAL, SYNTHETIC; not staging)

Stack: real `src/lib/learning/events.ts` sender, routed into the real Worker handler (`workers/webhook-receiver/index.js`), whose Supabase write is answered by a thin PostgREST stand-in that inserts into a **throwaway local PostgreSQL 16** with every repo migration applied. Every assertion reads rows back from Postgres. Users are `SYNTHETIC…` keys. The helper refuses any URL containing `supabase.co/.com` or the Supabase pooler. Production was touched only by two read-only queries (row counts, trigger/column presence, cron job).

Reproduce:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/make-trace-db.sh
LEARNING_TRACE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ck8492_trace npx vitest run workers/webhook-receiver/learningEvents
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

Proved: shown row stores the tile kind and confidence actually shown; answer row's `shown_event_id` equals that shown row's id; no sender call/row for disabled switch, missing or withdrawn consent, Worker switch off; malformed, unknown-hexagon, answer-on-shown, oversized (characters and bytes) and origin-less requests store nothing; duplicate shown and replayed answer stored once, changed answer kept; answer with no shown event and answer after expiry refused; table and logs contain no finding value, email, phone or account id; purge removes raw rows and leaves counts with no person column; manual delete by code removes rows.

Mutation check: with the Worker changes reverted, the oversize and leak tests fail; with the migration removed, the schema assertions fail.

## 4. Operator runbook (nothing here has been run in production)

Order (collection stays OFF until every step before 6 is recorded):

1. Privacy owner (MPC-6798) reviews Privacy 2.4A, including the legal basis for the random code, the 24 h link window and what withdrawal should do (section 5).
2. Chris approves the migration `20261027090000_hexagon_events_answer_integrity.sql`. Apply by hand in the SQL editor (auto-migration is off). It is additive and fast on the empty table. Verify: `select count(*) from information_schema.columns where table_name='mpt_hexagon_events' and column_name='shown_event_id';` returns 1 and `select count(*) from pg_trigger where tgname='mpt_hexagon_events_link_answer';` returns 1.
3. Merge and deploy the Worker change (merging may trigger a deploy: treat the merge as a production action and take it only on release authority).
4. Confirm the deployed `RATE_LIMITER` binding exists (the code fails open if it does not) and that `namespace_id 7915` is unique in the Cloudflare account.
5. Real-people check of the dashboard.
6. Release authority sets `VITE_LEARNING_EVENTS` (site build) and `LEARNING_EVENTS_ENABLED` (Worker). Then run one authorised end-to-end trace with a test browser profile and read the rows back.

Rollback: set either switch off (the route returns 404 / nothing is sent). Schema: the rollback statements in the migration header. Deletion by code: `delete from public.mpt_hexagon_events where person_key = '<code>';`.

## 5. Remaining human gates and decisions

- Migration approval (Chris) for the new migration. Not applied.
- Privacy owner review of 2.4A and decision on: withdrawal (keep the random code so deletion stays possible, or clear it and accept un-deletable old rows); whether a deletion route should exist; the 24 h expiry value.
- A real staging Supabase project (or an approved branch) for a true browser → Worker → staging DB trace. Needs access and possibly spend: not created.
- Cloudflare access to confirm the switches are unset, the rate-limit binding is deployed and the namespace is unique.
- Real-people check; release authority; production proof stays **pending**.

## 6. Handoff contracts for CK-8493 and CK-8494 (not started)

- Event contract: `mpt_hexagon_events` columns as in the trace test (no value, email, phone or account id). One vote per person, tile, source and scan window: the first answer; later different answers are kept but not counted. After this migration every answer has `shown_event_id`; answers stored before it have NULL.
- Denominators: `shown` rows are the denominator source; silence is never an answer; rollups hold `shown_people` and the four answer counts per day, tile, source and config version, with no person key.
- Aggregation: reuse `src/lib/learning/aggregate.ts` (30 responders, 95% Wilson, proposals only). Mixed `config_version` rows must be grouped, not pooled.
- Withdrawal/deletion: rows can disappear by manual deletion or the purge, so aggregation must tolerate missing shown rows.
- CK-8494 should reuse the same sender and consent gate; it must not add a second event store.
