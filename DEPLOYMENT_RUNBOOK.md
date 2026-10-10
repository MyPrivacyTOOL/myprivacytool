# Core Brain Deployment Runbook (MPC-7257, production promotion MPC-7260)

Deploys the **core-brain** Cloudflare Worker (`workers/core-brain`, behaviour in `docs/core-brain.md`).

| | URL | Notes |
|---|---|---|
| **Production** | `https://brain.myprivacytool.io` | Custom domain route in `wrangler.toml`. `wrangler deploy` creates the DNS record and certificate; no manual DNS record. |
| Pre-production (workers.dev) | `https://core-brain.myprivacytool.workers.dev` | Retired: `workers_dev = false`. Rollback: set it to `true` and redeploy. |

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

**Telegram and X never call core-brain directly.** Each platform calls the **social-listeners** Worker, which checks the
platform's own proof and forwards the event to core-brain (`POST /ingest/social`, over a service binding, with
`Authorization: Bearer <CORE_BRAIN_TOKEN>`). core-brain only accepts `/webhook` (secret header) and `/ingest/social` (bearer
token), neither of which a platform can send, so a webhook pointed at `brain.myprivacytool.io` would be rejected.

| Platform | URL to register on the platform | What the platform sends | Secret held by social-listeners |
|---|---|---|---|
| Telegram | `https://<social-listeners address>/webhook/telegram` | header `X-Telegram-Bot-Api-Secret-Token`, equal to the `secret_token` given to `setWebhook` | `TELEGRAM_WEBHOOK_SECRET` |
| X | `https://<social-listeners address>/webhook/x` | a CRC `GET` (answered with the consumer secret), then signed `POST`s (`X-Twitter-Webhooks-Signature`) | `X_CONSUMER_SECRET` |

`<social-listeners address>` is the Worker's own address. Its `wrangler.toml` has `workers_dev = true` and no custom route, so it
is the `workers.dev` address shown in Cloudflare, Workers, social-listeners (`GET /` there answers `{"worker":"social-listeners","ok":true}`).
Do **not** set `workers_dev = false` on social-listeners: the platforms need that address. (core-brain is different: it is served
from `brain.myprivacytool.io` and its `workers.dev` address is off.)

**Before repointing, check each of these:**

1. The core-brain gates in section 3 pass.
2. The social-listeners secrets are real values. `deploy.yml` substitutes the literal `placeholder` for any that is unset, so a
   green deploy does not prove they are set. Names only: `cd workers/social-listeners && npx wrangler secret list`.
   `CORE_BRAIN_TOKEN` must equal core-brain's `WEBHOOK_SECRET`; rotate the two together.
3. The forward path works without involving a platform (use a recognisable test id, not a real chat id):
   ```bash
   SL=https://<social-listeners address>
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SL/webhook/telegram" \
     -H 'Content-Type: application/json' -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
     -d '{"message":{"chat":{"id":999000111},"text":"/start"}}'
   # 200 = forwarded and accepted by core-brain. 401 = wrong Telegram secret. 502 = core-brain rejected or was unreachable
   # (check CORE_BRAIN_TOKEN against WEBHOOK_SECRET). Without the header the answer must be 401.
   ```
   Once state write-back is deployed (`docs/core-brain.md`), this creates a state row for that test id; remove it afterwards with
   `select public.mpt_erase_chat_sender('telegram', '999000111');`.

**One platform at a time, a test message after each:**

1. Telegram: register the webhook with the same value in `secret_token` as `TELEGRAM_WEBHOOK_SECRET`, then confirm with
   `getWebhookInfo` (no `last_error_message`):
   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://<social-listeners address>/webhook/telegram" -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
   ```
2. X: in the X developer portal register `https://<social-listeners address>/webhook/x` for the Account Activity API (X sends
   the CRC `GET` immediately and the registration fails unless `X_CONSUMER_SECRET` is correct), then subscribe the account.
3. After about a week with no requests on the core-brain `workers.dev` address, `workers_dev = false` on core-brain
   (done in the MPC-7257 follow-up; rollback in section 5).

**No reply reaches the user yet.** social-listeners only checks that core-brain accepted the event and ignores the response keys,
and core-brain never contacts the platforms (`docs/core-brain.md`). So a test message is confirmed in logs, **not** by a bot
reply: core-brain logs a `routed` event for each message (Cloudflare, Workers, Logs; social-listeners logs only failures, such as
`core_brain_rejected` or `core_brain_unreachable`), and, once state write-back is deployed, one `interaction_log` row appears per message. Real users will see silence until a reply path is built; decide whether
that is acceptable before repointing a live bot.

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
