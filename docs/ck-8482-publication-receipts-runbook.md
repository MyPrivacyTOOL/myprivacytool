# CK-8482 — truthful publication receipts, bounded recovery, watchdog (mpt-content-approval)

Status words used here: LOCAL / PUSHED / PR OPEN / MERGED / DEPLOYED / VERIFIED OPERATING. Live publication verification is **PENDING**.

## What changed
- A Make.com HTTP 2xx is now recorded as `handed_off` (agent_execution_logs status `handed_off`, per-platform row in `publication_receipts`). It was previously logged as `published`. `verified_published` is set only by `POST /receipt`.
- Per-platform states: `drafted → approved → handed_off → verified_published`, plus `failed`. Ambiguous outcomes carry `outcome_unknown=1` and stay pending.
- `POST /receipt`: HMAC-SHA256 over `"<timestamp>.<raw body>"` (headers `x-receipt-timestamp`, `x-receipt-signature`), 5-minute window, `receipt_id` replay protection, content/platform association (a hand-off must exist), post URL host must belong to the platform, conflicting second post id → 409.
- `recover(env, {reconcile})`: re-sends only platforms that definitely failed and are due (backoff 60s·2^n, cap 1h, honours Retry-After, max 5 attempts, then dead-letter + Slack alert). Ambiguous timeouts are reconciled first; `unknown` is never re-sent. Rejected or never-approved cycles are never re-sent.
- `GET /status?drafted_content_id=…` (bearer `APPROVAL_API_TOKEN`): stage counts (generated / awaiting approval / approved-not-sent / handed off / verified / failed / unknown / dead-letter / overdue). Awaiting approval is healthy.
- `social_metrics` seed rows are written when a post is verified, with real post id/URL (previously zero rows at hand-off).
- Reuses MPC-8332 (publish windows), MPC-8371 (D1/KV), MPC-8374 (schema.js, make_webhook_log).

## Not done / needs authority (nothing below was activated)
1. Apply D1 migration `workers/mpt-content-consumer/migrations/0004_publication_receipts.sql` to `mpt-agent-logs` (additive). Until applied the worker logs `publication_receipts tracking unavailable` and falls back to the legacy single-POST flow (hand-off is still logged `handed_off`).
2. `wrangler secret put RECEIPT_SIGNING_SECRET` for `mpt-content-approval` (value shared with the Make scenario that signs receipts). Without it `/receipt` returns 503.
3. Make scenario: add a callback step posting a signed receipt per platform (`receipt_id, drafted_content_id, platform, status, make_run_id, post_id, post_url, published_at`). Not changed by this task.
4. Cron for `recover()` / watchdog: the Cloudflare Free plan allows 5 crons per account and all 5 are used (see mpt-content-producer/wrangler.toml). `scheduled()` is implemented but no trigger is configured. Needs a decision on which trigger to free or a plan change.
5. Live cron/queue/consumer evidence and the live Make scenario were not inspected (no Cloudflare/Make read performed this session). Source config only: producer cron `0 22 * * *`, queue `mpt-content-generation-queue`, consumer `max_retries=3`.

## Deploy / disable / rollback
- Deploy: merge to `main` triggers `deploy-mpt-content-pipeline.yml` (path-filtered). DEPLOYED only after the run is green and `GET /` returns `{ok:true,worker:'mpt-content-approval'}`.
- Disable receipts: delete `RECEIPT_SIGNING_SECRET` (`/receipt` → 503). Disable recovery: nothing to do (no trigger).
- Rollback worker: Actions → rollback workflow, or `cd workers/mpt-content-approval && npx wrangler rollback`. Rollback data: `DROP TABLE publication_receipts; DROP TABLE receipt_callbacks;` (only CK-8482 data).

## Test evidence (synthetic — test evidence, NOT real publication proof)
`npx vitest run workers --coverage.enabled=false` → 22 files, 538 tests passed. `node workers/mpt-content-consumer/worker.test.mjs` → 35 checks passed. receipts.js 100% lines.
Trace for `daily-posts-2026-10-21` (receipts.vitest.mjs, sandbox mocks only; no live account reachable):
1. drafted ×6 → approve_all → approved ×6 → Make mock 200 → `handed_off` ×6 (post_id/url null)
2. signed receipt `r-x` (run-77, p-x, https://x.com/mpt/status/1) → x `verified_published`, provenance `callback:r-x`; other 5 stay `handed_off`
3. forged / unsigned / stale / wrong-platform-URL / unknown-content receipts → 401/400/404, no state change; replay → 200 duplicate; different post id → 409
4. pinterest failure receipt → `failed` → recover() re-sends only `["pinterest"]` → `handed_off`; the 5 verified platforms are never re-sent
5. Make timeout → `outcome_unknown`, duplicate approval and recover() send nothing; reconcile `received` → `handed_off`, `not_received` → re-sent once
6. 5×503 → dead-letter, one Slack alert, no further sends (exactly 5 Make calls)
