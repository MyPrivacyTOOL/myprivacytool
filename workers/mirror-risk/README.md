# mpt-mirror-risk (MPC-7252)

Thin Cloudflare Worker around `src/lib/mirrorRiskApi.ts`.

Routes: `POST /api/v1/scan`, `POST /api/v1/scan/batch`, `GET /api/v1/health`. Only `email` is checked against HIBP; phone, handle, domain and any failed check return `not_checked` with no score.

## Breach source
**None by default** (`BREACH_PROVIDER` unset): every email lookup returns `not_checked`, and no third party is called.

- `xposedornot` (free, no key) exists in the code but must NOT be enabled for the product without written permission: XposedOrNot's Terms (https://xposedornot.com/terms, last updated July 2026) say commercial use of their data requires a licensing agreement (s.4), require attribution (s.5) and forbid rate-limit workarounds (s.5). Reviewed 2026-10-12; see Notion MPC-7252.
- `hibp` (paid) is parked until Phase 5 (revenue): `BREACH_PROVIDER = "hibp"` + `wrangler secret put HIBP_API_KEY`. Key: https://haveibeenpwned.com/API/Key

Either provider receives the user's email, so the privacy policy must say so before one is enabled. Parsing of the XposedOrNot response was coded from public SDK docs and is unverified against the live API (any unexpected response returns `not_checked`, never "clean").

## Not deployed yet
No workflow deploys this Worker. Before any deploy: (1) pick a provider with a licence that covers commercial use, (2) update the privacy policy, (3) add a deploy workflow modelled on `deploy-mpt-metrics-collector.yml`, (4) run one live check with a real email.
