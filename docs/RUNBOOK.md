# MyPrivacyTOOL (MOT) technical runbook

Task: MPC-7250 (secondary deliverable). Written 2026-10-06 from the repo, the Notion page *MPT Infrastructure — GitHub, Cloudflare & Supabase (Ops)*, and read-only checks of the live Cloudflare and Supabase accounts on the same date.
**No secret values belong in this file. Names only.** Overlaps `docs/INFRASTRUCTURE.md` if that PR (#65) lands: that file is the short orientation, this one is the operating procedure.

| FLEET-TASK-V4.2 | |
|---|---|
| Goal | An on-call person who has not touched MOT before can deploy, roll back, monitor and diagnose Workers, Supabase and the Actions pipeline using this file alone. |
| Scope | Cloudflare Pages + Workers, Supabase project `xmdmkumwxpgahmlweuug`, GitHub Actions in `MyPrivacyTOOL/myprivacytool`. Documentation only: no infrastructure, secret, workflow or migration is changed by this file. |
| Out of scope | The Notion → Supabase agent cutover (MPC-6965, blocked on the MPC-6950 key rotation) is described only as a constraint (section 9). |
| Acceptance | Every procedure names the exact place to click or command to run; every alert listed exists (or is marked as a gap); every troubleshooting row maps a real log string or status to a cause; this file is linked from Notion. |
| Rollback of this doc | Revert the commit; archive the Notion page. Nothing else depends on it. |

## 1. System map

```
visitor ─► Cloudflare Pages `wwwmyprivacytool` (built from main) ─► Workers (MPT account 35cb17172c65a20f5cf1baf131485382)
                                                                     mpt-leads ─► Notion Leads DB, Slack, HubSpot, Supabase (engagement, baselines)
                                                                     mpt-scan-report ─► Supabase (users/leads/scans/signals), HubSpot, Resend, HIBP; cron */5
                                                                     myprivacytool-github-channel ─► GitHub API, Supabase channel_tokens, KV PROFILE_CACHE
                                                                     myprivacytool-oauth-poc ─► Google (stateless)
Supabase `xmdmkumwxpgahmlweuug`: RLS forced, service_role writes only; pg_cron purge + alert jobs
```

| Component | Source | Deploys via | URL / id |
|---|---|---|---|
| Site | repo root (Vite) | Cloudflare Pages auto-build on push to `main`; `postbuild` writes per-route HTML and `sitemap.xml` | `https://www.myprivacytool.io` |
| `mpt-leads` | `workers/mpt-leads` | `deploy-mpt-leads.yml` on merge | `https://mpt-leads.myprivacytool.workers.dev` |
| `mpt-scan-report` | `workers/scan-report` | `deploy-scan-report.yml` on merge; cron `*/5 * * * *` | `https://mpt-scan-report.myprivacytool.workers.dev` |
| `myprivacytool-github-channel` | `workers/github-channel` | `deploy-github-channel.yml`: tests on PR/push, deploy on `workflow_dispatch` | `https://channels.myprivacytool.io` (custom domain; `*.workers.dev` retired) |
| `myprivacytool-oauth-poc` | `workers/oauth-poc` | `deploy-oauth-poc.yml` on merge | `https://myprivacytool-oauth-poc.myprivacytool.workers.dev` |
| `telegram-webhook`, `webhook-receiver` | `workers/*` | not deployed (the second never was) | — |
| Database | `supabase/migrations`, `supabase/sql` | applied by a human or connector; **a merge does not apply them** | project `xmdmkumwxpgahmlweuug` |

Live check on 2026-10-06 (Cloudflare connector, read-only): the MPT account lists exactly four Workers — `mpt-leads`, `mpt-scan-report`, `myprivacytool-oauth-poc`, `myprivacytool-github-channel`. Re-run `workers_list` to confirm before relying on this.

Secret names per Worker are in `workers/<name>/EXPECTED_SECRETS.txt`. Non-secret settings live in each `wrangler.toml` (`wrangler deploy` **overwrites dashboard plain-text variables**, so never set a plain variable only in the dashboard).

## 2. Access you need

| Need | Where |
|---|---|
| Repo write | GitHub `MyPrivacyTOOL/myprivacytool`. A Claude Code cloud session holds write for one GitHub owner at a time. |
| Cloudflare | Dashboard login for the MPT account (not the personal cransford account). Claude's Cloudflare connector is read-only. |
| Supabase | Dashboard, or the Supabase connector (`execute_sql`, `apply_migration`, `query_logs`, advisors). |
| Repo Actions secrets | `CLOUDFLARE_API_TOKEN` (MPT account only, Workers Scripts: Edit), `CLOUDFLARE_ACCOUNT_ID`. scan-report optionally syncs `SCAN_REPORT_RESEND_API_KEY`, `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY`, `SCAN_REPORT_HUBSPOT_TOKEN`, `SCAN_REPORT_HIBP_API_KEY`. |
| Network note | Claude sandboxes block `api.cloudflare.com`, `*.workers.dev` and `myprivacytool.io`. Ask a human to run the `curl`, then verify the result in Supabase. |

## 3. Deployment procedures

### 3.1 Worker (all four)
1. Branch → change → run the Worker's tests locally:
   - `node workers/mpt-leads/worker.test.mjs`
   - `node workers/scan-report/worker.test.mjs` (run `node workers/scan-report/scripts/sync-guides.mjs` first if `optOutGuides.json` changed)
   - `node --test workers/github-channel/test/*.test.mjs`
   - `node --test workers/oauth-poc/oauth.test.mjs`
2. Open a PR; squash-merge to `main`.
3. Open **Actions** and read the run for the Worker. The deploy workflow snapshots secret *names* before and after `wrangler deploy`; it fails if any name changes or any name in `EXPECTED_SECRETS.txt` is missing. A green merge is not a green deploy.
4. Verify with the real outcome, not the run status:
   - `mpt-leads`: a human POSTs a test lead; check a new row in `public.mpt_user_engagement` (`select * from public.mpt_user_engagement order by created_at desc limit 5;`) and in the Notion Leads DB. Delete test rows afterwards.
   - `mpt-scan-report`: POST `/api/scan` with an allowlisted address; check `public.scans` and the received email; later `select report_status, report_attempts, report_last_error from public.scans order by created_at desc limit 5;`
   - `github-channel` / `oauth-poc`: `GET /health` returns `{"status":"ok"}`.
5. Report with a state word: LOCAL / PUSHED / MERGED / LIVE (LIVE only after step 4).

`github-channel` is deployed manually: Actions → *GitHub channel Worker* → Run workflow (the workflow refuses to deploy placeholder `REPLACE_*` config).

### 3.2 Site
Merge to `main`; Cloudflare Pages builds `npm run build` (+ `postbuild`: `prerender-meta.mjs`, `generate-sitemap.mjs`). Check the Pages deployment is green, then load the changed route. The Pages project needs `VITE_WORKER_ENDPOINT` (= the `mpt-leads` URL) and optionally `VITE_SCAN_API_URL` (scan-report) and `VITE_GITHUB_CHANNEL_URL`.

### 3.3 Database change
1. Add `supabase/migrations/<timestamp>_<name>.sql`, additive only, with its rollback written in the header comment.
2. Check the schema first (`list_tables`), apply (`apply_migration`), then run `get_advisors` for `security` and `performance`.
3. A merge never applies a migration. If the repo file and the live project disagree, the live project is the source of truth.

### 3.4 Rotating a Worker secret
Dashboard → Workers & Pages → the Worker → Settings → Variables and Secrets → pencil → **Rotate** → paste → **Deploy**. Secrets are write-only. `NOTION_TOKEN` is the internal Notion connection `mpt-leads-worker` and needs the MPT Leads database shared with it. `SUPABASE_SERVICE_ROLE_KEY` must be the legacy `service_role` key, never `anon`. Never print or commit a value.

## 4. Rollback procedures

| What | Fast rollback | Then |
|---|---|---|
| Worker code | Revert the merge commit on `main`; the workflow redeploys the previous code. Or Dashboard → the Worker → Deployments → select the last good version → **Rollback**. Or `wrangler rollback` from a machine with Cloudflare access (not exercised in this repo; general Cloudflare behaviour). | Confirm with the step 4 check in 3.1. Fix forward in a new PR. |
| Worker config / var | Revert the `wrangler.toml` change and redeploy. | |
| Secret | Rotate back to the previous value (kept by whoever owns the provider account, not in git). | A deleted secret cannot be recovered through the API; the deploy guard exists to catch this. |
| Site | Pages → `wwwmyprivacytool` → Deployments → last good → **Rollback**. | Revert the commit so the next build does not reintroduce it. |
| Migration | Run the rollback written in the migration header as a **new** migration. Never edit an applied one. | Re-run advisors. |
| `mpt-scan-report` mailing | Set `RECIPIENT_ALLOWLIST` in `wrangler.toml` to a test inbox (or `ALLOW_PARTIAL_REPORT = "false"` to hold reports) and redeploy: stops outbound mail without stopping intake. | |

Rows written by Workers are additive. Reverting code does not delete them; remove test rows deliberately.

## 5. Monitoring and alerts

What exists today:

| Signal | Where | Notes |
|---|---|---|
| Worker logs and exceptions | Dashboard → Worker → Observability → Events (enabled on all four) | `mpt-leads` has invocation logs persisted at 100% sampling. |
| Deploy guard | Actions run fails on changed or missing secret names | Per Worker workflow. |
| Report SLA | `mpt-scan-report` logs `ALERT: N report(s) past their 48h deadline` each cron run | Log line only; nothing pages anyone. |
| Purge health | `select * from public.mpt_purge_health();` | `healthy=false` if last success > 2h, any failure in 24h, or rows > 2h past expiry. |
| Purge alert | pg_cron `mpt-purge-alert` at `:30` hourly → Telegram "MPT Alerts" group via `pg_net` (token and chat id in Supabase Vault) | Test: `select public.mpt_purge_alert(true);` |
| Schema safety | Supabase advisors (`security`, `performance`) | Run after every DDL change. |
| Failed jobs | `select jobname, status, start_time from cron.job_run_details order by start_time desc limit 20;` | |
| Engagement proof | `mpt_user_engagement` row count growing | Fail-soft write: a silent Worker failure shows as no new rows. |

**Gaps (no alert exists):** Worker error-rate or CPU spikes, a 5xx rate on `/api/scan`, `report_status='failed'` rows in `scans`, Pages build failures, and Actions failures. Recommended: Cloudflare Notifications for Workers errors, a scheduled query alert on `scans where report_status='failed' or report_due_at < now() and report_status <> 'sent'`, and GitHub Actions failure emails to the owner.

Daily 2-minute check: Actions (red runs), Worker Observability (exceptions), `mpt_purge_health()`, `select count(*) from public.scans where report_status not in ('sent') and report_due_at < now();` (expect 0).

## 6. Troubleshooting

### 6.1 Worker failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `mpt-leads` 500 `{"error":"Save failed",...}`, Notion 401 `API token is invalid` | `NOTION_TOKEN` invalid or database not shared with the connection | Rotate `NOTION_TOKEN`; share MPT Leads with `mpt-leads-worker`. |
| `mpt-leads` returns success but no engagement row | The Supabase write is fail-soft | Read the log for `Supabase mpt_user_engagement insert failed: <status>`. |
| Log `401 Invalid API key` | `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_URL` wrong | Replace the secret. |
| Log `401 ... 42501 permission denied` | The `anon` key was pasted | Use the legacy `service_role` key. |
| Log `Supabase mpt_score_baselines ... failed` | Migration `mpc_7173_mpt_score_baselines` not applied, or key wrong | `list_tables`; apply the migration. |
| `scan-report` `POST /api/scan` 400 `Consent required` | Client sent `consent` other than boolean `true` | Fix the caller. |
| `scan-report` 500 `Could not record your scan request` | A Supabase error (malformed JSON now returns 400 `Invalid request`, MPC-7350) | Log line `scan submit failed:`; check the Supabase key and tables. |
| `mpt-leads` or `scan-report` 403 `Forbidden origin` | A browser request from a site other than myprivacytool.io / www (MPC-7350). Requests with no Origin header are still accepted | Expected for other sites. If it is the real site, check the `Origin` header the browser sends. |
| `mpt-leads` or `scan-report` 429 `Too many requests` | Per-IP rate limit (`RATE_LIMITER` binding in `wrangler.toml`: 10 per minute on `mpt-leads`, 5 per minute on `scan-report`) | Wait a minute. To disable, remove the `[[ratelimits]]` block and redeploy; the code fails open when the binding is absent. |
| Scan accepted but no email | `RECIPIENT_ALLOWLIST` excludes the address; `RESEND_API_KEY` missing; `confirmation held: recipient not in allowlist` in the log | Expected until launch approval; otherwise set the secret. |
| Reports stuck `pending` / `held` | No `HIBP_API_KEY` and `ALLOW_PARTIAL_REPORT` is `"false"`; or Resend failing | Check `report_last_error`; `report_attempts` ≥ 5 becomes `failed`. |
| Two confirmation emails | Both Workers sending | `mpt-leads` must have `CONFIRMATION_OWNER = "scan-report"` (set in its `wrangler.toml`); disable any HubSpot "Scan confirmed" workflow. |
| GitHub channel callback `?channel_error=connect_failed&stage=store` | Supabase write failed (key, `channel_tokens` columns) | Token is revoked at GitHub automatically; fix the cause and reconnect. |
| GitHub channel `invalid_state` | Cookie expired (10 min) or blocked | Retry from `/oauth/github/start`. |
| GitHub channel connected but SPA still shows "Connect" | Third-party cookie blocked (Safari, Firefox) | Known limitation: needs a custom domain for the Worker. |
| Profile 401 `reauthorize` | Token revoked at GitHub | User reconnects. |
| OAuth PoC `invalid_state` | State cookie missing/tampered, or `STATE_SIGNING_KEY` rotated mid-flow | Retry the flow. |
| Deploy fails `No such module ...json` or `Expected ";" but found "with"` | JSON imported with import attributes; wrangler 3 cannot bundle | Use a generated JS module (`workers/scan-report/scripts/sync-guides.mjs`). |
| Deploy fails `secret names changed across deploy` | A secret was added or removed | Compare the printed lists; restore the missing secret. |
| `wrangler deploy` wiped a setting | Dashboard-only plain variable | Put it in `wrangler.toml`. |

### 6.2 Database connection and permission errors

| Symptom | Likely cause | Fix |
|---|---|---|
| `permission denied for table ...` from a Worker | Wrong role key, or RLS forced with no policy | Workers must use `service_role`. |
| `permission denied` from the browser (anon) | By design | Never expose `service_role` to browser code; route writes through a Worker. |
| `new row violates check constraint channel_tokens_*_ciphertext` | Old constraint (`v1.` only) after a key rotation | Apply migration `channel_tokens_worker_columns`. |
| No rows in `mpt_osint_scan_results` | Expected: 24h TTL and hourly purge | `select * from public.mpt_purge_health();` |
| Purge alert fires | Job failed or lagging | `select * from cron.job_run_details where jobname like 'mpt-purge%' order by start_time desc limit 10;` then run `select public.mpt_purge_expired_scan_results();` |
| Supabase project paused (free plan) | Inactivity | Restore from the dashboard; confirm Workers recover. |
| Advisor warns of RLS disabled | New table without RLS | Add `enable` + `force row level security` and revoke `anon, authenticated`. |

### 6.3 GitHub Actions and access

| Symptom | Fix |
|---|---|
| Workflow stops at "repo secrets are not set" | Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in Settings → Secrets and variables → Actions. |
| Cloudflare 403 on the snapshot step | Token scope or account mismatch: token must be MPT-account, Workers Scripts: Edit. |
| Push 403 / repo not found in a Claude session | Session attached to the other GitHub owner; attach `MyPrivacyTOOL`. |
| `CONNECT tunnel failed, 403` to workers.dev | Sandbox allowlist; ask a human to curl. |
| Deploy workflow did not run | Path filters: only changes under `workers/<name>/**`, the workflow file, and (scan-report) `src/data/optOutGuides.json` trigger it; use `workflow_dispatch`. |

## 7. Incident checklist

1. Establish impact: lead capture (`mpt-leads`), scan intake/report (`mpt-scan-report`), site (Pages), or a channel.
2. Check Actions for a recent deploy; if one correlates, roll back (section 4) first, diagnose second.
3. Read Worker Observability for the failing minute; map the message with section 6.
4. Never paste a secret into chat, logs or a PR. If one leaks, treat it as MPC-6950 style: rotate, then record.
5. Record the outcome in the Notion task and add the new symptom to section 6.

## 8. Contacts and ownership
Accountable: `@cransford`. Agent work is tracked in the Notion *Tasks Fleet Master* database. Approvals for spend, production policy and real-user sends go to the human, never to an agent.

## 9. Constraints in force
- The Notion → Supabase cutover (MPC-6965) is **blocked** by the secret rotation MPC-6950. The agent does not write to Supabase until the grant and key land; do not change that plan from this runbook.
- `mpt-scan-report` only emails an allowlist until the legal pages (MPC-6545) are live and a real-user send is approved.
- OAuth (MPC-6971), legal pages and performance work are owned by their own tasks; this runbook only documents them.

## 10. Maintenance
Update this file in the same PR that changes a deploy path, a Worker route, a secret name or an alert. Review it quarterly alongside `quarterly-standards-rescan.yml`.
