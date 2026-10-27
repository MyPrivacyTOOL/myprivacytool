// MPC-7891 Telegram baseline scan v1 (allow-listed test accounts only, default off). After core-brain moves the sender from
// awaiting_confirmation to confirmed (the Y to the consent question), runs getChat + getUserProfilePhotos for THE SENDER ONLY,
// replies with a risk report (hexagons returned out of 30) and saves a snapshot to public.profile_snapshots. Wording is DRAFT pending Chris's approval (strategy 9.9, 11).
import { ARRIVAL, TELEGRAM_HEXAGONS, type ArrivalId, type ObservationState } from "../../../shared/hexagon-registry/channels.js";
import { BAND_LABEL, bandFor } from "../../../shared/hexagon-registry/score.js";
import type { Logger } from "./logger";
import { call, probeIds, telegramSender } from "./probe-reader";
import type { Env } from "./shared";

export const SCAN_VERSION = "telegram-baseline-1";
export const RISK_VERSION = "risk-count-1";
const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90; // the consent text says "up to 90 days"; D-A (9.9) retention policy is still to be fixed

/**
 * Risk contract risk-count-1 (owner's decision, 2026-10-26): risk = how many of the 30 Telegram hexagons this bot received, out of 30. Each counts 1
 * (no weights). Higher = more exposed, like the website's exposure score; the band edges come from that score (shared/hexagon-registry/score.js).
 * Hexagons that are not checked in the baseline (disabled, or not looked up) can never be counted, so they are reported next to the risk.
 */
export interface Risk { returned: number; possible: number; notChecked: number; percent: number; band: "low" | "medium" | "high"; label: string }

export function riskFrom(hexagons: HexagonState[]): Risk {
  const returned = hexagons.filter((x) => x.state === "returned").length;
  const percent = Math.round((returned / hexagons.length) * 100);
  const band = bandFor(percent) as Risk["band"];
  return { returned, possible: hexagons.length, notChecked: hexagons.filter((x) => x.state === "not_checked").length, percent, band, label: BAND_LABEL[band] };
}

/** Things Telegram never gives a bot, whatever the account's settings. Shown as wins, worded as how Telegram's bot system works, not as a check of the person's settings. */
export const NEVER_SENT = ["phone number (unless you tap a share button)", "last seen", "IP address", "device"] as const;

/** Insights that stay off until their interpretation is approved or measured (see the task's measurement results). */
export const DISABLED_INSIGHTS = { message_count: "message_id measurement not run", account_era: "no approved id-to-era table" } as const;

export const baselineScanEnabled = (env: Env): boolean => env.TELEGRAM_BASELINE_SCAN === "on";

interface Decision { intent?: unknown; state?: unknown; next_state?: unknown; state_source?: unknown }
/** True only for the Y that confirms the pending consent question: awaiting_confirmation -> confirmed on a stored (not assumed) state. */
export function isConsentConfirmation(brain: Decision | null): boolean {
  return !!brain && brain.intent === "verify" && brain.state === "awaiting_confirmation" && brain.next_state === "confirmed" && brain.state_source !== "fallback";
}

/**
 * MPC-7894 staged release: TELEGRAM_SCAN_SCOPE="all" lets ANY private, non-bot sender use the baseline scan and the /fix wizard (real-user personal data).
 * Anything else (default, unset) keeps both on the PROBE_TELEGRAM_IDS allow-list. Do not set it before the retention, wording and legal gates in
 * docs/telegram-fix-wizard.md ("Real-user release gates") are recorded as done. DEEP and the dashboard link stay allow-list only.
 */
export const scanScopeAll = (env: Env): boolean => env.TELEGRAM_SCAN_SCOPE === "all";
export const scanAllowed = (env: Env, senderId: string): boolean => scanScopeAll(env) || probeIds(env).has(senderId);

/** The sender when this update is a private message from an allowed sender (test accounts, or anyone when TELEGRAM_SCAN_SCOPE=all); never a target taken from message text. */
export function baselineSender(env: Env, update: unknown): { id: string; chatId: number | string } | null {
  const s = telegramSender(update);
  return s && scanAllowed(env, s.id) ? s : null;
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

export interface HexagonState { id: string; channel: "TG"; arrival: ArrivalId; state: ObservationState }
export interface Report { risk: Risk; insights: string[]; hexagons: HexagonState[]; text: string }

const has = (o: Record<string, unknown>, k: string): boolean => o[k] !== undefined && o[k] !== null && o[k] !== "";

/**
 * One state per Telegram hexagon (shared/hexagon-registry/channels.js, 30 of them). "returned" = this bot received it in this successful check;
 * "not_returned" = a successful check did not return it (may be a privacy setting, or simply unset: never "hidden"); "not_checked" = disabled or
 * not looked up in the baseline. Pure.
 */
export function hexagonStates(update: unknown, chat: Record<string, unknown>, photoSets: unknown[]): HexagonState[] {
  const from = (update as { message?: { from?: Record<string, unknown>; date?: unknown; text?: unknown } }).message?.from ?? {};
  const msg = (update as { message?: { date?: unknown; text?: unknown } }).message ?? {};
  const usernames = Array.isArray(chat.active_usernames) ? chat.active_usernames.length : 0;
  const uniq = photoSets.flatMap((x) => (Array.isArray(x) ? x : [])).some((p: { file_unique_id?: unknown }) => typeof p?.file_unique_id === "string");
  const idNum = typeof chat.id === "number" ? chat.id : null;
  const accent = typeof chat.accent_color_id === "number" ? chat.accent_color_id : null;
  const returned: Record<string, boolean> = {
    "tg.numeric_id": idNum !== null, "tg.first_name": has(chat, "first_name") || has(from, "first_name"), "tg.last_name": has(chat, "last_name") || has(from, "last_name"),
    "tg.username": has(chat, "username") || usernames > 0 || has(from, "username"), "tg.language": has(from, "language_code"),
    "tg.message_time": typeof msg.date === "number", "tg.message_text": typeof msg.text === "string", "tg.update_counter": typeof (update as { update_id?: unknown }).update_id === "number",
    "tg.bio": has(chat, "bio"), "tg.birthday": has(chat, "birthdate"), "tg.photo_current": photoSets.length > 0 || has(chat, "photo"), "tg.photo_history": photoSets.length > 1,
    "tg.photo_fingerprint": uniq, "tg.extra_usernames": usernames > 1, "tg.premium": chat.is_premium === true, "tg.emoji_status": has(chat, "emoji_status_custom_emoji_id"),
    "tg.profile_colour": has(chat, "profile_accent_color_id") || (accent !== null && idNum !== null && accent !== idNum % 7), "tg.profile_background": has(chat, "profile_background_custom_emoji_id"),
    "tg.gift_settings": has(chat, "accepted_gift_types"), "tg.business_intro": has(chat, "business_intro"), "tg.business_location": has(chat, "business_location"),
    "tg.business_hours": has(chat, "business_opening_hours"), "tg.personal_channel": has(chat, "personal_chat"),
    "tg.forward_privacy": has(chat, "has_private_forwards"), "tg.voice_restriction": has(chat, "has_restricted_voice_and_video_messages"),
  };
  return TELEGRAM_HEXAGONS.map((x) => ({
    id: x.id, channel: "TG" as const, arrival: x.arrival,
    state: !x.enabled || !(x.id in returned) ? "not_checked" : returned[x.id] ? "returned" : "not_returned",
  }));
}

/** One block per arrival class: "[A] Sent with every message: 7 of 8", then what came back and what did not. Not-checked hexagons are left out of the counts. */
function hexagonLines(hexagons: HexagonState[]): string[] {
  const label = (id: string) => TELEGRAM_HEXAGONS.find((x) => x.id === id)?.label ?? id;
  const out: string[] = [];
  for (const a of Object.keys(ARRIVAL) as ArrivalId[]) {
    const checked = hexagons.filter((x) => x.arrival === a && x.state !== "not_checked");
    if (!checked.length) continue;
    const got = checked.filter((x) => x.state === "returned").map((x) => label(x.id));
    const not = checked.filter((x) => x.state !== "returned").map((x) => label(x.id));
    out.push("", `[${a}] ${ARRIVAL[a].label}: ${got.length} of ${checked.length}`, `  Returned: ${got.join(", ") || "none"}`, ...(not.length ? [`  Not returned: ${not.join(", ")}`] : []));
  }
  return out;
}

/** Pure: builds the report from successful answers. Returns null if a required call failed (no score is ever invented). */
export function buildReport(update: unknown, chatAnswer: Answer, photosAnswer: Answer): Report | null {
  const chat = result(chatAnswer), photos = result(photosAnswer);
  if (!chat || !photos) return null;
  const m = (update as { update_id?: unknown; message?: { from?: { id?: number; first_name?: string; last_name?: string; language_code?: string } } }).message?.from ?? {};
  const photoSets = Array.isArray(photos.photos) ? photos.photos : [];
  const hexagons = hexagonStates(update, chat, photoSets);
  const got = (id: string) => hexagons.find((x) => x.id === id)?.state === "returned";
  const idNum = typeof chat.id === "number" ? chat.id : null;
  const accent = typeof chat.accent_color_id === "number" ? chat.accent_color_id : null;
  const defaultColour = idNum !== null && accent !== null && accent === idNum % 7;
  const risk = riskFrom(hexagons);

  const insights: string[] = [];
  if (got("tg.birthday")) insights.push("Birthday: your day and month were returned to this bot. A birthday is a common security-question answer.");
  if (got("tg.language")) insights.push(`Language: your app sent "${m.language_code}" with your message. That is a language setting, not your location or nationality.`);
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

  const text = [
    `Telegram risk (draft test report): ${risk.returned} / ${risk.possible} - ${risk.label}`,
    `That is how many of the ${risk.possible} pieces of information Telegram could send this bot actually reached it in this check (${risk.notChecked} cannot be checked yet). Higher = more exposed. Not returned only means this bot did not receive it: it does not verify your privacy settings.`,
    ...hexagonLines(hexagons),
    "",
    `✅ Never sent to bots by Telegram: ${NEVER_SENT.join(", ")}.`,
    "This is how Telegram's bot system works for every account. It is not a check of your own privacy settings.",
    ...(insights.length ? ["", "What this shows:", ...insights.map((i) => `- ${i}`)] : []),
    "",
    "Next: change settings yourself in Telegram > Settings > Privacy, then ask for a re-check. Risk version " + RISK_VERSION + ".",
  ].join("\n");
  return { risk, insights, hexagons, text };
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
      scan_version: SCAN_VERSION, risk_version: RISK_VERSION, schema_version: 1, score: null, // risk lives in report.risk (count out of 30); the legacy 0-10 column stays empty
      consent: { state_before: "awaiting_confirmation", state_after: "confirmed", confirming_update_id: updateId, consent_text_key: "bot.first_hexagon.question" },
      consent_at: typeof date === "number" ? new Date(date * 1000).toISOString() : null,
      get_chat: stripFileIds(chat), photos: stripFileIds(photos),
      report: report ? { channel: "TG", risk: report.risk, never_sent: NEVER_SENT, hexagons: report.hexagons, insights: report.insights, disabled: DISABLED_INSIGHTS } : null,
      expires_at: new Date(Date.now() + retentionDays(env) * DAY_MS).toISOString(),
    }, log);
    const text = report ? report.text : FAILED_TEXT;
    const sent = await call(env, "sendMessage", { chat_id: sender.chatId, text });
    log.info("baseline_scan_done", { complete: !!report, saved, sent: sent.status });
  } catch (err) {
    log.warn("baseline_scan_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** "/scanstatus": a sender asks whether the baseline scan would run for them. Replies with three yes/no answers only, never a variable's value. PROBE_MODE=on only. */
export const isScanStatusRequest = (update: unknown): boolean => {
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/scanstatus(@\w+)?$/i.test(text.trim());
};

export async function replyScanStatus(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const s = telegramSender(update);
    if (!s || !env.TELEGRAM_BOT_TOKEN) return;
    const yn = (b: boolean) => (b ? "yes" : "no");
    const text = [
      `Baseline scan switch on: ${yn(baselineScanEnabled(env))}`,
      `Your id is on the allow-list: ${yn(probeIds(env).has(s.id))}`,
      `Snapshot storage configured: ${yn(!!env.SUPABASE_URL && !!env.SUPABASE_KEY)}`,
    ].join("\n");
    await call(env, "sendMessage", { chat_id: s.chatId, text });
  } catch (err) {
    log.warn("scan_status_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
