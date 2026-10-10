# mpt-metrics-collector

Daily raw-metrics collector for MPT analytics (MPC-7377, task 2/9; strategy: Notion "MPT Data & Analytics Strategy").
Appends one row per source per run to `public.mpt_raw_metrics` (created by MPC-7376, `supabase/sql/`).

- Cron: `15 0 * * *` (00:15 UTC). Manual run: `POST /run` with `Authorization: Bearer <COLLECTOR_TRIGGER_TOKEN>`. `GET /health` reports `configured`.
- Collectors are modules in `collectors/` exporting `{source, report, collect(env) -> {payload, error?}}`; register them in `worker.js`.
  A failing collector writes a `status=error` row and the others still run.
- `collectors/supabase-counts.js`: row counts of scans, users, leads, subscribers, mpt_user_engagement, interaction_log (counts only, no personal data).
- `collectors/cloudflare-zone.js` and `collectors/cloudflare-workers.js` (MPC-7381, task 6/9): Cloudflare GraphQL Analytics API pull of the last complete UTC day, as a cross-check on GA4 (consent banners and ad blockers hide visitors from GA4).
  `cloudflare/zone_daily` = requests and unique visitors for zone myprivacytool.io; `cloudflare/workers_daily` = invocations and errors for `mpt-leads`, `core-brain`, `social-listeners`. The API data is stored untouched in `payload`.
  Auth is a **read-only** token (Analytics Read only) in `CLOUDFLARE_ANALYTICS_TOKEN`; never reuse the deploy token. A failed call writes `status=error` with an empty payload, so the cell stays blank.
  `supabase/sql/mpt-cloudflare-daily-metrics.sql` adds `cloudflare_*` columns and `cloudflare_visitors_minus_ga4_active_users` to `mpt_daily_metrics` (apply after `mpt-raw-metrics.sql`).
- Secrets (names only, set in Cloudflare by a human): see `EXPECTED_SECRETS.txt`. Values never appear in the repo, logs or rows.

Deploy: `.github/workflows/deploy-mpt-metrics-collector.yml` (tests, deploy, secret-name check, health check).
Test: `node workers/mpt-metrics-collector/worker.test.mjs`.
