/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MPC-7902 — WhatsApp proof of possession (hard go-live gate).
 *
 * No external / OSINT check may run on a phone number unless a web session has been BOUND, server-side, to the wa_id that sent an
 * authenticated inbound WhatsApp message containing a one-time code that this session asked for.
 *
 *   POST /api/pop/challenge   browser. {target?, consent: true} -> {session_token, code, expires_at, whatsapp_link}
 *                             The server mints BOTH the session token and the code. The client never supplies either.
 *   POST /api/pop/status      browser. {session_token} -> {verified}. Never returns the wa_id.
 *   redeemFromInbound()       called by the Meta-signed WhatsApp webhook only (index.js, after verifyMeta). The only way to bind a session.
 *   checkPossession()         the gate. Called at the execution boundary (start-deep-dive) immediately before any provider call.
 *   revokePossession()        STOP / DELETE: kills every proof for that wa_id.
 *
 * State lives in the existing mpt_conversation_state store (no new table, no competing identity store). Every key is HMAC-hashed with
 * POP_HMAC_SECRET, so a database read does not reveal a live code or a usable session token. Keys:
 *   pop_ch:<h(code)>      challenge          10 min, deleted on redemption (atomic DELETE ... RETURNING = single use)
 *   pop_sess:<h(token)>   proof / binding    60 min {wa, bound_at, inbound_ts, consent}
 *   pop_rev:<h(wa)>       revocation         24 h  {at}      (a proof bound at or before `at` is dead)
 *   pop_try:<h(wa)>       wrong-code counter 15 min
 *   pop_msg:<h(msg id)>   inbound dedup      1 h
 * INTERIM: when the MPC-7898 ledger is built these become ledger rows (person-key + data_point). See docs/whatsapp-pop-gate-mpc-7902.md.
 *
 * Everything FAILS CLOSED: a missing secret, an unreadable store or a failed write means no proof, never a default.
 * Possession proof is not consent to anything else and does not bypass any provider, budget or release gate.
 */
import { getStateStrict, insertStateIfAbsent, putStateStrict, takeState } from './state-store.js';
import { corsFor, clip } from './security.js';

type Env = Record<string, any>;

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const PROOF_TTL_MS = 60 * 60 * 1000;
export const REVOKE_TTL_MS = 24 * 3600 * 1000;
const TRY_WINDOW_MS = 15 * 60 * 1000;
const TRY_LOCK_MS = 60 * 60 * 1000;
export const MAX_WRONG_CODES = 5;
const MSG_TTL_MS = 60 * 60 * 1000;
/** Version of the consent wording shown on the web page. Bump when the wording changes; the proof records which one was accepted. */
export const CONSENT_VERSION = 'pop-consent-v1';

export const VERIFY_PROMPT = 'To protect privacy, verify that you control this number by sending this code to our WhatsApp bot.';
export const REPLY_OK = 'Verified. A MyPrivacyTOOL web session can now run a privacy check on this number for the next 60 minutes. If this was not you, reply STOP.';
export const REPLY_BAD_CODE = 'That code did not work or has expired. Please start again on the MyPrivacyTOOL website.';
export const REPLY_LOCKED = 'Too many attempts. Please try again later.';
export const REPLY_FAILED = 'We could not complete verification. Please start again on the MyPrivacyTOOL website.';

// 30 symbols, no 0/O/1/I/L/U. 8 symbols = ~39 bits, 240 = 8 * 30 so rejection sampling below is unbiased.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const CODE_RE = /\bMPT-([A-HJKMNP-TV-Z2-9]{4})-([A-HJKMNP-TV-Z2-9]{4})\b/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const enc = new TextEncoder();

/** Storage key a session token's proof lives under. Exported so tests can read the persisted state. */
export const sessionKey = async (env: Env, token: string) => `pop_sess:${await h(env, 'sess', token)}`;

export const popEnabled = (env: Env) => env.PHONE_SCAN_WEB_ENABLED === '1';
const secretOk = (env: Env) => typeof env.POP_HMAC_SECRET === 'string' && env.POP_HMAC_SECRET.length >= 32;

async function h(env: Env, label: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(env.POP_HMAC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${label}:${value}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(): string {
  const out: string[] = [];
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) { if (b < 240 && out.length < 8) out.push(ALPHABET[b % 30]); }
  }
  return `MPT-${out.slice(0, 4).join('')}-${out.slice(4).join('')}`;
}
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Digits only, country code included, as Meta's wa_id is. null = not a usable number. */
export function normaliseTarget(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 32 || !/^\+?[\d\s\-().]+$/.test(s)) return null;
  const d = s.replace(/\D/g, '').replace(/^00/, '');   // 00 is the international prefix
  return /^[1-9]\d{5,14}$/.test(d) ? d : null;
}

const jsonRes = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

// ── The gate ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Gate =
  | { ok: true; wa_id: string; inbound_ts: number }
  | { ok: false; status: 403 | 503; error: string; prompt?: string };

const deny = (error: string, withPrompt = false): Gate => ({ ok: false, status: 403, error, ...(withPrompt ? { prompt: VERIFY_PROMPT } : {}) });
const unavailable = (error: string): Gate => ({ ok: false, status: 503, error });

/**
 * Validates, from durable state, that this session holds a live proof for exactly this target. Call it at the point of execution, every time
 * (do not cache its answer, and re-run it when queued work starts). `target` undefined = only ask whether the session is verified.
 */
export async function checkPossession(env: Env, input: { token: unknown; target?: unknown }): Promise<Gate> {
  if (!popEnabled(env)) return deny('phone_scan_disabled');                       // flag OFF = no phone-number scan on web, full stop
  if (!secretOk(env)) return unavailable('proof_store_unavailable');
  if (typeof input.token !== 'string' || !TOKEN_RE.test(input.token)) return deny('verification_required', true);
  let target: string | null = null;
  if (input.target !== undefined) {
    target = normaliseTarget(input.target);
    if (!target) return deny('target_invalid');
  }
  const sess = await getStateStrict(env, `pop_sess:${await h(env, 'sess', input.token)}`);
  if (!sess.ok) return unavailable('proof_store_unavailable');
  const p = sess.state;
  if (!p || typeof p.wa !== 'string' || typeof p.bound_at !== 'number' || typeof p.inbound_ts !== 'number') return deny('verification_required', true);
  const rev = await getStateStrict(env, `pop_rev:${await h(env, 'wa', p.wa)}`);
  if (!rev.ok) return unavailable('proof_store_unavailable');
  if (rev.state && typeof rev.state.at === 'number' && rev.state.at >= p.bound_at) return deny('proof_revoked', true);
  if (p.consent?.v !== CONSENT_VERSION || p.consent?.accepted !== true) return deny('consent_required');
  if (target !== null && target !== p.wa) return deny('target_mismatch');        // never substitute another target
  return { ok: true, wa_id: p.wa, inbound_ts: p.inbound_ts };
}

/** STOP / DELETE: every proof bound to this wa_id stops working at once. Returns false if the tombstone could not be stored. */
export async function revokePossession(env: Env, waId: string): Promise<boolean> {
  if (!secretOk(env)) return false;
  return putStateStrict(env, `pop_rev:${await h(env, 'wa', waId)}`, { at: Date.now() }, REVOKE_TTL_MS);
}

// ── Inbound redemption (Meta-signed webhook only) ───────────────────────────────────────────────────────────────────────────────
export interface InboundMessage { from: string; text: string; msgId?: string; ts: number }
export type Redeem = { outcome: 'bound' | 'invalid' | 'mismatch' | 'locked' | 'duplicate' | 'error' | 'ignored'; reply: string | null };

/**
 * Called only from handleWhatsApp AFTER verifyMeta accepted the request. `from` is therefore the provider-attested sender; the code
 * can only come from a message that sender really sent. Nothing the browser sends is read here.
 */
export async function redeemFromInbound(env: Env, m: InboundMessage): Promise<Redeem> {
  if (!popEnabled(env)) return { outcome: 'ignored', reply: null };
  const found = CODE_RE.exec(m.text || '');
  if (!found || !/^\d{6,15}$/.test(m.from)) return { outcome: 'ignored', reply: null };
  if (!secretOk(env)) return { outcome: 'error', reply: REPLY_FAILED };
  const code = `MPT-${found[1]}-${found[2]}`.toUpperCase();
  const now = Date.now();

  // 1. Claim the provider message id atomically, so a redelivered / replayed event does nothing (no second reply, no strike).
  if (m.msgId) {
    const claim = await insertStateIfAbsent(env, `pop_msg:${await h(env, 'msg', m.msgId)}`, { at: now }, MSG_TTL_MS);
    if (!claim.ok) return { outcome: 'error', reply: REPLY_FAILED };
    if (!claim.inserted) return { outcome: 'duplicate', reply: null };
  }

  // 2. Brute-force guard, per sender, before the code is even looked at.
  const tryKey = `pop_try:${await h(env, 'wa', m.from)}`;
  const tries = await getStateStrict(env, tryKey);
  if (!tries.ok) return { outcome: 'error', reply: REPLY_FAILED };
  const t = tries.state;
  if (t && t.n >= MAX_WRONG_CODES && typeof t.until === 'number' && now < t.until) return { outcome: 'locked', reply: REPLY_LOCKED };

  // 3. Single-use: one DELETE ... RETURNING. Concurrent redeemers of the same code: exactly one gets the row.
  const taken = await takeState(env, `pop_ch:${await h(env, 'ch', code)}`);
  if (!taken.ok) return { outcome: 'error', reply: REPLY_FAILED };
  const ch = taken.state;
  if (!ch || typeof ch.sid !== 'string') {
    const n = (t && typeof t.n === 'number' && now - (t.first ?? 0) < TRY_WINDOW_MS ? t.n : 0) + 1;
    await putStateStrict(env, tryKey, { n, first: n === 1 ? now : t?.first ?? now, until: now + TRY_LOCK_MS }, TRY_LOCK_MS);   // best effort; the code is refused either way
    return { outcome: 'invalid', reply: REPLY_BAD_CODE };
  }

  // 4. The sender must be the number the visitor said they wanted checked. The code is spent either way; we do not say which number was expected.
  if (ch.target && ch.target !== m.from) return { outcome: 'mismatch', reply: REPLY_BAD_CODE };

  // 5. Durably record the proof BEFORE telling anyone it worked. No write, no proof.
  const ok = await putStateStrict(env, `pop_sess:${ch.sid}`, {
    wa: m.from, bound_at: now, inbound_ts: m.ts, msg: m.msgId ? await h(env, 'msg', m.msgId) : null,
    consent: { v: ch.consent?.v, accepted: ch.consent?.accepted === true },
  }, PROOF_TTL_MS);
  if (!ok) return { outcome: 'error', reply: REPLY_FAILED };
  return { outcome: 'bound', reply: REPLY_OK };
}

// ── HTTP (browser) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function body(request: Request): Promise<any> {
  const raw = await request.text();
  if (raw.length > 2048) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function handlePop(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/pop/challenge' && path !== '/api/pop/status') return null;
  const cors = corsFor(request);
  const hdr = { ...cors.headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdr });
  if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
  if (!cors.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, hdr);
  if (!popEnabled(env)) return jsonRes({ error: 'phone_scan_disabled' }, 403, hdr);
  if (!secretOk(env)) return jsonRes({ error: 'proof_store_unavailable' }, 503, hdr);
  const b = await body(request);
  if (!b || typeof b !== 'object') return jsonRes({ error: 'bad_request' }, 400, hdr);

  if (path === '/api/pop/status') {
    const g = await checkPossession(env, { token: b.session_token });
    if (g.ok === true) return jsonRes({ verified: true }, 200, hdr);
    return jsonRes({ verified: false, error: g.error, ...(g.prompt ? { prompt: g.prompt } : {}) }, g.status, hdr);
  }

  // challenge
  if (b.consent !== true) return jsonRes({ error: 'consent_required' }, 400, hdr);   // explicit, never defaulted
  let target: string | null = null;
  if (b.target !== undefined && b.target !== null && b.target !== '') {
    target = normaliseTarget(clip(b.target, 40));
    if (!target) return jsonRes({ error: 'target_invalid' }, 400, hdr);
  }
  if (env.RATE_LIMITER) {   // unlike the read-only learning endpoint, this one writes: a limiter that errors means no challenge
    try { if (!(await env.RATE_LIMITER.limit({ key: `pop:${request.headers.get('CF-Connecting-IP') || 'unknown'}` })).success) return jsonRes({ error: 'rate_limited' }, 429, hdr); }
    catch { return jsonRes({ error: 'proof_store_unavailable' }, 503, hdr); }
  }
  const token = randomToken();
  const sid = await h(env, 'sess', token);
  for (let i = 0; i < 5; i++) {   // collision handling: the INSERT is atomic, a taken code is simply redrawn
    const code = randomCode();
    const r = await insertStateIfAbsent(env, `pop_ch:${await h(env, 'ch', code)}`, { sid, target, consent: { v: CONSENT_VERSION, accepted: true }, created: Date.now() }, CHALLENGE_TTL_MS);
    if (!r.ok) return jsonRes({ error: 'proof_store_unavailable' }, 503, hdr);
    if (!r.inserted) continue;
    const bot = typeof env.WHATSAPP_BOT_NUMBER === 'string' && /^\d{6,15}$/.test(env.WHATSAPP_BOT_NUMBER) ? env.WHATSAPP_BOT_NUMBER : null;   // unset = no link and no number shown, never a placeholder
    return jsonRes({
      session_token: token, code, prompt: VERIFY_PROMPT, expires_at: Date.now() + CHALLENGE_TTL_MS,
      whatsapp_link: bot ? `https://wa.me/${bot}?text=${encodeURIComponent(code)}` : null,   // opening it sends nothing; only an inbound message counts
    }, 200, hdr);
  }
  return jsonRes({ error: 'try_again' }, 503, hdr);
}
