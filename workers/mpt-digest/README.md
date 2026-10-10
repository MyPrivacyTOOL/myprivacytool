# mpt-digest (MPC-7383)

Monday 09:00 Hong Kong (cron `0 1 * * 1` UTC) Slack digest of at most five lines for Chris, built from the latest two
rows of the MPT weekly tracker (data source `49361779-2050-4d96-8f69-ad1da1636810`).

- Lines: scans vs target, pace status, biggest mover up/down, agent plan, failed sources + decisions needed.
- Never estimates: blank cells stay blank; a failed source is named; an unreadable tracker posts an error line with no figures.
- Optional `Agent Insights` lines read: `Plan: ...`, `Decision: ...`, `Failed sources: ga4, hubspot` (written by MPC-7382).

## Status
- Deploy workflow: `.github/workflows/deploy-mpt-digest.yml`. Slack channel `#proj-myprivacytool` (`C0AR4TB6Y77`) set in `wrangler.toml`.
- Notion: MPT Dashboard page created under the MyPrivacyTOOL hub; Management & Data Analytics Hub database moved under it.
- Human steps: set Worker secrets `NOTION_TOKEN` (share the tracker with that integration) and `SLACK_BOT_TOKEN` (bot invited to the channel), then re-run the deploy workflow.
- Still to do: deliver one real digest and record its Slack permalink.

Tests: `workers/mpt-digest/digest.vitest.mjs` (picked up by `npm test`).
