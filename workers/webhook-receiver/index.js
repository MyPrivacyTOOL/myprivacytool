/**
 * MyPrivacyTOOL — Cloudflare Worker: Webhook Receiver
 * Receives inbound messages from all platforms and routes to First Hexagon engine
 * 
 * Platforms handled:
 *   - Telegram (live)
 *   - Email/Gmail (live via GCP Cloud Function)
 *   - Facebook Messenger (stub — needs Meta App credentials)
 *   - Instagram DM (stub — needs Meta App credentials)
 *   - WhatsApp (stub — needs WhatsApp Business credentials)
 *   - SMS/Twilio (stub — needs Twilio credentials)
 */

import { generateFirstHexagon } from './first-hexagon.js';
import { saveConversationState, getConversationState } from './firestore-client.js';
import { createHubSpotContact } from './hubspot-client.js';

const PLATFORM_TOKENS = {
  telegram: () => TELEGRAM_BOT_TOKEN,       // CF secret
  meta_verify: () => META_VERIFY_TOKEN,     // CF secret
  twilio: () => TWILIO_AUTH_TOKEN,          // CF secret
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Platform routing
    if (path === '/webhook/telegram') return handleTelegram(request, env);
    if (path === '/webhook/messenger') return handleMessenger(request, env);
    if (path === '/webhook/instagram') return handleInstagram(request, env);
    if (path === '/webhook/whatsapp') return handleWhatsApp(request, env);
    if (path === '/webhook/sms') return handleSMS(request, env);
    if (path === '/webhook/email') return handleEmail(request, env);

    return new Response('Not Found', { status: 404 });
  }
};

// ─── TELEGRAM ────────────────────────────────────────────────────────────────

async function handleTelegram(request, env) {
  try {
    const body = await request.json();
    const message = body?.message || body?.callback_query?.message;
    if (!message) return ok();

    const chatId = String(message.chat.id);
    const text = message.text || '';
    const userName = message.from?.first_name || message.from?.username || 'there';
    const userId = String(message.from?.id);

    const state = await getConversationState(env, `telegram:${userId}`);

    if (!state || state.stage === 'new') {
      // First contact — send First Hexagon
      const hexagon = generateFirstHexagon({
        name: userName,
        platform: 'telegram',
        handle: message.from?.username || null,
      });

      await saveConversationState(env, `telegram:${userId}`, {
        stage: 'awaiting_confirmation',
        platform: 'telegram',
        chatId,
        userId,
        name: userName,
        hexagonSent: true,
        ts: Date.now(),
      });

      await createHubSpotContact(env, {
        source: 'telegram',
        name: userName,
        handle: message.from?.username,
        userId,
      });

      await sendTelegram(env, chatId, hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      // Handle Y/N response
      const reply = await handleConfirmation(text, state, env, `telegram:${userId}`);
      await sendTelegram(env, chatId, reply);
    } else {
      await sendTelegram(env, chatId, "Thanks! Our team will be in touch. 🔒");
    }

    return ok();
  } catch (err) {
    console.error('Telegram handler error:', err);
    return ok(); // Always 200 to Telegram
  }
}

async function sendTelegram(env, chatId, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
}

// ─── FACEBOOK MESSENGER ──────────────────────────────────────────────────────

async function handleMessenger(request, env) {
  // Meta webhook verification
  if (request.method === 'GET') return verifyMetaWebhook(request, env);

  try {
    const body = await request.json();
    const entry = body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    if (!messaging) return ok();

    const senderId = messaging.sender.id;
    const text = messaging.message?.text || '';
    const state = await getConversationState(env, `messenger:${senderId}`);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'messenger', userId: senderId });
      await saveConversationState(env, `messenger:${senderId}`, {
        stage: 'awaiting_confirmation', platform: 'messenger',
        senderId, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'messenger', userId: senderId });
      await sendMessenger(env, senderId, hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(text, state, env, `messenger:${senderId}`);
      await sendMessenger(env, senderId, reply);
    }

    return ok();
  } catch (err) {
    console.error('Messenger handler error:', err);
    return ok();
  }
}

async function sendMessenger(env, recipientId, text) {
  // STUB — requires META_PAGE_ACCESS_TOKEN
  if (!env.META_PAGE_ACCESS_TOKEN) return;
  await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${env.META_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
}

// ─── INSTAGRAM DM ────────────────────────────────────────────────────────────

async function handleInstagram(request, env) {
  if (request.method === 'GET') return verifyMetaWebhook(request, env);
  // Instagram uses same Meta Graph API structure as Messenger
  // STUB — wire after Meta App approval
  return ok();
}

// ─── WHATSAPP ────────────────────────────────────────────────────────────────

async function handleWhatsApp(request, env) {
  if (request.method === 'GET') return verifyMetaWebhook(request, env);

  try {
    const body = await request.json();
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return ok();

    const from = msg.from; // phone number
    const text = msg.text?.body || '';
    const state = await getConversationState(env, `whatsapp:${from}`);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'whatsapp', phone: from });
      await saveConversationState(env, `whatsapp:${from}`, {
        stage: 'awaiting_confirmation', platform: 'whatsapp',
        phone: from, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'whatsapp', phone: from });
      await sendWhatsApp(env, from, hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(text, state, env, `whatsapp:${from}`);
      await sendWhatsApp(env, from, reply);
    }

    return ok();
  } catch (err) {
    console.error('WhatsApp handler error:', err);
    return ok();
  }
}

async function sendWhatsApp(env, to, text) {
  // STUB — requires WHATSAPP_PHONE_NUMBER_ID + META_WHATSAPP_TOKEN
  if (!env.META_WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return;
  await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.META_WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
}

// ─── SMS / TWILIO ─────────────────────────────────────────────────────────────

async function handleSMS(request, env) {
  try {
    // Twilio sends form-encoded POST
    const text = await request.text();
    const params = new URLSearchParams(text);
    const from = params.get('From');
    const body = params.get('Body') || '';

    const state = await getConversationState(env, `sms:${from}`);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'sms', phone: from });
      await saveConversationState(env, `sms:${from}`, {
        stage: 'awaiting_confirmation', platform: 'sms',
        phone: from, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'sms', phone: from });
      return sendSMSResponse(hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(body, state, env, `sms:${from}`);
      return sendSMSResponse(reply);
    }

    return sendSMSResponse("Thanks! Our team will be in touch. 🔒");
  } catch (err) {
    console.error('SMS handler error:', err);
    return sendSMSResponse("Thanks for getting in touch!");
  }
}

function sendSMSResponse(text) {
  // Twilio expects TwiML XML response
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${text}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

// ─── EMAIL ───────────────────────────────────────────────────────────────────

async function handleEmail(request, env) {
  // Called by GCP Cloud Function after Gmail API receives inbound email
  try {
    const body = await request.json();
    const { from, subject, name } = body;

    const state = await getConversationState(env, `email:${from}`);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'email', email: from, name });
      await saveConversationState(env, `email:${from}`, {
        stage: 'awaiting_confirmation', platform: 'email',
        email: from, name, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'email', email: from, name });
      // Reply is sent by the GCP Cloud Function — return payload here
      return new Response(JSON.stringify({ reply: hexagon }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ reply: "Thanks! We'll be in touch." }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Email handler error:', err);
    return new Response('error', { status: 500 });
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function verifyMetaWebhook(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

async function handleConfirmation(text, state, env, stateKey) {
  const normalised = text.trim().toUpperCase();
  
  if (normalised === 'Y' || normalised === 'YES') {
    await saveConversationState(env, stateKey, { ...state, stage: 'confirmed', confirmedAt: Date.now() });
    return `✅ Thanks for confirming!\n\nYour full Privacy Report is being prepared. You'll receive it here within 60 seconds.\n\nWant to remove yourself from data broker sites? Visit:\nhttps://myprivacytool.io/report`;
  }
  
  if (normalised === 'N' || normalised === 'NO') {
    await saveConversationState(env, stateKey, { ...state, stage: 'denied', deniedAt: Date.now() });
    return `No problem! This may be someone with a similar name.\n\nYou can run a fresh scan with your exact details at:\nhttps://myprivacytool.io/scan\n\nType SCAN to try again.`;
  }
  
  return `Please reply with:\n✅ <b>Y</b> — yes, that's me\n❌ <b>N</b> — that's not me`;
}

function ok() {
  return new Response('OK', { status: 200 });
}
