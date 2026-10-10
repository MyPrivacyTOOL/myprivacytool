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

Response (200): `{ ok, intent, intent_source, trust_level, state, state_source, next_state, locale, response_key, message_keys }`.
`trust_level` and `state` are what the sender had when the message arrived; `next_state` is what the conversation becomes (see
"State and trust" below). The write is best effort, so `next_state` is the intended state, not a confirmation that it was stored.
`next_state` is `null` when the stored state could not be read (`state_source: "fallback"`): the Worker then asks the database to
keep the state as it is, so a read failure can never reset a confirmed conversation.
`/ingest/social` answers `200 { ok: true, ignored: true }` for verified events that carry no user text (follows, likes, edits,
our own DM echoes) so the platform does not retry. Errors use the shared `{ error: { code, message } }` shape: 400 bad JSON or
payload, 401 bad token, 503 not configured (retryable), 405/413.

## Decisions

1. **Canonical implementation.** This TypeScript Worker is the MPC-8601 core brain. The older `feat/mpc-8601-core-brain` branch
   (JavaScript, `POST /brain`, never merged, predates CK-007) is stale and is not to be merged over it.
2. **Auth between the Workers.** One shared secret: core-brain's `WEBHOOK_SECRET` equals social-listeners' `CORE_BRAIN_TOKEN`.
   social-listeners sends it on every forward, including over the service binding, because core-brain is also reachable on its
   public workers.dev address and must not trust the caller by transport alone. Rotate both together.
3. **Sender to state mapping.** `conversation_states` rows for chat senders are keyed by `channel` and the `sender_id` column
   (the platform's sender id as text), unique per channel. `lead_id` is optional: a chat sender has no email, and `leads.email`
   is NOT NULL, so inventing placeholder leads would pollute the lead list and hide chat data from the email-keyed DSAR path.
   A row has a `sender_id`, a `lead_id`, or both; attaching a real lead later is a separate step. Platforms outside the table's
   `channel` check (X today) have no state row: they are treated as anonymous, trust 0, and their interactions are log-only.
4. **Trust threshold.** `trust_level >= 1` means "identity confirmed": a repeat Scan returns the report call-to-action instead
   of the First Hexagon teaser. The migration does not define the 0 to 5 scale; change `CONFIRMED_TRUST_LEVEL` in `index.ts` when it does.
5. **State and trust.** After each routed message the Worker calls the `mpt_brain_record` RPC, which upserts the sender's state and
   appends one `interaction_log` row in a single transaction. States: `new` to `awaiting_confirmation` (the First Hexagon teaser
   was sent; it ends with a Y/N question) to `confirmed` (yes; trust raised to `CONFIRMED_TRUST_LEVEL`) or `declined` (no; trust
   unchanged). The database applies `trust_level = greatest(existing, floor)`, so **trust only ever goes up**; no message can
   lower it. The write runs after the reply is sent (`waitUntil`) and is best effort: if Supabase is down or the migration is
   not applied yet, it is logged as a warning and the reply is unchanged.
6. **Privacy.** Emails and phone numbers are redacted before text goes to Qwen. Logs carry event metadata only: no message text,
   sender ids or keys (a test enforces it).

## Not built (deferred; no code owns these yet)

| Item | Why it matters | Needed before |
|---|---|---|
| Attaching a real lead to a chat sender | Chat-sender rows have `sender_id` but no `lead_id`, so they are not yet tied to an email, and trust earned in chat does not carry to other channels. | Cross-channel Progressive Trust |
| Scheduling the `interaction_log` purge | `mpt_purge_expired_interaction_log()` exists but nothing calls it, so rows are kept past `retain_until` until it is scheduled (pg_cron, like the scan-results purge). | Production retention policy |
| MPC-8302 Mirror and Risk call | Scan returns the generic First Hexagon, not a computed risk summary. | Real scan results in chat |
| Live Qwen call and staging test | Qwen request/response shape is covered by stubbed tests only. | Production traffic |
| X reply path | X senders have no state channel, so every X user is anonymous. | X as a real channel |

## State write-back and interaction log

Migration `supabase/migrations/20261010120000_mpc_8601_core_brain_state_writeback.sql` adds `conversation_states.sender_id`
(and makes `lead_id` optional), the `interaction_log` table, and the service_role-only functions `mpt_brain_record`,
`mpt_erase_chat_sender(channel, sender_id)` and `mpt_purge_expired_interaction_log()`. `interaction_log` holds metadata only
(intent, response key, state and trust before/after): **no message text and no sender id**, and its rows go with their state row.
Apply the migration **before** relying on write-back; until then the Worker still replies correctly and logs `state write failed`.
To erase a chat sender (no email, so the DSAR helpers cannot find them): `select public.mpt_erase_chat_sender('telegram', '<id>');`.

**Trust is self-asserted.** `confirmed` means the sender typed "yes", not that anyone verified identity, and until MPC-8302 the
teaser is generic (no real scan result). Trust 1 only switches the reply from the teaser to the report call-to-action; do not
use it to gate anything personal.

## Deploy

`.github/workflows/deploy.yml` deploys both Workers on push to `main` and needs these GitHub Actions secrets (names in
`SECRETS.md`): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`, `WEBHOOK_SECRET`
(all required for core-brain; the deploy fails before shipping if one is missing, and no stand-in value is ever used),
`QWEN_API_KEY` (optional: rules-based intent without it), `CORE_BRAIN_TOKEN` (same value as `WEBHOOK_SECRET`), and the
social-listeners ones. Production is `https://brain.myprivacytool.io` (custom domain route in `wrangler.toml`, MPC-7260);
the steps, the live-Qwen gate and rollback are in `/DEPLOYMENT_RUNBOOK.md`.
