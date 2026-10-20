/**
 * MPC-7915 slice 3 (server): POST /api/learning/event, the one place visitors' answers about a tile are accepted.
 * Design: https://app.notion.com/p/3fe28547eaa781bbb748c984b7601dd3
 *
 * OFF unless the Worker secret/variable LEARNING_EVENTS_ENABLED is exactly "true": otherwise the route answers 404 as if it did not exist.
 * (The site has its own switch, VITE_LEARNING_EVENTS; both must be on before anything is collected.)
 * Browser-origin only (CORS), a tiny body, strict validation, and the row holds NO finding value, account, phone or email:
 * person_key is a random id the browser makes. Writing is best effort: the visitor always gets 202 and a storage failure is logged, never shown.
 * NOT done here, and required before this is switched on in production: a rate limit (nothing in this Worker rate-limits browser routes today),
 * the Privacy Policy wording, and applying the migration (supabase/migrations/20261019180000_hexagon_learning_events.sql).
 */
import { insertMptRow } from './supabase-client.js';
import { corsFor } from './security.js';
import { isKnownHexagonId } from '../../shared/hexagon-registry/registry.js';

type Env = Record<string, string | undefined>;

const MAX_BODY_BYTES = 2048;
const PERSON_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SCAN_WINDOW_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SOURCES = new Set(['web-scan']);
const TILE_KINDS = new Set([
  'clear', 'needs_fixing', 'our_guess', 'seen_low_risk', 'you_told_us', 'you_confirmed', 'device_agrees', 'guess_wrong',
  'not_checked', 'couldnt_check', 'cant_check_here',
]);
const ANSWERS = new Set(['yes_me', 'not_me', 'disputed', 'kept']);

export interface LearningRow {
  event_type: 'shown' | 'answer';
  person_key: string;
  scan_window: string;
  hexagon_id: string;
  source: string;
  tile_kind: string | null;
  confidence_at_display: number | null;
  config_version: number;
  answer: string | null;
}

/** Returns the row to store, or null for anything that is not exactly the shape we accept. Nothing outside these fields is ever kept. */
export function validateLearningEvent(input: unknown): LearningRow | null {
  if (!input || typeof input !== 'object') return null;
  const b = input as Record<string, unknown>;
  if (b.event_type !== 'shown' && b.event_type !== 'answer') return null;
  if (typeof b.person_key !== 'string' || !PERSON_KEY_RE.test(b.person_key)) return null;
  if (typeof b.scan_window !== 'string' || !SCAN_WINDOW_RE.test(b.scan_window)) return null;
  if (typeof b.hexagon_id !== 'string' || !isKnownHexagonId(b.hexagon_id)) return null;
  const source = b.source ?? 'web-scan';
  if (typeof source !== 'string' || !SOURCES.has(source)) return null;
  const tile = b.tile_kind ?? null;
  if (tile !== null && (typeof tile !== 'string' || !TILE_KINDS.has(tile))) return null;
  const conf = b.confidence_at_display ?? null;
  if (conf !== null && (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1)) return null;
  const version = b.config_version ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > 100000) return null;
  const answer = b.answer ?? null;
  if (b.event_type === 'answer' ? typeof answer !== 'string' || !ANSWERS.has(answer) : answer !== null) return null;
  return { event_type: b.event_type as LearningRow['event_type'], person_key: b.person_key, scan_window: b.scan_window, hexagon_id: b.hexagon_id, source, tile_kind: tile, confidence_at_display: conf, config_version: version, answer: answer as string | null };
}

export async function handleLearningEvent(request: Request, env: Env): Promise<Response> {
  if (env.LEARNING_EVENTS_ENABLED !== 'true') return new Response('Not Found', { status: 404 });
  const cors = corsFor(request);
  const headers = { ...cors.headers, 'Content-Type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
  if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
  // Browser-origin only: a request with no Origin (a script) is refused, unlike the generic gate which lets it through.
  if (!cors.allowed || !request.headers.get('Origin')) return new Response(JSON.stringify({ error: 'Forbidden origin' }), { status: 403, headers });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(JSON.stringify({ error: 'too_large' }), { status: 413, headers });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* falls through to bad_request */ }
  const row = validateLearningEvent(body);
  if (!row) return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  const ok = await insertMptRow(env, 'mpt_hexagon_events', row);   // best effort: a duplicate 'shown' or a down database is logged, not shown
  if (!ok) console.warn('learning event not stored');
  return new Response(JSON.stringify({ ok: true }), { status: 202, headers });
}
