# mpt-leads Worker

Live lead-capture Worker for myprivacytool.io (`https://api.myprivacytool.io`, custom domain; the
`mpt-leads.myprivacytool.workers.dev` address still answers and is what the deploy smoke test uses;
Cloudflare account `35cb17172c65a20f5cf1baf131485382`). Accepts a POST on any path
(the scan email modal posts to `<endpoint>/webhook/leads`).

- `worker.js` is deployed as-is. History: first commit = source recovered from Cloudflare
  (modified 2026-08-19), second commit = MPC-6956 engagement write.
- Writes: Notion Leads DB, Slack, HubSpot, Resend confirmation email, and (MPC-6956)
  one `mpt_user_engagement` row in Supabase `xmdmkumwxpgahmlweuug` via service_role.
- Secrets (names only, set in Cloudflare): HUBSPOT_API_KEY, HUBSPOT_TOKEN, LEADS_DB_ID,
  NOTION_TOKEN, RESEND_API_KEY, SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL.

- MPC-7500: Hunter enrichment + readiness score (0-100) written to HubSpot, High Priority (> 80) alerts, and a
  5-minute cron retry sweep. See `docs/lead-scoring-mpc-7500.md`. Optional secrets: `HUNTER_API_KEY`, `ALERT_EMAIL`.

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

## Turnstile (MPC-8368)

The post-scan email form sends a Cloudflare Turnstile token as `cf-turnstile-response`; the Worker verifies it against the
`TURNSTILE_SECRET_KEY` secret. `TURNSTILE_ENFORCE = "true"` in `wrangler.toml` rejects failed or missing tokens with 403
`Verification failed`; `"false"` verifies and logs only. A Turnstile outage (siteverify unreachable) fails open.

Every failure is logged as one line starting `TURNSTILE_FAILED` followed by JSON (`ts`, `ip`, `country`, `origin`, `reason`,
`action` = `blocked_403` or `allowed_report_only`). `ip` is truncated to the network prefix (IPv4 `a.b.c.0/24`, IPv6 `/48`), never the
full address, and the line never carries the email or the token. Workers Logs retention is fixed by plan (3 days Free, 7 days Paid)
and cannot be set per line, which is why the address is cut before it is logged. Search the Worker logs for it to review false
positives. Rollback: set `TURNSTILE_ENFORCE = "false"` and merge (the deploy workflow ships it in about 2 minutes).

The custom domain is declared in `wrangler.toml` (`routes`, `custom_domain = true`); `wrangler deploy` keeps its DNS record and
certificate. The site posts to it via the Pages variable `VITE_WORKER_ENDPOINT` (production). To go back to `workers.dev`, set that
variable to `https://mpt-leads.myprivacytool.workers.dev` and redeploy the site.
