import type { Logger } from "./logger";

export interface Env {
  X_CONSUMER_SECRET?: string;
  /** CK-8502 owner decision D1: "on" stores the hexagon values an X event carries (profile fields, post/DM text) with the event. Default off. Needs legal sign-off and the wording change first. */
  X_CAPTURE_HEXAGONS?: string;
  /** CK-8502 owner decision D1: "on" stores the Telegram hexagon values an update carries (name, @username, language, time, message text) for private non-bot senders. Default off. Same preconditions as X_CAPTURE_HEXAGONS. */
  TELEGRAM_CAPTURE_HEXAGONS?: string;
  /** MPC-7628 Mirror bot: app bearer token (public profile lookup) and user-context token with dm.write (DM replies). */
  X_BEARER_TOKEN?: string;
  X_USER_ACCESS_TOKEN?: string;
  /** Token refresh (MPC-7628): OAuth 2.0 Client ID/Secret of the X app, and the first refresh token (bootstrap only; the rotating pair then lives in Supabase). */
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REFRESH_TOKEN?: string;
  /** OAuth 1.0a keys (API key, account access token + secret): sign the clip upload, which the OAuth 2.0 token cannot do. */
  /** HubSpot private-app token limited to contacts (read/write) and contact properties (read/write): the X activity sync. */
  HUBSPOT_SOCIAL_TOKEN?: string;
  X_CONSUMER_KEY?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
  /** Override for the clip attached to Mirror/welcome DMs (default: https://myprivacytool.io/media/alice-curtain.mp4); "off" sends text only. */
  MEDIA_VIDEO_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  /** Workers Rate Limiting bindings for the Mirror bot (MPC-7628). Missing = no limit (fails open). */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  RATE_LIMITER_GLOBAL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** LinkedIn app Client Secret (MPC-7640): signs webhook challenges and deliveries. Unset = LinkedIn webhook fails closed. */
  LINKEDIN_CLIENT_SECRET?: string;
  /** MPC-8689 pilot Discord interactions endpoint: "on" answers /webhook/discord; anything else (default) is off. Needs DISCORD_PUBLIC_KEY (hex, from the Developer Portal). */
  DISCORD_SCAN?: string;
  DISCORD_PUBLIC_KEY?: string;
  /** Comma-separated Discord user ids allowed to use it (our own test accounts); empty = nobody gets a result (the endpoint still answers Discord's PING). */
  DISCORD_PROBE_IDS?: string;
  /** Optional bot token: lets the check read the public profile banner and colour (GET /users/{id}). Unset = that one hexagon says not checked. */
  DISCORD_BOT_TOKEN?: string;
  /** MPC-8689 pilot extras, each default off ("on" enables), allow-listed test accounts only (empty list = nobody). */
  SMS_EXTRAS?: string; SMS_PROBE_NUMBERS?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_WEBHOOK_URL?: string;
  VIBER_EXTRAS?: string; VIBER_PROBE_IDS?: string; VIBER_AUTH_TOKEN?: string;
  LINE_EXTRAS?: string; LINE_PROBE_IDS?: string; LINE_CHANNEL_SECRET?: string; LINE_CHANNEL_ACCESS_TOKEN?: string;
  GITHUB_EXTRAS?: string; GITHUB_WEBHOOK_SECRET?: string; GITHUB_PROBE_LOGINS?: string;
  YOUTUBE_EXTRAS?: string; YOUTUBE_EXTRAS_SECRET?: string; YOUTUBE_API_KEY?: string; YOUTUBE_PROBE_CHANNEL_IDS?: string;
  KAKAO_EXTRAS?: string; KAKAO_SKILL_SECRET?: string; KAKAO_PROBE_IDS?: string;
  WECHAT_EXTRAS?: string; WECHAT_TOKEN?: string; WECHAT_PROBE_OPENIDS?: string;
  ZALO_EXTRAS?: string; ZALO_WEBHOOK_SECRET?: string; ZALO_PROBE_IDS?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Bot API token used to send replies (MPC-7251). Without it messages are still ingested, just not answered. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Channel probe reader: "on" = allow-listed test accounts only, "all" = every non-bot sender; anything else (default) is off. See docs/channel-probe.md. */
  PROBE_MODE?: string;
  /** Comma-separated numeric Telegram ids of our own test accounts; only these are ever captured by the probe reader. */
  PROBE_TELEGRAM_IDS?: string;
  /** Mode "all": skip the public lookups for a sender looked up within this many hours (default 24). */
  PROBE_LOOKUP_HOURS?: string;
  /** Mode "all": days until a row's expires_at (default 90, clamped 1-365). */
  PROBE_RETENTION_DAYS?: string;
  /** Full event log (mode "on" only): comma-separated numeric Telegram ids of people who opted in, logged in addition to PROBE_TELEGRAM_IDS. */
  PROBE_LOG_OPTIN_IDS?: string;
  /** Full event log: days until a row expires (default 90, clamped 1-365), or "forever" for no expiry. */
  PROBE_LOG_RETENTION_DAYS?: string;
  /** MPC-7891 Telegram baseline scan: "on" runs it for senders in PROBE_TELEGRAM_IDS after the consent Y; anything else (default) is off. */
  TELEGRAM_BASELINE_SCAN?: string;
  /** Days until a profile_snapshots row expires (default 90, clamped 1-365). */
  PROFILE_SNAPSHOT_RETENTION_DAYS?: string;
  /** MPC-7894 gate 3: secret (32+ characters). When set, scan tables store an HMAC of the Telegram id instead of the id. Unset = plain ids (test accounts). See src/sender-key.ts. */
  TELEGRAM_ID_HMAC_KEY?: string;
  /** MPC-7894 staged release: "all" opens the baseline scan and /fix wizard to every private non-bot sender (real-user data); default/unset = PROBE_TELEGRAM_IDS only. */
  TELEGRAM_SCAN_SCOPE?: string;
  /** MPC-7894 Telegram fix wizard: "on" enables /fix and its buttons for senders in PROBE_TELEGRAM_IDS; anything else (default) is off. */
  TELEGRAM_FIX_WIZARD?: string;
  /** MPC-7893 one-time dashboard link: "on" lets senders in PROBE_TELEGRAM_IDS ask for it with "dashboard"; anything else (default) is off. */
  TELEGRAM_DASHBOARD_LINKS?: string;
  /** MPC-8689 one-time footprint handoff link: "on" lets senders in PROBE_TELEGRAM_IDS ask for it with "footprint"; anything else (default) is off. */
  TELEGRAM_FOOTPRINT_LINKS?: string;
  /** Base URL of the dashboard site (https only). Default https://www.myprivacytool.io. */
  DASHBOARD_BASE_URL?: string;
  /** MPC-7892 Telegram DEEP username check: "on" enables it for senders in PROBE_TELEGRAM_IDS; anything else (default) is off. */
  TELEGRAM_DEEP_SCAN?: string;
  /** Days until deep_jobs rows expire (default 90, clamped 1-365). */
  DEEP_RETENTION_DAYS?: string;
  /** Max DEEP jobs per sender per 24h (default 3, clamped 1-20). */
  DEEP_JOBS_PER_DAY?: string;
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

export const hex = (u8: Uint8Array) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

export const base64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));

/** Reads the raw body (needed for signatures) with a hard size cap. Returns null if too large. */
export async function readRawBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return enc.encode(text).length > MAX_BODY_BYTES ? null : text;
}

export interface ForwardEnvelope {
  source: "x" | "telegram" | "linkedin";
  receivedAt: string;
  /** Verified, parsed platform payload, passed through untouched. This Worker never inspects content. */
  payload: unknown;
}

/**
 * Forwards to core-brain via service binding, else HTTP. Returns the response when core-brain accepted it, null when it
 * could not be reached or refused it, and RATE_LIMITED when core-brain throttled the sender (429). A throttled event must
 * be acknowledged and dropped, not retried: platforms resend on a non-2xx, which would only feed the limiter (MPC-7257).
 */
export const RATE_LIMITED = Symbol("core-brain-rate-limited");

export async function callCoreBrain(env: Env, envelope: ForwardEnvelope, log: Logger): Promise<Response | typeof RATE_LIMITED | null> {
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
    return null;
  }
  try {
    const res = await target.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(envelope) }));
    if (res.status === 429) {
      log.warn("core_brain_rate_limited", { source: envelope.source });
      return RATE_LIMITED;
    }
    if (!res.ok) log.error("core_brain_rejected", { source: envelope.source, status: res.status });
    return res.ok ? res : null;
  } catch (err) {
    log.error("core_brain_unreachable", { source: envelope.source, error: err instanceof Error ? err.message : "unknown" });
    return null;
  }
}

/** Same as callCoreBrain for callers that only need to know whether the event is done: accepted, or throttled and dropped. */
export async function forwardToCoreBrain(env: Env, envelope: ForwardEnvelope, log: Logger): Promise<boolean> {
  return (await callCoreBrain(env, envelope, log)) !== null; // RATE_LIMITED counts as done: acknowledge, do not retry
}

/** Parses JSON (already signature-verified). Null on malformed input. */
/** Reads a nested key path from untyped JSON; undefined at the first non-object step (what `a?.b?.c` gave on a parsed payload). */
export function pick(value: unknown, ...path: string[]): unknown {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function parseJson(raw: string): unknown | null {
  try { return JSON.parse(raw); } catch { return null; }
}
