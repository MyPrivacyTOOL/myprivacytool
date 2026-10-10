# MPT secrets (MPT-1004)

MPT = MyPrivacyTOOL. Real values are **never** committed. Only `.env.example` (placeholders) is tracked.

| Secret | core-brain | social-listeners |
|---|:-:|:-:|
| `SUPABASE_URL` | ✅ | ✅ |
| `SUPABASE_KEY` | ✅ | ✅ |
| `QWEN_API_KEY` | ✅ | |
| `WEBHOOK_SECRET` (required: the deploy fails without it) | ✅ | |
| `TWILIO_SID` | | ✅ |
| `TWILIO_AUTH_TOKEN` | | ✅ |
| `META_APP_SECRET` | | ✅ |
| `CORE_BRAIN_TOKEN` (same value as core-brain `WEBHOOK_SECRET`) | | ✅ |
| `X_CONSUMER_SECRET` (MPC-8301) | | ✅ |
| `TELEGRAM_WEBHOOK_SECRET` (MPC-8301) | | ✅ |

Each Worker only receives the secrets it needs (least privilege). Secrets are read in code as `env.NAME`.
`wrangler.toml` cannot hold secret values, so it lists the names in comments and `EXPECTED_SECRETS.txt`.

## 1. Local development

```bash
cp .env.example .env     # then fill in real values; .env is gitignored
```

For `wrangler dev`, put the same `NAME=value` lines in `workers/<worker>/.dev.vars` (also gitignored).

## 2. Cloudflare Wrangler secrets (Chris, one-off per Worker)

Log in once (`npx wrangler login`), then run each command and paste the value when prompted
(the value never appears in shell history or the repo):

```bash
cd workers/core-brain
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put QWEN_API_KEY
npx wrangler secret put WEBHOOK_SECRET

cd ../social-listeners
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put TWILIO_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put META_APP_SECRET
npx wrangler secret put X_CONSUMER_SECRET
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Check names (not values) with `npx wrangler secret list`.

## 3. GitHub Actions secrets

Add under **Settings → Secrets and variables → Actions → New repository secret**:

- `CLOUDFLARE_API_TOKEN` (Account → Workers Scripts → Edit), `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_URL`, `SUPABASE_KEY`, `QWEN_API_KEY`, `WEBHOOK_SECRET`, `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `CORE_BRAIN_TOKEN`, `X_CONSUMER_SECRET`, `TELEGRAM_WEBHOOK_SECRET`

On every push to `main`, `.github/workflows/deploy.yml` runs `npm install` + `npm test`, then deploys both
Workers with `cloudflare/wrangler-action@v3` and syncs these secrets to each Worker.
(Step 2 is therefore only needed for the first manual setup or to rotate a secret outside CI.)

## 4. Full per-Worker inventory (all Workers)

The table at the top only covers `core-brain` and `social-listeners`. This is every secret the Worker code reads
(`env.NAME`). Names marked † are read in code but missing from that Worker's `EXPECTED_SECRETS.txt`
(`webhook-receiver` has no `EXPECTED_SECRETS.txt` at all). Reconcile these when rotating.

| Worker | Secrets |
|---|---|
| core-brain | `SUPABASE_URL`, `SUPABASE_KEY`, `QWEN_API_KEY`, `WEBHOOK_SECRET`, `SUPABASE_SERVICE_KEY` †, `TELEGRAM_BOT_TOKEN` †, `X_API_KEY` † |
| social-listeners | `SUPABASE_URL`, `SUPABASE_KEY`, `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `X_CONSUMER_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `CORE_BRAIN_TOKEN` |
| github-channel | `GITHUB_CLIENT_SECRET`, `STATE_SIGNING_KEY`, `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDDIT_CLIENT_SECRET` † |
| mpt-leads | `HUBSPOT_API_KEY`, `HUBSPOT_TOKEN`, `NOTION_TOKEN`, `RESEND_API_KEY`, `SLACK_BOT_TOKEN`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HUNTER_API_KEY` † (non-secret config: `LEADS_DB_ID`, `SLACK_CHANNEL_ID`, `SUPABASE_URL`) |
| oauth-poc | `GOOGLE_CLIENT_SECRET`, `STATE_SIGNING_KEY`, `SUPABASE_SERVICE_ROLE_KEY` † |
| scan-report | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIBP_API_KEY`, `HUBSPOT_TOKEN`, `UNSUBSCRIBE_SECRET` † |
| telegram-webhook | `TELEGRAM_BOT_TOKEN`, `HUBSPOT_API_KEY`, `WEBHOOK_SECRET` |
| webhook-receiver | `EMAIL_WEBHOOK_SECRET`, `FIRESTORE_SA_TOKEN`, `HUBSPOT_API_KEY`, `META_APP_SECRET`, `META_PAGE_ACCESS_KEY`, `META_VERIFY_KEY`, `META_WHATSAPP_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN` |

GitHub Actions also holds: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY`,
`SCAN_REPORT_RESEND_API_KEY`, `SCAN_REPORT_HUBSPOT_TOKEN`, `SCAN_REPORT_HIBP_API_KEY`.

## 5. Rotation checklist

Revoke and reissue at the provider, then update **both** the Worker (`wrangler secret put`) and the GitHub Actions secret.

- [ ] **Shared values: change everywhere in the same window**
  - `WEBHOOK_SECRET` (core-brain, telegram-webhook) and `CORE_BRAIN_TOKEN` (social-listeners) must stay equal.
  - `SUPABASE_SERVICE_ROLE_KEY` is used by github-channel, mpt-leads, oauth-poc, scan-report and webhook-receiver.
  - `HUBSPOT_API_KEY` / `HUBSPOT_TOKEN`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_KEY`,
    `TELEGRAM_WEBHOOK_SECRET`, `META_APP_SECRET`, `TWILIO_AUTH_TOKEN` appear in several Workers. Confirm each
    pair of near-identical names (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_KEY`, `HUBSPOT_API_KEY`/`HUBSPOT_TOKEN`)
    holds the same credential before rotating.
- [ ] **`ENCRYPTION_KEY` (github-channel): do not simply replace.** Data encrypted with the old key becomes unreadable.
  Plan a re-encryption or keep the old key available for decryption first.
- [ ] **`STATE_SIGNING_KEY` (github-channel, oauth-poc):** safe to replace; in-flight OAuth flows will fail once.
- [ ] **`UNSUBSCRIBE_SECRET` (scan-report):** replacing invalidates unsubscribe links already sent in emails.
- [ ] **Supabase:** rotate the service-role key, then the DB password and access token; redeploy via `deploy-supabase.yml`.
- [ ] **Cloudflare:** reissue `CLOUDFLARE_API_TOKEN` last, since CI needs it to push the other secrets.
- [ ] Update `EXPECTED_SECRETS.txt` for every † name above and add one for `webhook-receiver`.
- [ ] Redeploy every Worker, run `npx wrangler secret list` in each, and hit the smoke checks in `DEPLOYMENT_RUNBOOK.md`.
- [ ] Run `node scripts/ci/scan-secrets.mjs` (last run: clean, 417 files).

## Rules

- Never paste real keys into code, issues, PRs or chat. Rotate immediately if one leaks.
- Run `node scripts/ci/scan-secrets.mjs` before committing.
