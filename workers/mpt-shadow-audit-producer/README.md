# mpt-shadow-audit-producer

Authenticated front door that lets the Shadow Audit polling job (Cloud Run) push completed audits into the Cloudflare queue `mpt-shadow-audit-queue` without holding a Cloudflare API token (MPC-8644; unblocks MPC-8367).

- `POST /enqueue` with `Authorization: Bearer <PRODUCER_SECRET>`
- Body: `audit_id`, `created_at`, `outcome` (pass|warn|fail), `env` (staging|prod), `pillar_scores` (name -> 0..100). Other fields are dropped.
- Responses: 202 queued, 400 invalid body, 401 bad auth.

Deploy: `wrangler deploy`, then `wrangler secret put PRODUCER_SECRET` (never commit the value). The same value is stored in GCP Secret Manager as `mpt-audit-producer-secret` for the job.
