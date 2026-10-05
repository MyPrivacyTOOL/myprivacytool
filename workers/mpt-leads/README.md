# mpt-leads Worker

Live lead-capture Worker for myprivacytool.io (`mpt-leads.myprivacytool.workers.dev`,
Cloudflare account `35cb17172c65a20f5cf1baf131485382`). Accepts a POST on any path
(the scan email modal posts to `<endpoint>/webhook/leads`).

- `worker.js` is deployed as-is. History: first commit = source recovered from Cloudflare
  (modified 2026-08-19), second commit = MPC-6956 engagement write.
- Writes: Notion Leads DB, Slack, HubSpot, Resend confirmation email, and (MPC-6956)
  one `mpt_user_engagement` row in Supabase `xmdmkumwxpgahmlweuug` via service_role.
- Secrets (names only, set in Cloudflare): HUBSPOT_API_KEY, HUBSPOT_TOKEN, LEADS_DB_ID,
  NOTION_TOKEN, RESEND_API_KEY, SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL.

## Deploy
Merging to `main` deploys automatically: `.github/workflows/deploy-mpt-leads.yml` runs the stub
tests, snapshots the Worker's secret NAMES, runs `wrangler deploy` (secrets are not touched), and
then fails the run if any secret name changed or any name in `EXPECTED_SECRETS.txt` is missing.

One-time setup (human): create a Cloudflare API token (MPT account only, permission
Account > Workers Scripts > Edit) and add repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` (= 35cb17172c65a20f5cf1baf131485382).
Manual fallback: Cloudflare dashboard -> Workers & Pages -> mpt-leads -> Edit code -> paste -> Deploy.

## Test
`node workers/mpt-leads/worker.test.mjs` (stubbed fetch, no network, no secrets).

## Verify live
Submit the scan email modal once, then in Supabase (project xmdmkumwxpgahmlweuug):
`select * from public.mpt_user_engagement order by created_at desc limit 5;`
Expect a row with `full_scan_completed = true`. Worker logs show
`Supabase mpt_user_engagement insert failed` (with the HTTP status) on any failure.
