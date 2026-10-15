// Channel probe "reader". PROBE_MODE=on (test-only): for senders on the PROBE_TELEGRAM_IDS allow-list (our own test accounts), saves the raw
// Telegram update exactly as delivered, then the public lookups we expect OSINT to use (getChat, getUserProfilePhotos) and their raw results.
// PROBE_MODE=all (decision D-A, "capture everywhere"): every non-bot sender, from any update type, with a wider set of public lookups.
// Rows go to public.channel_probe_captures (service_role only; 7 day expiry in "on", PROBE_RETENTION_DAYS in "all").
// PROBE_MODE defaults to off; any other value counts as off.
import type { EventLog } from "./event-log";
import type { Logger } from "./logger";
import type { Env } from "./shared";

const TELEGRAM_API = "https://api.telegram.org";
const TIMEOUT_MS = 5000;

export type ProbeMode = "off" | "on" | "all";

export const probeMode = (env: Env): ProbeMode => (env.PROBE_MODE === "on" || env.PROBE_MODE === "all" ? env.PROBE_MODE : "off");

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_LOOKUP_HOURS = 24;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_FILE_LOOKUPS = 5;

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

/** A user (never a bot) found on an update, plus the group chat id when the update carries one. */
interface Chat { id?: number | string; type?: string }
interface Actor { id: string; groupChatId?: number | string }

// Update types and the field that holds the acting user.
const ACTOR_FIELDS: [updateType: string, userField: string][] = [
  ["message", "from"], ["edited_message", "from"], ["callback_query", "from"], ["inline_query", "from"],
  ["chosen_inline_result", "from"], ["my_chat_member", "from"], ["chat_member", "from"], ["chat_join_request", "from"],
  ["business_message", "from"], ["edited_business_message", "from"], ["message_reaction", "user"],
  ["shipping_query", "from"], ["pre_checkout_query", "from"], ["poll_answer", "user"],
];

/** The sending user of any supported update type, or null for bots and anything without a numeric user id. */
export function updateActor(update: unknown): Actor | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, unknown>;
  for (const [type, field] of ACTOR_FIELDS) {
    const part = u[type] as { chat?: Chat; message?: { chat?: Chat } } & Record<string, unknown> | null | undefined;
    if (!part || typeof part !== "object") continue;
    const user = part[field] as { id?: unknown; is_bot?: unknown } | null | undefined;
    if (!user || typeof user !== "object" || user.is_bot === true || typeof user.id !== "number" || !Number.isFinite(user.id)) continue;
    const chat = part.chat ?? part.message?.chat; // callback_query carries its chat on the original message
    const grouped = (chat?.type === "group" || chat?.type === "supergroup") && (typeof chat.id === "number" || typeof chat.id === "string");
    return grouped && chat ? { id: String(user.id), groupChatId: chat.id } : { id: String(user.id) };
  }
  return null;
}

export function isProbeSender(env: Env, update: unknown): boolean {
  const mode = probeMode(env);
  if (mode === "all") return updateActor(update) !== null;
  const s = telegramSender(update);
  return mode === "on" && s !== null && probeIds(env).has(s.id);
}

/** "/probeid" (optionally "/probeid@BotName"): the sender asks for their own numeric id so it can be added to the allow-list. */
export function isProbeIdRequest(update: unknown): boolean {
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/probeid(@\w+)?$/i.test(text.trim());
}

interface Row { platform: string; sender_id: string; kind: string; payload: unknown; expires_at?: string }

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
async function telegram(env: Env, method: string, body: Record<string, unknown>, events?: EventLog | null): Promise<{ status: number; response: unknown }> {
  const result = await call(env, method, body);
  events?.out(method, body, result); // full event log (mode "on", logged senders only); never passed in mode "all"
  return result;
}

async function call(env: Env, method: string, body: Record<string, unknown>): Promise<{ status: number; response: unknown }> {
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

/** Retention for mode "all" rows: PROBE_RETENTION_DAYS, default 90, clamped to 1-365. */
export function retentionDays(env: Env): number {
  const n = Number.parseInt(env.PROBE_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : DEFAULT_RETENTION_DAYS;
}

/** Lookup throttle window for mode "all": PROBE_LOOKUP_HOURS, default 24 (a non-positive or non-numeric value falls back to the default). */
export function lookupHours(env: Env): number {
  const n = Number(env.PROBE_LOOKUP_HOURS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKUP_HOURS;
}

/** True when this sender already has a lookup:getChat row inside the throttle window. Fails open (false) on any error. */
async function recentlyLooked(env: Env, senderId: string): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return false;
  try {
    const since = new Date(Date.now() - lookupHours(env) * HOUR_MS).toISOString();
    const q = `platform=eq.telegram&sender_id=eq.${encodeURIComponent(senderId)}&kind=eq.${encodeURIComponent("lookup:getChat")}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`;
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/channel_probe_captures?${q}`, {
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const found = await res.json();
    return Array.isArray(found) && found.length > 0;
  } catch {
    return false;
  }
}

/** file_ids of the largest size of each profile photo, first MAX_FILE_LOOKUPS photos. */
function largestPhotoFileIds(photos: { response: unknown }): string[] {
  const sets = (photos.response as { result?: { photos?: unknown } } | null)?.result?.photos;
  if (!Array.isArray(sets)) return [];
  const ids: string[] = [];
  for (const sizes of sets.slice(0, MAX_FILE_LOOKUPS)) {
    if (!Array.isArray(sizes) || sizes.length === 0) continue;
    type Size = { file_id?: unknown; width?: unknown; height?: unknown; file_size?: unknown };
    const area = (p: Size) => (Number(p?.width) || 0) * (Number(p?.height) || 0) || Number(p?.file_size) || 0;
    const best = (sizes as Size[]).reduce((a, b) => (area(b) >= area(a) ? b : a));
    if (typeof best?.file_id === "string") ids.push(best.file_id);
  }
  return ids;
}

/** Mode "all": raw update plus the wider set of public lookups, in parallel. */
async function captureAll(env: Env, update: unknown, log: Logger): Promise<void> {
  const actor = updateActor(update);
  if (!actor) return;
  const expires_at = new Date(Date.now() + retentionDays(env) * DAY_MS).toISOString();
  const row = (kind: string, payload: unknown): Row => ({ platform: "telegram", sender_id: actor.id, kind, payload, expires_at });
  const rows: Row[] = [row("update", update)];
  if (!env.TELEGRAM_BOT_TOKEN) {
    log.warn("probe_bot_token_unset");
  } else if (await recentlyLooked(env, actor.id)) {
    log.info("probe_lookups_throttled");
  } else {
    const userId = Number(actor.id);
    const [chat, photos, audios, personalMessages, member] = await Promise.all([
      telegram(env, "getChat", { chat_id: actor.id }),
      telegram(env, "getUserProfilePhotos", { user_id: userId, limit: 100 }),
      telegram(env, "getUserProfileAudios", { user_id: userId }),
      telegram(env, "getUserPersonalChatMessages", { user_id: userId, limit: 20 }),
      actor.groupChatId === undefined ? Promise.resolve(null) : telegram(env, "getChatMember", { chat_id: actor.groupChatId, user_id: userId }),
    ]);
    rows.push(row("lookup:getChat", chat), row("lookup:getUserProfilePhotos", photos), row("lookup:getUserProfileAudios", audios),
      row("lookup:getUserPersonalChatMessages", personalMessages));
    if (member) rows.push(row("lookup:getChatMember", member));
    // Follow-ups: the personal channel (public posts) and file_path metadata for the largest profile photos. Bytes are never fetched or stored.
    const personalId = (chat.response as { result?: { personal_chat?: { id?: unknown } } } | null)?.result?.personal_chat?.id;
    const followUps: Promise<Row>[] = [];
    if (typeof personalId === "number") followUps.push(telegram(env, "getChat", { chat_id: personalId }).then((r) => row("lookup:getChat(personal_chat)", r)));
    for (const file_id of largestPhotoFileIds(photos)) followUps.push(telegram(env, "getFile", { file_id }).then((r) => row("lookup:getFile", r)));
    rows.push(...(await Promise.all(followUps)));
  }
  await save(env, rows, log);
  log.info("probe_captured", { mode: "all", rows: rows.length });
}

/** Mode "on": raw update, then the raw result of each public lookup on an allow-listed sender. */
async function captureOn(env: Env, update: unknown, log: Logger, events?: EventLog | null): Promise<void> {
  const sender = telegramSender(update);
  if (!sender) return;
  const rows: Row[] = [{ platform: "telegram", sender_id: sender.id, kind: "message", payload: update }];
  if (env.TELEGRAM_BOT_TOKEN) {
    const chat = await telegram(env, "getChat", { chat_id: sender.id }, events);
    rows.push({ platform: "telegram", sender_id: sender.id, kind: "lookup:getChat", payload: chat });
    const photos = await telegram(env, "getUserProfilePhotos", { user_id: Number(sender.id), limit: 5 }, events);
    rows.push({ platform: "telegram", sender_id: sender.id, kind: "lookup:getUserProfilePhotos", payload: photos });
    // A profile can show a personal channel: look it up too, since its public posts are part of what OSINT could see.
    const personalId = (chat.response as { result?: { personal_chat?: { id?: unknown } } } | null)?.result?.personal_chat?.id;
    if (typeof personalId === "number") {
      const personal = await telegram(env, "getChat", { chat_id: personalId }, events);
      rows.push({ platform: "telegram", sender_id: sender.id, kind: "lookup:getChat(personal_chat)", payload: personal });
    }
  } else {
    log.warn("probe_bot_token_unset");
  }
  await save(env, rows, log);
  log.info("probe_captured", { rows: rows.length });
}

/** Saves the raw update and the public lookups for the current PROBE_MODE. Never throws. */
export async function runTelegramProbe(env: Env, update: unknown, log: Logger, events?: EventLog | null): Promise<void> {
  try {
    const mode = probeMode(env);
    if (mode === "all") await captureAll(env, update, log);
    else if (mode === "on") await captureOn(env, update, log, events);
  } catch (err) {
    log.warn("probe_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Answers "/probeid" with the sender's own numeric id (nothing else). Never throws. */
export async function replyProbeId(env: Env, update: unknown, log: Logger, events?: EventLog | null): Promise<void> {
  try {
    const sender = telegramSender(update);
    if (!sender || !env.TELEGRAM_BOT_TOKEN) return;
    await telegram(env, "sendMessage", { chat_id: sender.chatId, text: `Your Telegram id is ${sender.id}` }, events);
  } catch (err) {
    log.warn("probe_reply_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
