# Core Brain Deployment Runbook (MPC-7257, production promotion MPC-7260)

Deploys the **core-brain** Cloudflare Worker (`workers/core-brain`, behaviour in `docs/core-brain.md`).

| | URL | Notes |
|---|---|---|
| **Production** | `https://brain.myprivacytool.io` | Custom domain route in `wrangler.toml`. `wrangler deploy` creates the DNS record and certificate; no manual DNS record. |
| Pre-production (workers.dev) | `https://core-brain.myprivacytool.workers.dev` | Same Worker, still enabled until traffic has moved; then set `workers_dev = false`. |

There is **one** Worker. There is no separate staging Worker or `*.staging.workers.dev` address: "staging" was the first
workers.dev deployment of the same script. Every push to `main` redeploys it (`.github/workflows/deploy.yml`).

Routes (all JSON; see `docs/core-brain.md` for bodies):

| Route | Auth |
|---|---|
| `GET /health` | none; returns `{ ok, worker, configured }` |
| `POST /webhook` | header `X-MPT-Webhook-Secret: <WEBHOOK_SECRET>` |
| `POST /ingest/social` | header `Authorization: Bearer <WEBHOOK_SECRET>` (social-listeners sends it as `CORE_BRAIN_TOKEN`) |

---

## 1. Before you merge to `main`

GitHub repo secrets (Settings → Secrets and variables → Actions). Names only; see `SECRETS.md`.

| Secret | Required | Notes |
|---|:-:|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | yes | The token must be able to edit Workers and the `myprivacytool.io` zone DNS / Workers custom domains (the same permission `channels.myprivacytool.io` already needed). |
| `SUPABASE_URL`, `SUPABASE_KEY` | yes | The deploy fails before anything ships if either is missing or blank. |
| `WEBHOOK_SECRET` | yes | A long random value. **No stand-in is ever used**: a guessable secret would let anyone call `/webhook`. Set `CORE_BRAIN_TOKEN` (social-listeners) to the same value. |
| `QWEN_API_KEY` | no | Without it intent classification uses the rules engine (`intent_source: "rules"`). Needed for the Qwen gate below. |

If a required secret is missing, `deploy.yml` fails at **Require core-brain secrets**; the running Worker is untouched.

## 2. Deploy

Merging to `main` runs `deploy.yml` (tests, then deploy). To redeploy without a commit: Actions → *Deploy core-brain &
social-listeners* → *Run workflow*. Expect 3 to 6 minutes. `smoke-site.yml` then probes `brain.myprivacytool.io`
(retrying for up to 10 minutes while DNS and the certificate settle).

## 3. Production gates (all must pass before any platform webhook points at `brain.myprivacytool.io`)

```bash
BASE=https://brain.myprivacytool.io

# 3a. Configured, and auth is enforced
curl -s "$BASE/health"                                   # expect {"ok":true,"worker":"core-brain","configured":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/webhook" -d '{}'   # expect 401

# 3b. LIVE QWEN GATE: at least one intent must be classified by Qwen. Run with the real secret.
curl -s -X POST "$BASE/webhook" \
  -H 'Content-Type: application/json' -H "X-MPT-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{"platform":"telegram","sender_id":"gate-test","message_text":"I want to scan my email for data leaks"}'
# expect 200 with "intent_source":"qwen". "rules" means Qwen was not reached: check QWEN_API_KEY and the
# DashScope account, fix, and repeat. Do NOT go live until one response says "qwen".

# 3c. Graceful fallback (no crash when Qwen is down) is covered by the unit tests:
npx vitest run workers/core-brain
```

3a and 3b can also be run without handling the secret: Actions → *Core Brain production gates* → *Run workflow*
(`core-brain-gates.yml`, CK-7318). It reads `WEBHOOK_SECRET` from the repo secret and prints only pass/fail, status codes
and `intent_source`; the same check runs locally with `WEBHOOK_SECRET=... node scripts/ci/core-brain-gates.mjs`.

Read-only launch: state write-back and `interaction_log` are intentionally not built (Phase 2). The Worker reads trust
level from Supabase and falls back to anonymous; it never writes `conversation_states`.

## 4. Cut traffic over

One platform at a time, with a test message after each:

1. Telegram: set the bot webhook to `https://brain.myprivacytool.io/...` through social-listeners (it forwards to core-brain with the bearer token; confirm social-listeners' `CORE_BRAIN_TOKEN` equals `WEBHOOK_SECRET`).
2. X: update the Account Activity webhook URL on social-listeners the same way.
3. After about a week with no requests on the workers.dev address, set `workers_dev = false` in `wrangler.toml` and redeploy.

DNS: nothing to edit by hand. The apex, `www` (Pages), `channels` and the `send.` mail records are untouched. Do not deploy
during an Email Routing record change on the same zone, so a failure has one obvious cause.

## 5. Rollback

| Layer | Action |
|---|---|
| Worker code | Actions → *Rollback Worker* → `core-brain` (leave `dry_run` on first to list versions; untick it to roll back, optionally with a `version_id`). It snapshots secret names, rolls back, verifies they are unchanged and smoke-tests `brain.myprivacytool.io`. CLI: `cd workers/core-brain && npx wrangler rollback`. Dashboard: Workers → core-brain → Deployments. |
| Callers | Point the platform webhooks back at the workers.dev address (still live until step 4.3). |
| Domain | Remove the `routes` line from `wrangler.toml` and redeploy, or delete the custom domain in Cloudflare → Workers → core-brain → Settings → Domains. Nothing else in the zone changed. |
| Bad commit | `git revert <sha>` on `main`; the revert PR must pass CI and redeploys automatically. |

The rollback drill (`rollback.yml`, Mondays 06:23 UTC, dry run) now includes `core-brain`.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `deploy.yml` fails at *Require core-brain secrets* | A required secret is unset or blank (names only are printed). Set it and re-run. |
| `/health` shows `configured:false`, POST routes answer 503 | `SUPABASE_URL`, `SUPABASE_KEY` or `WEBHOOK_SECRET` did not reach the Worker. Re-run the deploy. |
| 401 from `/webhook` or `/ingest/social` | Wrong secret. `/webhook` uses `X-MPT-Webhook-Secret`; `/ingest/social` uses `Authorization: Bearer`. social-listeners' `CORE_BRAIN_TOKEN` must equal `WEBHOOK_SECRET`. |
| `intent_source` is always `rules` | `QWEN_API_KEY` unset or rejected. The Worker logs `qwen http error` / `qwen failed` (no message text) and falls back; it does not error. |
| `brain.myprivacytool.io` does not resolve right after deploy | Custom domain and certificate can take a few minutes. Check Cloudflare → Workers → core-brain → Domains. The token needs zone DNS / custom-domain permission. |

Stream logs: `cd workers/core-brain && npx wrangler tail --format pretty`. Logs carry event metadata only.

---

**Runbook version:** MPC-7260 v2 (replaces the MPC-7257 v1 draft, which described `*.mpt.workers.dev` URLs, `/webhook/x` and
`/webhook/telegram` routes, Firestore logging and `npm run test:staging`, none of which exist).
