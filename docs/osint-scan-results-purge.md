# OSINT Scan Results — Scheduled Purge (MPC-6957)

Notion cannot auto-delete rows by date, so a Cloudflare Worker cron removes expired rows.

## Schedule & retention
- **Store:** Notion database *MPT OSINT Scan Results* (data source `dfd81319-00ce-45c9-ae1a-af5bc7eec516`).
- **Retention:** 24 hours — each row's `Expires At` property is the source of truth.
- **Schedule:** daily at 03:15 UTC (`[triggers] crons` in `workers/webhook-receiver/wrangler.toml`).
- **Action:** rows with `Expires At` < now are archived via the Notion API (moved to Trash; Notion permanently removes them after 30 days — the API has no hard delete). Up to 2,000 rows per run; the next run continues.
- **Logging:** counts only (`archived`, `failed`); never page IDs or contents.

## Failure alerting
Any run that fails (missing token, query error, Notion errors after retries, any row that can't be archived) sends a Telegram message to `PURGE_ALERT_CHAT_ID` using the existing `TELEGRAM_BOT_KEY`.

## Configuration (Worker secrets/vars)
| Name | Kind | Purpose |
|---|---|---|
| `NOTION_TOKEN` | secret | Notion integration token; integration must be shared with the scan-results DB with read + update content access |
| `PURGE_ALERT_CHAT_ID` | secret/var | Telegram chat that receives failure alerts |
| `NOTION_SCAN_RESULTS_DATA_SOURCE_ID` | var (optional) | Overrides the default data source id |

```
cd workers/webhook-receiver
wrangler secret put NOTION_TOKEN
wrangler secret put PURGE_ALERT_CHAT_ID
wrangler deploy
```

## Verify
1. `wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=15+3+*+*+*"`.
2. Add a test row with `Expires At` in the past; confirm it lands in Notion Trash and the log shows `archived=1 failed=0`.
3. Unset `NOTION_TOKEN` in staging and confirm a Telegram alert arrives.

## Future
When agents switch to Supabase `mpt_osint_scan_results` (MPC-6956), add a matching purge (`delete where expires_at < now()`), e.g. via pg_cron.
