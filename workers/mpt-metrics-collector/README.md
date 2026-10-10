# mpt-metrics-collector

Daily raw-metrics collector for MPT analytics (MPC-7377, task 2/9; strategy: Notion "MPT Data & Analytics Strategy").
Appends one row per source per run to `public.mpt_raw_metrics` (created by MPC-7376, `supabase/sql/`).

- Cron: `15 16 * * *` UTC = 00:15 HKT every day, just after the Hong Kong day ends. All days and weeks are Hong Kong days (Monday start); the GA4 property must report in Asia/Hong_Kong. Manual run: `POST /run` with `Authorization: Bearer <COLLECTOR_TRIGGER_TOKEN>`. `GET /health` reports `configured`.
- Collectors are modules in `collectors/` exporting `{source, report, collect(env) -> {payload, error?}}`; register them in `worker.js`.
  A failing collector writes a `status=error` row and the others still run.
- `collectors/supabase-counts.js`: row counts of scans, users, leads, subscribers, mpt_user_engagement, interaction_log (counts only, no personal data).
- `collectors/ga4.js` (MPC-7378): GA4 Data API `runReport` for property 515216281 only, last complete Hong Kong day. One row per report, API response untouched in `payload`:
  `daily_overview` (sessions, activeUsers, screenPageViews, eventCount by date), `daily_events` (by eventName, incl. privacy_scan_completed), `daily_source_medium`, `daily_country`, `daily_landing_page`, and on Mondays `weekly_overview` (previous Mon..Sun activeUsers).
  A failed call writes `status=error` with an empty payload, so `mpt_daily_metrics` cells stay blank; nothing is estimated.
  Auth: Google service account (Viewer on the property, `analytics.readonly`); its JSON key is the Worker secret `GA4_SERVICE_ACCOUNT_JSON`.
- Secrets (names only, set in Cloudflare by a human): see `EXPECTED_SECRETS.txt`. Values never appear in the repo, logs or rows.

Deploy: `.github/workflows/deploy-mpt-metrics-collector.yml` (tests, deploy, secret-name check, health check).
Test: `node workers/mpt-metrics-collector/worker.test.mjs`.

## Cloudflare analytics collector (MPC-7381, task 6/9)

`collectors/cloudflare-analytics.js` pulls the previous full Hong Kong day from the Cloudflare GraphQL Analytics API as a cross-check on GA4 (Worker invocations use the exact HKT window; the zone dataset only buckets by UTC date, so zone numbers are for the UTC date with the same calendar date and are labelled `payload.zone_utc_day`):
zone `myprivacytool.io` (requests + unique visitors, `httpRequests1dGroups`) and Workers `mpt-leads`, `core-brain`, `social-listeners`
(invocations + errors, `workersInvocationsAdaptive`). Both untouched responses are stored in `payload.zone` / `payload.workers`.

- Secrets (set by a human): `CLOUDFLARE_ANALYTICS_TOKEN` = a token with **Analytics Read only** (CK-7318 notes `mpt-openclaw-readonly` already exists; never use the deploy token), and `CLOUDFLARE_ZONE_ID` = zone ID of myprivacytool.io.
- A failed call writes `status=error`; the failed half stays `null` (blank), the other half is kept.
- `supabase/sql/mpt-cloudflare-daily-metrics.sql`: view `mpt_cloudflare_daily` (visitors, requests, per-Worker invocations/errors per day). `mpt_daily_metrics` joins it on `metric_date` to show `cloudflare_visitors` next to GA4 active users.

## Notion publisher (MPC-7382, task 7/9)

`publishers/notion.js` runs after the collectors on every scheduled run and writes counts and summaries (no personal data) to Notion, reading the Supabase views `mpt_daily_metrics` / `mpt_weekly_metrics`.

- **Daily row** (yesterday's Hong Kong day) in *Management & Data Analytics MPT Hub* (data source `5bf43eae-1da1-438e-859d-56b241b5b1ac`), existing column names: `GA4 Sessions`, `Website Visitors` (GA4 active users), `Supabase Signups` (users created that day), `Newsletter Signups` (subscribers created that day), `Total Leads` (latest `supabase/table_counts` pull). Source and read time go in `Notes`. Columns with no source yet are not written.
- **Weekly row** (Mondays, for the week that just ended) in *MPT Total Project Channel Analytics and Metrics* (data source `49361779-2050-4d96-8f69-ad1da1636810`): `Entry` = `Week of YYYY-MM-DD`, `Week Of`, `Cumulative Scans`, `Conversion Rate %`, `Current MRR`, `GA4 Active Users`, `Blog Posts Published`, `X Threads Posted`, `Previous Week` (relation to the prior week's row), `Linked Objective` = O3, `Agent Insights` (source and read time of every number). `Pace Status` is set after writing, from Notion's own `Pace Gap %` formula: On Track at 0 or above, At Risk from 0 to -15, Behind below -15.
- **Idempotent:** rows are found by `Date` / `Week Of`; a re-run updates the same row. More than one match is an error, not a guess.
- **Existing rows are never edited:** a row is only updated if its `Notes` / `Agent Insights` starts with `[mpt-metrics-collector]`. Hand-made rows (e.g. the manual `Week of 2026-10-05` entry) are skipped and reported as `skipped_not_ours`. Older outreach columns are never written.
- **Blank, not estimated:** a NULL from the views (source missing or `status=error`) leaves the cell blank.
- Secret `NOTION_TOKEN` (internal integration token). Chris must share both databases with that integration. Optional vars `NOTION_DAILY_DATA_SOURCE_ID`, `NOTION_WEEKLY_DATA_SOURCE_ID` override the defaults above.
- Manual run: `POST /publish?day=YYYY-MM-DD&week=YYYY-MM-DD` with the same bearer token as `/run`.
- Test: `node workers/mpt-metrics-collector/publisher.test.mjs`.

## YouTube collector (MPC-7380, task 5/9)

`collectors/youtube.js` pulls the previous full Hong Kong day from the YouTube Data API v3 with `YOUTUBE_API_KEY` (sent as the `x-goog-api-key` header, never in the URL). Stores subscribers, total views and videos, videos published that day, per-video views/likes/comments in `payload.summary`, and the untouched responses in `payload.raw`. Channel `UC-chigimJFz4Rs8ulbDUeFQ` (override with `YOUTUBE_CHANNEL_ID`).

- Impressions are `null`: they need the YouTube Analytics API with OAuth from the channel owner (follow-up).
- X is not collected: the paid API tier is not approved.
- `supabase/sql/mpt-youtube-daily-metrics.sql`: view `mpt_youtube_daily` (not yet applied).
