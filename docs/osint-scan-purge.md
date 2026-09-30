# OSINT Scan Results — Scheduled Purge (MPC-6957)

**What:** Cloudflare Worker cron (`workers/webhook-receiver`, `scheduled` handler) that archives expired rows in the
Notion database **MPT OSINT Scan Results**.

**Retention policy:** each scan row is valid for **24 hours** (`Expires At`). Notion cannot expire rows itself, so the job
archives every row where `Expires At` < now.

**Schedule:** hourly (`0 * * * *`, UTC) — rows are removed within ~1 hour of expiry. Each run handles up to 2,000 rows
(20 pages × 100); any remainder is picked up next run.

**Delete semantics:** the Notion API has no hard delete. Rows are *archived* (moved to Notion trash), which Notion
permanently deletes after 30 days. Rows are unreadable via the API/integration once archived.

**Secrets (`wrangler secret put`):**
- `NOTION_TOKEN` — integration with read + update access to the scan-results database
- `TELEGRAM_BOT_KEY`, `TELEGRAM_ALERT_CHAT_ID` — failure alerts
- optional var `NOTION_SCAN_DB_ID` (defaults to the MPT OSINT Scan Results DB)

**Logging / alerting:** logs counts only (`archived`, `failed`) — never handles or row contents. A Telegram alert is sent
if any row fails to archive or the Notion API errors. If `NOTION_TOKEN` is missing the job logs a warning and skips.

**Manual verification:** `wrangler tail`, then trigger with `wrangler dev --test-scheduled` and
`curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`.

**Future:** when agents move to Supabase (MPC-6956), scan results are enforced by RLS `expires_at`; a matching
`DELETE ... WHERE expires_at < now()` (pg_cron) should replace this job.
