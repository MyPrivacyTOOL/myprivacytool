// MPC-9889 (Open Tracker design section 3): the marketing visit log, written for person / unknown visits only. Bots and AI crawlers go to the
// machine mirror (shared/edge-capture/capture.ts recordVisit -> edge_visits), never here.
//
// THIS FILE AND THE PURGE JOB ARE THE ONLY CODE ALLOWED TO TOUCH THE visit_log SCHEMA (scripts/ci/check-visit-log-isolation.mjs, ESLint). It reaches the
// database through two service_role-only RPCs and never names a table. Fields, and only these: ip (shaped by the country policy), referrer (host + path),
// utm_source / utm_medium / utm_campaign / utm_content, country, device class, and the database's own ts. No session, scan, email, hash, user agent, cookie.
//
// Policy: read through public.mpt_visit_log_policy() with a 60 s cache (the longest a flipped row takes to apply here; the database re-applies the policy on
// every write, so a stale cache can only be MORE conservative than the row, never looser). If the policy read fails the mode is "none" (no address), never raw.
// Truncation (IPv4 /24, IPv6 /48) happens HERE, so the full address never reaches Supabase for a truncated or none country.
import { callRecipient, type RecipientContext } from "../shared/recipients/outbound";
import { workerRecipientContext } from "../shared/recipients/worker-ctx";

export type IpMode = "raw" | "truncated" | "none";
export interface CountryRule { ip_mode: IpMode; enabled: boolean }
export type Policy = Map<string, CountryRule>;

export interface VisitLogEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** The 60 s policy cache named in the design (3.3). */
export const POLICY_TTL_MS = 60_000;
/** After a failed policy read, do not hammer the database: keep the fail-closed answer this long. */
const FAILURE_TTL_MS = 5_000;
/** The mode used when the policy cannot be read at all: write the row without an address. */
export const FAIL_CLOSED: CountryRule = { ip_mode: "none", enabled: true };

const VISIT_LOG_SENT = ["ip", "referrer", "utm", "country", "device_profile"] as const;
const IP_MODES: readonly string[] = ["raw", "truncated", "none"];

// ----- IP shaping ---------------------------------------------------------------------------------------------------------------------

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseV4(ip: string): number[] | null {
  const m = V4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Expands an IPv6 literal to eight 16-bit groups, or null if it is not one. Handles :: and a trailing dotted IPv4. */
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (!s.includes(":")) return null;
  const tail = s.lastIndexOf(":");
  const v4 = parseV4(s.slice(tail + 1));
  if (v4) s = `${s.slice(0, tail + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string): number[] | null => {
    if (h === "") return [];
    const gs = h.split(":");
    if (gs.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return gs.map((g) => parseInt(g, 16));
  };
  const head = toGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toGroups(halves[1]);
  if (!rest || head.length + rest.length > 7) return null;
  return [...head, ...Array(8 - head.length - rest.length).fill(0), ...rest];
}

/**
 * The address as it may be stored under a mode. raw: unchanged (normalised); truncated: IPv4 /24 (a.b.c.0), IPv6 /48 (g1:g2:g3::); none: null.
 * An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is treated as the IPv4 address it carries. Anything that is not an address becomes null: it is never
 * stored as text.
 */
export function shapeIp(ip: string | null | undefined, mode: IpMode): string | null {
  if (!ip || mode === "none") return null;
  const raw = ip.trim();
  const v4 = parseV4(raw);
  if (v4) return mode === "raw" ? v4.join(".") : `${v4[0]}.${v4[1]}.${v4[2]}.0`;
  const v6 = parseV6(raw);
  if (!v6) return null;
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    const a = [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255];
    return mode === "raw" ? a.join(".") : `${a[0]}.${a[1]}.${a[2]}.0`;
  }
  if (mode === "raw") return v6.map((g) => g.toString(16)).join(":");
  return `${v6[0].toString(16)}:${v6[1].toString(16)}:${v6[2].toString(16)}::`;
}

// ----- the other fields ---------------------------------------------------------------------------------------------------------------

/** Referrer reduced to host + path. No scheme, query string or fragment. The one-time dashboard link /d/<token> is a credential and is redacted. */
export function referrerHostPath(ref: string | null | undefined): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    if (!u.host) return null;
    return (u.host + u.pathname.replace(/^\/d\/[^/]*/i, "/d/[redacted]")).slice(0, 512);
  } catch {
    return null;
  }
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

/** The four campaign tags from the query string, each capped at 128 characters. Nothing else from the query string is kept. */
export function utmFromUrl(url: URL): Record<(typeof UTM_KEYS)[number], string | null> {
  const out = {} as Record<(typeof UTM_KEYS)[number], string | null>;
  for (const k of UTM_KEYS) {
    const v = url.searchParams.get(k);
    out[k] = v ? v.slice(0, 128) : null;
  }
  return out;
}

export type DeviceClass = "mobile" | "desktop" | "tablet" | "unknown";

/** A device class and nothing finer. The user-agent string itself is read here and discarded. */
export function deviceClass(headers: Headers): DeviceClass {
  const ch = headers.get("sec-ch-ua-mobile");
  const ua = headers.get("user-agent") ?? "";
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (ch === "?1" || /mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile";
  if (ch === "?0" || ua) return "desktop";
  return "unknown";
}

export const arrivalCountry = (request: Request): string => {
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  const c = (request.headers.get("cf-ipcountry") ?? cf?.country ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "XX";
};

// ----- policy ---------------------------------------------------------------------------------------------------------------------------

let cache: { at: number; ttl: number; policy: Policy | null } | null = null;
/** Tests only. */
export const resetPolicyCache = (): void => { cache = null; };

function parsePolicy(body: unknown): Policy | null {
  if (!Array.isArray(body)) return null;
  const policy: Policy = new Map();
  for (const row of body as Array<Record<string, unknown>>) {
    if (typeof row?.country !== "string" || typeof row.ip_mode !== "string" || !IP_MODES.includes(row.ip_mode)) continue;
    policy.set(row.country, { ip_mode: row.ip_mode as IpMode, enabled: row.enabled !== false });
  }
  return policy.has("*") ? policy : null;   // no DEFAULT row = unusable = fail closed
}

export async function loadPolicy(env: VisitLogEnv, rctx: RecipientContext, now: number = Date.now()): Promise<Policy | null> {
  if (cache && now - cache.at < cache.ttl) return cache.policy;
  let policy: Policy | null = null;
  try {
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const res = await callRecipient("visit-log", {
        url: `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/mpt_visit_log_policy`,
        sent: [],
        init: {
          method: "POST",
          headers: { "content-type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
          body: "{}",
          signal: AbortSignal.timeout(2000),
        },
      }, rctx);
      if (res.ok) policy = parsePolicy(await res.json());
    }
  } catch {
    policy = null;
  }
  cache = { at: now, ttl: policy ? POLICY_TTL_MS : FAILURE_TTL_MS, policy };
  return policy;
}

/** The rule for a country: its own row, else the DEFAULT row, else (policy unreadable) fail closed to "none". */
export function ruleFor(policy: Policy | null, country: string): CountryRule {
  if (!policy) return FAIL_CLOSED;
  return policy.get(country) ?? policy.get("*") ?? FAIL_CLOSED;
}

// ----- the write ------------------------------------------------------------------------------------------------------------------------

export interface VisitLogRow {
  p_country: string;
  p_ip: string | null;
  p_referrer: string | null;
  p_utm_source: string | null;
  p_utm_medium: string | null;
  p_utm_campaign: string | null;
  p_utm_content: string | null;
  p_device: DeviceClass;
}

/** Builds the one row. Pure: the policy rule is passed in. */
export function buildVisitLogRow(request: Request, rule: CountryRule, country: string = arrivalCountry(request)): VisitLogRow {
  const url = new URL(request.url);
  const utm = utmFromUrl(url);
  return {
    p_country: country,
    p_ip: shapeIp(request.headers.get("cf-connecting-ip"), rule.ip_mode),
    p_referrer: referrerHostPath(request.headers.get("referer")),
    p_utm_source: utm.utm_source,
    p_utm_medium: utm.utm_medium,
    p_utm_campaign: utm.utm_campaign,
    p_utm_content: utm.utm_content,
    p_device: deviceClass(request.headers),
  };
}

/** Writes one visit-log row for a person / unknown visit. Resolves true if a row was stored, false otherwise (country switched off, store down). Never throws. */
export async function recordPersonVisit(env: VisitLogEnv, request: Request, fetchImpl?: typeof fetch, rctx?: RecipientContext): Promise<boolean> {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
    const country = arrivalCountry(request);
    const ctx = rctx ?? workerRecipientContext(env as Record<string, unknown>, { fetchImpl, country: country === "XX" ? null : country });
    const rule = ruleFor(await loadPolicy(env, ctx), country);
    if (!rule.enabled) return false;
    const res = await callRecipient("visit-log", {
      url: `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/mpt_visit_log_record`,
      sent: [...VISIT_LOG_SENT],
      init: {
        method: "POST",
        headers: { "content-type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify(buildVisitLogRow(request, rule, country)),
        signal: AbortSignal.timeout(3000),
      },
    }, ctx);
    return res.ok;
  } catch {
    return false;
  }
}
