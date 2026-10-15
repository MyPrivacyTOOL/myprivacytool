// Telegram full event log (docs/channel-probe.md, "Full event log"). Runs ONLY when PROBE_MODE=on AND the sender is in PROBE_TELEGRAM_IDS or
// PROBE_LOG_OPTIN_IDS. Mode "all" and "off" never reach it. Rows go to public.telegram_event_log (service_role only):
//   in    the raw update, untrimmed
//   out   every Bot API call made for the logged chat: {method, request, status, response}
//   brain the core-brain answer used to pick the reply
// Every write is fire-and-forget (ctx.waitUntil), has a 5s timeout and swallows errors: logging can never delay or fail the webhook.
import type { Logger } from "./logger";
import { probeIds, probeMode, updateActor } from "./probe-reader";
import type { Env } from "./shared";

const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
const SESSION_GAP_MS = 30 * 60_000;
const DEFAULT_RETENTION_DAYS = 90;

export type Direction = "in" | "out" | "brain";

export interface EventRow {
  direction: Direction;
  kind: string;
  sender_id: string;
  chat_id: string;
  update_id: number | null;
  session_id: string;
  payload: unknown;
  expires_at: string | null;
}

export interface EventLog {
  /** The raw update, untrimmed. */
  in(update: unknown): void;
  /** One Bot API call: request body, HTTP status (0 = no answer) and Telegram's response. */
  out(method: string, request: unknown, result: { status: number; response: unknown }): void;
  /** The core-brain answer (or why there was none). The response is cloned, so the caller can still read it. */
  brain(brain: Response | "rate_limited" | null): void;
  /** Waits for every write. Only needed where there is no ExecutionContext (tests, local runs). */
  drain(): Promise<void>;
}

const idSet = (raw: string | undefined): Set<string> =>
  new Set((raw ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,20}$/.test(s)));

/** PROBE_LOG_OPTIN_IDS: comma-separated numeric Telegram ids of people who opted in to the full log. */
export const optInIds = (env: Env): Set<string> => idSet(env.PROBE_LOG_OPTIN_IDS);

/** Days until a row expires: PROBE_LOG_RETENTION_DAYS, default 90, clamped 1-365; "forever" = null (never expires). */
export function logRetentionDays(env: Env): number | null {
  const raw = (env.PROBE_LOG_RETENTION_DAYS ?? "").trim().toLowerCase();
  if (raw === "forever") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : DEFAULT_RETENTION_DAYS;
}

/** The logged sender of an update, or null when this update must not be logged (mode not "on", bot, unlisted, not opted in). */
export function loggedSender(env: Env, update: unknown): string | null {
  if (probeMode(env) !== "on") return null;
  const actor = updateActor(update);
  if (!actor) return null;
  return probeIds(env).has(actor.id) || optInIds(env).has(actor.id) ? actor.id : null;
}

/** The chat an update belongs to. Updates with no chat (inline queries, ...) use the sender id, which is also their private chat id. */
function chatIdOf(update: unknown, senderId: string): string {
  for (const part of Object.values(update as Record<string, unknown>)) {
    if (!part || typeof part !== "object") continue;
    const p = part as { chat?: { id?: unknown }; message?: { chat?: { id?: unknown } } };
    const id = p.chat?.id ?? p.message?.chat?.id;
    if (typeof id === "number" || (typeof id === "string" && id !== "")) return String(id);
  }
  return senderId;
}

const updateId = (update: unknown): number | null => {
  const id = (update as { update_id?: unknown }).update_id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
};

/** The first top-level key that is not update_id: Telegram's update type (message, callback_query, ...). */
const updateKind = (update: unknown): string => Object.keys(update as object).find((k) => k !== "update_id") ?? "unknown";

const base = (env: Env) => `${(env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/rest/v1/telegram_event_log`;
const headers = (env: Env, extra: Record<string, string> = {}) =>
  ({ apikey: env.SUPABASE_KEY ?? "", authorization: `Bearer ${env.SUPABASE_KEY ?? ""}`, ...extra });

/**
 * `${chat_id}:${sender_id}:${n}`. n continues the sender's latest inbound row, and moves up after 30 minutes of silence for that chat+sender.
 * Fails open: on any error (or a session id we cannot read) it starts a new session numbered by the clock, which is above any counter.
 */
export async function resolveSession(env: Env, chatId: string, senderId: string, now = Date.now()): Promise<string> {
  const prefix = `${chatId}:${senderId}:`;
  const fresh = `${prefix}${Math.floor(now / 1000)}`;
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return fresh;
  try {
    const q = `chat_id=eq.${encodeURIComponent(chatId)}&sender_id=eq.${encodeURIComponent(senderId)}&direction=eq.in&select=session_id,created_at&order=created_at.desc&limit=1`;
    const res = await fetch(`${base(env)}?${q}`, { headers: headers(env), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return fresh;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return fresh;
    if (rows.length === 0) return `${prefix}1`;
    const last = rows[0] as { session_id?: unknown; created_at?: unknown };
    const at = typeof last.created_at === "string" ? Date.parse(last.created_at) : Number.NaN;
    const n = typeof last.session_id === "string" && last.session_id.startsWith(prefix) ? Number(last.session_id.slice(prefix.length)) : Number.NaN;
    if (!Number.isSafeInteger(n) || n < 1 || Number.isNaN(at)) return fresh;
    return `${prefix}${now - at > SESSION_GAP_MS ? n + 1 : n}`;
  } catch {
    return fresh;
  }
}

/** Starts the event log for this update, or returns null when it is out of scope (nothing is logged, nothing is called). */
export function createEventLog(env: Env, update: unknown, log: Logger, ctx?: ExecutionContext): EventLog | null {
  try {
    return build(env, update, log, ctx);
  } catch (err) {
    log.warn("event_log_failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}

function build(env: Env, update: unknown, log: Logger, ctx?: ExecutionContext): EventLog | null {
  const senderId = loggedSender(env, update);
  if (senderId === null) return null;
  const chatId = chatIdOf(update, senderId);
  const uid = updateId(update);
  const days = logRetentionDays(env);
  const expires_at = days === null ? null : new Date(Date.now() + days * DAY_MS).toISOString();
  const session = resolveSession(env, chatId, senderId); // never rejects
  const seen = new Map<string, number>();
  const pending: Promise<void>[] = [];

  const write = async (direction: Direction, kind: string, payload: unknown): Promise<void> => {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return log.warn("event_log_unconfigured");
      // A kind repeated within one update (e.g. two getChat calls) gets a #n suffix so the (direction, update_id, kind) key stays unique.
      const key = `${direction}:${kind}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      const row: EventRow = {
        direction, kind: count > 1 ? `${kind}#${count}` : kind, sender_id: senderId, chat_id: chatId, update_id: uid,
        session_id: await session, payload, expires_at,
      };
      // The bot token is only ever in a request URL, never in a body; scrub it from the serialized row anyway.
      let body = JSON.stringify(row);
      if (env.TELEGRAM_BOT_TOKEN) body = body.split(env.TELEGRAM_BOT_TOKEN).join("[redacted]");
      const res = await fetch(base(env), {
        method: "POST",
        headers: headers(env, { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }), // ON CONFLICT DO NOTHING
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) log.warn("event_log_save_failed", { status: res.status });
    } catch (err) {
      log.warn("event_log_save_failed", { error: err instanceof Error ? err.name : "unknown" });
    }
  };
  const track = (p: Promise<void>): void => {
    if (ctx?.waitUntil) ctx.waitUntil(p);
    else pending.push(p);
  };

  return {
    in: (u) => track(write("in", updateKind(u), u)),
    out: (method, request, result) => track(write("out", method, { method, request, status: result.status, response: result.response })),
    brain: (brain) => {
      // A failure gets its own kind, so a successful retry of the same update_id still logs its decision (and out rows).
      if (brain === null) return track(write("brain", "decision_unavailable", { outcome: "unavailable" }));
      if (brain === "rate_limited") return track(write("brain", "decision_rate_limited", { outcome: "rate_limited" }));
      const copy = brain.clone();
      track((async () => {
        let body: unknown = null;
        try { body = await copy.json(); } catch { /* non-JSON answer: keep null */ }
        await write("brain", "core-brain", { outcome: "ok", status: copy.status, body });
      })());
    },
    drain: async () => { await Promise.all(pending); },
  };
}
