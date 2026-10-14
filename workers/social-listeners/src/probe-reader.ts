// Channel probe "reader" (test-only). When PROBE_MODE=on and the sender is one of our own allow-listed test accounts, saves the raw
// Telegram update exactly as delivered, then runs the public lookups we expect OSINT to use (getChat, getUserProfilePhotos) on the sender
// and saves their raw results too. Rows go to public.channel_probe_captures (7 day expiry, service_role only).
// Real users are never captured: any sender not on PROBE_TELEGRAM_IDS takes the normal path untouched. PROBE_MODE defaults to off.
import type { Logger } from "./logger";
import type { Env } from "./shared";

const TELEGRAM_API = "https://api.telegram.org";
const TIMEOUT_MS = 5000;

export const probeOn = (env: Env): boolean => env.PROBE_MODE === "on";

/** PROBE_TELEGRAM_IDS: comma-separated numeric Telegram user ids of our own test accounts. */
export function probeIds(env: Env): Set<string> {
  return new Set((env.PROBE_TELEGRAM_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,20}$/.test(s)));
}

interface Sender { id: string; chatId: number | string }

/** The sender of a private-message update, or null for anything else (edits, channel posts, groups, bots). */
export function telegramSender(update: unknown): Sender | null {
  const m = (update as { message?: { from?: { id?: unknown; is_bot?: unknown }; chat?: { id?: unknown; type?: unknown } } } | null)?.message;
  const id = m?.from?.id;
  const chatId = m?.chat?.id;
  if (m?.from?.is_bot === true || m?.chat?.type !== "private") return null;
  if (typeof id !== "number" || (typeof chatId !== "number" && typeof chatId !== "string")) return null;
  return { id: String(id), chatId };
}

export function isProbeSender(env: Env, update: unknown): boolean {
  const s = telegramSender(update);
  return probeOn(env) && s !== null && probeIds(env).has(s.id);
}

/** "/probeid" (optionally "/probeid@BotName"): the sender asks for their own numeric id so it can be added to the allow-list. */
export function isProbeIdRequest(update: unknown): boolean {
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/probeid(@\w+)?$/i.test(text.trim());
}

interface Row { platform: string; sender_id: string; kind: string; payload: unknown }

async function save(env: Env, rows: Row[], log: Logger): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return log.warn("probe_storage_unconfigured");
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/channel_probe_captures`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) log.warn("probe_save_failed", { status: res.status });
  } catch (err) {
    log.warn("probe_save_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** One Bot API call. Returns what Telegram answered (including errors) so refusals are recorded as evidence. Never throws, never logs the URL. */
async function telegram(env: Env, method: string, body: Record<string, unknown>): Promise<{ status: number; response: unknown }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let response: unknown = null;
    try { response = await res.json(); } catch { /* non-JSON answer: keep null */ }
    return { status: res.status, response };
  } catch (err) {
    return { status: 0, response: { error: err instanceof Error ? err.name : "unknown" } };
  }
}

/** Saves the raw update, then the raw result of each public lookup on the sender. Never throws. */
export async function runTelegramProbe(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const sender = telegramSender(update);
    if (!sender) return;
    const rows: Row[] = [{ platform: "telegram", sender_id: sender.id, kind: "message", payload: update }];
    if (env.TELEGRAM_BOT_TOKEN) {
      const chat = await telegram(env, "getChat", { chat_id: sender.id });
      rows.push({ platform: "telegram", sender_id: sender.id, kind: "lookup:getChat", payload: chat });
      const photos = await telegram(env, "getUserProfilePhotos", { user_id: Number(sender.id), limit: 5 });
      rows.push({ platform: "telegram", sender_id: sender.id, kind: "lookup:getUserProfilePhotos", payload: photos });
      // A profile can show a personal channel: look it up too, since its public posts are part of what OSINT could see.
      const personalId = (chat.response as { result?: { personal_chat?: { id?: unknown } } } | null)?.result?.personal_chat?.id;
      if (typeof personalId === "number") {
        const personal = await telegram(env, "getChat", { chat_id: personalId });
        rows.push({ platform: "telegram", sender_id: sender.id, kind: "lookup:getChat(personal_chat)", payload: personal });
      }
    } else {
      log.warn("probe_bot_token_unset");
    }
    await save(env, rows, log);
    log.info("probe_captured", { rows: rows.length });
  } catch (err) {
    log.warn("probe_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Answers "/probeid" with the sender's own numeric id (nothing else). Never throws. */
export async function replyProbeId(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const sender = telegramSender(update);
    if (!sender || !env.TELEGRAM_BOT_TOKEN) return;
    await telegram(env, "sendMessage", { chat_id: sender.chatId, text: `Your Telegram id is ${sender.id}` });
  } catch (err) {
    log.warn("probe_reply_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
