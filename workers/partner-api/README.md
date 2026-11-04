# mpt-partner-api (MPC-7651)

Server-to-server API for businesses that embed MyPrivacyTOOL exposure checks (HR platforms, financial services, white-label security firms).
Base path `/v1`, JSON, `Authorization: Bearer mpt_live_...`. Spec: `GET /v1/openapi.json` (source: `openapi.ts`).

| Route | What |
|---|---|
| `POST /v1/scan` `{value, type, reference?}` | One exposure check (email, phone, handle, domain), via the same engine as `mpt-mirror-risk`. Stores a result and a SHA-256 of the value, never the value. |
| `GET /v1/report/:id` | The stored result. Kept 30 days, then `410`. |
| `POST /v1/monitors`, `GET /v1/monitors`, `DELETE /v1/monitors/:id` | Register or stop a watch. Needs `subject_consent: true` and an https `webhook_url`. Delete overwrites the stored identifier. |
| `GET /v1/usage?month=YYYY-MM` | Billable scans and amount. |
| `GET /v1/health`, `GET /v1/openapi.json` | No key needed. |

## Rules in the code
- Keys are stored as SHA-256 only. Issue one with `node workers/partner-api/scripts/issue-key.mjs <partner_uuid> "label"`; it prints the key once plus the SQL to run.
- Requests with an `Origin` header are refused (`403 browser_not_allowed`): a key in a browser is a leaked key.
- Rate limit: 60/min per key, same binding keyed by IP before auth (fails open if the binding is missing). `429` + `Retry-After`. Optional `monthly_scan_cap` per partner.
- **Billing:** `$0.10` per `checked` scan. A `not_checked` result (no breach provider, upstream error) carries no score and is **not billed**. Volume bands in `pricing.ts` ($0.10 to 10k, $0.08 to 100k, $0.06 above) are a **proposal**; the brief only fixes $0.10.
- One error shape everywhere: `{"error":{"code","message"}}`. No upstream text is returned.

## Not done / needs a decision before go-live
1. **Breach provider.** With none configured (default, see `mpt-mirror-risk/README.md`) every email scan is `not_checked` and earns nothing. No partner can be billed until HIBP is licensed or another source is cleared.
2. **Monitor re-checks do not run.** Monitors are stored; nothing re-scans them or calls the webhook yet. Needs a cron (Workers Free allows 5 per account; `mpt-scan-report` uses one) or a Supabase `pg_cron` + queue. Do not sell `/monitor` until this exists.
3. **Privacy.** A partner sending a person's email is a processor relationship: needs a DPA and a privacy-policy line before the first partner. Legal, not code.
4. **Migration** `supabase/migrations/20261013010000_mpc_7651_partner_api.sql` must be applied, then a partner row inserted by hand.
5. **Deploy.** No workflow yet; model one on `deploy-mpt-leads.yml`. `RATE_LIMITER` namespace `7651001` and the final domain (`api.myprivacytool.io` is a placeholder in the spec) are to be confirmed. Secret: `SUPABASE_SERVICE_ROLE_KEY`.
6. **Success criteria** (3 pilot partners, $1000+/month) are commercial and not achievable from code alone.
7. The test suite `api.vitest.ts` could not be run in the authoring sandbox (npm registry blocked); CI runs it. The handler was smoke-run under Node with a stubbed engine and database.
