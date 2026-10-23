# mpt-cairn-blackboard

API bridge between Cairn (the OSINT state-space search engine) and the Cairn tables in Supabase (`cairn_sessions`, `cairn_facts`, `cairn_intents`).
Task MPC-8413 step 2; contract from the MPC-8401 design spec. Cairn never talks to Supabase directly: it posts here, and this Worker validates, hashes sensitive values and writes with the service key.

**State: code and tests only. Not deployed.** The deploy workflow is `workflow_dispatch` only, so merging does not publish the endpoint (MPC-8413 lists the deployment as a separate approval).

## Endpoint

`POST /api/cairn/blackboard/commit` with `Authorization: Bearer <CAIRN_BRIDGE_TOKEN>`. `GET /health` is open and returns `{ ok, configured }`.

```json
{ "session_id": "mpt-cairn-1729607963", "action": "write_facts", "payload": { } }
```

| action | payload | notes |
| --- | --- | --- |
| `start_session` | `seed_email` (required), `seed_username`, `investigation_goal`, `allowed_domains`, `excluded_domains`, `max_depth`, `max_facts`, `timeout_seconds`, `user_id` (uuid of `public.users`), `cairn_project_id` | **Not in the spec**: facts need a session row, and the spec had no way to create one. Idempotent: a repeat returns `created: false`. |
| `write_facts` | `facts[]` (max 25) as in the spec | All-or-nothing validation. Retrying a batch is safe (duplicate `fact_id`s are ignored). |
| `write_intents` | `intents[]` (max 25) as in the spec | Same. A session holds at most 50 intents. |
| `update_session_state` | `status`, `status_reason`, `facts_discovered`, `intents_generated`, `intents_completed`, `concluded_at`, `metadata` | Works on a finished session. `completed` / `failed` stamps `concluded_at`. |

Errors: `{ "success": false, "error": "<code>", "error_detail": "..." }` with 400 (bad input), 401, 404 (no such session), 409 (session not active), 413, 422 (`max_facts_exceeded`, `max_intents_exceeded`), 429 (`retry-after: 30`), 502 (database call failed, safe to retry), 500 (secrets not set).
Callers should retry 5xx and network errors with backoff (1 s, 2 s, 4 s); 4xx fail immediately.

## Decisions that differ from the MPC-8413 plan

- **No bcrypt.** bcrypt at 12 rounds does not fit the Workers CPU limit, the native `bcrypt` package does not run on Workers, and a salted one-way hash cannot be used to de-duplicate or to show a value in the Notion dashboard. Sensitive fact types are hashed with **HMAC-SHA256 + a server-side pepper** (`CAIRN_HASH_PEPPER`, WebCrypto): the same input always gives the same hash (so repeats are recognised), and the value cannot be recovered without the pepper. Stored as `hmac-sha256:<hex>` with `is_hashed = true`. The raw value is also removed from `extracted_metadata` and from the description.
- **Only `phone` is hashed by default** (`HASH_FACT_TYPES`). The Cairn strategy page says all facts are hashed; the MPC-8401 spec and the Notion "Value" column assume emails, usernames and URLs stay readable. **Needs a decision from Chris.** To hash more types, set the plain variable, e.g. `HASH_FACT_TYPES = "phone,email"`.
- **30 writes per minute per session** (the MPC-8413 acceptance criterion) rather than the plan's 100 per session. The count comes from the database (rows created in the last 60 s), so it holds across all Worker instances and needs no KV, which MPC-8373 has not provisioned yet. A retry of an already-stored batch inside the same minute can get a 429 and succeeds after the window.
- Per-session caps: `max_facts` (default 100) and 50 intents, from the Cairn strategy page.

## Secrets (names only, set in Cloudflare by a human)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the current `sb_secret_` key, sent in the `apikey` header only), `CAIRN_BRIDGE_TOKEN` (the bearer Cairn sends; generate it, never paste it in chat), `CAIRN_HASH_PEPPER` (generate once; **changing it changes every hash, so keep it**).

## Tests

`node workers/mpt-cairn-blackboard/worker.test.mjs`: 13 tests against an in-memory stand-in for Supabase. Covers auth, validation, the spec's example payloads, idempotent retries, that a raw phone number is never sent to Supabase, rate limit, caps, and that database errors do not leak.
Not covered: a real PostgREST round trip (do this once after deploy, on a clearly marked test session, and delete it).

## Deploy and rollback

Actions -> **Deploy mpt-cairn-blackboard Worker** -> Run workflow. The first run fails the secret-name check until the four secrets are set; set them and re-run. Rollback: delete the Worker in Cloudflare; the tables are unaffected.
