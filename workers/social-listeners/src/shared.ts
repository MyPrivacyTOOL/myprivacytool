import type { Logger } from "./logger";

export interface Env {
  X_CONSUMER_SECRET?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Preferred: service binding to the core-brain Worker (MPC-8601). */
  CORE_BRAIN?: { fetch(request: Request): Promise<Response> };
  /** Fallback: plain HTTP to core-brain when no service binding is configured. */
  CORE_BRAIN_URL?: string;
  CORE_BRAIN_TOKEN?: string;
}

export const MAX_BODY_BYTES = 1_000_000;
const enc = new TextEncoder();

export function timingSafeEqual(a: string | null, b: string | null): boolean {
  const x = enc.encode(a ?? ""), y = enc.encode(b ?? "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export const base64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));

/** Reads the raw body (needed for signatures) with a hard size cap. Returns null if too large. */
export async function readRawBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return enc.encode(text).length > MAX_BODY_BYTES ? null : text;
}

export interface ForwardEnvelope {
  source: "x" | "telegram";
  receivedAt: string;
  /** Verified, parsed platform payload, passed through untouched. This Worker never inspects content. */
  payload: unknown;
}

/** Forwards to core-brain via service binding, else HTTP. Returns true when core-brain accepted it. */
export async function forwardToCoreBrain(env: Env, envelope: ForwardEnvelope, log: Logger): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // MPC-8601: core-brain is also reachable on its public workers.dev address, so it authenticates every caller,
  // service binding included. CORE_BRAIN_TOKEN must equal core-brain's WEBHOOK_SECRET.
  if (env.CORE_BRAIN_TOKEN) headers.Authorization = `Bearer ${env.CORE_BRAIN_TOKEN}`;
  let target: { fetch(r: Request): Promise<Response> };
  let url: string;
  if (env.CORE_BRAIN) {
    target = env.CORE_BRAIN;
    url = "https://core-brain/ingest/social";
  } else if (env.CORE_BRAIN_URL) {
    target = { fetch: (r) => fetch(r) };
    url = new URL("/ingest/social", env.CORE_BRAIN_URL).toString();
  } else {
    log.error("core_brain_unconfigured", { source: envelope.source });
    return false;
  }
  try {
    const res = await target.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(envelope) }));
    if (!res.ok) log.error("core_brain_rejected", { source: envelope.source, status: res.status });
    return res.ok;
  } catch (err) {
    log.error("core_brain_unreachable", { source: envelope.source, error: err instanceof Error ? err.message : "unknown" });
    return false;
  }
}

/** Parses JSON (already signature-verified). Null on malformed input. */
export function parseJson(raw: string): unknown | null {
  try { return JSON.parse(raw); } catch { return null; }
}
