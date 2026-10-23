// mpt-cairn-blackboard (MPC-8413, spec MPC-8401): API bridge that lets Cairn write its blackboard (sessions, facts, intents)
// into Supabase without knowing Supabase internals. One endpoint: POST /api/cairn/blackboard/commit, bearer-token protected.
// Writes go through PostgREST with the service key (tables are service_role only). No secret, seed email or fact value is ever logged.
// Sensitive fact types (default: phone) are hashed with HMAC-SHA256 + a server-side pepper before they reach the database.
export const BRIDGE_VERSION = '1.0.0';

const SESSION_ID_RE = /^mpt-cairn-[0-9]{10,}$/;
const FACT_ID_RE = /^cairn-fact-[A-Za-z0-9_-]{3,64}$/;
const INTENT_ID_RE = /^cairn-intent-[A-Za-z0-9_-]{3,64}$/;
const FACT_TYPES = ['email', 'username', 'domain', 'phone', 'url', 'breach_record', 'public_record', 'social_profile'];
const HASH_ALGORITHMS = ['bcrypt', 'sha256', 'sha512', 'hmac-sha256'];
const SESSION_STATUSES = ['active', 'paused', 'completed', 'failed'];
const CLASSIFICATIONS = ['sensitive', 'public', 'internal'];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 262144;
const MAX_BATCH = 25;
const WRITES_PER_MINUTE = 30; // per session, facts + intents together (MPC-8413 acceptance criteria)
const MAX_INTENTS_PER_SESSION = 50; // Cairn strategy page: rate-limit the intent queue to 50 intents per scan
const MAX_METADATA_CHARS = 8000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const fail = (status, error, error_detail, extra = {}, headers = {}) => json({ success: false, error, error_detail, ...extra }, status, headers);

const configured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.CAIRN_BRIDGE_TOKEN && env.CAIRN_HASH_PEPPER);

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Constant-time token check: compares fixed-length digests so neither length nor content leaks through timing.
async function tokenOk(header, expected) {
  if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = await sha256(header.slice(7));
  const b = await sha256(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacHex(pepper, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// PostgREST call. Secret keys go in the apikey header only (not Authorization: Bearer). Errors carry the status code only, never the body.
async function sb(env, path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} failed: HTTP ${res.status}`);
  return res;
}

async function countRows(env, table, filter) {
  const res = await sb(env, `${table}?select=id&${filter}`, { method: 'HEAD', prefer: 'count=exact' });
  const total = (res.headers.get('content-range') || '').split('/')[1];
  const n = Number(total);
  if (!Number.isInteger(n)) throw new Error(`supabase count ${table} failed: no content-range`);
  return n;
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const int = (v, min, max, dflt) => (Number.isInteger(v) && v >= min && v <= max ? v : dflt);
const isoOrNull = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const smallJson = (v) => JSON.stringify(v).length <= MAX_METADATA_CHARS;
const stringList = (v) => (Array.isArray(v) && v.length <= 100 && v.every((x) => typeof x === 'string' && x.length <= 253) ? v : null);

const hashTypes = (env) => new Set(String(env.HASH_FACT_TYPES ?? 'phone').split(',').map((s) => s.trim()).filter(Boolean));

// Returns { row } or { reason }. A sensitive type is hashed here, so the raw value never reaches the database.
async function buildFact(f, sessionDbId, env) {
  const o = plainObject(f);
  if (!o) return { reason: 'not an object' };
  if (typeof o.fact_id !== 'string' || !FACT_ID_RE.test(o.fact_id)) return { reason: 'fact_id must look like cairn-fact-<3-64 letters, digits, - or _>' };
  const description = str(o.description, 2000);
  if (!description) return { reason: 'description is required' };
  if (!FACT_TYPES.includes(o.fact_type)) return { reason: `fact_type must be one of ${FACT_TYPES.join(', ')}` };
  const confidence = o.confidence_score === undefined ? 0.5 : o.confidence_score;
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return { reason: 'confidence_score must be a number from 0 to 1' };
  const classification = o.data_classification === undefined ? 'sensitive' : o.data_classification;
  if (!CLASSIFICATIONS.includes(classification)) return { reason: `data_classification must be one of ${CLASSIFICATIONS.join(', ')}` };
  const metaIn = o.extracted_metadata === undefined || o.extracted_metadata === null ? {} : plainObject(o.extracted_metadata);
  if (!metaIn || !smallJson(metaIn)) return { reason: 'extracted_metadata must be an object under 8000 characters' };
  const chain = o.discovery_chain === undefined ? [] : stringList(o.discovery_chain);
  if (!chain) return { reason: 'discovery_chain must be a list of strings' };

  let value = o.fact_value === undefined || o.fact_value === null ? null : String(o.fact_value).slice(0, 500);
  let isHashed = false;
  let algorithm = null;
  let desc = description;
  const meta = { ...metaIn };

  if (o.is_hashed === true) {
    // The caller already hashed it: accept only a named, known algorithm. We store what we are given and never try to reverse it.
    if (!HASH_ALGORITHMS.includes(o.hash_algorithm)) return { reason: `hash_algorithm must be one of ${HASH_ALGORITHMS.join(', ')} when is_hashed is true` };
    isHashed = true;
    algorithm = o.hash_algorithm;
  } else if (hashTypes(env).has(o.fact_type) && value !== null) {
    const raw = value;
    value = `hmac-sha256:${await hmacHex(env.CAIRN_HASH_PEPPER, `${o.fact_type}:${raw.toLowerCase()}`)}`;
    isHashed = true;
    algorithm = 'hmac-sha256';
    for (const k of [o.fact_type, `${o.fact_type}_number`, 'value', 'raw']) delete meta[k];
    desc = desc.split(raw).join('[hashed]');
  }

  return {
    row: {
      fact_id: o.fact_id,
      session_id: sessionDbId,
      description: desc,
      fact_type: o.fact_type,
      fact_value: value,
      confidence_score: confidence,
      source_name: str(o.source_name, 200),
      source_url: str(o.source_url, 2000),
      extracted_metadata: meta,
      discovered_from_intent_id: str(o.discovered_from_intent_id, 100),
      discovery_chain: chain,
      is_hashed: isHashed,
      hash_algorithm: algorithm,
      data_classification: classification,
    },
  };
}

function buildIntent(i, sessionDbId) {
  const o = plainObject(i);
  if (!o) return { reason: 'not an object' };
  if (typeof o.intent_id !== 'string' || !INTENT_ID_RE.test(o.intent_id)) return { reason: 'intent_id must look like cairn-intent-<3-64 letters, digits, - or _>' };
  const description = str(o.description, 2000);
  if (!description) return { reason: 'description is required' };
  const from = o.from_fact_ids === undefined ? [] : stringList(o.from_fact_ids);
  if (!from) return { reason: 'from_fact_ids must be a list of strings' };
  return {
    row: {
      intent_id: o.intent_id,
      session_id: sessionDbId,
      description,
      intent_type: str(o.intent_type, 40),
      from_fact_ids: from,
      target_fact_id: str(o.target_fact_id, 100),
      creator: str(o.creator, 100),
      timeout_seconds: int(o.timeout_seconds, 1, 600, 60),
      human_hint: str(o.human_hint, 1000),
    },
  };
}

async function startSession(env, sessionId, p) {
  const email = str(p.seed_email, 320);
  if (!email || !EMAIL_RE.test(email)) return fail(400, 'invalid_seed_email', 'payload.seed_email must be an email address');
  if (p.user_id !== undefined && p.user_id !== null && !(typeof p.user_id === 'string' && UUID_RE.test(p.user_id))) return fail(400, 'invalid_user_id', 'payload.user_id must be a UUID (public.users.id) or omitted');
  const allowed = p.allowed_domains === undefined ? [] : stringList(p.allowed_domains);
  const excluded = p.excluded_domains === undefined ? [] : stringList(p.excluded_domains);
  if (!allowed || !excluded) return fail(400, 'invalid_domains', 'allowed_domains and excluded_domains must be lists of strings');
  const row = {
    session_id: sessionId,
    user_id: p.user_id ?? null,
    seed_email: email,
    seed_username: str(p.seed_username, 200),
    investigation_goal: str(p.investigation_goal, 1000),
    allowed_domains: allowed,
    excluded_domains: excluded,
    max_depth: int(p.max_depth, 1, 10, 3),
    max_facts: int(p.max_facts, 1, 100, 100),
    timeout_seconds: int(p.timeout_seconds, 10, 900, 300),
    started_at: new Date().toISOString(),
    cairn_project_id: str(p.cairn_project_id, 200),
  };
  const res = await sb(env, 'cairn_sessions?on_conflict=session_id&select=session_id', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=representation' });
  const created = (await res.json()).length === 1;
  return json({ success: true, session_id: sessionId, created, timestamp: new Date().toISOString() });
}

async function loadSession(env, sessionId) {
  const res = await sb(env, `cairn_sessions?select=id,status,max_facts&session_id=eq.${encodeURIComponent(sessionId)}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

// Counts rows written for this session in the last minute (facts + intents) so the limit is shared by every Worker isolate.
async function recentWrites(env, dbId) {
  const since = encodeURIComponent(new Date(Date.now() - 60000).toISOString());
  const [f, i] = await Promise.all([
    countRows(env, 'cairn_facts', `session_id=eq.${dbId}&created_at=gte.${since}`),
    countRows(env, 'cairn_intents', `session_id=eq.${dbId}&created_at=gte.${since}`),
  ]);
  return f + i;
}

const rateLimited = () => fail(429, 'rate_limited', `limit is ${WRITES_PER_MINUTE} writes per minute per session`, {}, { 'retry-after': '30' });

async function writeFacts(env, sessionId, session, p) {
  const list = Array.isArray(p.facts) ? p.facts : null;
  if (!list || !list.length) return fail(400, 'invalid_payload', 'payload.facts must be a non-empty list');
  if (list.length > MAX_BATCH) return fail(400, 'batch_too_large', `at most ${MAX_BATCH} facts per request`);
  const rows = [];
  const failed = [];
  for (const f of list) {
    const built = await buildFact(f, session.id, env);
    if (built.row) rows.push(built.row); else failed.push({ fact_id: typeof f?.fact_id === 'string' ? f.fact_id : null, reason: built.reason });
  }
  if (failed.length) return fail(400, 'invalid_fact', `${failed.length} fact(s) failed validation; nothing was written`, { failed_facts: failed });
  if ((await recentWrites(env, session.id)) + rows.length > WRITES_PER_MINUTE) return rateLimited();
  const existing = await countRows(env, 'cairn_facts', `session_id=eq.${session.id}`);
  if (existing + rows.length > session.max_facts) return fail(422, 'max_facts_exceeded', `session allows ${session.max_facts} facts; it already has ${existing}`);
  // ignore-duplicates makes a caller retry of the same batch safe.
  const res = await sb(env, 'cairn_facts?on_conflict=fact_id&select=fact_id', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
  const written = await res.json();
  const total = await countRows(env, 'cairn_facts', `session_id=eq.${session.id}`);
  await sb(env, `cairn_sessions?id=eq.${session.id}`, { method: 'PATCH', body: { facts_discovered: total }, prefer: 'return=minimal' });
  return json({ success: true, facts_written: written.length, fact_ids: written.map((r) => r.fact_id), session_facts_count: total, timestamp: new Date().toISOString() });
}

async function writeIntents(env, sessionId, session, p) {
  const list = Array.isArray(p.intents) ? p.intents : null;
  if (!list || !list.length) return fail(400, 'invalid_payload', 'payload.intents must be a non-empty list');
  if (list.length > MAX_BATCH) return fail(400, 'batch_too_large', `at most ${MAX_BATCH} intents per request`);
  const rows = [];
  const failed = [];
  for (const i of list) {
    const built = buildIntent(i, session.id);
    if (built.row) rows.push(built.row); else failed.push({ intent_id: typeof i?.intent_id === 'string' ? i.intent_id : null, reason: built.reason });
  }
  if (failed.length) return fail(400, 'invalid_intent', `${failed.length} intent(s) failed validation; nothing was written`, { failed_intents: failed });
  if ((await recentWrites(env, session.id)) + rows.length > WRITES_PER_MINUTE) return rateLimited();
  const existing = await countRows(env, 'cairn_intents', `session_id=eq.${session.id}`);
  if (existing + rows.length > MAX_INTENTS_PER_SESSION) return fail(422, 'max_intents_exceeded', `a session allows ${MAX_INTENTS_PER_SESSION} intents; it already has ${existing}`);
  const res = await sb(env, 'cairn_intents?on_conflict=intent_id&select=intent_id', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
  const written = await res.json();
  const total = await countRows(env, 'cairn_intents', `session_id=eq.${session.id}`);
  await sb(env, `cairn_sessions?id=eq.${session.id}`, { method: 'PATCH', body: { intents_generated: total }, prefer: 'return=minimal' });
  return json({ success: true, intents_written: written.length, intent_ids: written.map((r) => r.intent_id), session_intents_count: total, timestamp: new Date().toISOString() });
}

async function updateSessionState(env, sessionId, session, p) {
  const patch = {};
  if (p.status !== undefined) {
    if (!SESSION_STATUSES.includes(p.status)) return fail(400, 'invalid_status', `status must be one of ${SESSION_STATUSES.join(', ')}`);
    patch.status = p.status;
  }
  if (p.status_reason !== undefined) patch.status_reason = str(p.status_reason, 500);
  for (const k of ['facts_discovered', 'intents_generated', 'intents_completed']) {
    if (p[k] === undefined) continue;
    if (!Number.isInteger(p[k]) || p[k] < 0 || p[k] > 100000) return fail(400, 'invalid_counter', `${k} must be an integer from 0 to 100000`);
    patch[k] = p[k];
  }
  if (p.concluded_at !== undefined) {
    const t = isoOrNull(p.concluded_at);
    if (!t) return fail(400, 'invalid_concluded_at', 'concluded_at must be an ISO-8601 timestamp');
    patch.concluded_at = t;
  } else if (p.status === 'completed' || p.status === 'failed') patch.concluded_at = new Date().toISOString();
  if (p.metadata !== undefined) {
    const m = plainObject(p.metadata);
    if (!m || !smallJson(m)) return fail(400, 'invalid_metadata', 'metadata must be an object under 8000 characters');
    patch.metadata = m;
  }
  if (!Object.keys(patch).length) return fail(400, 'invalid_payload', 'nothing to update');
  await sb(env, `cairn_sessions?id=eq.${session.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  return json({ success: true, session_id: sessionId, status: patch.status ?? session.status, timestamp: new Date().toISOString() });
}

export async function commit(request, env) {
  if (!configured(env)) return fail(500, 'not_configured', 'bridge secrets are not set');
  if (!(await tokenOk(request.headers.get('authorization'), env.CAIRN_BRIDGE_TOKEN))) return fail(401, 'unauthorized', 'missing or wrong bearer token');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large', `body is limited to ${MAX_BODY_BYTES} bytes`);
  let body;
  try { body = JSON.parse(text); } catch { return fail(400, 'invalid_json', 'body is not valid JSON'); }
  const b = plainObject(body);
  if (!b) return fail(400, 'invalid_json', 'body must be a JSON object');
  if (typeof b.session_id !== 'string' || !SESSION_ID_RE.test(b.session_id)) return fail(400, 'invalid_session_id', 'session_id must look like mpt-cairn-<10 or more digits>');
  const p = plainObject(b.payload);
  if (!p) return fail(400, 'invalid_payload', 'payload must be an object');
  const actions = { start_session: null, write_facts: writeFacts, write_intents: writeIntents, update_session_state: updateSessionState };
  if (!(b.action in actions)) return fail(400, 'invalid_action', `action must be one of ${Object.keys(actions).join(', ')}`);
  try {
    if (b.action === 'start_session') return await startSession(env, b.session_id, p);
    const session = await loadSession(env, b.session_id);
    if (!session) return fail(404, 'session_not_found', 'start the session first with action start_session');
    if (b.action !== 'update_session_state' && session.status !== 'active') return fail(409, 'session_not_active', `session is ${session.status}`);
    return await actions[b.action](env, b.session_id, session, p);
  } catch (e) {
    // Status code only: the Supabase response body can echo row values.
    console.error(JSON.stringify({ worker: 'mpt-cairn-blackboard', action: b.action, session_id: b.session_id, error: String(e?.message ?? e).slice(0, 200) }));
    return fail(502, 'database_error', 'the database call failed; the request is safe to retry');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, worker: 'mpt-cairn-blackboard', version: BRIDGE_VERSION, configured: configured(env) });
    if (url.pathname === '/api/cairn/blackboard/commit') {
      if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'use POST', {}, { allow: 'POST' });
      return commit(request, env);
    }
    return fail(404, 'not_found', 'unknown path');
  },
};
