import { executeRiskAnalysis } from '../../src/lib/mirrorRiskOrchestrator';
import type { BreachProvider, InputType } from '../../src/lib/osintLookup';
import { OPENAPI } from './openapi';
import { priceMonth } from './pricing';

// MPC-7651: B2B partner API. Routes (all under /v1, JSON, Bearer API key except health and openapi.json):
//   POST /v1/scan   GET /v1/report/:id   POST|GET /v1/monitors   DELETE /v1/monitors/:id   GET /v1/usage
// Keys are stored only as SHA-256 hashes (supabase/migrations/20261013010000_mpc_7651_partner_api.sql). Server-to-server only.

export interface PartnerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  HIBP_API_KEY?: string;
  BREACH_PROVIDER?: string;
  /** Cloudflare ratelimit binding (60/min). Keyed by API key id, and by IP for failed auth. Fails open if absent or erroring. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const DEFAULT_SUPABASE = 'https://xmdmkumwxpgahmlweuug.supabase.co';
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_ACTIVE_MONITORS = 1000;
const TYPES: readonly string[] = ['email', 'phone', 'handle', 'domain'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

class HttpError extends Error {
  status: number;
  code: string;
  headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status; this.code = code; this.headers = headers;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
const fail = (status: number, code: string, message: string, headers?: Record<string, string>) => new HttpError(status, code, message, headers);

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function providerOf(env: PartnerEnv): BreachProvider | undefined {
  return env.BREACH_PROVIDER === 'xposedornot' || env.BREACH_PROVIDER === 'hibp' ? env.BREACH_PROVIDER : undefined;
}

async function limited(env: PartnerEnv, key: string): Promise<boolean> {
  if (!env.RATE_LIMITER) return false;
  try { return !(await env.RATE_LIMITER.limit({ key })).success; } catch { return false; }
}

function sb(env: PartnerEnv) {
  const base = `${env.SUPABASE_URL || DEFAULT_SUPABASE}/rest/v1`;
  const headers = (prefer?: string): Record<string, string> => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  });
  async function call(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
    const res = await fetch(`${base}/${path}`, { method, headers: headers(prefer), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      console.error(`partner-api supabase ${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`);
      throw fail(500, 'internal_error', 'Request failed');
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    select: (path: string) => call('GET', path),
    insert: (table: string, row: unknown) => call('POST', table, row, 'return=representation').then((r) => (Array.isArray(r) ? r[0] : r)),
    patch: (path: string, row: unknown) => call('PATCH', path, row, 'return=representation'),
  };
}

interface Caller { keyId: string; partnerId: string; cap: number | null; lastUsed: string | null }

async function authenticate(request: Request, env: PartnerEnv, db: ReturnType<typeof sb>): Promise<Caller> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await limited(env, `ip:${ip}`)) throw fail(429, 'rate_limited', 'Too many requests', { 'Retry-After': '60' });
  const auth = request.headers.get('Authorization') || '';
  const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] || request.headers.get('X-API-Key') || '';
  if (!/^mpt_(live|test)_[A-Za-z0-9_-]{32,64}$/.test(key)) throw fail(401, 'invalid_api_key', 'Missing or invalid API key');
  const hash = await sha256Hex(key);
  const rows = await db.select(`partner_api_keys?key_hash=eq.${hash}&revoked_at=is.null&select=id,partner_id,last_used_at,partners(status,monthly_scan_cap)`);
  const row = rows?.[0];
  if (!row) throw fail(401, 'invalid_api_key', 'Missing or invalid API key');
  if (row.partners?.status !== 'active') throw fail(403, 'partner_suspended', 'This partner account is suspended');
  return { keyId: row.id, partnerId: row.partner_id, cap: row.partners.monthly_scan_cap ?? null, lastUsed: row.last_used_at };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw fail(413, 'payload_too_large', 'Body too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw fail(413, 'payload_too_large', 'Body too large');
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw fail(400, 'invalid_json', 'Body must be valid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'invalid_request', 'Body must be a JSON object');
  return body as Record<string, unknown>;
}

function parseSubject(body: Record<string, unknown>): { value: string; type: InputType; reference: string | null } {
  const { value, type, reference } = body;
  if (typeof type !== 'string' || !TYPES.includes(type)) throw fail(400, 'invalid_type', 'type must be one of email, phone, handle, domain');
  if (typeof value !== 'string' || !value.trim() || value.length > 320) throw fail(400, 'invalid_value', 'value must be a non-empty string of at most 320 characters');
  if (reference !== undefined && (typeof reference !== 'string' || reference.length > 128)) throw fail(400, 'invalid_reference', 'reference must be a string of at most 128 characters');
  return { value: value.trim(), type: type as InputType, reference: (reference as string | undefined) ?? null };
}

function monthBounds(month: string): { from: string; to: string } {
  const [, y, m] = MONTH_RE.exec(month)!;
  const next = Number(m) === 12 ? `${Number(y) + 1}-01` : `${y}-${String(Number(m) + 1).padStart(2, '0')}`;
  return { from: `${y}-${m}-01T00:00:00Z`, to: `${next}-01T00:00:00Z` };
}

async function billableCount(db: ReturnType<typeof sb>, partnerId: string, month: string): Promise<number> {
  const { from, to } = monthBounds(month);
  const rows = await db.select(`partner_scans?partner_id=eq.${partnerId}&billable=eq.true&created_at=gte.${from}&created_at=lt.${to}&select=id&limit=1000000`);
  return rows.length;
}

const scanView = (r: any) => ({ scan_id: r.id, created_at: r.created_at, type: r.input_type, reference: r.reference ?? null, status: r.status, billable: r.billable, result: r.result });

async function postScan(request: Request, env: PartnerEnv, db: ReturnType<typeof sb>, who: Caller): Promise<Response> {
  const subject = parseSubject(await readJson(request));
  const month = new Date().toISOString().slice(0, 7);
  if (who.cap !== null && (await billableCount(db, who.partnerId, month)) >= who.cap) {
    throw fail(429, 'monthly_cap_reached', 'Monthly scan cap reached; contact us to raise it');
  }
  const out = await executeRiskAnalysis({ value: subject.value, type: subject.type, apiKey: env.HIBP_API_KEY, provider: providerOf(env) });
  if (!out.success || !out.data) {
    // Validation errors carry a caller-safe message (see the orchestrator); anything else is generic. Nothing is stored or billed.
    const known = out.error?.code === 'INVALID_INPUT' || out.error?.code?.startsWith('INVALID');
    throw fail(known ? 400 : 502, known ? 'invalid_value' : 'scan_failed', known ? out.error!.message : 'Scan failed');
  }
  const row = await db.insert('partner_scans', {
    partner_id: who.partnerId,
    input_type: subject.type,
    value_sha256: await sha256Hex(`${subject.type}:${subject.value.toLowerCase()}`),
    reference: subject.reference,
    status: out.data.status,
    // Only a real check is billed: "not_checked" carries no score, so the partner gets nothing to pay for.
    billable: out.data.status === 'checked',
    result: out.data,
  });
  return json(scanView(row));
}

async function getReport(id: string, db: ReturnType<typeof sb>, who: Caller): Promise<Response> {
  if (!UUID_RE.test(id)) throw fail(404, 'not_found', 'Report not found');
  const row = (await db.select(`partner_scans?id=eq.${id}&partner_id=eq.${who.partnerId}&select=id,created_at,input_type,reference,status,billable,result,result_cleared_at`))?.[0];
  if (!row) throw fail(404, 'not_found', 'Report not found');
  if (row.result === null) throw fail(410, 'result_expired', 'Results are kept for 30 days and this one has been cleared');
  return json(scanView(row));
}

function parseWebhook(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 512) throw fail(400, 'invalid_webhook_url', 'webhook_url must be an https URL');
  let u: URL;
  try { u = new URL(raw); } catch { throw fail(400, 'invalid_webhook_url', 'webhook_url must be an https URL'); }
  const host = u.hostname.toLowerCase();
  const ipLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
  if (u.protocol !== 'https:' || u.username || u.password || ipLiteral || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw fail(400, 'invalid_webhook_url', 'webhook_url must be a public https URL with a hostname');
  }
  return u.toString();
}

const monitorView = (r: any) => ({ monitor_id: r.id, created_at: r.created_at, type: r.input_type, reference: r.reference ?? null, webhook_url: r.webhook_url, last_checked_at: r.last_checked_at ?? null });

async function postMonitor(request: Request, db: ReturnType<typeof sb>, who: Caller): Promise<Response> {
  const body = await readJson(request);
  const subject = parseSubject(body);
  if (body.subject_consent !== true) throw fail(400, 'consent_required', 'subject_consent must be true: the person must have agreed to be monitored');
  const webhook = parseWebhook(body.webhook_url);
  const active = await db.select(`partner_monitors?partner_id=eq.${who.partnerId}&deleted_at=is.null&select=id&limit=${MAX_ACTIVE_MONITORS}`);
  if (active.length >= MAX_ACTIVE_MONITORS) throw fail(429, 'monitor_limit', `At most ${MAX_ACTIVE_MONITORS} active monitors`);
  const row = await db.insert('partner_monitors', {
    partner_id: who.partnerId, input_type: subject.type, value: subject.value, reference: subject.reference, webhook_url: webhook, subject_consent: true,
  });
  return json(monitorView(row), 201);
}

async function listMonitors(db: ReturnType<typeof sb>, who: Caller): Promise<Response> {
  const rows = await db.select(`partner_monitors?partner_id=eq.${who.partnerId}&deleted_at=is.null&select=id,created_at,input_type,reference,webhook_url,last_checked_at&order=created_at.desc&limit=${MAX_ACTIVE_MONITORS}`);
  return json({ monitors: rows.map(monitorView) });
}

async function deleteMonitor(id: string, db: ReturnType<typeof sb>, who: Caller): Promise<Response> {
  if (!UUID_RE.test(id)) throw fail(404, 'not_found', 'Monitor not found');
  // The identifier is overwritten, not just flagged: a deleted monitor must not keep the person's email or phone.
  const rows = await db.patch(`partner_monitors?id=eq.${id}&partner_id=eq.${who.partnerId}&deleted_at=is.null`, { deleted_at: new Date().toISOString(), value: '' });
  if (!rows?.length) throw fail(404, 'not_found', 'Monitor not found');
  return json(null, 204);
}

async function getUsage(url: URL, db: ReturnType<typeof sb>, who: Caller): Promise<Response> {
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  if (!MONTH_RE.test(month)) throw fail(400, 'invalid_month', 'month must look like 2026-10');
  const billable = await billableCount(db, who.partnerId, month);
  const { amount_usd, bands } = priceMonth(billable);
  return json({ month, billable_scans: billable, amount_usd, currency: 'USD', bands, monthly_scan_cap: who.cap });
}

export async function handlePartnerRequest(request: Request, env: PartnerEnv = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    // Keys are secrets: a browser request (Origin header) means a key is shipped to a page. Refuse before any lookup.
    if (request.headers.get('Origin')) throw fail(403, 'browser_not_allowed', 'This API is server-to-server only; never call it from a browser');

    if (request.method === 'GET' && path === '/v1/health') return json({ ok: true, service: 'mpt-partner-api', api_version: '1.0.0' });
    if (request.method === 'GET' && path === '/v1/openapi.json') return json(OPENAPI);
    if (!path.startsWith('/v1/')) throw fail(404, 'not_found', 'Not found');

    const db = sb(env);
    const who = await authenticate(request, env, db);
    if (await limited(env, `key:${who.keyId}`)) throw fail(429, 'rate_limited', 'Too many requests', { 'Retry-After': '60' });
    // Best-effort, at most hourly: last_used_at helps support spot dead keys without a write on every call.
    if (!who.lastUsed || Date.now() - Date.parse(who.lastUsed) > 3_600_000) {
      db.patch(`partner_api_keys?id=eq.${who.keyId}`, { last_used_at: new Date().toISOString() }).catch(() => {});
    }

    const seg = path.split('/'); // ['', 'v1', resource, id?]
    const resource = seg[2];
    const id = seg[3];
    if (seg.length > 4) throw fail(404, 'not_found', 'Not found');

    if (resource === 'scan' && !id) { if (request.method === 'POST') return await postScan(request, env, db, who); throw methodNotAllowed('POST'); }
    if (resource === 'report' && id) { if (request.method === 'GET') return await getReport(id, db, who); throw methodNotAllowed('GET'); }
    if (resource === 'monitors' && !id) {
      if (request.method === 'POST') return await postMonitor(request, db, who);
      if (request.method === 'GET') return await listMonitors(db, who);
      throw methodNotAllowed('GET, POST');
    }
    if (resource === 'monitors' && id) { if (request.method === 'DELETE') return await deleteMonitor(id, db, who); throw methodNotAllowed('DELETE'); }
    if (resource === 'usage' && !id) { if (request.method === 'GET') return await getUsage(url, db, who); throw methodNotAllowed('GET'); }
    throw fail(404, 'not_found', 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status, e.headers);
    console.error('partner-api unhandled', e instanceof Error ? e.message : 'unknown');
    return json({ error: { code: 'internal_error', message: 'Request failed' } }, 500);
  }
}

function methodNotAllowed(allow: string) { return fail(405, 'method_not_allowed', `Use ${allow}`, { Allow: allow }); }
