// HITL identity confirmation loop: POST /api/scan/hexagon-interaction and GET /api/scan/final-risk-score.
//
// Proof-of-Possession: both endpoints answer 403 unless scan_session_id names a row in mpt_scan_sessions with verified_at set and
// revoked_at null (a wa_id bound by the WhatsApp verification flow). Unknown, unbound and revoked sessions are indistinguishable (403).
//
// Honesty filter (final score). A hexagon's final state is the LATEST interaction for it in this session, else its captured state:
//   confirmed             -> counts
//   rejected (false_positive), disputed -> never count
//   no interaction        -> counts only as "checked": the scan captured it as FOUND and the registry marks it measured.
//                            Estimates (given/guess), cannot-be-checked, clear and not_checked hexagons never count on their own.
// score = round(counted / HEXAGON_COUNT * 100, 1): the denominator is every hexagon in the registry, not just the ones answered.
import { HEXAGON_COUNT, getHexagon } from '../../../shared/hexagon-registry/registry.js';
import { readCappedJson } from './webScan.js';

export const USER_ACTIONS = ['confirmed', 'rejected', 'disputed'];
const SESSION_RE = /^[A-Za-z0-9_-]{16,128}$/;
const SOURCE_RE = /^[A-Za-z0-9 ._-]{1,64}$/;
const KEYS = ['scan_session_id', 'hexagon_id', 'user_action', 'original_confidence_score', 'osint_source'];

export function validateInteraction(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => !KEYS.includes(k))) return { error: 'Invalid request' };
  if (typeof b.scan_session_id !== 'string' || !SESSION_RE.test(b.scan_session_id)) return { error: 'Invalid scan_session_id' };
  if (typeof b.hexagon_id !== 'string' || !getHexagon(b.hexagon_id)) return { error: 'Unknown hexagon_id' };
  if (!USER_ACTIONS.includes(b.user_action)) return { error: 'Invalid user_action' };
  const c = b.original_confidence_score;
  if (c != null && !(typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1)) return { error: 'original_confidence_score must be 0 to 1' };
  if (b.osint_source != null && !(typeof b.osint_source === 'string' && SOURCE_RE.test(b.osint_source))) return { error: 'Invalid osint_source' };
  return { value: { sessionId: b.scan_session_id, hexagonId: b.hexagon_id, action: b.user_action, confidence: c ?? null, source: b.osint_source ?? null } };
}

/** @returns {Promise<{web_scan_id: string|null}|null>} the bound session, or null when it is unknown, unverified or revoked */
async function boundSession(sb, sessionId) {
  const rows = await sb.select(`mpt_scan_sessions?select=web_scan_id&scan_session_id=eq.${encodeURIComponent(sessionId)}&verified_at=not.is.null&revoked_at=is.null&limit=1`);
  return rows?.[0] ?? null;
}

export async function handleHexagonInteraction(env, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (await rateLimited(env, request, 'hitl:')) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  const read = await readCappedJson(request, 1024);
  if (read.status) return json({ error: read.status === 413 ? 'Payload too large' : 'Invalid request' }, read.status);
  const v = validateInteraction(read.body);
  if (v.error) return json({ error: v.error }, 400);
  const { sessionId, hexagonId, action, confidence, source } = v.value;
  try {
    const res = await sb.rpc('mpt_record_hexagon_interaction', {
      p_scan_session_id: sessionId, p_hexagon_id: hexagonId, p_user_action: action, p_confidence: confidence, p_osint_source: source,
    });
    if (res?.bound !== true) return json({ error: 'Session not verified' }, 403);
    return json({ ok: true });
  } catch (e) {
    console.error('hexagon interaction failed:', e.status || 'error');
    return json({ error: 'Could not record the interaction' }, 500);
  }
}

/** Pure: the honesty filter and score. `scanResults` is web_scans.results (or []), `interactions` any order. */
export function computeFinalRiskScore(scanResults, interactions) {
  const latest = new Map();
  for (const i of [...interactions].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) latest.set(i.hexagon_id, i.user_action);
  const captured = new Map((Array.isArray(scanResults) ? scanResults : []).map((r) => [r?.id, r?.status]));
  const confirmed = [];
  const ids = new Set([...latest.keys(), ...captured.keys()]);
  for (const id of ids) {
    const reg = getHexagon(id);
    if (!reg) continue;
    const action = latest.get(id);
    const counts = action ? action === 'confirmed' : captured.get(id) === 'found' && reg.truth.level === 'measured';
    if (counts) confirmed.push(id);
  }
  confirmed.sort();
  return { score: Math.round((confirmed.length / HEXAGON_COUNT) * 1000) / 10, verified_exposures: confirmed.length, total_hexagons: HEXAGON_COUNT, confirmed_hexagon_ids: confirmed };
}

export async function handleFinalRiskScore(env, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (await rateLimited(env, request, 'hitl:')) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  const sessionId = new URL(request.url).searchParams.get('scan_session_id') || '';
  if (!SESSION_RE.test(sessionId)) return json({ error: 'Invalid scan_session_id' }, 400);
  try {
    const session = await boundSession(sb, sessionId);
    if (!session) return json({ error: 'Session not verified' }, 403);
    const interactions = await sb.select(`mpt_hexagon_interactions?select=hexagon_id,user_action,created_at&scan_session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc`);
    let results = [];
    if (session.web_scan_id) results = (await sb.select(`web_scans?select=results&id=eq.${session.web_scan_id}&limit=1`))?.[0]?.results ?? [];
    return json(computeFinalRiskScore(results, interactions || []));
  } catch (e) {
    console.error('final risk score failed:', e.status || 'error');
    return json({ error: 'Could not calculate the score' }, 500);
  }
}
