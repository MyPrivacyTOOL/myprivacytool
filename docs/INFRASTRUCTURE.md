# MyPrivacyTOOL infrastructure (GitHub, Cloudflare, Supabase)

Source of truth for how MPT is built and deployed. Written 2026-10-05 from the Notion page
"MPT Infrastructure - GitHub, Cloudflare & Supabase (Ops)" and checked against this repo's workflows.
**No secret values belong in this file. Names only.** Update it whenever any of this changes.

## Layout

| Layer | Where | Notes |
|---|---|---|
| Code | GitHub `MyPrivacyTOOL/myprivacytool` | Site + `workers/*` + `supabase/migrations/`. Not the `krispyking/*` fleet repos. |
| Site | Cloudflare Pages project `wwwmyprivacytool` | Built from `main`; auto-deploys on push. |
| Workers | Cloudflare MPT account (id `35cb17172c65a20f5cf1baf131485382`) | `mpt-leads`, `mpt-scan-report`, `myprivacytool-oauth-poc`. |
| Database | Supabase project `xmdmkumwxpgahmlweuug` | `mpt_*` tables plus the scan-report tables. RLS enabled and forced; only `service_role` writes. |

The old personal Cloudflare account is **not** part of MPT. Nothing is deployed through the droplet relay.

## Deploying

Merge to `main`; GitHub Actions does the rest.

| Workflow | Triggers on changes to | Does |
|---|---|---|
| `deploy-mpt-leads.yml` | `workers/mpt-leads/**` | tests, secret-name guard, `wrangler deploy` |
| `deploy-scan-report.yml` | `workers/scan-report/**`, `src/data/optOutGuides.json` | regenerates `lib/guides.generated.js`, tests, `wrangler deploy` |
| `deploy-oauth-poc.yml` | `workers/oauth-poc/**` | tests, secret-name guard, `wrangler deploy` |

Needs repo Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
Always check the Actions run after merging: a green merge does not mean a green deploy.

Database changes: add a file under `supabase/migrations/` and apply it to the Supabase project (the merge does not apply it).

## Secrets

Secrets are write-only in Cloudflare: values cannot be read back, only replaced. `wrangler deploy` leaves them alone
but **replaces plain-text dashboard variables**, so non-secret vars must live in `wrangler.toml`.
Expected secret names per Worker are in `workers/<name>/EXPECTED_SECRETS.txt`. The deploy fails if names go missing.

To rotate: Cloudflare dashboard -> Workers & Pages -> the Worker -> Settings -> Variables and Secrets -> Rotate -> paste -> Deploy.

## Rollback

- Site: Cloudflare Pages -> `wwwmyprivacytool` -> Deployments -> pick the last good deploy -> Rollback; then revert the commit on `main`.
- Worker: revert the commit on `main` (the workflow redeploys), or `wrangler rollback` from a machine with Cloudflare access.
- Database: migrations here are additive; undo with a new migration, not by editing an applied one.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `mpt-leads` returns 500 `Save failed`, Notion 401 | `NOTION_TOKEN` invalid: rotate it. |
| Log `Supabase ... insert failed: 401 Invalid API key` | `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_URL` wrong. |
| Log `401 ... 42501 permission denied` | The anon key was pasted; use the legacy `service_role` key. |
| Worker returns success but no row | The Supabase write is fail-soft and only logs: read the Worker log (Dashboard -> Worker -> Observability). |
| Worker deploy: `No such module ...json` or `Expected ";" but found "with"` | JSON imported with import attributes. Wrangler 3.x cannot bundle them; use a generated JS module (see `workers/scan-report/scripts/sync-guides.mjs`). |
| Scan-report feature does nothing | Needs the Worker deployed and the migration applied. The site posts to the Worker by default (MPC-7385); check `VITE_SCAN_API_URL` is not set to an empty string in the Pages project, and that the address is in `RECIPIENT_ALLOWLIST` while the allowlist is in place. |
| Push 403 / repo not found in a Claude session | Session is attached to the other GitHub owner. |
