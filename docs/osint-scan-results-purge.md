# OSINT Scan Results — Expiry Purge (MPC-6957 / MPC-6977)

Scan results carry a 24-hour retention promise (`expires_at`). Expired rows are deleted by the database itself.

## How it works (live)
- **Store:** Supabase project `xmdmkumwxpgahmlweuug`, table `public.mpt_osint_scan_results` (RLS + FORCE; writes are service_role only; RLS also hides rows past `expires_at` from users).
- **Job:** `pg_cron` job `mpt-purge-expired-scan-results`, **hourly** (`0 * * * *`, UTC), calls `public.mpt_purge_expired_scan_results()` which deletes rows where `expires_at < now()`. Worst case a row lives ~1h past expiry (and is invisible to users via RLS during that time).
- **Delete semantics:** hard delete (no Trash/recovery window).
- **Logging:** run history is in `cron.job_run_details` (status + timing; no row contents).
- **SQL record:** `supabase/sql/mpt-purge-expired-scan-results.sql`.

## Monitoring
`select * from public.mpt_purge_health();` (service_role only) returns `healthy`, `last_success`, `failed_runs_24h`, `expired_rows`. `healthy = false` when the last success is >2h old, any run failed in 24h, or rows are >2h past expiry.

**Not yet automated:** pushing an alert on `healthy = false`. This needs an outbound channel secret (e.g. a Telegram bot token + chat id) held outside this repo — tracked as a follow-up.

## Verify
1. `select * from cron.job where jobname = 'mpt-purge-expired-scan-results';` → `active = true`.
2. `select * from public.mpt_purge_health();` → `healthy = true`.
3. `select count(*) from public.mpt_osint_scan_results where expires_at < now();` → `0` shortly after the top of the hour.

## Legacy Notion store
The Notion database *MPT OSINT Scan Results* is the pre-cutover store (agent still writes there until MPC-6977 cutover). It is not purged automatically; it held 0 rows on 2026-10-05. A Cloudflare Worker purge for it was written (PR #20) but never deployed, and has been removed — if Notion must hold scan rows again before cutover, add a Notion purge to `mpt-leads` or archive manually.
