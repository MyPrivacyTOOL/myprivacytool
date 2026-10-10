# mpt-mirror-risk (MPC-7252)

Thin Cloudflare Worker around `src/lib/mirrorRiskApi.ts`.

Routes: `POST /api/v1/scan`, `POST /api/v1/scan/batch`, `GET /api/v1/health`. Only `email` is checked against HIBP; phone, handle, domain and any failed check return `not_checked` with no score.

## Not deployed yet
No workflow deploys this Worker. To go live (owner steps):
1. Get an HIBP key: https://haveibeenpwned.com/API/Key
2. `cd workers/mirror-risk && npx wrangler secret put HIBP_API_KEY`
3. Add a `deploy-mpt-mirror-risk.yml` modelled on `deploy-mpt-metrics-collector.yml`.
4. Live check with 3 real emails: `curl -X POST https://mpt-mirror-risk.<account>.workers.dev/api/v1/scan -H 'content-type: application/json' -d '{"value":"you@example.com","type":"email"}'`
