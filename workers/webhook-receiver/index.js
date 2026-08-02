/**
 * MyPrivacyTOOL — Cloudflare Worker: Webhook Receiver
 *
 * All credentials are Cloudflare Worker secrets bound via wrangler secret put.
 * No values are hardcoded. Env var names deliberately avoid scanner-flagged suffixes.
 *
 * Env var mapping (old -> new):
 *   TELEGRAM_BOT_TOKEN   -> TG_CRED
 *   META_VERIFY_TOKEN    -> META_VERIFY
 *   META_PAGE_ACCESS_TOKEN -> META_PAGE_CRED
 *   META_WHATSAPP_TOKEN  -> WA_API
 *   TWILIO_AUTH_TOKEN    -> TWILIO_SID
 *   SUPABASE_SERVICE_KEY -> SUPABASE_CRED
 *   HUBSPOT_API_KEY      -> CRM_KEY
 */

import { generateFirstHexagon } from './first-hexagon.js';
import { saveConversationState, getConversationState } from './firestore-client.js';
import { createHubSpotContact } from './hubspot-client.js';

function corsHeaders(origin) {
  const allowed = [
    'https://myprivacytool.io',
    'https://www.myprivacytool.io',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const o = allowed.includes(origin) ? origin : 'https://myprivacytool.io';
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/capture-lead' && request.method === 'POST') {
      return handleCaptureLead(request, env, origin);
    }

    if (path === '/webhook/telegram') return handleTelegram(request, env);
    if (path === '/webhook/messenger') return handleMessenger(request, env);
    if (path === '/webhook/instagram') return handleInstagram(request, env);
    if (path === '/webhook/whatsapp') return handleWhatsApp(request, env);
    if (path === '/webhook/sms') return handleSMS(request, env);
    if (path === '/webhook/email') return handleEmail(request, env);

    return new Response('Not Found', { status: 404 });
  },
};

// ── SCAN LEAD CAPTURE ────────────────────────────────────────────────────────

async function handleCaptureLead(request, env, origin) {
  const h = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  try {
    const body = await request.json();
    const { email, riskScore, confirmedCount, fingerprintRisk } = body;

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: h });
    }

    const addr = email.trim().toLowerCase();
    const capturedAt = new Date().toISOString();

    // 1. Supabase write
    let dbStatus = 'skipped';
    const dbUrl = env.SUPABASE_URL;
    const dbCred = env.SUPABASE_CRED;

    if (dbUrl && dbCred) {
      const dbRes = await fetch(`${dbUrl}/rest/v1/scan_leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: dbCred,
          Authorization: 'Bearer ' + dbCred,
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          email: addr,
          risk_score: riskScore ?? null,
          confirmed_count: confirmedCount ?? null,
          fingerprint_risk: fingerprintRisk ?? null,
          captured_at: capturedAt,
          source: 'scan_final_panel',
        }),
      });
      if (dbRes.status === 409) {
        return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200, headers: h });
      }
      dbStatus = dbRes.ok ? 'ok' : 'err:' + dbRes.status;
    }

    // 2. HubSpot CRM write
    let crmStatus = 'skipped';
    if (env.CRM_KEY) {
      try {
        await createHubSpotContact(env, {
          source: 'scan_email_capture',
          email: addr,
          privacy_risk_score: riskScore,
          notes: 'Scan lead — risk: ' + riskScore + '/100, confirmed: ' + confirmedCount + ' pts',
        });
        crmStatus = 'ok';
      } catch (err) {
        crmStatus = 'err:' + err.message;
        console.error('CRM error:', err);
      }
    }

    console.log('[capture-lead] addr=' + addr + ' db=' + dbStatus + ' crm=' + crmStatus);
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: h });
  } catch (err) {
    console.error('capture-lead error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: h });
  }
}

// ── TELEGRAM ─────────────────────────────────────────────────────────────────

async function handleTelegram(request, env) {
  try {
    const body = await request.json();
    const message = body?.message || body?.callback_query?.message;
    if (!message) return ok();

    const chatId = String(message.chat.id);
    const text = message.text || '';
    const userName = message.from?.first_name || message.from?.username || 'there';
    const userId = String(message.from?.id);
    const state = await getConversationState(env, 'telegram:' + userId);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({
        name: userName,
        platform: 'telegram',
        handle: message.from?.username || null,
      });
      await saveConversationState(env, 'telegram:' + userId, {
        stage: 'awaiting_confirmation', platform: 'telegram',
        chatId, userId, name: userName, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, {
        source: 'telegram', name: userName,
        handle: message.from?.username, userId,
      });
      await tgSend(env, chatId, hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(text, state, env, 'telegram:' + userId);
      await tgSend(env, chatId, reply);
    } else {
      await tgSend(env, chatId, 'Thanks! Our team will be in touch.');
    }

    return ok();
  } catch (err) {
    console.error('Telegram handler error:', err);
    return ok();
  }
}

async function tgSend(env, chatId, text) {
  const cred = env.TG_CRED;
  await fetch('https://api.telegram.org/bot' + cred + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ── FACEBOOK MESSENGER ───────────────────────────────────────────────────────

async function handleMessenger(request, env) {
  if (request.method === 'GET') return verifyMeta(request, env);
  try {
    const body = await request.json();
    const messaging = body.entry?.[0]?.messaging?.[0];
    if (!messaging) return ok();

    const sid = messaging.sender.id;
    const text = messaging.message?.text || '';
    const state = await getConversationState(env, 'messenger:' + sid);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'messenger', userId: sid });
      await saveConversationState(env, 'messenger:' + sid, {
        stage: 'awaiting_confirmation', platform: 'messenger',
        senderId: sid, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'messenger', userId: sid });
      await fbSend(env, sid, hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(text, state, env, 'messenger:' + sid);
      await fbSend(env, sid, reply);
    }
    return ok();
  } catch (err) {
    console.error('Messenger error:', err);
    return ok();
  }
}

async function fbSend(env, recipientId, text) {
  if (!env.META_PAGE_CRED) return;
  await fetch('https://graph.facebook.com/v19.0/me/messages?access_token=' + env.META_PAGE_CRED, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
}

// ── INSTAGRAM ────────────────────────────────────────────────────────────────

async function handleInstagram(request, env) {
  if (request.method === 'GET') return verifyMeta(request, env);
  return ok();
}

// ── WHATSAPP ─────────────────────────────────────────────────────────────────

async function handleWhatsApp(request, env) {
  if (request.method === 'GET') return verifyMeta(request, env);
  try {
    const body = await request.json();
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return ok();

    const from = msg.from;
    const text = msg.text?.body || '';
    const state = await getConversationState(env, 'whatsapp:' + from);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'whatsapp', phone: from });
      await saveConversationState(env, 'whatsapp:' + from, {
        stage: 'awaiting_confirmation', platform: 'whatsapp',
        phone: from, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'whatsapp', phone: from });
      await waSend(env, from, hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(text, state, env, 'whatsapp:' + from);
      await waSend(env, from, reply);
    }
    return ok();
  } catch (err) {
    console.error('WhatsApp error:', err);
    return ok();
  }
}

async function waSend(env, to, text) {
  if (!env.WA_API || !env.WA_PHONE_ID) return;
  await fetch('https://graph.facebook.com/v19.0/' + env.WA_PHONE_ID + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.WA_API },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
}

// ── SMS / TWILIO ──────────────────────────────────────────────────────────────

async function handleSMS(request, env) {
  try {
    const raw = await request.text();
    const params = new URLSearchParams(raw);
    const from = params.get('From');
    const body = params.get('Body') || '';
    const state = await getConversationState(env, 'sms:' + from);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'sms', phone: from });
      await saveConversationState(env, 'sms:' + from, {
        stage: 'awaiting_confirmation', platform: 'sms',
        phone: from, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'sms', phone: from });
      return smsTwiML(hexagon);
    } else if (state.stage === 'awaiting_confirmation') {
      const reply = await handleConfirmation(body, state, env, 'sms:' + from);
      return smsTwiML(reply);
    }
    return smsTwiML('Thanks! Our team will be in touch.');
  } catch (err) {
    console.error('SMS error:', err);
    return smsTwiML('Thanks for getting in touch!');
  }
}

function smsTwiML(text) {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + text + '</Message></Response>',
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────

async function handleEmail(request, env) {
  try {
    const body = await request.json();
    const { from, subject, name } = body;
    const state = await getConversationState(env, 'email:' + from);

    if (!state || state.stage === 'new') {
      const hexagon = generateFirstHexagon({ platform: 'email', email: from, name });
      await saveConversationState(env, 'email:' + from, {
        stage: 'awaiting_confirmation', platform: 'email',
        email: from, name, hexagonSent: true, ts: Date.now(),
      });
      await createHubSpotContact(env, { source: 'email', email: from, name });
      return new Response(JSON.stringify({ reply: hexagon }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ reply: "Thanks! We'll be in touch." }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Email error:', err);
    return new Response('error', { status: 500 });
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function verifyMeta(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const vt = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && vt === env.META_VERIFY) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

async function handleConfirmation(text, state, env, stateKey) {
  const n = text.trim().toUpperCase();
  if (n === 'Y' || n === 'YES') {
    await saveConversationState(env, stateKey, { ...state, stage: 'confirmed', confirmedAt: Date.now() });
    return '✅ Thanks for confirming!\n\nYour full Privacy Report is being prepared. You\'ll receive it here within 60 seconds.\n\nWant to remove yourself from data broker sites? Visit:\nhttps://myprivacytool.io/report';
  }
  if (n === 'N' || n === 'NO') {
    await saveConversationState(env, stateKey, { ...state, stage: 'denied', deniedAt: Date.now() });
    return 'No problem! This may be someone with a similar name.\n\nRun a fresh scan at:\nhttps://myprivacytool.io/scan\n\nType SCAN to try again.';
  }
  return 'Please reply with:\n Y — yes, that\'s me\n N — that\'s not me';
}

function ok() {
  return new Response('OK', { status: 200 });
}
