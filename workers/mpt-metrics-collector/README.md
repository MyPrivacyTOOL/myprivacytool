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

## HubSpot collector (MPC-7379, task 4/9)

`collectors/hubspot.js` stores one `source=hubspot, report=portal_daily` row per run for MPT's portal **246502821** (constant `HUBSPOT_PORTAL_ID`). Counts and aggregates only: total contacts, contacts created on the previous Hong Kong day, contacts per lifecycle stage (plus `(none)`), deals per pipeline/stage with count and amount sum. No emails, names, phone numbers or deal names are requested or stored; searches ask for one record with only `hs_object_id` and keep just `total`.

- **Portal guard:** the first call is `GET /account-info/v3/details`. If the portal ID differs from 246502821, or cannot be read, the row is `status=error` and nothing else is read (`payload.guard`).
- **Read-only:** secret `HUBSPOT_READONLY_TOKEN` (a read-only private-app token; not the write-capable `HUBSPOT_TOKEN` / `HUBSPOT_API_KEY` other Workers hold). `hubspotRead()` only allows GET and the contact/deal search endpoints. The token is redacted from error text, and error text carries the HTTP status only.
- Scopes needed on the private app: `crm.objects.contacts.read`, `crm.objects.deals.read`, `crm.schemas.contacts.read`, `crm.schemas.deals.read` (pipelines, lifecycle options).
- `supabase/sql/mpt-hubspot-daily.sql`: view `mpt_hubspot_daily` and `hubspot_total_contacts` / `hubspot_new_contacts` appended to `mpt_daily_metrics`. Total contacts is the count when the run happened; new contacts is for the Hong Kong day in `payload.day`.
- Test: `node workers/mpt-metrics-collector/hubspot.test.mjs`.

## Monday Slack digest (MPC-7383, task 8/9)

`publishers/slack-digest.js` + `lib/digest.js`. Second cron `0 1 * * 1` = Monday 01:00 UTC = **09:00 Hong Kong**. It reads the latest two rows of the weekly tracker (the Monday 00:15 HKT publish has just written the week that ended) and posts **at most five lines** to Chris:
scans against target, pace status, biggest mover up and down (week on week), the agent's plan, and failed sources plus anything needing his decision.

- **Never an estimate.** A blank cell stays blank and is not used as a mover. Failed sources are named (`DATA GAP: ga4, hubspot failed`): any source whose latest pull per report in the last 48h is `status=error` in `mpt_raw_metrics`. If the tracker cannot be read, the message says so and shows no figures.
- **Agent plan / decision:** read from `Plan:` and `Decision:` lines in the row's `Agent Insights` (written by the agent, task 9/9). Missing => "none recorded" / "nothing".
- **Secrets (set by a human in Cloudflare; names only here):** `SLACK_BOT_TOKEN` (bot token with `chat:write`, bot invited to the channel or allowed to DM) and `MPTSLACK_CHANNEL_ID` (Chris's DM or the channel). Until both are set the digest cron logs "digest skipped" and does nothing; the daily run is unaffected.
- **Manual / verification:** `POST /digest?dry=1` returns the text without posting; `POST /digest` posts and returns `{ts, channel, permalink}` (same bearer token as `/run`). Record the permalink as evidence.
- Test: `node workers/mpt-metrics-collector/digest.test.mjs`.
- Chris's page: **MPT Dashboard** under the MyPrivacyTOOL hub (linked views only, no copied data): https://app.notion.com/p/3f528547eaa78102917edbc1acc368ee
