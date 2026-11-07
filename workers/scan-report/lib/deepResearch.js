// MPC-9546 / MPC-9549: Deep Research ownership check and own results list (Chris, 2026-11-07: ship without the shared reveal flow).
//
// Four POST routes, all OFF unless DEEP_RESEARCH_ENABLED is exactly "true" (they answer 404 otherwise, like the referral routes):
//   /api/deep-research/start    {email, cf-turnstile-response?}      -> emails a 6-digit code -> {ok, challenge_id}
//   /api/deep-research/verify   {challenge_id, email, code}          -> {ok, verified, token}   (token = proof of ownership, 1 hour)
//   /api/deep-research/results  {token}                              -> {ok, findings[]}        (this person's findings only)
//   /api/deep-research/delete   {token}                              -> {ok, deleted}           (deletion on request)
//
// The rules live in the database (migration 20261107050000_mpc_9549...): codes are stored as a hash, 5 wrong tries lock a code, at most 5
// codes per address per hour, and a finding can only be written for an address that passed. This file adds: the code email, the HMAC that
// turns an address into the 64-hex subject the database sees, and a signed token so ONLY the person who passed can read results.
//
// Privacy: the address is never stored here (the database holds only HMAC(address)); neither the address nor the code is ever logged.
// A suppressed (unsubscribed) address gets the same answer as everyone else but no email, so the endpoint cannot be used to probe lists.
// NO SPEND: reuses the existing Resend sender and Supabase. Nothing here calls a paid data provider; findings stay empty until a provider is connected.
import { sendEmail, shell } from './email.js';
import { checkDeliverableDomain } from './emailDomain.js';
import { isOptedOut } from './suppression.js';
import { readCappedJson } from './webScan.js';
import { turnstileBlocks } from './turnstile.js';

export const RETENTION_DAYS = 90;            // Chris, 2026-11-07
export const MIN_CONFIDENCE = 80;            // strategy page: only findings we are at least 80% sure about are shown
export const TOKEN_TTL_SECONDS = 3600;       // matches the database's 1-hour verified window
export const CODE_TTL_SECONDS = 600;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const norm = (e) => String(e || '').trim().toLowerCase().slice(0, 254);

export const deepResearchEnabled = (env) => String(env.DEEP_RESEARCH_ENABLED) === 'true';
/** When a finding written now should expire. Used by whatever writes findings (via mpt_deep_record_finding). */
export const findingExpiry = (now = new Date()) => new Date(now.getTime() + RETENTION_DAYS * 86400000).toISOString();

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(key)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}
export const subjectHash = (env, email) => hmacHex(env.DEEP_RESEARCH_HMAC_KEY, `subject:${norm(email)}`);
const codeHash = (env, subject, code) => hmacHex(env.DEEP_RESEARCH_HMAC_KEY, `code:${subject}:${code}`);

/** Six digits, uniformly random (rejection sampling, no modulo bias). */
export function makeCode() {
  const limit = 4294000000;                   // largest multiple of 1,000,000 that fits in 32 bits
  const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return String(a[0] % 1000000).padStart(6, '0');
}

const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
const sameString = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function makeToken(env, subject, challengeId, now = Date.now()) {
  const payload = b64u(JSON.stringify({ s: subject, c: challengeId, e: Math.floor(now / 1000) + TOKEN_TTL_SECONDS }));
  return `${payload}.${await hmacHex(env.DEEP_RESEARCH_HMAC_KEY, `token:${payload}`)}`;
}
/** -> {subject, challengeId} or null (bad shape, bad signature, expired). Never throws. */
export async function readToken(env, token, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 600) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !sameString(sig, await hmacHex(env.DEEP_RESEARCH_HMAC_KEY, `token:${payload}`))) return null;
    const p = JSON.parse(unb64u(payload));
    if (!/^[0-9a-f]{64}$/.test(p.s) || !UUID_RE.test(p.c) || !(p.e * 1000 > now)) return null;
    return { subject: p.s, challengeId: p.c };
  } catch { return null; }
}

export function buildCodeEmail(code) {
  const subject = 'Your MyPrivacyTOOL verification code';
  const text = `Your MyPrivacyTOOL verification code is ${code}.\n\nIt works for 10 minutes. We send it so only the owner of this address can run Deep Research checks on it.\nIf you did not ask for this, ignore this email: nobody can see anything about you without this code.\n\nAlice\nYour Dedicated MyPrivacyTOOL AI`;
  const inner = `<p style="margin:0 0 14px 0;font-size:16px;line-height:24px">Your verification code is:</p>
<p style="margin:0 0 14px 0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:6px">${code}</p>
<p style="margin:0 0 14px 0;font-size:14px;line-height:22px;color:#374151">It works for 10 minutes. We send it so only the owner of this address can run Deep Research checks on it.</p>
<p style="margin:0 0 14px 0;font-size:14px;line-height:22px;color:#374151">If you did not ask for this, ignore this email: nobody can see anything about you without this code.</p>
<p style="margin:0 0 14px 0;font-size:14px;line-height:22px;color:#374151">Alice<br>Your Dedicated MyPrivacyTOOL AI</p>`;
  const footer = 'This is a one-time security email, not marketing. Questions, or want your data deleted? Reply to this email or write to hello@myprivacytool.io.';
  return { subject, text, html: shell(subject, `Your code is ${code}`, inner, null, { footer }) };
}

const gate = async (env, request, origin, json, { allowedOrigins, rateLimited, prefix }) => {
  if (!deepResearchEnabled(env)) return json({ error: 'Not available' }, 404);
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (await rateLimited(env, request, prefix)) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.DEEP_RESEARCH_HMAC_KEY) return json({ error: 'Unavailable' }, 503);
  return null;
};
const readBody = async (request, max, json) => {
  const read = await readCappedJson(request, max);
  if (read.status || !read.body || typeof read.body !== 'object' || Array.isArray(read.body)) return { refused: json({ error: 'Invalid request' }, read.status === 413 ? 413 : 400) };
  return { body: read.body };
};
const errText = (e) => String((e && e.message) || e);

// POST /api/deep-research/start
export async function handleDeepResearchStart(env, request, origin, json, deps) {
  const { sb, allowed = () => true, fetchImpl = fetch } = deps;
  const refused = await gate(env, request, origin, json, { ...deps, prefix: 'deep-start:' });
  if (refused) return refused;
  const { body, refused: bad } = await readBody(request, 2048, json);
  if (bad) return bad;
  const email = norm(body.email);
  if (!EMAIL_RE.test(email)) return json({ error: 'Valid email required' }, 400);
  if (await turnstileBlocks(env, request, body['cf-turnstile-response'], origin, fetchImpl)) return json({ error: 'Verification failed' }, 403);
  if (!allowed(env, email)) return json({ ok: true, challenge_id: crypto.randomUUID() });        // same answer as a real one, no email
  const dom = await checkDeliverableDomain(email, fetchImpl);
  if (!dom.ok) return json({ error: 'That email address cannot receive mail' }, 400);
  if (await isOptedOut(sb, email)) return json({ ok: true, challenge_id: crypto.randomUUID() }); // unsubscribed: no email, same answer

  const subject = await subjectHash(env, email);
  const code = makeCode();
  let id;
  try {
    id = await sb.rpc('mpt_deep_challenge_create', { p_subject_hash: subject, p_channel: 'email', p_code_hash: await codeHash(env, subject, code), p_ttl_seconds: CODE_TTL_SECONDS });
  } catch (e) {
    if (/MPT01|rate_limited/.test(errText(e))) return json({ error: 'Too many codes requested for this address. Try again in an hour.' }, 429);
    console.error('deep-research start failed:', errText(e).slice(0, 120));
    return json({ error: 'Unavailable' }, 503);
  }
  const sent = await sendEmail(env, { to: email, ...buildCodeEmail(code), idempotencyKey: `deep-research-code-${id}` }, fetchImpl);
  if (!sent.sent) { console.error('deep-research code not sent:', String(sent.reason).slice(0, 120)); return json({ error: 'We could not send the code. Please try again.' }, 502); }
  return json({ ok: true, challenge_id: id });
}

// POST /api/deep-research/verify
export async function handleDeepResearchVerify(env, request, origin, json, deps) {
  const { sb } = deps;
  const refused = await gate(env, request, origin, json, { ...deps, prefix: 'deep-verify:' });
  if (refused) return refused;
  const { body, refused: bad } = await readBody(request, 2048, json);
  if (bad) return bad;
  const email = norm(body.email), code = String(body.code ?? '').trim(), id = String(body.challenge_id ?? '');
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code) || !UUID_RE.test(id)) return json({ error: 'Invalid request' }, 400);
  const subject = await subjectHash(env, email);
  let status;
  try { status = await sb.rpc('mpt_deep_challenge_verify', { p_id: id, p_code_hash: await codeHash(env, subject, code) }); }
  catch (e) { console.error('deep-research verify failed:', errText(e).slice(0, 120)); return json({ error: 'Unavailable' }, 503); }
  if (status === 'verified') return json({ ok: true, verified: true, token: await makeToken(env, subject, id), expires_in: TOKEN_TTL_SECONDS });
  const messages = { wrong: 'That code is not right.', expired: 'That code has expired. Ask for a new one.', locked: 'Too many wrong tries. Ask for a new code.', already_verified: 'That code was already used. Ask for a new one.', unknown: 'That code is not valid. Ask for a new one.' };
  return json({ ok: false, status: String(status), error: messages[status] || messages.unknown }, status === 'wrong' ? 400 : 409);
}

// A valid, unexpired token whose address is STILL verified in the database. -> {subject} or a Response.
async function authorise(env, body, sb, json) {
  const t = await readToken(env, body.token);
  if (!t) return { response: json({ error: 'Please verify your email again.' }, 401) };
  let ok;
  try { ok = await sb.rpc('mpt_deep_is_verified', { p_subject_hash: t.subject, p_channel: 'email', p_window_seconds: TOKEN_TTL_SECONDS }); }
  catch (e) { console.error('deep-research auth failed:', errText(e).slice(0, 120)); return { response: json({ error: 'Unavailable' }, 503) }; }
  return ok === true ? { subject: t.subject } : { response: json({ error: 'Please verify your email again.' }, 401) };
}

// POST /api/deep-research/results
export async function handleDeepResearchResults(env, request, origin, json, deps, now = new Date()) {
  const { sb } = deps;
  const refused = await gate(env, request, origin, json, { ...deps, prefix: 'deep-results:' });
  if (refused) return refused;
  const { body, refused: bad } = await readBody(request, 1024, json);
  if (bad) return bad;
  const who = await authorise(env, body, sb, json);
  if (who.response) return who.response;
  // Findings flagged for human review are not shown until a person clears them; encrypted evidence is never returned.
  const rows = await sb.select(`hexagon_findings?subject_hash=eq.${who.subject}&expires_at=gt.${encodeURIComponent(now.toISOString())}&confidence_score=gte.${MIN_CONFIDENCE}&needs_human_review=eq.false&select=id,hexagon_id,finding_type,confidence_score,remediation_link,created_at&order=created_at.desc&limit=100`);
  return json({ ok: true, min_confidence: MIN_CONFIDENCE, retention_days: RETENTION_DAYS, findings: rows });
}

// POST /api/deep-research/delete
export async function handleDeepResearchDelete(env, request, origin, json, deps) {
  const { sb } = deps;
  const refused = await gate(env, request, origin, json, { ...deps, prefix: 'deep-delete:' });
  if (refused) return refused;
  const { body, refused: bad } = await readBody(request, 1024, json);
  if (bad) return bad;
  const who = await authorise(env, body, sb, json);
  if (who.response) return who.response;
  const deleted = await sb.rpc('mpt_deep_delete_subject', { p_subject_hash: who.subject });
  return json({ ok: true, deleted: Number(deleted) || 0 });
}
