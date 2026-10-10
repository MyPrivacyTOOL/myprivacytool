# mpt-digest (MPC-7383)

Monday 09:00 Hong Kong (cron `0 1 * * 1` UTC) Slack digest of at most five lines for Chris, built from the latest two
rows of the MPT weekly tracker (data source `49361779-2050-4d96-8f69-ad1da1636810`).

- Lines: scans vs target, pace status, biggest mover up/down, agent plan, failed sources + decisions needed.
- Never estimates: blank cells stay blank; a failed source is named; an unreadable tracker posts an error line with no figures.
- Optional `Agent Insights` lines read: `Plan: ...`, `Decision: ...`, `Failed sources: ga4, hubspot` (written by MPC-7382).

## Not done yet (blocked on MPC-7382 and Chris)
- Deploy workflow (model on `.github/workflows/deploy-mpt-leads.yml`), secrets `NOTION_TOKEN`, `SLACK_BOT_TOKEN`.
- Set `SLACK_CHANNEL_ID` in `wrangler.toml` (placeholder now).
- Notion: MPT Dashboard page, moving the Management & Data Analytics Hub database under the MyPrivacyTOOL hub.
- Deliver one real digest and record its Slack permalink.

Tests: `workers/mpt-digest/digest.vitest.mjs` (picked up by `npm test`).
