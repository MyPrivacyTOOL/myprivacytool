/**
 * MyPrivacyTOOL — Telegram Bot Webhook
 * Cloudflare Worker
 *
 * Flow:
 * 1. Telegram sends POST to this worker on every message
 * 2. Worker sends First Hexagon reply
 * 3. Worker creates/updates HubSpot contact
 * 4. Worker stores conversation state in KV
 *
 * Deploy:
 *   wrangler deploy workers/telegram-webhook/index.js
 *
 * Env vars needed (Cloudflare Dashboard → Workers → Settings → Variables):
 *   TELEGRAM_BOT_TOKEN   — from @BotFather
 *   HUBSPOT_API_KEY      — portal 246502821
 *   WEBHOOK_SECRET       — random string for verification
 */

const FIRST_HEXAGON = `🔍 *Here's what's publicly known about you right now:*

✅ Name: visible from your Telegram profile
✅ Location: city & country estimable from IP
⚠️ Phone: possibly linked to this account
⚠️ Email: may be findable via data brokers
⚠️ Social profiles: cross-platform links detected
🚨 Data broker exposure: estimated 40+ sites

---
Is this data about you?

Reply *Y* to see your full privacy report and start removing yourself from data broker sites.

Reply *N* if this profile doesn't match you — we'll run a fresh scan.`;

const CONFIRMED_Y = `✅ *Confirmed.*

Your full privacy report is being generated now.

👉 Go here to see it and start the removal process:
https://myprivacytool.com/scan

We'll walk you through every step. It takes about 5 minutes.`;

const CONFIRMED_N = `🔍 *No problem — let's find the right profile.*

Run a fresh scan with your details here:
https://myprivacytool.com/scan

Takes 30 seconds.`;

const UNKNOWN = `👋 *Welcome to MyPrivacyTOOL.*

Send me your name or just say *"scan me"* and I'll show you what data brokers know about you right now.

It's free. No signup needed.`;

async function sendTelegramMessage(chatId, text, token) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function createHubSpotContact(firstName, lastName, telegramId, apiKey) {
  const url = "https://api.hubapi.com/crm/v3/objects/contacts";
  const body = {
    properties: {
      firstname: firstName || "Telegram",
      lastname: lastName || "User",
      mpt_telegram_id: String(telegramId),
      mpt_channel: "telegram",
      mpt_stage: "first_hexagon_sent",
      lifecyclestage: "lead",
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getConversationState(kv, chatId) {
  const raw = await kv.get(`tg:${chatId}`);
  return raw ? JSON.parse(raw) : { stage: "new" };
}

async function setConversationState(kv, chatId, state) {
  await kv.put(`tg:${chatId}`, JSON.stringify(state), { expirationTtl: 86400 * 7 }); // 7 days
}

export default {
  async fetch(request, env) {
    // Verify secret header (set in Telegram webhook registration)
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const message = update.message;
    if (!message) return new Response("OK");

    const chatId = message.chat.id;
    const text = (message.text || "").trim().toLowerCase();
    const from = message.from || {};
    const firstName = from.first_name || "";
    const lastName = from.last_name || "";

    // Get current conversation state
    const state = await getConversationState(env.MPT_KV, chatId);

    let replyText = "";
    let nextStage = state.stage;

    if (state.stage === "new" || text === "start" || text === "/start" || text === "scan me" || text === "scan") {
      // Send First Hexagon
      replyText = FIRST_HEXAGON;
      nextStage = "awaiting_confirmation";

      // Create HubSpot contact (fire and forget)
      createHubSpotContact(firstName, lastName, chatId, env.HUBSPOT_API_KEY).catch(console.error);

    } else if (state.stage === "awaiting_confirmation") {
      if (text === "y" || text === "yes") {
        replyText = CONFIRMED_Y;
        nextStage = "confirmed";
      } else if (text === "n" || text === "no") {
        replyText = CONFIRMED_N;
        nextStage = "declined";
      } else {
        replyText = "Reply *Y* to confirm this is you, or *N* if not.";
      }
    } else {
      replyText = UNKNOWN;
      nextStage = "awaiting_confirmation";
    }

    // Save state
    await setConversationState(env.MPT_KV, chatId, { stage: nextStage, chatId, firstName, lastName });

    // Send reply
    await sendTelegramMessage(chatId, replyText, env.TELEGRAM_BOT_TOKEN);

    return new Response("OK");
  },
};
