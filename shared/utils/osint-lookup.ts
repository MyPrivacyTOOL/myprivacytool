// MPC-8302 (FLEET-TASK-V4.2): passive OSINT lookup + "Mirror & Risk" summary.
//
// lookupRiskSummary(input_value, input_type, deps) -> RiskSummary
//
// PASSIVE ONLY: the single network call is a read-only GET to the Have I Been Pwned v3 API
// (breachedaccount + pasteaccount). We never log in, scrape, probe the account or contact the subject.
// HIBP can only answer for email addresses (its domain search requires proof of ownership), so phone,
// handle and domain come back as status "not_checked" with confidence "low" and NO score: we do not guess.
//
// PRIVACY: nothing is persisted. The cache holds only the breach/paste lookup result, keyed by a SHA-256 hash of
// type+value (never the raw value), for 24h. Logs carry the first 8 hex chars of that hash, never the value.

import { createLogger, type Logger } from "@mpt/utils";

export type InputType = "email" | "phone" | "handle" | "domain";
export type Confidence = "high" | "medium" | "low";
export type RiskLevel = "low" | "medium" | "high" | "critical" | "unknown";

export interface Breach { name: string; date: string | null; data_classes: string[] }

export interface RiskSummary {
  input_type: InputType;
  input_value: string;            // normalised; reflected back to the user who supplied it
  status: "checked" | "not_checked";
  reason?: string;                // set when not_checked
  breach_count: number | null;    // null = not checked (never 0 for "unknown")
  paste_count: number | null;
  breach_list: Breach[];
  exposure_score: number | null;  // 0..100, null when not checked
  risk_level: RiskLevel;
  next_steps: string[];           // localisation keys, see risk-templates.ts
  confidence: Confidence;
}

/** What we cache: the lookup, never the subject's identifier. */
export interface LookupResult {
  status: "checked" | "not_checked";
  reason?: string;
  breaches: Breach[];
  pastes: number | null;          // null = paste lookup failed
}

export interface LookupCache {
  get(key: string): Promise<LookupResult | null>;
  set(key: string, value: LookupResult, ttlSeconds: number): Promise<void>;
}

export interface OsintDeps {
  hibpApiKey?: string;
  fetchImpl?: typeof fetch;
  cache?: LookupCache;
  logger?: Logger;
  timeoutMs?: number;             // per HIBP request; default 3000 so first-time lookups stay under 5s
  now?: () => number;
}

export const CACHE_TTL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------- exposure score
// exposure_score = min(100, breach_count * 10 + paste_count * 5)      (spec MPC-8302)
// Deterministic, integer, clamped. Only computed when the lookup was actually performed.
export function exposureScore(breachCount: number, pasteCount: number): number {
  return Math.min(100, Math.max(0, Math.round(breachCount * 10 + pasteCount * 5)));
}

// Bands: 0 low (nothing found) | 1-29 medium | 30-59 high | 60+ critical.
export function riskLevel(score: number | null): RiskLevel {
  if (score === null) return "unknown";
  return score === 0 ? "low" : score < 30 ? "medium" : score < 60 ? "high" : "critical";
}

// ---------------------------------------------------------------- input handling
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@.]{2,}$/;
const PHONE_RE = /^\+[1-9][0-9]{6,14}$/;                       // E.164, same as public.leads.phone_number
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HANDLE_RE = /^[a-z0-9._]{1,50}$/;

export class InvalidInputError extends Error {}

export function normalizeInput(value: string, type: InputType): string {
  const v = String(value ?? "").trim();
  switch (type) {
    case "email": if (!EMAIL_RE.test(v)) throw new InvalidInputError("invalid email"); return v.toLowerCase();
    case "phone": { const p = v.replace(/[\s().-]/g, ""); if (!PHONE_RE.test(p)) throw new InvalidInputError("invalid phone (E.164 required)"); return p; }
    case "domain": { const d = v.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (!DOMAIN_RE.test(d)) throw new InvalidInputError("invalid domain"); return d; }
    case "handle": { const h = v.replace(/^@/, "").toLowerCase(); if (!HANDLE_RE.test(h)) throw new InvalidInputError("invalid handle"); return h; }
    default: throw new InvalidInputError("unknown input_type");
  }
}

export async function hashKey(type: InputType, value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${type}:${value}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const hashPrefix = (hash: string) => hash.slice(0, 8);

// ---------------------------------------------------------------- default in-memory cache (per isolate)
export function createMemoryCache(now: () => number = Date.now): LookupCache {
  const store = new Map<string, { v: LookupResult; exp: number }>();
  return {
    async get(k) { const e = store.get(k); if (!e) return null; if (e.exp <= now()) { store.delete(k); return null; } return e.v; },
    async set(k, v, ttl) { store.set(k, { v, exp: now() + ttl * 1000 }); },
  };
}
const defaultCache = createMemoryCache();

// ---------------------------------------------------------------- HIBP (read-only GETs)
type HibpOutcome<T> = { ok: true; data: T } | { ok: false; reason: string };

async function hibpGet<T>(path: string, empty: T, d: Required<Pick<OsintDeps, "fetchImpl" | "timeoutMs">> & { key: string }): Promise<HibpOutcome<T>> {
  const url = `https://haveibeenpwned.com/api/v3/${path}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await d.fetchImpl(url, {
        headers: { "hibp-api-key": d.key, "user-agent": "MyPrivacyTOOL-mirror-risk" },
        signal: AbortSignal.timeout(d.timeoutMs),
      });
    } catch (e) {
      return { ok: false, reason: (e as Error)?.name === "TimeoutError" ? "HIBP timeout" : "HIBP unreachable" };
    }
    if (res.status === 404) return { ok: true, data: empty };           // not found = checked, nothing there
    if (res.status === 200) return { ok: true, data: (await res.json()) as T };
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers?.get?.("retry-after")) || 1, 2);   // short: keeps us inside the 5s budget
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return { ok: false, reason: res.status === 429 ? "HIBP rate limited" : `HIBP HTTP ${res.status}` };
  }
  return { ok: false, reason: "HIBP rate limited" };
}

async function lookupEmail(email: string, deps: OsintDeps): Promise<LookupResult> {
  const key = deps.hibpApiKey;
  if (!key) return { status: "not_checked", reason: "HIBP API key not configured", breaches: [], pastes: null };
  const d = { fetchImpl: deps.fetchImpl ?? fetch, timeoutMs: deps.timeoutMs ?? 3000, key };
  const enc = encodeURIComponent(email);
  const [b, p] = await Promise.all([
    hibpGet<Array<{ Name: string; BreachDate?: string; DataClasses?: string[] }>>(`breachedaccount/${enc}?truncateResponse=false`, [], d),
    hibpGet<unknown[]>(`pasteaccount/${enc}`, [], d),
  ]);
  if (!b.ok) return { status: "not_checked", reason: b.reason, breaches: [], pastes: null };
  return {
    status: "checked",
    breaches: b.data.map((x) => ({ name: x.Name, date: x.BreachDate ?? null, data_classes: x.DataClasses ?? [] })),
    pastes: p.ok ? p.data.length : null,
  };
}

// ---------------------------------------------------------------- next steps (keys from locales/*/main.json, risk.next.*)
export function nextStepsFor(level: RiskLevel, classes: string[]): string[] {
  const has = (re: RegExp) => classes.some((c) => re.test(c.toLowerCase()));
  const steps: string[] = [];
  switch (level) {
    case "critical": steps.push("risk.next.change_passwords", "risk.next.enable_2fa", "risk.next.review_brokers", "risk.next.scan_cta"); break;
    case "high":     steps.push("risk.next.change_passwords", "risk.next.enable_2fa", "risk.next.scan_cta"); break;
    case "medium":   steps.push("risk.next.enable_2fa", "risk.next.scan_cta"); break;
    case "low":      steps.push("risk.next.nothing_urgent", "risk.next.monitor"); break;
    default:         steps.push("risk.next.try_email");
  }
  if (level !== "low" && level !== "unknown" && has(/password/)) steps.push("risk.next.rotate_reused");
  return steps;
}

function notChecked(type: InputType, value: string, reason: string): RiskSummary {
  return {
    input_type: type, input_value: value, status: "not_checked", reason,
    breach_count: null, paste_count: null, breach_list: [], exposure_score: null,
    risk_level: "unknown", next_steps: nextStepsFor("unknown", []), confidence: "low",
  };
}

// ---------------------------------------------------------------- public API
export async function lookupRiskSummary(inputValue: string, inputType: InputType, deps: OsintDeps = {}): Promise<RiskSummary> {
  const log = deps.logger ?? createLogger("osint-lookup");
  const value = normalizeInput(inputValue, inputType);          // throws InvalidInputError; callers map it to a prompt
  const hash = await hashKey(inputType, value);
  const t0 = (deps.now ?? Date.now)();

  if (inputType !== "email") {
    log.info("osint.unsupported_type", { type: inputType, ref: hashPrefix(hash) });
    return notChecked(inputType, value, `No passive public source for ${inputType} lookups yet`);
  }

  const cache = deps.cache ?? defaultCache;
  let result: LookupResult | null = null;
  let cached = false;
  try { result = await cache.get(hash); cached = !!result; } catch (e) { log.warn("osint.cache_read_failed", { ref: hashPrefix(hash) }); }
  if (!result) {
    result = await lookupEmail(value, deps);
    // Only successful lookups are cached: a failure must not pin a user to "unknown" for 24h.
    if (result.status === "checked") { try { await cache.set(hash, result, CACHE_TTL_SECONDS); } catch { log.warn("osint.cache_write_failed", { ref: hashPrefix(hash) }); } }
  }
  log.info("osint.lookup", { type: inputType, ref: hashPrefix(hash), status: result.status, cached, breaches: result.breaches.length, ms: (deps.now ?? Date.now)() - t0 });

  if (result.status !== "checked") return notChecked(inputType, value, result.reason ?? "lookup unavailable");

  const breachCount = result.breaches.length;
  const pasteCount = result.pastes;                              // null if the paste call failed
  const score = exposureScore(breachCount, pasteCount ?? 0);
  const level = riskLevel(score);
  const classes = [...new Set(result.breaches.flatMap((b) => b.data_classes))];
  return {
    input_type: inputType, input_value: value, status: "checked",
    breach_count: breachCount, paste_count: pasteCount,
    breach_list: result.breaches, exposure_score: score, risk_level: level,
    next_steps: nextStepsFor(level, classes),
    confidence: pasteCount === null ? "medium" : "high",         // score may undercount if pastes were unavailable
  };
}
