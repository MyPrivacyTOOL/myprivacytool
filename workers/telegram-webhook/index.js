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

import { resolveLocale, firstHexagon, confirmedY, confirmedN, unknown, confirmPrompt } from "./messages.js";

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

function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    // Verify secret header (set in Telegram webhook registration)
    // MPC-7350: fails closed. Previously an unset WEBHOOK_SECRET silently disabled authentication.
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!env.WEBHOOK_SECRET || !constantTimeEqual(secret, env.WEBHOOK_SECRET)) {
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
    const locale = resolveLocale(from.language_code);

    // Get current conversation state
    const state = await getConversationState(env.MPT_KV, chatId);

    let replyText = "";
    let nextStage = state.stage;

    if (state.stage === "new" || text === "start" || text === "/start" || text === "scan me" || text === "scan") {
      // Send First Hexagon
      replyText = firstHexagon(locale);
      nextStage = "awaiting_confirmation";

      // Create HubSpot contact (fire and forget)
      createHubSpotContact(firstName, lastName, chatId, env.HUBSPOT_API_KEY).catch(console.error);

    } else if (state.stage === "awaiting_confirmation") {
      if (text === "y" || text === "yes") {
        replyText = confirmedY(locale);
        nextStage = "confirmed";
      } else if (text === "n" || text === "no") {
        replyText = confirmedN(locale);
        nextStage = "declined";
      } else {
        replyText = confirmPrompt(locale);
      }
    } else {
      replyText = unknown(locale);
      nextStage = "awaiting_confirmation";
    }

    // Save state
    await setConversationState(env.MPT_KV, chatId, { stage: nextStage, chatId, firstName, lastName });

    // Send reply
    await sendTelegramMessage(chatId, replyText, env.TELEGRAM_BOT_TOKEN);

    return new Response("OK");
  },
};
