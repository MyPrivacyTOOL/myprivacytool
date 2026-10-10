# mpt-mirror-risk (MPC-7252)

Thin Cloudflare Worker around `src/lib/mirrorRiskApi.ts`.

Routes: `POST /api/v1/scan`, `POST /api/v1/scan/batch`, `GET /api/v1/health`. Only `email` is checked against HIBP; phone, handle, domain and any failed check return `not_checked` with no score.

## Breach source
Free by default: `BREACH_PROVIDER = "xposedornot"` (no key; breach names only, no data classes or pastes). HIBP (paid, richer) is parked until revenue (Phase 5): set `BREACH_PROVIDER = "hibp"` and `wrangler secret put HIBP_API_KEY` (key: https://haveibeenpwned.com/API/Key).

The free provider receives the user's email, so the privacy policy must say so. Its commercial-use terms are not yet confirmed, and its response format was coded from public SDK docs and is unverified against the live API (any unexpected response returns `not_checked`, never "clean").

## Not deployed yet
No workflow deploys this Worker. To go live (owner steps):
1. Confirm the XposedOrNot terms + privacy-policy wording above.
2. Add a `deploy-mpt-mirror-risk.yml` modelled on `deploy-mpt-metrics-collector.yml`.
3. Live check: `curl -X POST https://mpt-mirror-risk.<account>.workers.dev/api/v1/scan -H 'content-type: application/json' -d '{"value":"you@example.com","type":"email"}'` and compare with https://xposedornot.com.
