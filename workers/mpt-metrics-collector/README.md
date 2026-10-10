# mpt-metrics-collector

Daily raw-metrics collector for MPT analytics (MPC-7377, task 2/9; strategy: Notion "MPT Data & Analytics Strategy").
Appends one row per source per run to `public.mpt_raw_metrics` (created by MPC-7376, `supabase/sql/`).

- Cron: `15 0 * * *` (00:15 UTC). Manual run: `POST /run` with `Authorization: Bearer <COLLECTOR_TRIGGER_TOKEN>`. `GET /health` reports `configured`.
- Collectors are modules in `collectors/` exporting `{source, report, collect(env) -> {payload, error?}}`; register them in `worker.js`.
  A failing collector writes a `status=error` row and the others still run.
- `collectors/supabase-counts.js`: row counts of scans, users, leads, subscribers, mpt_user_engagement, interaction_log (counts only, no personal data).
- Secrets (names only, set in Cloudflare by a human): see `EXPECTED_SECRETS.txt`. Values never appear in the repo, logs or rows.

Deploy: `.github/workflows/deploy-mpt-metrics-collector.yml` (tests, deploy, secret-name check, health check).
Test: `node workers/mpt-metrics-collector/worker.test.mjs`.

## Cloudflare analytics collector (MPC-7381, task 6/9)

`collectors/cloudflare-analytics.js` pulls the previous full UTC day from the Cloudflare GraphQL Analytics API as a cross-check on GA4:
zone `myprivacytool.io` (requests + unique visitors, `httpRequests1dGroups`) and Workers `mpt-leads`, `core-brain`, `social-listeners`
(invocations + errors, `workersInvocationsAdaptive`). Both untouched responses are stored in `payload.zone` / `payload.workers`.

- Secrets (set by a human): `CLOUDFLARE_ANALYTICS_TOKEN` = a token with **Analytics Read only** (CK-7318 notes `mpt-openclaw-readonly` already exists; never use the deploy token), and `CLOUDFLARE_ZONE_ID` = zone ID of myprivacytool.io.
- A failed call writes `status=error`; the failed half stays `null` (blank), the other half is kept.
- `supabase/sql/mpt-cloudflare-daily-metrics.sql`: view `mpt_cloudflare_daily` (visitors, requests, per-Worker invocations/errors per day). `mpt_daily_metrics` joins it on `metric_date` to show `cloudflare_visitors` next to GA4 active users.
