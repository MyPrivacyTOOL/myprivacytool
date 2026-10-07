# Webhook Deployment Guide — MPC-7254

## Overview
This guide covers the setup, deployment, and operational management of:
1. **X (Twitter) Webhook** — Listen for brand mentions, privacy keywords, relevant hashtags
2. **Telegram Bot Webhook** — Listen for privacy scan requests, help commands
3. **Secret rotation** — 90-day OAuth token refresh, bot token management

**Status**: Deployment infrastructure ready (2026-10-07)
**Target deployment**: Cloudflare Workers (global HTTPS endpoints)
**Upstream**: Supabase Edge Function (MPC-8302 template engine)
**Logging**: Google Cloud Logging (structured JSON)

---

## Part 1: X Webhook Setup

### 1.1 X API Credentials

Required credentials from X Developer Dashboard:
- X Consumer Key (API Key)
- X Consumer Secret (API Secret)
- X Access Token
- X Access Token Secret
- X Bearer Token (v2 API)
- X Refresh Token (for OAuth 2.0 with PKCE)

**Location**: <https://developer.twitter.com/en/portal/dashboard>
- Go to **Projects & Apps** → Your Project → **Keys and tokens**
- Copy credentials from **Authentication Tokens**
- For OAuth 2.0 refresh token: Enable **OAuth 2.0** in app settings, request refresh token via flow
- Store all credentials in **Secret Manager** (see Part 3)

### 1.2 Set Up Webhook in X Developer Dashboard

1. Navigate to <https://developer.twitter.com/en/portal/account/api> → **Premium v2 API**
2. Select **Account Activity API** → **Dev environment** (or Prod)
3. Register your Cloudflare Workers endpoint as the webhook URL
4. X will send a **CRC challenge**. The webhook receiver responds with HMAC-SHA256
5. Verify registration by querying X API stream rules endpoint

### 1.3 Add Stream Filter Rules

Create rules to capture relevant tweets only. Use X API v2 `/tweets/search/stream/rules` endpoint.

Example filter categories:
- Brand mentions and privacy-related hashtags
- Privacy incident keywords (data exposed, breach, privacy leak)
- User removal requests (GDPR, CCPA references)

---

## Part 2: Telegram Bot Setup

### 2.1 Create a Telegram Bot

1. Message **@BotFather** on Telegram
2. Send `/newbot`
3. Provide bot details:
   - **Display Name**: `MyPrivacyTOOL Scanner`
   - **Username**: `myprivacytool_scanner_bot` (unique, must end with `_bot`)
4. BotFather returns a bot ID and access key
5. Store credentials in **Secret Manager** (see Part 3)

### 2.2 Configure Bot Commands

Send to **@BotFather**: `/mybots` → Select your bot → Edit Commands

Register these commands:
- `start` - Begin privacy scan
- `scan` - Run a new privacy scan
- `help` - Show help menu
- `remove` - Remove my data from brokers
- `status` - Check scan status

### 2.3 Register Webhook in Telegram

Use Telegram Bot API to register your webhook endpoint. Configure to receive:
- Messages
- Callback queries
- Inline queries

Telegram will deliver updates to your registered URL. Store bot ID and webhook secret in Secret Manager (see Part 3).

---

## Part 3: Secret Management & Rotation

### 3.1 Store Secrets in Google Secret Manager

Create secrets for all external API credentials:

```bash
# X API credentials
gcloud secrets create x-consumer-key --replication-policy="automatic"
gcloud secrets create x-consumer-secret --replication-policy="automatic"
gcloud secrets create x-access-token --replication-policy="automatic"
gcloud secrets create x-bearer-token --replication-policy="automatic"
gcloud secrets create x-refresh-token --replication-policy="automatic"

# Telegram bot credentials
gcloud secrets create telegram-bot-token --replication-policy="automatic"
gcloud secrets create telegram-webhook-secret --replication-policy="automatic"

# Supabase & Logging
gcloud secrets create supabase-service-key --replication-policy="automatic"
gcloud secrets create gcp-cloud-logging-token --replication-policy="automatic"
```

**IMPORTANT**: Never commit secret values to this repository. All credentials must be stored exclusively in Secret Manager.

### 3.2 Grant Cloudflare Workers Secret Access

In your GCP project **IAM**, grant the service account used by Cloudflare Workers:
- **Role**: `Secret Manager Secret Accessor`
- **Service Account**: Your Cloudflare service account or app's service account

### 3.3 X Access Token Rotation (90 days)

X access tokens expire after 90 days. Set up automatic rotation via Cloud Scheduler:

```bash
gcloud scheduler jobs create http x-token-rotation \
  --schedule="0 0 1 1,4,7,10 *" \
  --uri="https://myprivacytool.workers.dev/admin/rotate-x-token" \
  --http-method=POST
```

The webhook handler includes token refresh logic that:
1. Calls X OAuth2 token endpoint with the refresh token from Secret Manager
2. Receives a new access token
3. Stores updated token in Secret Manager
4. Logs the rotation event

### 3.4 Telegram Bot Token Rotation

Telegram bot tokens do not expire, but rotate annually for security:

1. Contact **@BotFather** to regenerate the bot token
2. Once regenerated, update Secret Manager with new value
3. Update Cloudflare Worker environment bindings
4. Re-register webhook with Telegram API

---

## Part 4: Cloudflare Worker Environment Configuration

### 4.1 Update `wrangler.toml`

```toml
# Add webhook routes
[[routes]]
pattern = "*/webhooks/x"
zone_id = "YOUR_ZONE_ID"

[[routes]]
pattern = "*/webhooks/telegram"
zone_id = "YOUR_ZONE_ID"

# Add KV namespace for rate limiting
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_KV_NAMESPACE_ID"

# Environment variables
[env.production]
vars = { ENVIRONMENT = "production" }
```

### 4.2 Bind Secrets to Worker

In `wrangler.toml` or via Cloudflare Dashboard:

```toml
[env.production.secrets]
X_CONSUMER_KEY = "x-consumer-key"
X_CONSUMER_SECRET = "x-consumer-secret"
X_ACCESS_TOKEN = "x-access-token"
X_BEARER_TOKEN = "x-bearer-token"
X_REFRESH_TOKEN = "x-refresh-token"
TELEGRAM_BOT_TOKEN = "telegram-bot-token"
TELEGRAM_BOT_WEBHOOK_SECRET = "telegram-webhook-secret"
SUPABASE_SERVICE_KEY = "supabase-service-key"
GCP_CLOUD_LOGGING_TOKEN = "gcp-cloud-logging-token"
```

### 4.3 Deploy

```bash
cd workers/webhooks
wrangler deploy --env production
```

Verify deployment by making a test request to your endpoint. Expect HTTP 401 (invalid signature) or 200 (valid event).

---

## Part 5: Integration with Supabase Edge Function

Webhook handlers forward all events to **MPC-8302 template engine**.

Event structure:
```json
{
  "platform": "x" | "telegram",
  "event_type": "mention" | "command" | "privacy_question",
  "user_id": "...",
  "username": "...",
  "text": "...",
  "created_at": "2026-10-07T06:08:51Z",
  "metadata": { ... }
}
```

**Supabase Edge Function endpoint** (URL stored in Secret Manager):
```
POST /functions/v1/risk-template-engine
Authorization: Bearer <service-key-from-secret-manager>
Content-Type: application/json
```

The edge function:
1. Receives the webhook event
2. Runs the **Risk Template Engine** (MPC-8302)
3. Generates a response (private exposure score, removal steps, etc.)
4. Inserts event into `webhook_events` table
5. Returns structured response back to webhook handler

---

## Part 6: Monitoring & Debugging

### 6.1 Cloud Logging Dashboard

View all webhook events:
```bash
gcloud logging read "jsonPayload.platform=x OR jsonPayload.platform=telegram" \
  --limit=50 \
  --format=json
```

Filter by platform:
```bash
# X events only
gcloud logging read "jsonPayload.platform=x" --limit=50

# Telegram events only
gcloud logging read "jsonPayload.platform=telegram" --limit=50

# Error events
gcloud logging read "severity=WARNING" --limit=50
```

### 6.2 Cloudflare Analytics

In Cloudflare Dashboard → **Analytics** → **Workers**:
- **Request count** by route
- **Error rates** and response codes
- **CPU time** per request
- **Real-time requests** viewer

### 6.3 Supabase Webhook Event Logs

Query the `webhook_events` table:
```sql
SELECT
  id,
  platform,
  event_type,
  username,
  text,
  response_status,
  created_at
FROM webhook_events
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 50;
```

---

## Part 7: Testing Webhooks Locally

### 7.1 Test X Webhook CRC Token

Send a GET request with a CRC token parameter. The endpoint responds with an HMAC-SHA256 computed response token.

### 7.2 Test X Webhook with Mock Tweet

Send a POST request with a mock tweet event payload and a valid X-Twitter-Webhooks-Signature header. The endpoint validates the signature and processes the event.

### 7.3 Test Telegram Webhook with Mock Message

Send a POST request with a mock Telegram message payload and optional secret token header. The endpoint validates the signature and processes the command.

---

## Part 8: Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| **401 Unauthorized** on X webhook | Invalid signature or expired bearer token | Verify token in Secret Manager; refresh if expired |
| **404 on Telegram webhook** | Webhook URL not registered in Telegram | Re-register webhook via Telegram Bot API setWebhook endpoint |
| **Rate limit (429)** | Too many requests from one user | Increase Cloudflare KV TTL or adjust rate limit threshold |
| **No events forwarded to Edge Function** | Edge function URL wrong or service key expired | Check environment variables; renew service key in Secret Manager |
| **Cloud Logging entries missing** | Service account lacks Secret Manager access | Grant `Secret Manager Secret Accessor` role to logging service account |

---

## Part 9: Next Steps

1. **MPC-8302**: Deploy Risk Template Engine (Supabase Edge Function)
2. **MPC-8303**: Build response templates (privacy exposure score, removal steps)
3. **MPC-8304**: Set up automated follow-ups (email, SMS, in-app notifications)
4. **Analytics**: Create dashboard for webhook event metrics
5. **Rate limiting**: Implement exponential backoff for downstream services

---

**Deployment owner**: MyPrivacyToolClaw
**Last updated**: 2026-10-07
**Status**: ✅ Ready for deployment
**Next review**: 2026-10-14
