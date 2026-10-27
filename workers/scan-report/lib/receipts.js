// CK-8503 (G4): provider receipts for the report email. Resend POSTs signed events (Svix format) to /api/resend-webhook; the furthest state seen is
// stored on the scan (scans.delivery_status) by public.mpt_record_email_receipt(), which ranks events in SQL so late or repeated events never move it backwards.
// OFF (404) until RESEND_WEBHOOK_SECRET is set. Until a receipt arrives the row says only "the provider accepted it" (lib/lifecycle.js).
//
// Signature: header svix-id, svix-timestamp, svix-signature ("v1,<base64>" space-separated). Signed content is `${id}.${timestamp}.${rawBody}`,
// HMAC-SHA256 with the base64 part of the secret ("whsec_<base64>"). The body is read raw, size-capped, and checked BEFORE it is parsed.
// Only the provider message id and event type are used. No address, subject or body is stored or logged.
export const MAX_RECEIPT_BYTES = 64 * 1024;
export const TIMESTAMP_TOLERANCE_S = 5 * 60;
export const EVENT_STATUS = { 'email.sent': 'sent', 'email.delivery_delayed': 'delivery_delayed', 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.failed': 'failed', 'email.complained': 'complained' };

const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64encode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function signReceipt(secret, id, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', b64decode(String(secret).replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `v1,${b64encode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))}`;
}

/** true only for a correctly signed, fresh request. Never throws: a malformed secret or header is simply "not valid". */
export async function verifyReceipt(secret, headers, rawBody, nowS = Math.floor(Date.now() / 1000)) {
  try {
    const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigs = headers.get('svix-signature');
    if (!id || !ts || !sigs || !/^\d{9,12}$/.test(ts)) return false;
    if (Math.abs(nowS - Number(ts)) > TIMESTAMP_TOLERANCE_S) return false;   // replay window
    const want = await signReceipt(secret, id, ts, rawBody);
    return sigs.split(' ').some((candidate) => same(candidate.trim(), want));
  } catch { return false; }
}

/** POST /api/resend-webhook. Answers 404 when off, 401 on a bad signature, 413 when oversized, 200 for anything verified (matched or not), 500 only on a database failure so Resend retries. */
export async function handleResendWebhook(env, request, json, { sb }) {
  if (!env.RESEND_WEBHOOK_SECRET) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  if (Number(request.headers.get('content-length') || 0) > MAX_RECEIPT_BYTES) return json({ error: 'Payload too large' }, 413);
  const raw = await request.text();
  if (raw.length > MAX_RECEIPT_BYTES) return json({ error: 'Payload too large' }, 413);
  if (!(await verifyReceipt(env.RESEND_WEBHOOK_SECRET, request.headers, raw))) return json({ error: 'Invalid signature' }, 401);
  let event;
  try { event = JSON.parse(raw); } catch { return json({ ok: true, ignored: 'unparseable' }); }
  const status = EVENT_STATUS[event?.type];
  const messageId = event?.data?.email_id;
  if (!status || typeof messageId !== 'string') return json({ ok: true, ignored: 'event not used' });   // opened, clicked, etc.
  const at = Date.parse(event.created_at || event.data?.created_at || '');
  try {
    const updated = await sb.rpc('mpt_record_email_receipt', { p_message_id: messageId, p_status: status, p_at: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString() });
    console.log(`resend receipt: ${status} ${updated ? 'recorded' : 'no change'}`);   // status only, no ids or addresses
    return json({ ok: true });
  } catch (e) {
    console.error('resend receipt not recorded:', e.status || 'error');   // 404 here = migration not applied yet; Resend retries
    return json({ error: 'Unavailable' }, 500);
  }
}
