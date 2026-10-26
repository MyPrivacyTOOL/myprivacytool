// MPC-7490: build one raw visit row from a request and write it to Supabase. Observes only: never blocks, challenges or alters a
// response, and every failure is swallowed. The IP is stored raw here; the database cuts it for person/unknown rows after the
// retention period (public.edge_visit_retention).
import { classify } from "./classify";
import type { RequestFacts } from "./ruleset";

export interface CaptureEnv {
  /** The switch. Anything other than 1/true/on/yes (including unset) means OFF. */
  EDGE_CAPTURE_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface VisitRow {
  host: string | null;
  path: string;
  method: string;
  status: number | null;
  user_agent: string | null;
  ip: string | null;
  country: string | null;
  asn: number | null;
  network: string | null;
  colo: string | null;
  referrer: string | null;
  headers: Record<string, string>;
  /** Decision D-A (capture everything raw): query string with credential-like values redacted. */
  query: string | null;
  /** 4 or 6, from the connecting IP's shape. */
  ip_version: number | null;
  /** Every property Cloudflare attached to the request (city, region, coordinates, timezone, TLS version and cipher, round-trip times...). */
  cf: Record<string, unknown>;
  /** Every request header except those that can carry a credential. */
  all_headers: Record<string, string>;
  class: string;
  rule: string;
  ruleset_version: string;
}

/** Headers worth keeping to explain a classification. Never cookie, authorization or anything that can carry a credential. */
export const SELECTED_HEADERS = [
  "accept", "accept-language", "accept-encoding", "upgrade-insecure-requests", "dnt", "sec-fetch-site", "sec-fetch-mode",
  "sec-fetch-dest", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "via", "x-forwarded-proto",
];

/** Headers never stored: they can carry a login, a session or a secret. Also anything whose name looks like one (see isCredentialHeader). */
export const CREDENTIAL_HEADERS = ["cookie", "authorization", "proxy-authorization", "x-api-key", "x-auth-token", "set-cookie"];
const CREDENTIAL_NAME = /(token|secret|password|passwd|api[-_]?key|session|bearer|credential|^cf-access-)/i;
export const isCredentialHeader = (name: string): boolean => CREDENTIAL_HEADERS.includes(name.toLowerCase()) || CREDENTIAL_NAME.test(name);

const MAX_ALL_HEADERS = 100;
const MAX_CF_BYTES = 8192;
const CREDENTIAL_QUERY_KEY = /(token|key|secret|pass|auth|code|session|sig|jwt|bearer|email|mail)/i;

export const captureEnabled = (env: CaptureEnv | undefined): boolean => /^(1|true|on|yes)$/i.test((env?.EDGE_CAPTURE_ENABLED ?? "").trim());

const cut = (v: string | null | undefined, n: number): string | null => (v == null || v === "" ? null : v.slice(0, n));

/** Referrer reduced to origin + path: query strings and fragments can carry personal data. */
export function cleanReferrer(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return cut(u.origin + u.pathname, 512);
  } catch {
    return null;
  }
}

/** All request headers except credential-bearing ones, values capped. */
export function allHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  h.forEach((value, name) => {
    if (n >= MAX_ALL_HEADERS || isCredentialHeader(name)) return;
    // The referer header keeps the existing rule (origin + path only): its query string can carry search terms or personal data.
    const kept = name.toLowerCase() === "referer" ? cleanReferrer(value) : value.slice(0, 512);
    if (kept == null) return;
    out[name.toLowerCase()] = kept;
    n += 1;
  });
  return out;
}

/** Query string kept in full except values whose key looks like a credential, an email or a code. */
export function cleanQuery(search: string): string | null {
  const raw = search.replace(/^\?/, "");
  if (!raw) return null;
  const parts = raw.split("&").map((kv) => {
    const i = kv.indexOf("=");
    const key = i < 0 ? kv : kv.slice(0, i);
    let decoded = key;
    try { decoded = decodeURIComponent(key); } catch { /* keep raw key */ }
    return i >= 0 && CREDENTIAL_QUERY_KEY.test(decoded) ? `${key}=[redacted]` : kv;
  });
  return cut(parts.join("&"), 1024);
}

/** A JSON-safe copy of everything Cloudflare put on request.cf. If it is too large, only the top-level plain values are kept. */
export function safeCf(cf: unknown): Record<string, unknown> {
  try {
    if (!cf || typeof cf !== "object") return {};
    const full = JSON.parse(JSON.stringify(cf)) as Record<string, unknown>;
    if (JSON.stringify(full).length <= MAX_CF_BYTES) return full;
    const flat: Record<string, unknown> = { _truncated: true };
    for (const [k, v] of Object.entries(full)) if (v === null || typeof v !== "object") flat[k] = v;
    return flat;
  } catch {
    return {};
  }
}

const ipVersion = (ip: string | null): number | null => (!ip ? null : ip.includes(":") ? 6 : /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? 4 : null);

interface CfProps {
  country?: string;
  asn?: number;
  asOrganization?: string;
  colo?: string;
  httpProtocol?: string;
}

export function buildVisit(request: Request, status: number | null): VisitRow {
  const url = new URL(request.url);
  const cf = ((request as unknown as { cf?: CfProps }).cf ?? {}) as CfProps;
  const headers: Record<string, string> = {};
  for (const name of SELECTED_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers[name] = v.slice(0, 256);
  }
  const ua = request.headers.get("user-agent") ?? "";
  const facts: RequestFacts = {
    userAgent: ua,
    asnOrg: cf.asOrganization ?? null,
    headers,
    httpProtocol: cf.httpProtocol ?? null,
  };
  const c = classify(facts);
  const country = (request.headers.get("cf-ipcountry") ?? cf.country ?? "").toUpperCase();
  const ip = cut(request.headers.get("cf-connecting-ip"), 64);
  return {
    host: cut(url.host, 255),
    path: url.pathname.slice(0, 512),
    method: request.method.slice(0, 16),
    status,
    user_agent: cut(ua, 512),
    ip,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    asn: typeof cf.asn === "number" ? cf.asn : null,
    network: cut(cf.asOrganization, 255),
    colo: cut(cf.colo, 8),
    referrer: cleanReferrer(request.headers.get("referer")),
    headers,
    query: cleanQuery(url.search),
    ip_version: ipVersion(ip),
    cf: safeCf((request as unknown as { cf?: unknown }).cf),
    all_headers: allHeaders(request.headers),
    class: c.cls,
    rule: c.rule,
    ruleset_version: c.rulesetVersion,
  };
}

/** Writes one row. Resolves true on success, false on any failure; never throws. */
export async function recordVisit(env: CaptureEnv, row: VisitRow, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/edge_visits`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Build and store the visit for a finished response. Always resolves. */
export async function captureVisit(env: CaptureEnv, request: Request, status: number | null, fetchImpl?: typeof fetch): Promise<boolean> {
  try {
    return await recordVisit(env, buildVisit(request, status), fetchImpl);
  } catch {
    return false;
  }
}
