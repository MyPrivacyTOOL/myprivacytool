# MyPrivacyTOOL — Omnichannel Messaging Infrastructure

## Overview

This doc covers the full messaging infrastructure: how inbound messages from any channel get routed to the First Hexagon workflow.

---

## Architecture

```
User (any channel)
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  Channel Adapters (one webhook per platform)         │
│  • Telegram → Cloudflare Worker (workers/telegram-webhook) │
│  • Web (/start page) → HubSpot form + email         │
│  • Facebook/Instagram → Meta Webhook (needs approval)│
│  • WhatsApp → Twilio (needs approval)                │
│  • Email → Postmark inbound (needs approval)         │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  HubSpot CRM (portal 246502821)                      │
│  • Contact created on first touch                    │
│  • mpt_channel, mpt_stage, mpt_telegram_id recorded  │
│  • Lifecycle stage: lead → customer                  │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  Conversation State (Cloudflare KV)                  │
│  Key: tg:{chatId}  Value: { stage, chatId, name }    │
│  Stages: new → awaiting_confirmation → confirmed     │
│  TTL: 7 days                                         │
└──────────────────────────────────────────────────────┘
```

---

## Channels — Status

| Channel | Status | What's Needed |
|---------|--------|---------------|
| Telegram | ✅ Ready to deploy | Bot token from @BotFather |
| Web (/start) | ✅ Ready to deploy | Nothing — live on Cloudflare Pages |
| WhatsApp | 🔒 Needs CK | Twilio account + number |
| Facebook Messenger | 🔒 Needs CK | Meta Business verification |
| Instagram DM | 🔒 Needs CK | Meta Business verification |
| Email (inbound) | 🔒 Needs CK | Postmark inbound webhook config |
| SMS | 🔒 Needs CK | Twilio account |
| Twitter/X DM | 🔒 Needs CK | X API v2 app approval |

---

## First Hexagon Flow

```
1. User arrives (any channel)
2. First Hexagon sent: 6-point privacy exposure summary
3. User replies Y or N
   Y → Full scan prompt → /scan page → email capture → HubSpot
   N → Fresh scan prompt → /scan page
4. HubSpot contact updated with stage
```

---

## Firestore Schema (GCP project: myprivacytool)

Collection: `conversations`

```json
{
  "docId": "{channel}:{userId}",
  "channel": "telegram | web | whatsapp | messenger | instagram | email | sms",
  "userId": "string (channel-specific ID)",
  "firstName": "string",
  "lastName": "string",
  "email": "string | null",
  "stage": "new | first_hexagon_sent | awaiting_confirmation | confirmed | declined | subscribed",
  "hubspotContactId": "string | null",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "messages": [
    {
      "direction": "inbound | outbound",
      "text": "string",
      "timestamp": "timestamp"
    }
  ]
}
```

---

## Telegram Deployment Steps

1. Create bot via @BotFather → get `TELEGRAM_BOT_TOKEN`
2. Create KV namespace: `wrangler kv:namespace create "MPT_KV"`
3. Paste KV namespace ID into `wrangler.toml`
4. Set secrets in Cloudflare Dashboard:
   - `TELEGRAM_BOT_TOKEN`
   - `HUBSPOT_API_KEY`
   - `WEBHOOK_SECRET` (any random string)
5. Deploy: `wrangler deploy workers/telegram-webhook/index.js`
6. Register webhook:
   ```
   curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://mpt-telegram-webhook.{CF_ACCOUNT}.workers.dev&secret_token={WEBHOOK_SECRET}"
   ```
7. Test: message the bot → should receive First Hexagon immediately

---

## Web (/start) Deployment

Already deployed via Cloudflare Pages — just needs the route added to App.tsx (PR included in this branch).

---

## What Needs CK Approval

See MPC-062 task in Notion for the full credential request list.

Short version:
- @BotFather Telegram token (Chris creates, pastes into Cloudflare)
- Meta Business account verification (or use existing page)
- Twilio account for WhatsApp/SMS
- Postmark inbound for email
