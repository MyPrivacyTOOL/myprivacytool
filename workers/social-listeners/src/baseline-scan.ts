// MPC-7891 Telegram baseline scan v1 (allow-listed test accounts only, default off). After core-brain moves the sender from
// awaiting_confirmation to confirmed (the Y to the consent question), runs getChat + getUserProfilePhotos for THE SENDER ONLY,
// replies with a scored report and saves a snapshot to public.profile_snapshots. Wording is DRAFT pending Chris's approval (strategy 9.9, 11).
import type { Logger } from "./logger";
import { call, probeIds, telegramSender } from "./probe-reader";
import type { Env } from "./shared";

export const SCAN_VERSION = "telegram-baseline-1";
export const RISK_VERSION = "risk-rank-1";
const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90; // the consent text says "up to 90 days"; D-A (9.9) retention policy is still to be fixed

/** Risk-ranking contract (strategy 9.10 tiers). PROPOSED penalty weights: not yet approved. Score = 10 minus penalties for fields observed, floored at 0. */
export const RISK_RANKING = {
  version: RISK_VERSION,
  weights: { critical: 3, high: 1.5, medium: 1, low: 0.25 },
  tiers: {
    username: "critical", bio: "high", birthdate: "high", numeric_id: "high", names: "medium", photo: "medium",
    language: "low", accent_color: "low", is_premium: "low",
  },
} as const;
type Field = keyof typeof RISK_RANKING.tiers;

/** Insights that stay off until their interpretation is approved or measured (see the task's measurement results). */
export const DISABLED_INSIGHTS = { message_count: "message_id measurement not run", account_era: "no approved id-to-era table" } as const;

export const baselineScanEnabled = (env: Env): boolean => env.TELEGRAM_BASELINE_SCAN === "on";

interface Decision { intent?: unknown; state?: unknown; next_state?: unknown; state_source?: unknown }
/** True only for the Y that confirms the pending consent question: awaiting_confirmation -> confirmed on a stored (not assumed) state. */
export function isConsentConfirmation(brain: Decision | null): boolean {
  return !!brain && brain.intent === "verify" && brain.state === "awaiting_confirmation" && brain.next_state === "confirmed" && brain.state_source !== "fallback";
}

/** The sender when this update is a private message from an allow-listed test account; never a target taken from message text. */
export function baselineSender(env: Env, update: unknown): { id: string; chatId: number | string } | null {
  const s = telegramSender(update);
  return s && probeIds(env).has(s.id) ? s : null;
}

/** Removes bot-specific file ids anywhere in a Telegram answer; file_unique_id is kept. */
export function stripFileIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFileIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== "file_id" && !k.endsWith("_file_id")).map(([k, v]) => [k, stripFileIds(v)]));
  }
  return value;
}

interface Answer { status: number; response: unknown }
const result = (a: Answer): Record<string, unknown> | null => {
  const r = a.response as { ok?: unknown; result?: unknown } | null;
  return a.status === 200 && r?.ok === true && r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export interface Item { field: Field; label: string; returned: boolean; penalty: number }
export interface Report { score: number; items: Item[]; insights: string[]; text: string }

/** Pure: builds the report from successful answers. Returns null if a required call failed (no score is ever invented). */
export function buildReport(update: unknown, chatAnswer: Answer, photosAnswer: Answer): Report | null {
  const chat = result(chatAnswer), photos = result(photosAnswer);
  if (!chat || !photos) return null;
  const m = (update as { update_id?: unknown; message?: { from?: { id?: number; first_name?: string; last_name?: string; language_code?: string } } }).message?.from ?? {};
  const photoSets = Array.isArray(photos.photos) ? photos.photos : [];
  const returned: Record<Field, boolean> = {
    username: !!(str(chat.username) || (Array.isArray(chat.active_usernames) && chat.active_usernames.length > 0)),
    bio: !!str(chat.bio),
    birthdate: !!chat.birthdate && typeof chat.birthdate === "object",
    numeric_id: typeof chat.id === "number",
    names: !!(str(chat.first_name) || str(chat.last_name)),
    photo: photoSets.length > 0 || !!chat.photo,
    language: !!str(m.language_code),
    accent_color: false, // only a deviation from the default colour counts (below)
    is_premium: chat.is_premium === true,
  };
  const idNum = typeof chat.id === "number" ? chat.id : null;
  const accent = typeof chat.accent_color_id === "number" ? chat.accent_color_id : null;
  const defaultColour = idNum !== null && accent !== null && accent === idNum % 7;
  if (accent !== null && !defaultColour) returned.accent_color = true;
  const labels: Record<Field, string> = {
    username: "@username", bio: "Bio", birthdate: "Birthday (day/month)", numeric_id: "Numeric Telegram id", names: "Name",
    photo: "Profile photo", language: "Language setting", accent_color: "Custom profile colour", is_premium: "Premium status",
  };
  const items: Item[] = (Object.keys(RISK_RANKING.tiers) as Field[]).map((field) => ({
    field, label: labels[field], returned: returned[field],
    penalty: returned[field] ? RISK_RANKING.weights[RISK_RANKING.tiers[field]] : 0,
  }));
  const score = Math.round(Math.max(0, 10 - items.reduce((s, i) => s + i.penalty, 0)) * 10) / 10;

  const insights: string[] = [];
  if (returned.birthdate) insights.push("Birthday: your day and month were returned to this bot. A birthday is a common security-question answer.");
  if (returned.language) insights.push(`Language: your app sent "${m.language_code}" with your message. That is a language setting, not your location or nationality.`);
  if (idNum !== null && accent !== null) insights.push(defaultColour
    ? "Name colour: Telegram's default for your id; no custom profile colour was returned (seen on one test account so far)."
    : "Name colour: a custom colour was returned.");
  const uniq = photoSets.flatMap((s: unknown) => (Array.isArray(s) ? s : []).map((p: { file_unique_id?: unknown }) => p?.file_unique_id)).filter((x: unknown) => typeof x === "string");
  if (uniq.length > 0) insights.push("Photo: Telegram gives each photo a stable identifier that is the same across bots, so the same photo can be recognised again.");
  const updateId = (update as { update_id?: unknown }).update_id;
  if (typeof updateId === "number") insights.push("Counter: this bot's update counter is shared by everyone who writes to it. It is not a count of your messages and can jump.");
  const engagement: string[] = [];
  if (chat.is_premium === true) engagement.push("Premium");
  if (typeof chat.max_reaction_count === "number") engagement.push(`up to ${chat.max_reaction_count} reactions per message`);
  if (chat.accepted_gift_types && typeof chat.accepted_gift_types === "object") engagement.push("gift settings returned");
  if (engagement.length > 0) insights.push(`How Telegram describes your account: ${engagement.join(", ")}.`);

  const found = items.filter((i) => i.returned), notFound = items.filter((i) => !i.returned);
  const text = [
    `Telegram baseline scan (draft test report): ${score}/10`,
    "",
    "Returned to this bot:", ...(found.length ? found.map((i) => `- ${i.label}`) : ["- nothing in the list"]),
    "",
    "Not returned to this bot in this check (may be hidden by your settings, or not set; this does not verify your settings):",
    ...(notFound.length ? notFound.map((i) => `- ${i.label}`) : ["- nothing in the list"]),
    "",
    "Never provided to bots by Telegram: phone number, last seen, IP address, device. We cannot inspect those settings.",
    ...(insights.length ? ["", "What this shows:", ...insights.map((i) => `- ${i}`)] : []),
    "",
    "Next: change settings yourself in Telegram > Settings > Privacy, then ask for a re-check. Score uses " + RISK_VERSION + " (draft weights).",
  ].join("\n");
  return { score, items, insights, text };
}

async function post(env: Env, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_KEY!, authorization: `Bearer ${env.SUPABASE_KEY!}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function retentionDays(env: Env): number {
  const n = Number.parseInt(env.PROFILE_SNAPSHOT_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : DEFAULT_RETENTION_DAYS;
}

/** Saves one snapshot; a replayed update_id is ignored by the unique index. Returns false if nothing could be stored. */
async function saveSnapshot(env: Env, row: Record<string, unknown>, log: Logger): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) { log.warn("snapshot_storage_unconfigured"); return false; }
  try {
    const res = await post(env, "profile_snapshots?on_conflict=platform,sender_id,update_id", row, { Prefer: "resolution=ignore-duplicates,return=minimal" });
    if (!res.ok) log.warn("snapshot_save_failed", { status: res.status });
    return res.ok;
  } catch (err) {
    log.warn("snapshot_save_failed", { error: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}

const FAILED_TEXT = "I couldn't complete the Telegram check just now, so I have no result to show. Nothing was scored. You can say \"scan me\" to try again later.";

/** Runs after the Y reply. Never throws, never logs payloads or the token. Does nothing for senders outside the allow-list. */
export async function runBaselineScan(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const sender = baselineSender(env, update);
    if (!sender || !env.TELEGRAM_BOT_TOKEN) return;
    const updateId = (update as { update_id?: unknown }).update_id;
    if (typeof updateId !== "number") return;
    const [chat, photos] = await Promise.all([
      call(env, "getChat", { chat_id: sender.id }),
      call(env, "getUserProfilePhotos", { user_id: Number(sender.id), limit: 5 }),
    ]);
    const report = buildReport(update, chat, photos);
    const date = (update as { message?: { date?: unknown } }).message?.date;
    const saved = await saveSnapshot(env, {
      platform: "telegram", sender_id: sender.id, update_id: updateId, status: report ? "complete" : "failed",
      scan_version: SCAN_VERSION, risk_version: RISK_VERSION, schema_version: 1, score: report?.score ?? null,
      consent: { state_before: "awaiting_confirmation", state_after: "confirmed", confirming_update_id: updateId, consent_text_key: "bot.first_hexagon.question" },
      consent_at: typeof date === "number" ? new Date(date * 1000).toISOString() : null,
      get_chat: stripFileIds(chat), photos: stripFileIds(photos),
      report: report ? { items: report.items, insights: report.insights, disabled: DISABLED_INSIGHTS } : null,
      expires_at: new Date(Date.now() + retentionDays(env) * DAY_MS).toISOString(),
    }, log);
    const text = report ? report.text : FAILED_TEXT;
    const sent = await call(env, "sendMessage", { chat_id: sender.chatId, text });
    log.info("baseline_scan_done", { complete: !!report, saved, sent: sent.status });
  } catch (err) {
    log.warn("baseline_scan_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
