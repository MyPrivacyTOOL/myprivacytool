// CK-8502 (owner decision D1): records the Telegram hexagon values one private message carries, as one social_events row (platform "telegram"),
// through the same idempotent mpt_social_record the X path uses. OFF unless TELEGRAM_CAPTURE_HEXAGONS="on". Only fields Telegram sent in THIS update:
// no getChat, no photo lookups (those are the baseline scan's separate, consented hexagons). Private chats and non-bot senders only.
// The stored sender key is the HMAC key when TELEGRAM_ID_HMAC_KEY is set (src/sender-key.ts), else the plain id.
// STOP / delete (any private sender, whatever the other switches say) erases the capture and core-brain's conversation row (eraseTelegramCapture).
import { isDeleteCommandText } from "./delete-my-data";
import type { Logger } from "./logger";
import { telegramSender } from "./probe-reader";
import { senderKey } from "./sender-key";
import { rpc } from "./social";
import type { Env } from "./shared";
import { pick } from "./shared";
import { cleanData } from "./x-hexagons";

export const telegramCaptureEnabled = (env: Env): boolean => env.TELEGRAM_CAPTURE_HEXAGONS === "on";

const messageText = (update: unknown): unknown => pick(update, "message", "text");

export const isCaptureDelete = (env: Env, update: unknown): boolean =>
  telegramCaptureEnabled(env) && telegramSender(update) !== null && isDeleteCommandText(messageText(update));

/** The record for one update, or null when it should not be captured. Pure. */
export function telegramRecord(update: unknown): { id: string; handle?: string; key: string; at?: number; data?: Record<string, string | number | boolean> } | null {
  const sender = telegramSender(update);
  const updateId = pick(update, "update_id");
  if (!sender || typeof updateId !== "number") return null;
  const text = messageText(update);
  if (isDeleteCommandText(text)) return null;               // a STOP is never recorded
  const date = Number(pick(update, "message", "date"));
  const at = Number.isFinite(date) && date > 0 ? date * 1000 : undefined;
  const username = pick(update, "message", "from", "username");
  return {
    id: sender.id, handle: typeof username === "string" ? username : undefined, key: `tg:${updateId}`, at,
    data: cleanData({
      "tg.first_name": pick(update, "message", "from", "first_name"), "tg.last_name": pick(update, "message", "from", "last_name"),
      "tg.username": username, "tg.language": pick(update, "message", "from", "language_code"),
      "tg.message_time": at ? new Date(at).toISOString() : undefined, "tg.message_text": text, "tg.update_counter": updateId,
    }),
  };
}

/**
 * Owner rule 2026-10-29 (19 or over only): nothing is recorded until the sender has answered Y to the teaser, which now carries the age line.
 * core-brain stores that as conversation_states.state = "confirmed". Any other state, no row, or a failed lookup means NOT confirmed, so we record nothing
 * (fail closed). The Y message itself is not recorded, because core-brain writes the state after it replies.
 */
export async function consentConfirmed(env: Env, senderId: string): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/conversation_states?channel=eq.telegram&sender_id=eq.${encodeURIComponent(senderId)}&order=updated_at.desc&limit=1&select=state`, {
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}` }, signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const rows = (await res.json().catch(() => [])) as { state?: unknown }[];
    return rows[0]?.state === "confirmed";
  } catch {
    return false;
  }
}

/** Never throws. A failure only means one uncaptured message. */
export async function captureTelegram(env: Env, update: unknown, log: Logger): Promise<void> {
  if (!telegramCaptureEnabled(env)) return;
  const rec = telegramRecord(update);
  if (!rec) return;
  if (!(await consentConfirmed(env, rec.id))) return;
  try {
    const res = await rpc(env, "mpt_social_record", {
      p_platform: "telegram", p_user_id: await senderKey(env, rec.id), p_handle: rec.handle ?? null, p_event: "dm", p_follows_us: null,
      p_event_key: rec.key, p_occurred_at: rec.at ? new Date(rec.at).toISOString() : null, p_source_ref: null, p_data: rec.data ?? null,
    });
    if (res && !res.ok) log.warn("telegram_capture_failed", { status: res.status });
  } catch (err) {
    log.warn("telegram_capture_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Removes everything captured for this sender (under the HMAC key and the plain id) and core-brain's conversation row. True when nothing failed. */
export async function eraseTelegramCapture(env: Env, update: unknown, log: Logger): Promise<boolean> {
  const sender = telegramSender(update);
  if (!sender) return false;
  let ok = true;
  try {
    const keys = new Set([sender.id, await senderKey(env, sender.id)]);
    for (const k of keys) {
      const res = await rpc(env, "mpt_erase_social_contact", { p_platform: "telegram", p_user_id: k });
      if (res && !res.ok) ok = false;
    }
    const state = await rpc(env, "mpt_erase_chat_sender", { p_channel: "telegram", p_sender_id: sender.id });
    if (state && !state.ok) ok = false;
  } catch (err) {
    log.warn("telegram_capture_erase_failed", { error: err instanceof Error ? err.name : "unknown" });
    ok = false;
  }
  return ok;
}

const DONE = "Done. I deleted what I recorded about you from this chat. Send a message any time to start again.";
const FAILED = "I could not finish deleting just now, so please do not assume it is gone. Send STOP again in a few minutes.";

/** Answers a STOP from a sender the scan features are not open to (allowed senders get the fuller reply from handleDeleteMyData). */
export async function replyCaptureErased(env: Env, update: unknown, ok: boolean, log: Logger): Promise<void> {
  const chatId = pick(update, "message", "chat", "id");
  if (!env.TELEGRAM_BOT_TOKEN || (typeof chatId !== "number" && typeof chatId !== "string")) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: ok ? DONE : FAILED }), signal: AbortSignal.timeout(5000),
    });
  } catch { log.warn("telegram_capture_reply_failed"); }
}
