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
Cloudflare dashboard -> Workers & Pages -> mpt-leads -> Edit code -> paste `worker.js` -> Deploy.
The dashboard keeps existing secrets. If deploying by API, upload with
`keep_bindings: ["secret_text","plain_text"]` or the secrets are dropped.

## Verify
Submit the scan email modal once, then in Supabase:
`select * from public.mpt_user_engagement order by created_at desc limit 5;`
Expect a row with `full_scan_completed = true`. Worker logs show
`Supabase mpt_user_engagement insert failed` on any failure.
