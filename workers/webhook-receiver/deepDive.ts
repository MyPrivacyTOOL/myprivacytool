/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WhatsApp deep dive: OSINT scan -> user confirms findings on the web -> user replies RESULTS on WhatsApp (pull model, no Meta templates).
 *   POST /api/scan/start-deep-dive       server-to-server (X-Webhook-Secret = DEEP_DIVE_SECRET). {wa_id} -> {scan_id, hexagons}
 *   GET  /api/scan/deep-dive             browser, ?scan_id= -> {hexagons, finalized}: what the "Is this you?" page shows (scan_id is the bearer, as for the routes below)
 *   POST /api/scan/hexagon-interaction   browser, scan_id is the bearer. {scan_id, hexagon_id, action: confirm|reject|dispute}; each accepted answer is persisted (persistInteraction)
 *   GET  /api/scan/final-risk-score      browser, ?scan_id= -> {verified_exposure_count, score, confirmed_hexagon_ids, not_checked_count}
 *   POST /api/scan/finalize              browser, {scan_id}: marks the scan complete (once); the count is always computed SERVER-side
 *   resultsReply(env, wa_id)             called by the WhatsApp webhook when the person texts RESULTS or STATUS
 * Imported lazily from index.js so the Node-run security test never loads TypeScript.
 */
import { getConversationState, saveConversationState } from './firestore-client.js';
import { insertMptRow } from './supabase-client.js';
import { corsFor, clip, timingSafeEqual, unauthorized } from './security.js';
import { runOsintScan, verifiedExposureCount, verifiedExposureIds, ProofOfPossessionError, type OsintProviders, type ProviderCall } from '../../src/services/osintOrchestrator';
import { confirmHexagon, disputeHexagon, type LearningSignal } from '../../src/lib/identityConfirmation';
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

/**
 * Persist one accepted answer (the learning loop). scan_id is the session id: this is only reached for a scan that exists, is
 * unexpired and belongs to a wa_id that messaged us. Rejected / disputed also go to the tuning log, but only when the finding names its
 * provider (the engine tunes per provider). Fail-soft like every write in supabase-client.js: a database problem never blocks the answer.
 */
export async function persistInteraction(env: Env, scanId: string, s: LearningSignal): Promise<void> {
  await insertMptRow(env, 'mpt_hexagon_interactions', {
    scan_session_id: scanId, hexagon_id: s.hexagonId, user_action: s.outcome,
    original_confidence_score: s.confidence_score, osint_source: s.source,
  });
  if ((s.outcome === 'rejected' || s.outcome === 'disputed') && s.source) {
    await insertMptRow(env, 'osint_engine_tuning_log', {
      hexagon_id: s.hexagonId, osint_source: s.source, action_type: s.outcome === 'rejected' ? 'false_positive_rate' : 'dispute_rate',
    });
  }
}

/** Browser endpoints: CORS limited to our own origins. */
function browserGate(req: Request, methods: string) {
  const cors = corsFor(req);
  const headers = { ...cors.headers, 'Access-Control-Allow-Methods': methods };
  return { allowed: cors.allowed, headers };
}

/** Log a completed deep dive to mpt_user_engagement. Holds the scan id only: no phone number, name or finding. */
export function logFinalized(env: Env, scanId: string) {
  return insertMptRow(env, 'mpt_user_engagement', { session_id: scanId, channel: 'whatsapp', full_scan_completed: true });
}

/**
 * RESULTS / STATUS on WhatsApp. Looks up the sender's newest unexpired scan; if the person has finished it on the web, returns the
 * summary text, otherwise the "still processing" text. The caller sends it with the ordinary text endpoint (no template).
 */
export const PROCESSING_TEXT = 'Your Deep Dive is still processing. Please check back in a few minutes.';
export const EXPIRED_TEXT = 'Your last Deep Dive link expired (they last 24 hours). You can start a new one at https://myprivacytool.io/scan';
export async function resultsReply(env: Env, waId: string): Promise<string> {
  const ptr: any = await getConversationState(env, `deepdive_latest:${waId}`);
  const scan = ptr?.scan_id ? await loadScan(env, ptr.scan_id) : null;
  if (ptr?.scan_id && !scan) return EXPIRED_TEXT;   // had a scan, it is past its 24h life
  if (!scan || scan.state.wa_id !== waId || !scan.state.finalized_at) return PROCESSING_TEXT;
  const verified = verifiedExposureCount(scan.hexagons);
  const ids = new Set(verifiedExposureIds(scan.hexagons));
  const action = scan.hexagons.filter((h) => ids.has(h.id) && h.remediation).length;   // verified exposures that have a fix for the person to do
  return `Your MPT Deep Dive is complete. ✅ Verified: ${verified} exposures. ⚠️ Action required: ${action} items. Tap here for your secure dashboard: ${dashboardUrl(env, scan.scanId)}`;
}
const dashboardUrl = (env: Env, scanId: string) => `${env.DEEP_DIVE_DASHBOARD_URL || 'https://myprivacytool.io/scan/deep-dive'}?scan=${scanId}`;

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
      await saveScan(env, scanId, { wa_id, created_at: Date.now(), expires_at: Date.now() + SCAN_TTL_MS, finalized_at: 0 }, hexagons);
      await saveConversationState(env, `deepdive_latest:${wa_id}`, { scan_id: scanId });   // lets RESULTS find this person's newest scan; holds no findings
      console.log('deep-dive providers', JSON.stringify(diagnostics));   // outcomes and timings only
      return jsonRes({ scan_id: scanId, hexagons });
    } catch (e) {
      if (e instanceof ProofOfPossessionError) return jsonRes({ error: 'proof_of_possession_failed' }, 403);
      throw e;
    }
  }

  if (path === '/api/scan/deep-dive') {
    const g = browserGate(request, 'GET, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: g.headers });
    if (request.method !== 'GET') return new Response('Not Found', { status: 404 });
    if (!g.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, g.headers);
    const scan = await loadScan(env, new URL(request.url).searchParams.get('scan_id'));
    if (!scan) return jsonRes({ error: 'scan_not_found' }, 404, g.headers);
    // The findings belong to the person holding the link (the link went to their own WhatsApp). No wa_id is in the hexagons.
    return jsonRes({ hexagons: scan.hexagons, finalized: !!scan.state.finalized_at }, 200, g.headers);
  }

  if (path === '/api/scan/hexagon-interaction') {
    const g = browserGate(request, 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: g.headers });
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    if (!g.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, g.headers);
    const b: any = await request.json().catch(() => null);
    const scan = await loadScan(env, b?.scan_id);
    if (!scan) return jsonRes({ error: 'scan_not_found' }, 404, g.headers);
    if (scan.state.finalized_at) return jsonRes({ error: 'scan_finalized' }, 409, g.headers);
    const action = b?.action;
    if (!['confirm', 'reject', 'dispute'].includes(action) || typeof b?.hexagon_id !== 'string') return jsonRes({ error: 'bad_request' }, 400, g.headers);
    const t = action === 'dispute' ? disputeHexagon({ hexagons: scan.hexagons }, b.hexagon_id) : confirmHexagon({ hexagons: scan.hexagons }, b.hexagon_id, action === 'confirm');
    if (!t.signal) return jsonRes({ error: 'transition_not_allowed' }, 409, g.headers);   // e.g. answering twice, or disputing a low-confidence finding
    await saveScan(env, scan.scanId, scan.state, t.next.hexagons);
    await persistInteraction(env, scan.scanId, t.signal);
    return jsonRes({ hexagon: t.next.hexagons.find((h) => h.id === b.hexagon_id) }, 200, g.headers);
  }

  if (path === '/api/scan/final-risk-score') {
    const g = browserGate(request, 'GET, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: g.headers });
    if (request.method !== 'GET') return new Response('Not Found', { status: 404 });
    if (!g.allowed) return jsonRes({ error: 'Forbidden origin' }, 403, g.headers);
    const scan = await loadScan(env, new URL(request.url).searchParams.get('scan_id'));
    if (!scan) return jsonRes({ error: 'scan_not_found' }, 404, g.headers);
    const ids = verifiedExposureIds(scan.hexagons);   // confirmed or checked exposures; false_positive, disputed, guess, not_checked never appear
    return jsonRes({
      verified_exposure_count: ids.length,
      // percent of this scan's hexagons that are verified exposures (the denominator is every hexagon in the scan, answered or not)
      score: scan.hexagons.length ? Math.round((ids.length / scan.hexagons.length) * 1000) / 10 : 0,
      confirmed_hexagon_ids: ids,
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
    if (scan.state.finalized_at) return jsonRes({ success: true, already_sent: true }, 200, g.headers);   // once per scan
    const count = verifiedExposureCount(scan.hexagons);   // never taken from the browser
    await saveScan(env, scan.scanId, { ...scan.state, finalized_at: Date.now() }, scan.hexagons);
    await logFinalized(env, scan.scanId);
    return jsonRes({ success: true, verified_exposure_count: count }, 200, g.headers);
  }

  return null;
}
