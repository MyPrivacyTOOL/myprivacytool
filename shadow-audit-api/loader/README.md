# Audit-trail loader (MPC-8364)

Turns the OpenClaw router's audit trail (`/opt/openclaw/audit/audit-*.jsonl`) into rows for the Shadow
Audit API log table `agent_logs.logs`. Standard library only (Python 3.8+). It does not upload anything.

## What it reads, and what that means for the audit
| Source field | Table column |
|---|---|
| `timestamp` | `ts` |
| `target_id` (when `target_type` = tool) | `tool` |
| `correlation_id` (falls back to `details.task_id`) | `session` (**verify** this really is the session) |
| `actor_id` | `agent_id` |
| built from `event_type` + `details.outcome_summary` / `error` / `reason` / `param_keys` | `text` (masked, max 500 chars) |
| none | `vault_start`, `vault_end` (empty), `nonce`, `sender`, `dest_region` (NULL) |

By default the source holds tool names, timing, outcomes and the **names** of parameters, never their values. So
detectors #41, #42 and #99 have nothing to read, #9, #65 and #119 have no data, and #51 (tool loops) and
#57/#58 (secrets, only inside outcome summaries and errors) are the ones that can fire. `details._raw` can
contain raw tool output and is never read. Only agent tool events and sensitive-data events are loaded;
`log_rolled` housekeeping is skipped.

## Argument values (MPC-8428, opt-in per agent)
When the router runs with `AUDIT_ARG_VALUES_AGENTS=<agent>`, it writes masked argument values to a separate
`args-YYYY-MM-DD.jsonl` sidecar (30-day retention, outside the hash chain). The loader joins it to the
`tool_execution_started` event by `event_id` and appends `| args: k=v; ...` to `text`; the run summary shows
`with_arg_values`. With the sidecar absent, output is unchanged and #41/#42/#99 stay **partial coverage**.
Values are masked in the router and masked again here. Masking covers secrets and emails only, not names or
phone numbers, so keep this to non-prod agents until personal-data rules exist.

## Masking
Done on the droplet, before anything leaves it. Secrets are replaced but keep the shape the detectors look
for (prefix, character class, length), e.g. `AKIA` + `X`*16, `sk_live_XXXX…`, `password: ********`.
Other secret shapes (private keys, JWTs, GitHub/Slack/Notion/Google/API keys) become `[REDACTED:...]`;
email addresses become `[EMAIL]`. Keep the four shaped patterns in step with `CRED_RE` in
`app/services/detectors.py` (a test checks this).

## Use (non-prod agents only; read-only on the droplet)
```bash
cd shadow-audit-api
python3 -m loader.audit_log_loader --agent testingnt69 --dry-run                      # counts only
python3 -m loader.audit_log_loader --agent testingnt69 --out /tmp/rows.ndjson         # writes masked rows
python3 -m loader.audit_log_loader --agent testingnt69 --since 2026-10-09T09:54:06.885Z --out /tmp/rows.ndjson
```
The run prints the timestamp to pass as `--since` next time. Loading into BigQuery (from Cloud Shell, after
copying the file there):
```bash
bq load --source_format=NEWLINE_DELIMITED_JSON mpt-digital-shadow---deepseek:agent_logs.logs rows.ndjson
```
Re-loading the same window with `bq load` creates duplicates; use `--since`. The audit log is hash-chained
(`previous_hash`/`entry_hash`); this loader does **not** verify the chain.

## Sending rows without copying files (`--push`)
`--push https://<ingest-service>` posts the masked rows in batches to the ingest endpoint (see `../INGEST.md`). The token comes from `--token-file` (or the `SHADOW_INGEST_TOKEN` environment variable), never from the command line. `--state-file` remembers where the last successful push ended (minus 5 seconds of overlap; the endpoint drops duplicates), so scheduled runs send only what is new. A failed push exits non-zero and does not move the state forward. `http://` URLs are refused.
