# Core Brain — MyPrivacyTOOL Central Orchestrator

## Overview

The **Core Brain** is a Cloudflare Worker that serves as the central orchestrator for the MyPrivacyTOOL social bot ecosystem. It:

1. **Routes social payloads** from X (Twitter) and Telegram webhooks
2. **Queries Supabase** for user state and localization preferences
3. **Classifies user intent** using Qwen LLM (entity recognition + intent labels)
4. **Invokes Mirror & Risk engine** (MPC-8302) for privacy scan queries
5. **Formats responses** with localization templates
6. **Routes responses back** to the correct social platform (X DM, Telegram message)
7. **Logs interactions** to Supabase for analytics
8. **Enforces rate limiting** and manages session state via KV

## Architecture

```
┌─────────────────────────┐
│  Social Platforms       │  X (Twitter), Telegram
│  (Webhook Inbound)      │
└────────────┬────────────┘
             │ POST /webhook
             ↓
┌─────────────────────────────────────┐
│  Core Brain Worker (Cloudflare)     │  Qwen intent classification
│  - Route & orchestrate              │  Supabase state lookup
│  - Intent classification            │  Rate limiting (KV)
│  - Localization lookup              │  Error handling
└──┬──────────┬──────────┬────────────┘
   │ query    │ log      │ respond
   ↓          ↓          ↓
   │    Supabase      Social APIs
   │    (state,  ├──→ X API (DM)
   │     logs)   ├──→ Telegram API
   │            │
   └────→ Mirror & Risk Engine (MPC-8302)
            (Scan queries, risk summary)
```

## Setup & Deployment

### 1. Cloudflare Account Prerequisites

- Cloudflare Workers account (free tier OK for testing)
- Project with Workers enabled
- KV namespace created (note the namespace ID)

### 2. Environment Variables

Set these in Cloudflare Dashboard → **Workers** → **Settings** → **Variables**:

| Variable | Value | Notes |
|----------|-------|-------|
| `SUPABASE_URL` | `https://your-project.supabase.co` | From Supabase project settings |
| `SUPABASE_SERVICE_KEY` | `eyJhbGc...` | Service role key (not anon public key) |
| `QWEN_API_KEY` | Your Qwen API key | Alibaba Cloud or compatible endpoint |
| `QWEN_MODEL` | `qwen-7b-chat` or `qwen-turbo` | Model name for intent classification |
| `WEBHOOK_SECRET` | Shared secret string | For verifying inbound webhook payloads |
| `X_API_KEY` | X API Bearer token | For sending DMs via X API |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` | Telegram bot token |
| `MIRROR_AND_RISK_WORKER_URL` | `https://mpt-mirror-risk.example.workers.dev` | URL to MPC-8302 Worker |

### 3. KV Namespace Configuration

Update `wrangler.toml` with your KV namespace ID:

```toml
[[kv_namespaces]]
binding = "CORE_BRAIN_KV"
id = "your-namespace-id-here"
```

### 4. Deploy

```bash
cd workers/core-brain
npm install
wrangler deploy
```

Note the deployed URL (e.g., `https://mpt-core-brain.your-account.workers.dev`).

## API Specification

### Inbound Webhook (POST)

**Endpoint:** `https://mpt-core-brain.your-account.workers.dev/`

**Headers:**
```
X-Webhook-Secret: <WEBHOOK_SECRET from env>
Content-Type: application/json
```

**Request Body:**
```json
{
  "id": "queue-message-id",
  "sender_id": "12345",
  "platform": "x",
  "message_text": "Can you check if my email was leaked?",
  "metadata": {
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "intent": "query_scan",
  "latency_ms": 847,
  "response_sent": true
}
```

**Error Responses:**
- `401 Unauthorized` — Invalid webhook secret
- `400 Bad Request` — Missing required fields
- `429 Too Many Requests` — Rate limit exceeded
- `500 Internal Server Error` — Processing error

### Health Check (GET)

**Endpoint:** `https://mpt-core-brain.your-account.workers.dev/`

**Response (200 OK):**
```json
{
  "status": "Core Brain operational"
}
```

## Integration Points

### Supabase Tables Required

1. **`user_state`** — User preferences and state
   ```sql
   sender_id TEXT PRIMARY KEY
   platform TEXT
   language_code TEXT
   opted_in BOOLEAN
   created_at TIMESTAMP
   updated_at TIMESTAMP
   ```

2. **`social_inbound_queue`** — Inbound message queue (optional, for FIFO polling)
   ```sql
   id TEXT PRIMARY KEY
   sender_id TEXT
   platform TEXT
   message_text TEXT
   metadata JSONB
   is_processed BOOLEAN DEFAULT false
   processed_at TIMESTAMP
   created_at TIMESTAMP
   ```

3. **`interaction_log`** — Analytics log
   ```sql
   id BIGSERIAL PRIMARY KEY
   sender_id TEXT
   platform TEXT
   message_text TEXT
   intent TEXT
   confidence FLOAT
   entities JSONB
   risk_summary JSONB
   response_text TEXT
   response_sent BOOLEAN
   latency_ms INT
   is_known_user BOOLEAN
   created_at TIMESTAMP
   ```

4. **`localization`** — Response templates by language
   ```sql
   language_code TEXT PRIMARY KEY
   greeting TEXT
   query_response_template TEXT
   help_response_template TEXT
   error_response_template TEXT
   ```

### Qwen Intent Labels

The Worker recognizes these intents:

- **`query_scan`** — User asking to scan for exposure (primary use case)
- **`get_help`** — User requesting help or documentation
- **`opt_in`** — User opting into notifications or features
- **`opt_out`** — User opting out or requesting to delete data
- **`feedback`** — User providing feedback on the tool
- **`unknown`** — Intent could not be determined

### Entity Recognition

The Worker extracts these entity types from messages:

- **`email`** — Email addresses (RFC 5322 pattern)
- **`phone`** — US phone numbers (XXX-XXX-XXXX format)
- **`handle`** — Social media handles (@username)
- **`domain`** — Domain names (example.com)

## Performance & Latency

**Target:** Sub-10 second end-to-end latency (most requests under 1s)

**Breakdown (typical):**
- Supabase queries: 200-400ms
- Qwen API call: 400-800ms
- Mirror & Risk engine: 100-300ms (if called)
- Response routing: 50-150ms
- Logging: 100-200ms

**Optimizations:**
- Rate limiting via KV (constant-time secret comparison)
- Parallel Supabase queries where possible
- Response timeout of 30s per external API call

## Rate Limiting

By default, each sender is limited to **10 messages per minute** via KV. Configure in `isRateLimited()` function:

```javascript
if (await isRateLimited(env.CORE_BRAIN_KV, senderId, 10)) {
  // Rate limited
}
```

## Debugging & Logs

All errors are logged to Cloudflare Workers console:

```bash
wrangler tail
```

Interaction logs are stored in Supabase `interaction_log` table for post-analysis.

## Testing

### Local Development

```bash
cd workers/core-brain
wrangler dev
```

Then in another terminal:

```bash
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: test-secret" \
  -d '{
    "sender_id": "user123",
    "platform": "x",
    "message_text": "Is my email john@example.com exposed?"
  }'
```

### Manual Testing in Production

1. Set `WEBHOOK_SECRET` in Cloudflare
2. Test with curl (substitute your Worker URL):

```bash
curl -X POST https://mpt-core-brain.your-account.workers.dev/ \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <YOUR_SECRET>" \
  -d '{"sender_id":"test","platform":"x","message_text":"test"}'
```

## Troubleshooting

### 401 Unauthorized
- Verify `WEBHOOK_SECRET` matches in request header
- Check `constantTimeEqual()` function not triggering on typo

### 429 Rate Limited
- User has sent >10 messages in 60s
- Check KV namespace is properly configured
- Review rate limit threshold in `isRateLimited()`

### Qwen API Timeout
- Verify `QWEN_API_KEY` is correct and not expired
- Check `QWEN_MODEL` matches available model name
- Review Alibaba Cloud API endpoint (currently hardcoded to dashscope.aliyuncs.com)

### Supabase Errors
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct
- Ensure `service_role` key is used, not `anon` public key
- Check RLS policies on `user_state`, `interaction_log` tables allow service role writes

## Dependencies & Future Improvements

### Blocking Dependencies
- **MPC-8301** (Social Platform API Integration) — must be deployed first; provides webhook endpoints
- **MPC-8302** (Mirror & Risk Engine) — must be deployed; called for scan queries

### Nice-to-Have Improvements
- [ ] Connection pooling for Supabase queries
- [ ] Circuit breaker pattern for external API calls
- [ ] A/B testing framework for response templates
- [ ] Conversation history caching in KV (multi-turn support)
- [ ] Metrics export to Cloudflare Analytics
- [ ] Custom intent classifier fine-tuning

## Support & Questions

Open an issue or Slack message in #myprivacytool-dev for:
- Integration questions
- Deployment issues
- Performance concerns
- Feature requests
