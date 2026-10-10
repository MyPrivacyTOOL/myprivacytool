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

## Notion publisher (MPC-7382, task 7/9)

After each run the Worker publishes summaries to Notion (`publishers/notion.js`, pace maths in `publishers/pace.js`):
- **Daily row** every run, in *Management & Data Analytics Hub* (data source `NOTION_DAILY_DATA_SOURCE_ID`): `Name`/`Date` = the UTC date, `GA4 Sessions`, `Website Visitors`, `Supabase Signups`, `Total Leads`, `Newsletter Signups`, source and read time in `Notes`.
  HubSpot, follower, YouTube, Blog Reads and Daily Growth Rate columns stay blank until their collectors exist.
- **Weekly row** on Mondays (UTC), in *MPT Total Project Channel Analytics and Metrics* (`NOTION_WEEKLY_DATA_SOURCE_ID`): `Entry` = `Week of YYYY-MM-DD`, `Week Of`, `Cumulative Scans`, `Conversion Rate %`, `Current MRR`, `GA4 Active Users`, `Blog Posts Published`, `X Threads Posted`, `Previous Week` linked to the prior Monday's row, `Pace Status` (On Track >= 0, At Risk 0 to -15, Behind below -15), source and read time of every number in `Agent Insights`.
- Numbers come from the views `mpt_daily_metrics` / `mpt_weekly_metrics` (MPC-7376). Counts only; no personal data.
- **Idempotent:** rows are found by date / `Week Of` and updated in place. A row whose `Notes` / `Agent Insights` does not start with `[mpt-metrics-collector]` was not written by the Worker and is never edited (this protects hand-entered rows and the older outreach rows).
- A source whose latest pull in `mpt_raw_metrics` is `status=error` leaves its cells blank. Nothing is estimated.
- Needs the Worker secret `NOTION_TOKEN` (Notion internal integration) and both databases shared with that integration (human step).
- Manual verification: `POST /run?weekly=1` runs the collectors, then publishes the daily and weekly rows regardless of weekday.
