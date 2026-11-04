/**
 * MPC-7350 — request authentication and output escaping for the webhook receiver.
 * Every inbound webhook is authenticated and FAILS CLOSED when its secret is not configured.
 */
const enc = new TextEncoder();

export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a ?? '')), y = enc.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function hmac(hash, key, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (u8) => btoa(String.fromCharCode(...u8));

/** Telegram: secret_token passed to setWebhook comes back in X-Telegram-Bot-Api-Secret-Token. */
export function verifyTelegram(request, env) {
  return !!env.TELEGRAM_WEBHOOK_SECRET &&
    timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET);
}

/** Meta (Messenger / Instagram / WhatsApp): X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). */
export async function verifyMeta(request, rawBody, env) {
  if (!env.META_APP_SECRET) return false;
  const sig = request.headers.get('X-Hub-Signature-256') || '';
  return timingSafeEqual(sig, 'sha256=' + hex(await hmac('SHA-256', env.META_APP_SECRET, rawBody)));
}

/** Twilio: X-Twilio-Signature = base64(HMAC-SHA1(auth token, url + sorted key+value pairs)). */
export async function verifyTwilio(request, params, env) {
  if (!env.TWILIO_AUTH_TOKEN) return false;
  let data = env.TWILIO_WEBHOOK_URL || request.url;
  for (const k of [...new Set(params.keys())].sort()) data += k + params.getAll(k).join('');
  return timingSafeEqual(request.headers.get('X-Twilio-Signature'), b64(await hmac('SHA-1', env.TWILIO_AUTH_TOKEN, data)));
}

/** Email inbound relay: shared secret in X-Webhook-Secret. */
export function verifySharedSecret(request, env) {
  return !!env.EMAIL_WEBHOOK_SECRET && timingSafeEqual(request.headers.get('X-Webhook-Secret'), env.EMAIL_WEBHOOK_SECRET);
}

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const escapeXml = escapeHtml;
export const clip = (v, n) => String(v ?? '').slice(0, n);
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export const ALLOWED_ORIGINS = ['https://myprivacytool.io', 'https://www.myprivacytool.io'];
export function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    allowed: !origin || ALLOWED_ORIGINS.includes(origin),
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  };
}

export const unauthorized = () => new Response('Unauthorized', { status: 401 });
