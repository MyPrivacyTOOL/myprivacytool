# core-brain (MPC-8601)

The router behind the social channels. social-listeners verifies a platform webhook and forwards it here; core-brain classifies
the intent with Qwen, reads the sender's trust level from Supabase, and answers with a **localization key** (MPT-1003). It never
talks to the platforms: the caller resolves the key to text (`public.localization`, `locales/`) and sends the reply.

## Routes

| Route | Caller | Auth | Body |
|---|---|---|---|
| `POST /webhook` | any HTTP client | `X-MPT-Webhook-Secret: <WEBHOOK_SECRET>` | `{ platform, sender_id, message_text, locale? }` or a raw Telegram update |
| `POST /ingest/social` | social-listeners (MPC-8301) | `Authorization: Bearer <WEBHOOK_SECRET>` | `{ source: "x" \| "telegram", receivedAt, payload }` |
| `GET /health` | anyone | none | `{ ok, worker, configured }` |

Response (200): `{ ok, intent, intent_source, trust_level, state, state_source, locale, response_key, message_keys }`.
`/ingest/social` answers `200 { ok: true, ignored: true }` for verified events that carry no user text (follows, likes, edits,
our own DM echoes) so the platform does not retry. Errors use the shared `{ error: { code, message } }` shape: 400 bad JSON or
payload, 401 bad token, 503 not configured (retryable), 405/413.

## Decisions

1. **Canonical implementation.** This TypeScript Worker is the MPC-8601 core brain. The older `feat/mpc-8601-core-brain` branch
   (JavaScript, `POST /brain`, never merged, predates CK-007) is stale and is not to be merged over it.
2. **Auth between the Workers.** One shared secret: core-brain's `WEBHOOK_SECRET` equals social-listeners' `CORE_BRAIN_TOKEN`.
   social-listeners sends it on every forward, including over the service binding, because core-brain is also reachable on its
   public workers.dev address and must not trust the caller by transport alone. Rotate both together.
3. **Sender to state mapping.** `conversation_states` has no sender column, so a row is found by `channel` and
   `context->>'sender_id'` (the platform's sender id as text). Whatever creates the row must write `sender_id` into `context`.
   Platforms outside the table's `channel` check (X today) are treated as anonymous, trust 0.
4. **Trust threshold.** `trust_level >= 1` means "identity confirmed": a repeat Scan returns the report call-to-action instead
   of the First Hexagon teaser. The migration does not define the 0 to 5 scale; change `CONFIRMED_TRUST_LEVEL` in `index.ts` when it does.
5. **Privacy.** Emails and phone numbers are redacted before text goes to Qwen. Logs carry event metadata only: no message text,
   sender ids or keys (a test enforces it).

## Not built (deferred; no code owns these yet)

| Item | Why it matters | Needed before |
|---|---|---|
| State write-back (`conversation_states` insert/update) | Trust never advances; `awaiting_confirmation` is never set by this Worker. Creating a row needs a `lead_id` (NOT NULL FK), so it needs a lead-resolution step. | Progressive Trust launches |
| `interaction_log` | No analytics or audit trail of routed messages. The table does not exist. | Reporting on bot usage |
| MPC-8302 Mirror and Risk call | Scan returns the generic First Hexagon, not a computed risk summary. | Real scan results in chat |
| Live Qwen call and staging test | Qwen request/response shape is covered by stubbed tests only. | Production traffic |
| X reply path | X senders have no state channel, so every X user is anonymous. | X as a real channel |

## Deploy

`.github/workflows/deploy.yml` deploys both Workers on push to `main` and needs these GitHub Actions secrets (names in
`SECRETS.md`): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`, `QWEN_API_KEY`, `WEBHOOK_SECRET`,
`CORE_BRAIN_TOKEN` (same value as `WEBHOOK_SECRET`), and the social-listeners ones. While any is missing the workflow fails at
"Uploading secrets" and nothing ships; until `WEBHOOK_SECRET` is set the Worker answers 503 on both POST routes.
