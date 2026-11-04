// MPC-8689: the two event-driven Telegram extra hexagons, "Edits" (tg.edits) and "Blocked or unblocked us" (tg.blocked_bot).
// They arrive as their own updates (edited_message, my_chat_member), not with the consent message, so the baseline scan reports them as "not checked".
// Active only when TELEGRAM_BASELINE_SCAN=on AND the sender is on the PROBE_TELEGRAM_IDS allow-list (never TELEGRAM_SCAN_SCOPE=all: no real-user release yet).
// What it does, and only this:
//   1. stores a FLAG in public.telegram_event_flags: that it happened, when, how many times. Never the message text, the edit or any other field.
//   2. answers once in chat (at most one reply per sender per 10 minutes) saying what that event sent to the bot.
// A "blocked" event cannot be answered (we are blocked), so it is stored and the person is told only when they unblock. Nothing is logged from the payload.
// Outside every score and count. Delete-my-data (STOP) removes the flags (mpt_delete_event_flags).
import { baselineScanEnabled } from "./baseline-scan";
import type { Logger } from "./logger";
import { call, probeIds } from "./probe-reader";
import { senderKey } from "./sender-key";
import type { Env } from "./shared";

const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
const REPLY_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_RETENTION_DAYS = 90;

export type EventFlag = "tg.edits" | "tg.blocked_bot";
export interface EventExtra { flag: EventFlag; state: "edited" | "blocked" | "unblocked"; senderId: string; chatId: number | string; at: number | null }

/** Pure. A private-chat edit by a person, or a private-chat block/unblock of the bot; anything else (groups, channels, bots, other updates) is null. */
export function observeEventExtra(update: unknown): EventExtra | null {
  const u = (update ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const edited = u.edited_message;
  if (edited && typeof edited === "object") {
    const id = edited.from?.id, chatId = edited.chat?.id;
    if (edited.from?.is_bot === true || edited.chat?.type !== "private" || typeof id !== "number" || typeof chatId !== "number" || typeof edited.edit_date !== "number") return null;
    return { flag: "tg.edits", state: "edited", senderId: String(id), chatId, at: edited.edit_date };
  }
  const m = u.my_chat_member;
  if (m && typeof m === "object") {
    const id = m.from?.id, chatId = m.chat?.id, status = m.new_chat_member?.status;
    if (m.from?.is_bot === true || m.chat?.type !== "private" || typeof id !== "number" || typeof chatId !== "number") return null;
    if (status !== "kicked" && status !== "member") return null;
    return { flag: "tg.blocked_bot", state: status === "kicked" ? "blocked" : "unblocked", senderId: String(id), chatId, at: typeof m.date === "number" ? m.date : null };
  }
  return null;
}

/** True only when the switch is on and the sender is on the allow-list. */
export const eventExtrasActive = (env: Env, e: EventExtra): boolean => baselineScanEnabled(env) && probeIds(env).has(e.senderId);

const lastReply = new Map<string, number>(); // best effort per isolate; the flag itself is always stored
const cooledDown = (key: string, now: number): boolean => {
  const prev = lastReply.get(key);
  if (prev !== undefined && now - prev < REPLY_COOLDOWN_MS) return false;
  lastReply.set(key, now);
  if (lastReply.size > 500) for (const [k, t] of lastReply) if (now - t >= REPLY_COOLDOWN_MS) lastReply.delete(k);
  return true;
};

function retentionDays(env: Env): number {
  const n = Number.parseInt(env.PROFILE_SNAPSHOT_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : DEFAULT_RETENTION_DAYS;
}

async function storeFlag(env: Env, e: EventExtra, log: Logger): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) { log.warn("event_flag_storage_unconfigured"); return false; }
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/mpt_record_event_flag`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_sender_id: await senderKey(env, e.senderId), p_flag: e.flag, p_state: e.state, p_expires_at: new Date(Date.now() + retentionDays(env) * DAY_MS).toISOString() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) log.warn("event_flag_save_failed", { status: res.status });
    return res.ok;
  } catch (err) {
    log.warn("event_flag_save_failed", { error: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}

const when = (at: number | null): string => (at ? ` at ${new Date(at * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC` : "");
export function eventReply(e: EventExtra, stored: boolean): string | null {
  const kept = stored
    ? "MPC kept only that it happened (a flag with the time), not what you wrote. Say STOP to delete it."
    : "I could not save a flag just now, so nothing was kept.";
  if (e.state === "edited") return `Extra check (not part of your number): Edits. You edited a message${when(e.at)}. When a message is edited, Telegram sends the bot the new version and the edit time, so an edit is not private from the bot. ${kept}`;
  if (e.state === "unblocked") return `Extra check (not part of your number): Blocked or unblocked us. You unblocked this bot${when(e.at)}. Telegram tells a bot when it is blocked or unblocked, but only then, and nothing else comes with it. ${kept}`;
  return null; // blocked: we cannot message the person
}

/** Never throws; never logs ids, payloads or the token. */
export async function handleEventExtra(env: Env, update: unknown, log: Logger): Promise<void> {
  const e = observeEventExtra(update);
  if (!e || !eventExtrasActive(env, e)) return;
  try {
    const stored = await storeFlag(env, e, log);
    const text = eventReply(e, stored);
    if (text && env.TELEGRAM_BOT_TOKEN && cooledDown(`${e.flag}:${e.senderId}`, Date.now())) await call(env, "sendMessage", { chat_id: e.chatId, text });
    log.info("event_extra_done", { flag: e.flag, state: e.state, stored });
  } catch (err) {
    log.warn("event_extra_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
