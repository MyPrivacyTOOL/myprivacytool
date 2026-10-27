// MPC-7894 gate 4: "STOP" / "delete my data" (exact messages) withdraws consent and deletes what this Worker's scan features stored about the sender.
// Active for every sender the scan/wizard is open to (allow-listed test accounts, or anyone when TELEGRAM_SCAN_SCOPE=all), whatever the feature switches say,
// so a person can always get their data removed even if a feature is later turned off. It uses the database functions that already exist:
//   mpt_erase_chat_sender   consent state (and its routing log rows) -> the next "Y" must be given again; the wizard stops re-checking at once
//   mpt_delete_profile_snapshots  baseline + re-check snapshots (cascades to fix-list progress and dashboard links/sessions)
//   mpt_delete_deep_data    DEEP jobs and results (cascade)
// Not covered here (stated honestly in the reply): the bot-wide probe logs (PROBE_MODE) and anything already sent to Telegram.
import { scanAllowed } from "./baseline-scan";
import type { Logger } from "./logger";
import { call, telegramSender } from "./probe-reader";
import type { Env } from "./shared";

const TIMEOUT_MS = 5000;

/** Exact whole-message commands only; a sentence that merely contains the words does nothing. */
export const isDeleteCommandText = (text: unknown): boolean =>
  typeof text === "string" && /^\/?(stop|delete my data|deletemydata|delete)(@\w+)?$/i.test(text.trim().replace(/\s+/g, " "));

export function isDeleteMyDataRequest(env: Env, update: unknown): boolean {
  const s = telegramSender(update);
  if (!s || !scanAllowed(env, s.id)) return false;
  return isDeleteCommandText((update as { message?: { text?: unknown } } | null)?.message?.text);
}

async function rpc(env: Env, fn: string, args: Record<string, string>): Promise<number | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const n = Number(await res.json().catch(() => 0));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}

const DONE = (n: number) => n > 0
  ? "Done. I deleted your saved scan results, your fix-list progress, any DEEP results and your consent record. I no longer hold them, and I will not re-check your profile. To start again, say \"scan me\" and answer the consent question."
  : "Nothing was stored about you, so there is nothing to delete. I will not re-check your profile.";
const FAILED = "I could not finish deleting everything just now, so please do not assume it is gone. Nothing new will be checked. Send STOP again in a few minutes; if it still fails, contact us at the address on our privacy page.";

/** Never throws; never logs ids, payloads or the token. Consent is erased first so re-checks stop immediately. */
export async function handleDeleteMyData(env: Env, update: unknown, log: Logger): Promise<void> {
  const s = telegramSender(update);
  if (!s || !env.TELEGRAM_BOT_TOKEN) return;
  try {
    const state = await rpc(env, "mpt_erase_chat_sender", { p_channel: "telegram", p_sender_id: s.id });
    const snaps = await rpc(env, "mpt_delete_profile_snapshots", { p_sender_id: s.id });
    const deep = await rpc(env, "mpt_delete_deep_data", { p_sender_id: s.id });
    const failed = state === null || snaps === null || deep === null;
    log.info("delete_my_data", { failed, state: state ?? -1, snapshots: snaps ?? -1, deep: deep ?? -1 });
    const total = (state ?? 0) + (snaps ?? 0) + (deep ?? 0);
    await call(env, "sendMessage", { chat_id: s.chatId, text: failed ? FAILED : DONE(total) });
  } catch (err) {
    log.warn("delete_my_data_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
