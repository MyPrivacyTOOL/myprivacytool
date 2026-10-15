/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WhatsApp deep dive: OSINT scan -> user confirms findings on the web -> "complete" template back on WhatsApp.
 *   POST /api/scan/start-deep-dive       server-to-server (X-Webhook-Secret = DEEP_DIVE_SECRET). {wa_id} -> {scan_id, hexagons}
 *   POST /api/scan/hexagon-interaction   browser, scan_id is the bearer. {scan_id, hexagon_id, action: confirm|reject|dispute}
 *   GET  /api/scan/final-risk-score      browser, ?scan_id=
 *   POST /api/scan/finalize              browser, {scan_id}: computes the count SERVER-side and sends the template (once)
 *   POST /api/whatsapp/notify-complete   server-to-server (same secret). {wa_id, verified_exposure_count, web_dashboard_url}
 * Imported lazily from index.js so the Node-run security test never loads TypeScript.
 */
import { getConversationState, saveConversationState } from './firestore-client.js';
import { insertMptRow } from './supabase-client.js';
import { corsFor, clip, timingSafeEqual, unauthorized } from './security.js';
import { runOsintScan, verifiedExposureCount, ProofOfPossessionError, type OsintProviders, type ProviderCall } from '../../src/services/osintOrchestrator';
import { sendTemplate, validateNotify, NotifyInputError, type SendResult } from '../../src/services/whatsappNotify';
import { confirmHexagon, disputeHexagon } from '../../src/lib/identityConfirmation';
import type { Hexagon } from '../../src/types/hexagon';

type Env = Record<string, string | undefined>;
const SCAN_TTL_MS = 24 * 3600 * 1000;   // same 24h promise as mpt_osint_scan_results
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Providers, built from env. Unset = not configured = not_checked. Response shapes below are ASSUMPTIONS to confirm against
//    the vendors' real docs before go-live; anything that does not match is thrown away as invalid, never defaulted.
async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`provider ${res.status}`);
  return res.json();
}
const count = (n: unknown, list: unknown): number => {
  if (typeof n === 'number') return n;
  if (Array.isArray(list)) return list.length;
  throw new Error('no count');
};

export function providersFromEnv(env: Env): OsintProviders {
  const p: OsintProviders = {};
  if (env.RAPIDAPI_KEY && env.RAPIDAPI_WHATSAPP_HOST) {
    p.profileMetadata = async (wa, signal) => {
      const j = await getJson(`https://${env.RAPIDAPI_WHATSAPP_HOST}${env.RAPIDAPI_WHATSAPP_PATH || '/profile'}?phone=${encodeURIComponent(wa)}`,
        { 'x-rapidapi-key': env.RAPIDAPI_KEY!, 'x-rapidapi-host': env.RAPIDAPI_WHATSAPP_HOST! }, signal);
      // profile_pic_url: string = has a photo, null = none. Absent key = unknown (left undefined so validation rejects it).
      const pic = j && 'profile_pic_url' in j ? (typeof j.profile_pic_url === 'string' ? j.profile_pic_url.length > 0 : j.profile_pic_url === null ? false : undefined) : undefined;
      return { profile_pic_exists: pic as boolean, is_business: j?.is_business };
    };
  }
  const keyed = (url?: string, key?: string): ProviderCall<any> | undefined => url && key
    ? (wa, signal) => getJson(`${url}${url.includes('?') ? '&' : '?'}phone=${encodeURIComponent(wa)}`, { Authorization: `Bearer ${key}` }, signal)
    : undefined;
  const spam = keyed(env.SPAM_API_URL, env.SPAM_API_KEY);
  if (spam) p.spamRegistry = async (wa, s) => { const j = await spam(wa, s); return { flag_count: count(j?.flags, j?.flags) }; };
  const breach = keyed(env.BREACH_API_URL, env.BREACH_API_KEY);
  if (breach) p.breachDb = async (wa, s) => { const j = await breach(wa, s); return { breach_count: count(j?.breach_count, j?.breaches) }; };
  return p;
}

// ── helpers
const stored = (env: Env) => !!env.GCP_PROJECT_ID && !!env.FIRESTORE_SA_TOKEN;
const jsonRes = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const serverAuth = (req: Request, env: Env) => !!env.DEEP_DIVE_SECRET && timingSafeEqual(req.headers.get('X-Webhook-Secret'), env.DEEP_DIVE_SECRET);

async function loadScan(env: Env, scanId: unknown) {
  if (typeof scanId !== 'string' || !UUID_RE.test(scanId)) return null;
  const s: any = await getConversationState(env, `deepdive:${scanId}`);
  if (!s || typeof s.expires_at !== 'number' || s.expires_at < Date.now()) return null;   // expired = gone, whatever Firestore still holds
  return { scanId, state: s, hexagons: JSON.parse(s.hexagons) as Hexagon[] };
}
const saveScan = (env: Env, scanId: string, state: any, hexagons: Hexagon[]) =>
  saveConversationState(env, `deepdive:${scanId}`, { ...state, hexagons: JSON.stringify(hexagons) });

/** Browser endpoints: CORS limited to our own origins. */
function browserGate(req: Request, methods: string) {
  const cors = corsFor(req);
  const headers = { ...cors.headers, 'Access-Control-Allow-Methods': methods };
  return { allowed: cors.allowed, headers };
}

/** Log one send attempt to mpt_user_engagement. Holds the scan id and Meta's answer only: no phone number, name or finding. */
export function logNotify(env: Env, scanId: string | null, r: SendResult) {
  return insertMptRow(env, 'mpt_user_engagement', {
    session_id: scanId ?? crypto.randomUUID(), channel: 'whatsapp', full_scan_completed: r.ok,
    whatsapp_notify_message_id: r.message_id, whatsapp_notify_error: r.error, whatsapp_notified_at: new Date().toISOString(),
  });
}

/** Shared by notify-complete and finalize. PoP: the number must have messaged us; the display name comes from our own record, not the caller. */
async function notify(env: Env, p: { wa_id: string; count: number; url: string; scanId: string | null; language?: string }): Promise<{ status: number; body: any }> {
  const conv: any = await getConversationState(env, `whatsapp:${p.wa_id}`);
  if (!conv?.inbound_message_timestamp) return { status: 403, body: { error: 'no inbound message from this number' } };
  const input = { wa_id: p.wa_id, verified_exposure_count: p.count, web_dashboard_url: p.url, display_name: conv.profileName, language: p.language };
  try { validateNotify(input); } catch (e) { return { status: 400, body: { error: e instanceof NotifyInputError ? e.message : 'invalid input' } }; }
  const r = await sendTemplate(env, input);
  await logNotify(env, p.scanId, r);
  return r.ok ? { status: 200, body: { success: true, message_id: r.message_id } } : { status: 502, body: { success: false, error: r.error } };
}

// ── handlers
export async function handleDeepDive(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === '/api/scan/start-deep-dive') {
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    if (!serverAuth(request, env)) return unauthorized();
    if (!stored(env)) return jsonRes({ error: 'storage_not_configured' }, 503);
    const body: any = await request.json().catch(() => null);
    const wa_id = clip(body?.wa_id, 20);
    const conv: any = await getConversationState(env, `whatsapp:${wa_id}`);
    try {
      const { hexagons, diagnostics } = await runOsintScan(
        { wa_id, profile_name: conv?.profileName, inbound_message_timestamp: conv?.inbound_message_timestamp }, providersFromEnv(env));
      const scanId = crypto.randomUUID();
      await saveScan(env, scanId, { wa_id, created_at: Date.now(), expires_at: Date.now() + SCAN_TTL_MS, notified_at: 0 }, hexagons);
      console.log('deep-dive providers', JSON.stringify(diagnostics));   // outcomes and timings only
      return jsonRes({ scan_id: scanId, hexagons });
    } catch (e) {
      if (e instanceof ProofOfPossessionError) return jsonRes({ error: 'proof_of_possession_failed' }, 403);
      throw e;
    }
  }

  if (path === '/api/scan/hexagon-interaction') {
    const g = browserGate(request, 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: g.headers });
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    if (!g.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, g.headers);
    const b: any = await request.json().catch(() => null);
    const scan = await loadScan(env, b?.scan_id);
    if (!scan) return jsonRes({ error: 'scan_not_found' }, 404, g.headers);
    if (scan.state.notified_at) return jsonRes({ error: 'scan_finalized' }, 409, g.headers);
    const action = b?.action;
    if (!['confirm', 'reject', 'dispute'].includes(action) || typeof b?.hexagon_id !== 'string') return jsonRes({ error: 'bad_request' }, 400, g.headers);
    const t = action === 'dispute' ? disputeHexagon({ hexagons: scan.hexagons }, b.hexagon_id) : confirmHexagon({ hexagons: scan.hexagons }, b.hexagon_id, action === 'confirm');
    if (!t.signal) return jsonRes({ error: 'transition_not_allowed' }, 409, g.headers);   // e.g. answering twice, or disputing a low-confidence finding
    await saveScan(env, scan.scanId, scan.state, t.next.hexagons);
    return jsonRes({ hexagon: t.next.hexagons.find((h) => h.id === b.hexagon_id) }, 200, g.headers);
  }

  if (path === '/api/scan/final-risk-score') {
    const g = browserGate(request, 'GET, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: g.headers });
    if (request.method !== 'GET') return new Response('Not Found', { status: 404 });
    if (!g.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, g.headers);
    const scan = await loadScan(env, new URL(request.url).searchParams.get('scan_id'));
    if (!scan) return jsonRes({ error: 'scan_not_found' }, 404, g.headers);
    return jsonRes({
      verified_exposure_count: verifiedExposureCount(scan.hexagons),
      not_checked_count: scan.hexagons.filter((h) => h.status === 'not_checked').length,
    }, 200, g.headers);
  }

  if (path === '/api/scan/finalize') {
    const g = browserGate(request, 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: g.headers });
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    if (!g.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, g.headers);
    const b: any = await request.json().catch(() => null);
    const scan = await loadScan(env, b?.scan_id);
    if (!scan) return jsonRes({ error: 'scan_not_found' }, 404, g.headers);
    if (scan.state.notified_at) return jsonRes({ success: true, already_sent: true }, 200, g.headers);   // once per scan
    const count = verifiedExposureCount(scan.hexagons);   // never taken from the browser
    const base = env.DEEP_DIVE_DASHBOARD_URL || 'https://myprivacytool.io/scan/deep-dive';
    const r = await notify(env, { wa_id: scan.state.wa_id, count, url: `${base}?scan=${scan.scanId}`, scanId: scan.scanId, language: b?.language });
    if (r.status === 200) await saveScan(env, scan.scanId, { ...scan.state, notified_at: Date.now() }, scan.hexagons);
    return jsonRes({ ...r.body, verified_exposure_count: count }, r.status === 200 ? 200 : r.status === 403 ? 403 : 502, g.headers);
  }

  if (path === '/api/whatsapp/notify-complete') {
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    if (!serverAuth(request, env)) return unauthorized();
    const b: any = await request.json().catch(() => null);
    const r = await notify(env, {
      wa_id: clip(b?.wa_id, 20), count: b?.verified_exposure_count, url: String(b?.web_dashboard_url ?? ''),
      scanId: typeof b?.scan_id === 'string' && UUID_RE.test(b.scan_id) ? b.scan_id : null, language: b?.language,
    });
    return jsonRes(r.body, r.status);
  }

  return null;
}
