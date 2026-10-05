# scan-report Worker (MPC-6677)

Makes the "report within 48 hours" promise true. One Worker owns **both** the confirmation email and the report.

```
/scan form --POST /api/scan--> mpt-scan-report
   -> Supabase: users, leads (UTM + consent evidence, 3y retention), scans (also the job queue)
   -> HubSpot contact upsert, lead_source_platform=web_scan
   -> confirmation email (Resend, idempotent, once per scan)
cron */5 min -> for each pending scan:
   HIBP breaches -> 5 brokers (never guessed) -> MPC-076 v1.0 score -> signals + hexagon_scores -> report email
```
GA4 `generate_lead` already fires client-side from `trackStartSignup` in `src/pages/Scan.tsx`.

## What the report really contains (and the confirmation email says only this)
- Breaches for the email (Have I Been Pwned). Needs `HIBP_API_KEY`; without it reports are **held**, not sent half-built (`ALLOW_PARTIAL_REPORT=true` overrides, breaches then labelled "not yet checked").
- Spokeo, Whitepages, BeenVerified, MyLife, Intelius: always **"not yet checked"**. The form collects an email only; these sites search by name and location and prohibit automated lookups. Removal links come only from `src/data/optOutGuides.json` (verified guides); MyLife and Intelius have none yet, so the email says so.
- Score 0-100 per MPC-076 v1.0, over checked categories only, labelled partial. Multipliers for email (1.5) and search (1.2) are our interpolation; broker/AI/social come from the spec.

## Safety gates
- `RECIPIENT_ALLOWLIST` (wrangler.toml) limits sends to test inboxes until the privacy policy (MPC-6545) is live and Chris approves a real-user send. Empty = open to everyone.
- Consent must be `true` in the request; it is never defaulted. One scan per address per 24h.
- To avoid duplicate senders set `CONFIRMATION_OWNER=scan-report` as a var on `mpt-leads`, and turn off any HubSpot workflow that sends "Scan confirmed".

## Secrets (names only; set with `wrangler secret put`)
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIBP_API_KEY`, `HUBSPOT_TOKEN`.

## Deploy (per the MPT Infrastructure Ops page)
Merge to `main` runs `.github/workflows/deploy-scan-report.yml` (same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets as `deploy-mpt-leads`; MPT account 35cb17172c65a20f5cf1baf131485382). Expected URL: `https://mpt-scan-report.myprivacytool.workers.dev`. Worker secrets are write-only and set by a human in the dashboard (Workers & Pages -> mpt-scan-report -> Settings -> Variables and Secrets). The Cloudflare connector is read-only, so it can confirm the Worker exists but not deploy.

## Frontend flag
Set `VITE_SCAN_API_URL` (Cloudflare Pages project `wwwmyprivacytool`, env var) to the Worker URL to enable. Unset = HubSpot-only, as today.

## Test
`node workers/scan-report/worker.test.mjs` (stubbed fetch, no network).
