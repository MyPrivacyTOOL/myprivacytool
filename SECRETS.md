# MPT secrets (MPT-1004)

MPT = MyPrivacyTOOL. Real values are **never** committed. Only `.env.example` (placeholders) is tracked.

| Secret | core-brain | social-listeners |
|---|:-:|:-:|
| `SUPABASE_URL` | ✅ | ✅ |
| `SUPABASE_KEY` | ✅ | ✅ |
| `QWEN_API_KEY` | ✅ | |
| `WEBHOOK_SECRET` | ✅ | |
| `TWILIO_SID` | | ✅ |
| `TWILIO_AUTH_TOKEN` | | ✅ |
| `META_APP_SECRET` | | ✅ |
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
- `SUPABASE_URL`, `SUPABASE_KEY`, `QWEN_API_KEY`, `WEBHOOK_SECRET`, `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `X_CONSUMER_SECRET`, `TELEGRAM_WEBHOOK_SECRET`

On every push to `main`, `.github/workflows/deploy.yml` runs `npm install` + `npm test`, then deploys both
Workers with `cloudflare/wrangler-action@v3` and syncs these secrets to each Worker.
(Step 2 is therefore only needed for the first manual setup or to rotate a secret outside CI.)

## Rules

- Never paste real keys into code, issues, PRs or chat. Rotate immediately if one leaks.
- Run `node scripts/ci/scan-secrets.mjs` before committing.
