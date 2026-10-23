// MPC-8452: the live view on the /scan thank-you screen. After a scan request is accepted the Worker runs the fast email checks at once and the
// page polls GET /api/scan/live to show each result as it lands. This first increment shows ONLY low-sensitivity facts (what was checked and
// whether it found something), never the value: anyone can type anyone's address, so the detail stays in the report email, which only the
// owner of the inbox receives. Showing the detail live needs proof of inbox ownership (a later increment).
// Access is a short-lived stream token (HMAC with UNSUBSCRIBE_SECRET, nothing stored). It is NOT the scan number, which is shown to the visitor
// as the deletion handle. The token goes in the URL query of a read-only GET; it expires after LIVE_TTL_MS.
import { EMAIL_HEXAGONS, emailHexagonSignalRows, runEmailHexagons } from './emailHexagons.js';

export const LIVE_TTL_MS = 15 * 60 * 1000;
export const VERIFY_TTL_MS = 7 * 24 * 3600 * 1000;   // the email link: possession of it proves the reader controls the inbox the scan was requested for
const SITE = 'https://www.myprivacytool.io';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
const sameString = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/** `${scanId}.${expiresAtMs}.${signature}`, or null when UNSUBSCRIBE_SECRET is not set (feature off). */
export async function makeLiveToken(env, scanId, now = Date.now()) {
  if (!env.UNSUBSCRIBE_SECRET || !UUID_RE.test(String(scanId))) return null;
  const exp = now + LIVE_TTL_MS;
  return `${scanId}.${exp}.${await sign(env.UNSUBSCRIBE_SECRET, `live:${scanId}:${exp}`)}`;
}

/** The link in the confirmation and report emails: `${SITE}/scan/live#v=<token>`. The token sits in the URL fragment, which browsers never send to any server. null = feature off. */
export async function makeLiveLink(env, scanId, now = Date.now()) {
  if (!env.UNSUBSCRIBE_SECRET || !UUID_RE.test(String(scanId))) return null;
  const exp = now + VERIFY_TTL_MS;
  return `${SITE}/scan/live#v=${scanId}.${exp}.${await sign(env.UNSUBSCRIBE_SECRET, `verify:${scanId}:${exp}`)}`;
}

/** The scan id an email-link token grants (and with it the right to see the detail), or null. */
export async function readVerifyToken(env, token, now = Date.now()) {
  if (!env.UNSUBSCRIBE_SECRET || typeof token !== 'string' || token.length > 200) return null;
  const [scanId, exp, sig, extra] = token.split('.');
  if (extra !== undefined || !UUID_RE.test(scanId || '') || !/^\d{10,15}$/.test(exp || '') || !sig) return null;
  if (Number(exp) < now) return null;
  return sameString(sig, await sign(env.UNSUBSCRIBE_SECRET, `verify:${scanId}:${exp}`)) ? scanId : null;
}

/** The scan id the token grants, or null when it is missing, malformed, forged or expired. */
export async function readLiveToken(env, token, now = Date.now()) {
  if (!env.UNSUBSCRIBE_SECRET || typeof token !== 'string' || token.length > 200) return null;
  const [scanId, exp, sig, extra] = token.split('.');
  if (extra !== undefined || !UUID_RE.test(scanId || '') || !/^\d{10,15}$/.test(exp || '') || !sig) return null;
  if (Number(exp) < now) return null;
  return sameString(sig, await sign(env.UNSUBSCRIBE_SECRET, `live:${scanId}:${exp}`)) ? scanId : null;
}

// The Supabase rows for this scan's email checks, reduced to what an unverified visitor may see: id, label, status. No value, no detail.
// With { verified: true } (the email link was used) a found check also carries its value.
export function liveItems(rows, { verified = false } = {}) {
  const byId = new Map();   // the report job rewrites these rows, so a scan may briefly hold two copies: keep the last of each
  for (const r of rows || []) {
    const def = EMAIL_HEXAGONS[r.signal_type];
    if (!def) continue;
    const status = r.check_status === 'found' ? 'found' : r.check_status === 'clear' ? 'clear' : 'not_checked';
    const item = { id: r.signal_type, label: def.label, status };
    if (verified && status === 'found' && r.details) item.value = String(r.details).slice(0, 300);   // only after the email link proved inbox ownership
    byId.set(r.signal_type, item);
  }
  return Object.keys(EMAIL_HEXAGONS).filter((id) => byId.has(id)).map((id) => byId.get(id));
}

const SIGNAL_DEFAULTS = { details: null, removal_status: 'not_started', removal_url: null, removal_instructions: null };

/** Runs the fast email checks right after the request is accepted and writes them as signal rows. Never throws. Skips a scan that already has rows. */
export async function runLiveChecks(env, sb, scanId, email, fetchImpl = fetch) {
  try {
    const have = await sb.select(`signals?scan_id=eq.${scanId}&signal_type=like.email-*&select=id&limit=1`);
    if (have.length) return { skipped: 'already has rows' };
    const hex = await runEmailHexagons(email, env, fetchImpl);
    await sb.insertMany('signals', emailHexagonSignalRows(scanId, hex).map((r) => ({ ...SIGNAL_DEFAULTS, ...r })));
    return { wrote: hex.length };
  } catch (e) {
    console.error('live checks failed:', String(e).replace(/\S+@\S+/g, '[email]'));
    return { failed: true };
  }
}

/**
 * GET /api/scan/live. Two kinds of key:
 *   ?t=<stream token>        from POST /api/scan: low-sensitivity view (id, label, status).
 *   Authorization: Bearer <v>  from the email link: proves the reader controls the inbox, so found checks also carry their value.
 * -> { items, done, report_sent, verified }.
 */
export async function handleLive(env, request, origin, json, { allowedOrigins, limited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!env.UNSUBSCRIBE_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  if (await limited(env, request)) return json({ error: 'Too many requests' }, 429);
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const verifiedScan = bearer ? await readVerifyToken(env, bearer) : null;
  const scanId = verifiedScan || (bearer ? null : await readLiveToken(env, new URL(request.url).searchParams.get('t')));
  if (!scanId) return json({ error: 'Invalid or expired' }, 401);
  const verified = Boolean(verifiedScan);
  try {
    const [rows, scan] = await Promise.all([
      sb.select(`signals?scan_id=eq.${scanId}&signal_type=like.email-*&select=signal_type,check_status${verified ? ',details' : ''}`),
      sb.select(`scans?id=eq.${scanId}&select=report_status&limit=1`),
    ]);
    const items = liveItems(rows, { verified });
    return json({ items, done: items.length >= Object.keys(EMAIL_HEXAGONS).length, report_sent: scan[0]?.report_status === 'sent', verified });
  } catch (e) {
    console.error('live read failed:', String(e).replace(/\S+@\S+/g, '[email]'));
    return json({ error: 'Unavailable' }, 503);
  }
}
