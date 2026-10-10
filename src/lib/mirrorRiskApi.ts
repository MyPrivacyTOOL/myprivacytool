/**
 * Mirror & Risk HTTP API — MPC-7252
 *
 * Fetch-API handler (Request -> Response) so it runs in a Cloudflare Worker, Node 18+ or a test without a framework:
 *   POST /api/v1/scan        { value, type }
 *   POST /api/v1/scan/batch  { values: [{ value, type }, ...] }   (max MAX_BATCH)
 *   GET  /api/v1/health
 *
 * The HIBP key comes from `env.HIBP_API_KEY` (Worker secret). Without it every lookup is "not_checked", never "safe".
 * Per-IP rate limiting is the host's job (Cloudflare ratelimit binding), as in workers/scan-report.
 */

import { executeBatchRiskAnalysis, executeRiskAnalysis, healthCheck } from './mirrorRiskOrchestrator';
import type { BreachProvider, InputType } from './osintLookup';

export interface MirrorRiskEnv {
  /** Paid HIBP key (Worker secret). Parked until revenue; optional. */
  HIBP_API_KEY?: string;
  /** 'xposedornot' (free, no key) or 'hibp'. Unset + no key => every email lookup is not_checked. */
  BREACH_PROVIDER?: string;
  /** Optional per-IP limiter (Cloudflare ratelimit binding). Fails open if absent or erroring. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export const ALLOWED_ORIGINS = ['https://myprivacytool.io', 'https://www.myprivacytool.io'];
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_BATCH = 10;
function providerOf(env: MirrorRiskEnv): BreachProvider | undefined {
  return env.BREACH_PROVIDER === 'xposedornot' || env.BREACH_PROVIDER === 'hibp' ? env.BREACH_PROVIDER : undefined;
}

const TYPES: readonly string[] = ['email', 'phone', 'handle', 'domain'];

function respond(body: unknown, status: number, origin: string): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  });
}

function parseItem(raw: unknown): { value: string; type: InputType } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { value, type } = raw as Record<string, unknown>;
  if (typeof value !== 'string' || value.length > 320 || typeof type !== 'string' || !TYPES.includes(type)) return null;
  return { value: value.trim(), type: type as InputType };
}

export async function handleRiskRequest(request: Request, env: MirrorRiskEnv = {}): Promise<Response> {
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return respond(null, 204, origin);
  // Browser callers must come from our own origins. No Origin header = server-side caller.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return respond({ error: 'Forbidden origin' }, 403, origin);

  if (request.method === 'GET' && url.pathname === '/api/v1/health') {
    return respond(await healthCheck(env.HIBP_API_KEY, providerOf(env)), 200, origin);
  }

  const isScan = url.pathname === '/api/v1/scan';
  const isBatch = url.pathname === '/api/v1/scan/batch';
  if (request.method !== 'POST' || (!isScan && !isBatch)) return respond({ error: 'Not found' }, 404, origin);

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return respond({ error: 'Payload too large' }, 413, origin);
  }
  if (env.RATE_LIMITER) {
    try {
      const key = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!(await env.RATE_LIMITER.limit({ key })).success) return respond({ error: 'Too many requests' }, 429, origin);
    } catch {
      // fail open
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'Invalid request' }, 400, origin);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ error: 'Invalid request' }, 400, origin);

  if (isScan) {
    const item = parseItem(body);
    if (!item) return respond({ error: 'value and type (email|phone|handle|domain) required' }, 400, origin);
    const result = await executeRiskAnalysis({ ...item, apiKey: env.HIBP_API_KEY, provider: providerOf(env) });
    return respond(result, result.success ? 200 : 400, origin);
  }

  const raw = (body as { values?: unknown }).values;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH) {
    return respond({ error: `values must be an array of 1-${MAX_BATCH} items` }, 400, origin);
  }
  const items = raw.map(parseItem);
  if (items.some((i) => i === null)) return respond({ error: 'Every item needs value and type' }, 400, origin);
  const result = await executeBatchRiskAnalysis({
    values: (items as { value: string; type: InputType }[]).map((i) => ({ ...i, apiKey: env.HIBP_API_KEY, provider: providerOf(env) })),
    parallel: true,
  });
  return respond(result, 200, origin);
}
