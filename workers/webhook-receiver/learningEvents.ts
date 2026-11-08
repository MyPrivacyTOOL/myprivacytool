/**
 * MPC-7915 slice 3 (server): POST /api/learning/event, the one place visitors' answers about a tile are accepted.
 * Design: https://app.notion.com/p/3fe28547eaa781bbb748c984b7601dd3
 *
 * OFF unless the Worker secret/variable LEARNING_EVENTS_ENABLED is exactly "true": otherwise the route answers 404 as if it did not exist.
 * (The site has its own switch, VITE_LEARNING_EVENTS; both must be on before anything is collected.)
 * Browser-origin only (CORS), a tiny body, strict validation. MPC-9892 (Open Tracker design 4.5): NO PERSON KEY. The server increments an
 * anonymous daily counter (public.mpt_learning_count_tile_event -> learning_aggregate_daily) and stores no row: no person key, scan window,
 * finding value, account, phone or email. A person_key sent by an older cached page is ignored, never read or stored. Writing is best effort:
 * the visitor always gets 202 and a storage failure is logged, never shown.
 * Rate limited per client address with the Cloudflare RATE_LIMITER binding (30 a minute; see wrangler.toml). Like the other Workers it fails open
 * if the binding is absent or errors, so tests/local runs work; the wrangler.toml syntax is pinned by workers/ratelimit-config.vitest.mjs.
 * Required before this is switched on in production: the Privacy Policy wording, and the migration
 * supabase/migrations/20261108210000_mpc_9892_learning_aggregate.sql.
 */
import { callMptRpc } from './supabase-client.js';
import { corsFor } from './security.js';
import { isKnownHexagonId } from '../../shared/hexagon-registry/registry.js';

type RateLimiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };
type Env = Record<string, string | undefined> & { RATE_LIMITER?: RateLimiter };

const MAX_BODY_BYTES = 2048;
const ANSWERS = new Set(['yes_me', 'not_me', 'disputed', 'kept']);

/** What is counted: one tile event. Nothing else in the body is read. */
export interface LearningEvent {
  event_type: 'shown' | 'answer';
  hexagon_id: string;
  answer: string | null;
}

/** Returns the event to count, or null for anything that is not exactly the shape we accept. Only these three fields are ever read. */
export function validateLearningEvent(input: unknown): LearningEvent | null {
  if (!input || typeof input !== 'object') return null;
  const b = input as Record<string, unknown>;
  if (b.event_type !== 'shown' && b.event_type !== 'answer') return null;
  if (typeof b.hexagon_id !== 'string' || !isKnownHexagonId(b.hexagon_id)) return null;
  const answer = b.answer ?? null;
  if (b.event_type === 'answer' ? typeof answer !== 'string' || !ANSWERS.has(answer) : answer !== null) return null;
  return { event_type: b.event_type as LearningEvent['event_type'], hexagon_id: b.hexagon_id, answer: answer as string | null };
}

async function limited(env: Env, request: Request): Promise<boolean> {
  if (!env.RATE_LIMITER) return false;
  try { return !(await env.RATE_LIMITER.limit({ key: 'learning:' + (request.headers.get('CF-Connecting-IP') || 'unknown') })).success; } catch { return false; }
}

export async function handleLearningEvent(request: Request, env: Env): Promise<Response> {
  if (env.LEARNING_EVENTS_ENABLED !== 'true') return new Response('Not Found', { status: 404 });
  const cors = corsFor(request);
  const headers = { ...cors.headers, 'Content-Type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
  if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
  // Browser-origin only: a request with no Origin (a script) is refused, unlike the generic gate which lets it through.
  if (!cors.allowed || !request.headers.get('Origin')) return new Response(JSON.stringify({ error: 'Forbidden origin' }), { status: 403, headers });
  if (await limited(env, request)) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { ...headers, 'Retry-After': '60' } });
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return new Response(JSON.stringify({ error: 'too_large' }), { status: 413, headers });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return new Response(JSON.stringify({ error: 'too_large' }), { status: 413, headers });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* falls through to bad_request */ }
  const row = validateLearningEvent(body);
  if (!row) return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  const ok = await callMptRpc(env, 'mpt_learning_count_tile_event', { p_hexagon_id: row.hexagon_id, p_event: row.event_type, p_answer: row.answer });   // best effort: a down database is logged, not shown
  if (!ok) console.warn('learning event not counted');
  return new Response(JSON.stringify({ ok: true }), { status: 202, headers });
}
