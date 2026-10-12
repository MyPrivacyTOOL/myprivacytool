# Secrets audit (MPC-7385)

Audit date: 2026-10-11. Scope: `MyPrivacyTOOL/myprivacytool` (all branches, all open/closed PR refs, full history)
and `MyPrivacyTOOL/MPT` (full history). Names only — no values appear in this file or anywhere in the repo.

## 1. Committed-secret sweep

The go-live ticket reported a Cloudflare API token ("all permissions") and the Supabase secret key committed in
plaintext in `WEBSITE_CONTROL.md`. Findings:

| Check | Result |
|---|---|
| `WEBSITE_CONTROL.md` in `myprivacytool` (957 commits, 172 branches, 225 PR refs) | **Never existed** in any commit |
| `WEBSITE_CONTROL.md` in `MPT` (all branches) | **Never existed** in any commit |
| `sb_secret_…`, `sbp_…`, `cfut_…`, service-role JWTs (`eyJhbGciOi…`) added anywhere in `myprivacytool` history | None (only truncated placeholders in `workers/core-brain/.env.example`) |
| `*_API_TOKEN` / `*_SERVICE_ROLE_KEY` / `*_SECRET_KEY` assigned a 30+ char literal in `myprivacytool` history | None |

No history rewrite was done because there was nothing to scrub. The leaked file is
`agents/myprivacytool/WEBSITE_CONTROL.md` in the agent workspace, outside this repo (Notion: MyPrivacyTOOL →
STANDING_OBJECTIVES, O2). Status as recorded there:

- **Cloudflare token:** closed. It was redacted in that repo (PR #598), and Cloudflare reported it invalid on 2026-08-30.
- **Supabase secret key:** **rotation in progress (2026-10-12).** The leaked key is a legacy JWT service_role key. A new
  secret key (`sb_secret_...`) was created and copied to scan-report, mpt-leads, mpt-metrics-collector, github-channel,
  core-brain and social-listeners by the manual workflow `rotate-supabase-key.yml` (GitHub secret
  `NEW_SUPABASE_SECRET_KEY`; deploy workflows now prefer it). The Cloudflare Pages secret `SUPABASE_SERVICE_ROLE_KEY`
  (site edge capture) is set by hand in the Pages dashboard and needs a site redeploy. **The old key is NOT revoked yet:**
  disabling the legacy keys also disables the legacy anon key, so first confirm in the Supabase API logs that no caller
  still sends a legacy JWT (`request.sb.jwt.apikey.payload.role`). Tracked in Notion as MPC-7385-F5.

Guardrails: `.gitignore` excludes `.env`, `.env.*` and `.dev.vars*`. `scripts/ci/scan-secrets.mjs` runs as a
blocking step in the `ci.yml` lint job, so a committed key fails the PR. Its allowlist skips a PEM header followed by
a `${…}` template, which only matches the runtime-generated test key in `workers/mpt-metrics-collector/ga4.test.mjs`.

## 2. GitHub Actions repository secrets

Set in *Settings → Secrets and variables → Actions*.

| GitHub secret | Workflows | Passed to |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy, deploy-scan-report, deploy-mpt-leads, deploy-mpt-digest, deploy-mpt-metrics-collector, deploy-github-channel, deploy-oauth-poc, deploy-telegram-webhook, rollback | wrangler-action `apiToken` (deploy only; scope it to *Workers Scripts: Edit* on the account, not "all permissions") |
| `CLOUDFLARE_ACCOUNT_ID` | same as above | wrangler-action `accountId` (identifier, not a secret, but kept alongside) |
| `SUPABASE_URL` | deploy | core-brain, social-listeners Worker secret |
| `SUPABASE_KEY` | deploy | core-brain, social-listeners Worker secret |
| `WEBHOOK_SECRET` | deploy, core-brain-gates, core-brain-rate-limit | core-brain Worker secret; CI smoke tests |
| `QWEN_API_KEY` | deploy | core-brain Worker secret (optional) |
| `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `X_CONSUMER_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `CORE_BRAIN_TOKEN`, `TELEGRAM_BOT_TOKEN` | deploy | social-listeners Worker secrets (each optional) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | register-telegram-webhook | Telegram `setWebhook` call |
| `SCAN_REPORT_RESEND_API_KEY` | deploy-scan-report | → `RESEND_API_KEY` on scan-report |
| `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY` | deploy-scan-report | → `SUPABASE_SERVICE_ROLE_KEY` on scan-report |
| `SCAN_REPORT_HUBSPOT_TOKEN` | deploy-scan-report | → `HUBSPOT_TOKEN` on scan-report |
| `SCAN_REPORT_HIBP_API_KEY` | deploy-scan-report | → `HIBP_API_KEY` on scan-report |
| `SUPABASE_ACCESS_TOKEN` | deploy-supabase | Supabase CLI (personal access token) |
| `SUPABASE_DB_PASSWORD` | deploy-supabase | Supabase CLI `db push` |
| `SUPABASE_PROJECT_ID` | deploy-supabase | Supabase CLI link (identifier) |

### scan-report prefix mapping (verified)

`.github/workflows/deploy-scan-report.yml` ("Sync Worker secrets from GitHub secrets" step) reads the
`SCAN_REPORT_`-prefixed GitHub secrets and drops the prefix before `wrangler secret put`:

```
SCAN_REPORT_HIBP_API_KEY              → HIBP_API_KEY
SCAN_REPORT_HUBSPOT_TOKEN             → HUBSPOT_TOKEN
SCAN_REPORT_RESEND_API_KEY            → RESEND_API_KEY
SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SERVICE_ROLE_KEY
```

An empty secret is skipped and logged as "skipped NAME (no GitHub secret)", so a missing one does not fail the
deploy. Look for that line in the run log to find out which secrets are unset.

## 3. Cloudflare Worker secrets (by Worker)

Set with `npx wrangler secret put NAME` in the Worker's directory, or in the Cloudflare dashboard (*Workers → Settings →
Variables and Secrets*). The "Synced by CI" column says whether a deploy workflow writes the secret. If it says no, a
human has to set it.

| Worker | Secret | Referenced in | Synced by CI | In `EXPECTED_SECRETS.txt` |
|---|---|---|:-:|:-:|
| core-brain | `SUPABASE_URL`, `SUPABASE_KEY`, `WEBHOOK_SECRET`, `QWEN_API_KEY` | `workers/core-brain/` | ✅ deploy.yml | ✅ |
| social-listeners | `SUPABASE_URL`, `SUPABASE_KEY`, `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `X_CONSUMER_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `CORE_BRAIN_TOKEN`, `TELEGRAM_BOT_TOKEN` | `workers/social-listeners/` | ✅ deploy.yml | ✅ |
| scan-report | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIBP_API_KEY`, `HUBSPOT_TOKEN` | `workers/scan-report/` | ✅ deploy-scan-report.yml | ✅ |
| scan-report | `UNSUBSCRIBE_SECRET` | `workers/scan-report/index.js` (unsubscribe links, day 3/7 follow-ups) | ❌ | optional, omitted on purpose |
| mpt-leads | `HUBSPOT_API_KEY`, `HUBSPOT_TOKEN`, `NOTION_TOKEN`, `RESEND_API_KEY`, `SLACK_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL` (+ `LEADS_DB_ID`, `SLACK_CHANNEL_ID` ids) | `workers/mpt-leads/` | ❌ | ✅ |
| mpt-leads | `HUNTER_API_KEY` | `workers/mpt-leads/lead-scoring.js` (optional enrichment) | ❌ | optional, omitted on purpose |
| mpt-metrics-collector | `CLOUDFLARE_ANALYTICS_TOKEN`, `COLLECTOR_TRIGGER_TOKEN`, `GA4_SERVICE_ACCOUNT_JSON`, `HUBSPOT_READONLY_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOUTUBE_API_KEY` (+ `CLOUDFLARE_ZONE_ID`, `MPTSLACK_CHANNEL_ID` ids) | `workers/mpt-metrics-collector/` | ❌ | ✅ |
| github-channel | `GITHUB_CLIENT_SECRET`, `STATE_SIGNING_KEY`, `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `workers/github-channel/` | ❌ | ✅ |
| github-channel | `REDDIT_CLIENT_SECRET` | `workers/github-channel/lib/reddit-routes.js` (optional Reddit OAuth) | ❌ | optional, omitted on purpose |
| oauth-poc | `GOOGLE_CLIENT_SECRET`, `STATE_SIGNING_KEY` | `workers/oauth-poc/` | ❌ | ✅ |
| oauth-poc | `SUPABASE_SERVICE_ROLE_KEY` (+ `SUPABASE_URL`) | `workers/oauth-poc/supabase.js` (optional account linking) | ❌ | optional, omitted on purpose |
| telegram-webhook | `TELEGRAM_BOT_TOKEN`, `HUBSPOT_API_KEY`, `WEBHOOK_SECRET` | `workers/telegram-webhook/` | ❌ | ✅ |
| webhook-receiver | `EMAIL_WEBHOOK_SECRET`, `FIRESTORE_SA_TOKEN`, `HUBSPOT_API_KEY`, `META_APP_SECRET`, `META_PAGE_ACCESS_KEY`, `META_VERIFY_KEY`, `META_WHATSAPP_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN` | `workers/webhook-receiver/` | ❌ (no deploy workflow) | ✅ (not enforced: no deploy workflow) |
| mirror-risk | none | — | — | ✅ (empty) |

## 4. Upstream source of each credential (where it is minted or rotated)

| Credential | Minted / rotated in | Copy the new value to |
|---|---|---|
| Cloudflare API token (deploy) | Cloudflare dashboard → *My Profile → API Tokens* | GitHub secret `CLOUDFLARE_API_TOKEN` only |
| Cloudflare analytics token | Cloudflare dashboard → API Tokens (Analytics: Read) | mpt-metrics-collector Worker secret |
| Supabase secret / service-role key | Supabase dashboard → *Project Settings → API Keys* | GitHub `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY`; Worker secret `SUPABASE_SERVICE_ROLE_KEY` on **mpt-leads, mpt-metrics-collector, github-channel, oauth-poc, webhook-receiver** (scan-report picks it up on the next deploy) |
| Supabase `SUPABASE_KEY` (core-brain / social-listeners) | Supabase dashboard → API Keys | GitHub secret `SUPABASE_KEY` (deploy.yml syncs both Workers) |
| Supabase anon / publishable key | Supabase dashboard → API Keys | mpt-leads Worker secret |
| Supabase access token / DB password | Supabase account → Access Tokens; project → Database settings | GitHub `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` |
| HubSpot private-app tokens | HubSpot → Settings → Private Apps | `SCAN_REPORT_HUBSPOT_TOKEN`; Worker secrets on mpt-leads, telegram-webhook, webhook-receiver, mpt-metrics-collector (read-only token) |
| Resend, HIBP, Hunter, Notion, Slack, Qwen, Twilio, Meta, X, Telegram, Google/GitHub/Reddit OAuth, YouTube, GA4 | Each vendor's console | The Workers listed in section 3 |
| `WEBHOOK_SECRET` / `CORE_BRAIN_TOKEN`, `STATE_SIGNING_KEY`, `ENCRYPTION_KEY`, `UNSUBSCRIBE_SECRET`, `COLLECTOR_TRIGGER_TOKEN` | Self-generated (`openssl rand -hex 32`) | GitHub secrets and/or Worker secrets as in sections 2–3. `CORE_BRAIN_TOKEN` must equal core-brain `WEBHOOK_SECRET` |

Frontend `VITE_*` variables (`src/`) are public build-time config (form IDs, endpoint URLs), not secrets.
`scripts/` reads `HUBSPOT_TOKEN`, `WEBHOOK_SECRET`, `TELEGRAM_*` and `MAKE_DISTRIBUTION_WEBHOOK_URL` from the
operator's local environment or from CI.

## 5. Gaps and follow-ups

1. **Rotating the Supabase service-role key affects six Workers**, and only scan-report is synced by CI. The other
   five need a manual `wrangler secret put`, or they will keep failing with 401 against Supabase.
2. **`EXPECTED_SECRETS.txt` means *required*.** deploy-mpt-leads, deploy-mpt-metrics-collector and
   deploy-mpt-digest **fail** (deploy-oauth-poc warns) when a listed name is not set on the Worker. Optional secrets
   are therefore left out on purpose: `UNSUBSCRIBE_SECRET` (scan-report follow-ups and unsubscribe links),
   `HUNTER_API_KEY` (mpt-leads enrichment), `REDDIT_CLIENT_SECRET` (github-channel Reddit OAuth) and
   `SUPABASE_SERVICE_ROLE_KEY` on oauth-poc. Each feature switches itself off when its secret is unset. Do not add
   them unless the feature becomes mandatory. `workers/webhook-receiver/EXPECTED_SECRETS.txt` now lists that Worker's
   names. It has no deploy workflow, so nothing enforces the list yet.
3. **GitHub secrets that may not be set:** all 7 social-listeners secrets and `QWEN_API_KEY` are optional, and
   deploy.yml silently substitutes `placeholder` when they are missing. The 4 `SCAN_REPORT_*` secrets are skipped
   silently when empty. This repo has no way to read which GitHub secrets exist, so check *Settings → Secrets* against
   section 2, or check the "skipped …" lines in the latest deploy-scan-report run.
4. **Cloudflare deploy token scope:** the reported token had "all permissions". Its replacement should be limited to
   *Account → Workers Scripts: Edit* (plus *Workers KV / Routes* only where needed).
