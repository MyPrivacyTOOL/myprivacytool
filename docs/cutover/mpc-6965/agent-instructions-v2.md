# Draft agent instructions v2 (MPC-6965) — DO NOT APPLY until the gates in README.md are open

> **Verify before use.** The tool argument names below are a draft built from the live Supabase schema and the MPC-6965 page. This session could not read `krispyking/openclaw26`. Confirm every argument name and the allowed-column lists against `services/agent-router/supabaseTools.js` (PR #941) and fix this file first.

## Policy text (replaces the "Write to MPT DBs" rule on the Architecture page)

> **Write to Supabase, not Notion.** Everything the MPT agent generates that is operational data goes through the `mpt_supabase_write` tool into the RLS-protected Supabase tables: scan results → `mpt_osint_scan_results`; API rate-limit counters → `mpt_api_rate_limits`; channel metrics → `mpt_channel_metrics`. Engagement rows are written by the `mpt-leads` Worker; the agent does not write them. Do not write these records to the Notion MPT databases. Read platform metadata from the fleet Platform Intelligence database as before; never write to it.

## Instructions for the agent

1. **Scans.** After each scan, record one row per platform checked with `mpt_supabase_write` on `mpt_osint_scan_results`. Send only the fields below. Do not send `id`, `created_at` or `expires_at` (the database sets `expires_at` to 24 hours after creation) and leave `user_id` unset (anonymous scans stay service-only).
2. **Rate limits.** After calls to a platform API, upsert one row per `(platform, endpoint)` into `mpt_api_rate_limits`. `calls_made` is an absolute count that overwrites the previous value, not an increment.
3. **Channel metrics.** At most one upsert per `(platform, metric_date)` per day into `mpt_channel_metrics`.
4. **Failure.** If the tool answers that nothing was recorded, or errors, stop that write, tell the operator in the usual alert channel and do not retry more than once. **Do not fall back to Notion.** A silent fallback would split the data between two stores and hide the fault.
5. **Privacy.** `user_handle` is personal data with a 24-hour life. Never copy it into Notion, logs, chat messages or any other store.

## Field mapping (Notion field → Supabase column)

| Notion DB | Notion field | Supabase column | Rule |
|---|---|---|---|
| OSINT Scan Results | Session ID | `session_id` (text, required) | Same value as before. |
| | Platform (relation) | `platform` (text, required) | Send the platform's name as text (the Platform Intelligence page title). Not a relation or URL. |
| | User Handle | `user_handle` (text, required) | As before. |
| | Data Points Found | `data_points_found` (int ≥ 0) | |
| | Confidence Score | `confidence_score` (0–1) | If the Notion value was 0–100, divide by 100. The table rejects values above 1. |
| | Scan (title), Timestamp, Expires At | none | Dropped: `created_at` and `expires_at` are set by the database. |
| API Rate Limit Tracking | Platform / Endpoint | `platform`, `endpoint` (text, required) | Upsert key. |
| | Calls Made / Limit | `calls_made` (int ≥ 0), `call_limit` (int ≥ 0, required) | |
| | Reset Time / Last Checked | `reset_time`, `last_checked` (ISO 8601) | Send `last_checked` as the current time. |
| | Entry (title) | none | Dropped. |
| Channel Metrics | Platform / Date | `platform` (text), `metric_date` (YYYY-MM-DD) | Upsert key. |
| | DMs Sent / Responses Received | `dms_sent`, `responses_received` (int ≥ 0) | |
| | Conversion Rate | `conversion_rate` (0–1) | Notion shows it as a percent; send the fraction. |
| | Entry (title) | none | Dropped. |

## Call shape (draft, confirm against the router)

```json
{ "tool": "mpt_supabase_write",
  "args": { "table": "mpt_osint_scan_results", "operation": "insert",
            "row": { "session_id": "<id>", "platform": "<name>", "user_handle": "<handle>",
                     "data_points_found": 3, "confidence_score": 0.82 } } }
```
```json
{ "tool": "mpt_supabase_write",
  "args": { "table": "mpt_api_rate_limits", "operation": "upsert", "on_conflict": "platform,endpoint",
            "row": { "platform": "<name>", "endpoint": "<path>", "calls_made": 41, "call_limit": 100,
                     "reset_time": "2026-10-08T13:00:00Z", "last_checked": "2026-10-08T12:00:00Z" } } }
```
```json
{ "tool": "mpt_supabase_write",
  "args": { "table": "mpt_channel_metrics", "operation": "upsert", "on_conflict": "platform,metric_date",
            "row": { "platform": "<name>", "metric_date": "2026-10-08", "dms_sent": 12,
                     "responses_received": 3, "conversion_rate": 0.25 } } }
```

## Pre-cutover text to keep as the rollback copy

Not captured: the original text could not be located (see the inventory, row 10 and the open question). **Capture it before step 3 of the runbook**; the rollback depends on it.
