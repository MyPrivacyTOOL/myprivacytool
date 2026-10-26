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
| `LINKEDIN_CLIENT_SECRET` (MPC-7640) | | ✅ |
| `TELEGRAM_WEBHOOK_SECRET` (MPC-8301) | | ✅ |
| `TELEGRAM_BOT_TOKEN` (MPC-7251, sends Telegram replies) | | ✅ |
| `X_BEARER_TOKEN` (MPC-7628, public profile lookup for the Mirror bot) | | ✅ |
| `X_USER_ACCESS_TOKEN` (MPC-7628, OAuth 2.0 user token with `dm.read dm.write`, sends Mirror DMs; expires in ~2h, used only as a fallback once refresh works) | | ✅ |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` (MPC-7628, OAuth 2.0 keys of the X app, used to refresh the user token) | | ✅ |
| `X_CONSUMER_KEY`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (MPC-7628, OAuth 1.0a API key and the account's access token + secret from the X app's Keys and tokens page, with `X_CONSUMER_SECRET` above; they sign the Alice clip upload, which the OAuth 2.0 token cannot do) | | ✅ |
| `HUBSPOT_SOCIAL_TOKEN` (MPC-7628, HubSpot private app `MPT X activity sync` for portal 246502821 with ONLY crm.objects.contacts.read/write and crm.schemas.contacts.read/write; creates/updates/deletes the X people in HubSpot; skipped when unset) | | ✅ |
| `X_REFRESH_TOKEN` (MPC-7628, the refresh token that came with the user token; seeds `public.mpt_x_oauth_tokens` on first use, after which the rotating pair lives in Supabase) | | ✅ |

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
npx wrangler secret put LINKEDIN_CLIENT_SECRET
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

Check names (not values) with `npx wrangler secret list`.

## 3. GitHub Actions secrets

Add under **Settings → Secrets and variables → Actions → New repository secret**:

- `CLOUDFLARE_API_TOKEN` (Account → Workers Scripts → Edit), `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_URL`, `SUPABASE_KEY`, `QWEN_API_KEY`, `WEBHOOK_SECRET`, `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `CORE_BRAIN_TOKEN`, `X_CONSUMER_SECRET`, `LINKEDIN_CLIENT_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`

On every push to `main`, `.github/workflows/deploy.yml` runs `npm install` + `npm test`, then deploys both
Workers with `cloudflare/wrangler-action@v3` and syncs these secrets to each Worker.
(Step 2 is therefore only needed for the first manual setup or to rotate a secret outside CI.)

## 4. Full per-Worker inventory (all Workers)

The table at the top only covers `core-brain` and `social-listeners`. This is every secret the Worker code reads
(`env.NAME`). Names marked † are **optional**: read in code but left out of that Worker's `EXPECTED_SECRETS.txt` on
purpose, because several deploy workflows fail when a listed name is missing. The feature behind each one switches
itself off while it is unset. See `docs/SECRETS-AUDIT.md`.

| Worker | Secrets |
|---|---|
| core-brain | `SUPABASE_URL`, `SUPABASE_KEY`, `QWEN_API_KEY`, `WEBHOOK_SECRET`, `SUPABASE_SERVICE_KEY` †, `TELEGRAM_BOT_TOKEN` †, `X_API_KEY` † |
| social-listeners | `SUPABASE_URL`, `SUPABASE_KEY`, `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `X_CONSUMER_SECRET`, `LINKEDIN_CLIENT_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `CORE_BRAIN_TOKEN`, `TELEGRAM_BOT_TOKEN` |
| github-channel | `GITHUB_CLIENT_SECRET`, `STATE_SIGNING_KEY`, `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDDIT_CLIENT_SECRET` † |
| mpt-leads | `HUBSPOT_API_KEY`, `HUBSPOT_TOKEN`, `NOTION_TOKEN`, `RESEND_API_KEY`, `SLACK_BOT_TOKEN`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `HUNTER_API_KEY` † (non-secret config: `LEADS_DB_ID`, `SLACK_CHANNEL_ID`, `SUPABASE_URL`) |
| mpt-metrics-collector | `SUPABASE_SERVICE_ROLE_KEY`, `COLLECTOR_TRIGGER_TOKEN`, `CLOUDFLARE_ANALYTICS_TOKEN`, `YOUTUBE_API_KEY`, `GA4_SERVICE_ACCOUNT_JSON`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN` (MPC-7383 Monday digest, `chat:write` only), `HUBSPOT_READONLY_TOKEN` (read-only HubSpot private-app token for portal 246502821; deliberately not the write-capable `HUBSPOT_TOKEN` / `HUBSPOT_API_KEY`) (non-secret config: `SUPABASE_URL`, `CLOUDFLARE_ZONE_ID`, `MPTSLACK_CHANNEL_ID` (set as a secret so `wrangler deploy` does not replace it)) |
| oauth-poc | `GOOGLE_CLIENT_SECRET`, `STATE_SIGNING_KEY`, `SUPABASE_SERVICE_ROLE_KEY` † |
| scan-report | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIBP_API_KEY`, `HUBSPOT_TOKEN`, `UNSUBSCRIBE_SECRET` † |
| webhook-receiver | `EMAIL_WEBHOOK_SECRET`, `FIRESTORE_SA_TOKEN`, `HUBSPOT_API_KEY`, `META_APP_SECRET`, `META_PAGE_ACCESS_KEY`, `META_VERIFY_KEY`, `META_WHATSAPP_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `BREACH_API_KEY`, `DEEP_DIVE_SECRET`, `RAPIDAPI_KEY`, `SPAM_API_KEY` |
| mpt-cairn-blackboard | `CAIRN_BRIDGE_TOKEN`, `CAIRN_HASH_PEPPER`, `NOTION_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` (non-secret config: `SUPABASE_URL`) |
| mpt-content-approval | `APPROVAL_API_TOKEN`, `MAKE_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `RECEIPT_SIGNING_SECRET` |
| mpt-content-consumer | `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN` |
| partner-api | `SUPABASE_SERVICE_ROLE_KEY`, `HIBP_API_KEY` (non-secret config: `SUPABASE_URL`) |
| mirror-risk | none |

GitHub Actions also holds: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY`,
`SCAN_REPORT_RESEND_API_KEY`, `SCAN_REPORT_HUBSPOT_TOKEN`, `SCAN_REPORT_HIBP_API_KEY`.

## 5. Rotation checklist

Revoke and reissue at the provider, then update **both** the Worker (`wrangler secret put`) and the GitHub Actions secret.

- [ ] **Shared values: change everywhere in the same window**
  - `WEBHOOK_SECRET` (core-brain) and `CORE_BRAIN_TOKEN` (social-listeners) must stay equal.
  - `SUPABASE_SERVICE_ROLE_KEY` is used by github-channel, mpt-leads, mpt-metrics-collector, mpt-cairn-blackboard,
    oauth-poc, partner-api, scan-report and webhook-receiver (core-brain and social-listeners hold it as
    `SUPABASE_KEY`). Use the manual workflow `rotate-supabase-key.yml` (see "Supabase key rotation" below).
    **It does not list `mpt-cairn-blackboard` or `partner-api`**: set those two by hand with `wrangler secret put`
    (or add them to the workflow) and check they were not missed in the 2026-10-14 rotation.
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
- [ ] Keep `EXPECTED_SECRETS.txt` to *required* names only. Add a † name only if its feature becomes mandatory.
- [ ] Redeploy every Worker, run `npx wrangler secret list` in each, and hit the smoke checks in `DEPLOYMENT_RUNBOOK.md`.
- [ ] Run `node scripts/ci/scan-secrets.mjs` (last run 2026-10-26: clean, 1039 files).

## Supabase key rotation (how the 2026-10-14 rotation was done)

Record of the procedure; the evidence and owner decisions are in Notion (MPC-7821). No values here.

1. Create the new secret key in the Supabase dashboard (Settings, API Keys). Do not delete the old one yet.
2. Save it as the GitHub Actions secret `NEW_SUPABASE_SECRET_KEY` (deploy workflows prefer it over
   `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY`).
3. Run **Rotate Supabase secret key (manual)** (`.github/workflows/rotate-supabase-key.yml`). Log must show
   `canary HTTP 200`, then `set <worker>` for each Worker and no `FAILED`.
4. Replace by hand what the workflow cannot reach: the Cloudflare **Pages** secret `SUPABASE_SERVICE_ROLE_KEY`
   (then redeploy the site) and the droplet env line `SUPABASE_SECRET_KEY_MYPRIVACYTOOL` in `/root/.env`.
5. Check the Supabase API logs: new key returns 200/201 and there are no 401/403.
6. Only then delete the old key or disable the legacy JWT keys. Disabling legacy keys also disables the legacy anon key.
7. Prove it: a request with the old key must return 401. (On 2026-10-14 to 19 this last check was not completed; the
   owner accepted the dashboard showing legacy keys disabled.)

Secret keys (`sb_secret_...`) go in the `apikey` header only, not `Authorization: Bearer`.

## Rules

- Never paste real keys into code, issues, PRs or chat. Rotate immediately if one leaks.
- Run `node scripts/ci/scan-secrets.mjs` before committing (CI also runs it and blocks the merge on a hit).

## Stripe checkout (MPC-7626 follow-up, Cloudflare Pages variables)

Set under Pages -> Settings -> Environment variables. Checkout stays off until `CHECKOUT_ENABLED` is 1/true/on/yes.

- `STRIPE_SECRET_KEY` (secret), `STRIPE_WEBHOOK_SECRET` (secret, from the endpoint `https://<site>/api/stripe-webhook`)
- `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_EXECUTIVE` (price ids; must match the approved $7.99 / $14.99 / $49.99)
- `CHECKOUT_ENABLED`

The webhook only verifies and acknowledges events; granting paid access needs an account/entitlement design first.
