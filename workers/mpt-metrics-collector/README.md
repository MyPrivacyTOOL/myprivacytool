# mpt-metrics-collector

Daily raw-metrics collector for MPT analytics (MPC-7377, task 2/9; strategy: Notion "MPT Data & Analytics Strategy").
Appends one row per source per run to `public.mpt_raw_metrics` (created by MPC-7376, `supabase/sql/`).

- Cron: `15 0 * * *` (00:15 UTC). Manual run: `POST /run` with `Authorization: Bearer <COLLECTOR_TRIGGER_TOKEN>`. `GET /health` reports `configured`.
- Collectors are modules in `collectors/` exporting `{source, report, collect(env) -> {payload, error?}}`; register them in `worker.js`.
  A failing collector writes a `status=error` row and the others still run.
- `collectors/supabase-counts.js`: row counts of scans, users, leads, subscribers, mpt_user_engagement, interaction_log (counts only, no personal data).
- `collectors/ga4.js` (MPC-7378): GA4 Data API `runReport` for property 515216281 only, last complete UTC day. One row per report, API response untouched in `payload`:
  `daily_overview` (sessions, activeUsers, screenPageViews, eventCount by date), `daily_events` (by eventName, incl. privacy_scan_completed), `daily_source_medium`, `daily_country`, `daily_landing_page`, and on Mondays `weekly_overview` (previous Mon..Sun activeUsers).
  A failed call writes `status=error` with an empty payload, so `mpt_daily_metrics` cells stay blank; nothing is estimated.
  Auth: Google service account (Viewer on the property, `analytics.readonly`); its JSON key is the Worker secret `GA4_SERVICE_ACCOUNT_JSON`.
- Secrets (names only, set in Cloudflare by a human): see `EXPECTED_SECRETS.txt`. Values never appear in the repo, logs or rows.

Deploy: `.github/workflows/deploy-mpt-metrics-collector.yml` (tests, deploy, secret-name check, health check).
Test: `node workers/mpt-metrics-collector/worker.test.mjs && node workers/mpt-metrics-collector/ga4.test.mjs`.
