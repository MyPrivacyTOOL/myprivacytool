// CK-8503 (G4): provider receipts for the report email. Resend POSTs signed events (Svix format) to /api/resend-webhook; the furthest state seen is
// stored on the scan (scans.delivery_status) by public.mpt_record_email_receipt(), which ranks events in SQL so late or repeated events never move it backwards.
// OFF (404) until RESEND_WEBHOOK_SECRET is set. Until a receipt arrives the row says only "the provider accepted it" (lib/lifecycle.js).
//
// Signature: header svix-id, svix-timestamp, svix-signature ("v1,<base64>" space-separated). Signed content is `${id}.${timestamp}.${rawBody}`,
// HMAC-SHA256 with the base64 part of the secret ("whsec_<base64>"). The body is read raw, size-capped, and checked BEFORE it is parsed.
// Only the provider message id and event type are used. No address, subject or body is stored or logged.
export const MAX_RECEIPT_BYTES = 64 * 1024;
export const TIMESTAMP_TOLERANCE_S = 5 * 60;
export const EVENT_STATUS = { 'email.clicked': 'clicked', 'email.sent': 'sent', 'email.delivery_delayed': 'delivery_delayed', 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.failed': 'failed', 'email.complained': 'complained' };

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

/** Resend bounce types: Permanent (hard), Transient (soft), Undetermined. Only a Permanent bounce or a complaint ends non-transactional email to that address. */
export const bounceKind = (event) => String(event?.data?.bounce?.type || '').toLowerCase().replace(/[^a-z]/g, '') || null;
const known = (k) => (['permanent', 'transient', 'undetermined'].includes(k) ? k : null);

/**
 * POST /api/resend-webhook. Answers 404 when off, 401 on a bad signature, 413 when oversized, 200 for anything verified (matched or not), 500 only on a database failure so Resend retries.
 * MPC-7556: every verified event is stored against the send (email_sends: any email type) as well as the report (scans.delivery_status, CK-8503). A hard bounce or a
 * complaint also records THE opt-out (optOutEverywhere), so that address is not emailed again by any non-transactional sender. Tagged-link clicks are counted; opens are not
 * (no pixels). The address in the event is used only to write the hashed opt-out; it is never stored or logged.
 * `deps.optOut(email, source)` and `deps.pushHubspot(email)` are injected by the Worker; tests pass fakes.
 */
export async function handleResendWebhook(env, request, json, { sb, optOut, pushHubspot }) {
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
  if (!status || typeof messageId !== 'string') return json({ ok: true, ignored: 'event not used' });   // opened, etc.
  const at = Date.parse(event.created_at || event.data?.created_at || '');
  const when = Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString();
  const bounce = status === 'bounced' ? known(bounceKind(event)) : null;
  try {
    // 1. the report email's own row (CK-8503); a click is not a delivery state, so it skips this
    const onScan = status === 'clicked' ? 0 : await sb.rpc('mpt_record_email_receipt', { p_message_id: messageId, p_status: status, p_at: when });
    // 2. the per-send row for every email type (MPC-7556). 404 = migration not applied yet: carry on, do not make Resend retry for ever.
    let onSend = 0;
    try { onSend = await sb.rpc('mpt_record_email_event', { p_message_id: messageId, p_status: status, p_at: when, p_bounce_type: bounce }); }
    catch (e) { if (e.status !== 404) throw e; console.warn('email event not stored per send: migration 20261028140000_mpc_7556_email_sends not applied'); }
    console.log(`resend receipt: ${status}${bounce ? ' (' + bounce + ')' : ''} ${onScan || onSend ? 'recorded' : 'no change'}`);   // status only, no ids or addresses
  } catch (e) {
    console.error('resend receipt not recorded:', e.status || 'error');   // 404 here = CK-8503 migration not applied yet; Resend retries
    return json({ error: 'Unavailable' }, 500);
  }
  // 3. a hard bounce or a complaint ends non-transactional email to that address. Idempotent, so Resend's retries are harmless.
  const endsEmail = bounce === 'permanent' || status === 'complained';
  let optedOut = false;
  if (endsEmail && typeof optOut === 'function') {
    const to = [].concat(event?.data?.to ?? []).filter((x) => typeof x === 'string' && x.includes('@'));
    try {
      for (const addr of to.slice(0, 5)) { await optOut(addr, status === 'complained' ? 'complaint' : 'hard_bounce'); if (typeof pushHubspot === 'function') await pushHubspot(addr); }
      optedOut = to.length > 0;
    } catch (e) { console.error('opt-out after bounce/complaint not recorded:', e.status || 'error'); return json({ error: 'Unavailable' }, 500); }   // Resend retries; optOutEverywhere is idempotent
  }
  return json({ ok: true, ...(optedOut ? { opted_out: true } : {}) });
}
