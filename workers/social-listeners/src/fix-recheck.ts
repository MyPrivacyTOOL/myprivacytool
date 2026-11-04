// MPC-7894 re-check comparison. Pure. Only hexagons that come from getChat / getUserProfilePhotos (or the sender object) are compared; anything derived from the
// original message (language, message text/time, update counter) cannot be re-observed from a button tap and is never part of a before/after comparison.
// "not_returned" means this bot did not receive the field in that response. It is not proof the setting is private to everyone.
import { type HexagonState, RISK_VERSION, SCAN_VERSION, hexagonStates } from "./baseline-scan";

export const RECHECK_VERSION = "telegram-recheck-1";
export const COMPARABLE_IDS = new Set([
  "tg.username", "tg.first_name", "tg.last_name", "tg.bio", "tg.birthday", "tg.photo_current", "tg.photo_history", "tg.photo_fingerprint", "tg.extra_usernames",
  "tg.premium", "tg.emoji_status", "tg.profile_colour", "tg.profile_background", "tg.gift_settings", "tg.business_intro", "tg.business_location",
  "tg.business_hours", "tg.personal_channel", "tg.forward_privacy", "tg.voice_restriction",
]);
const PHOTO_IDS = ["tg.photo_current", "tg.photo_history", "tg.photo_fingerprint"];

export type Outcome = "verified_change" | "no_change" | "not_in_baseline" | "new_exposure" | "unavailable" | "incomparable" | "partial";
interface Answer { status: number; response: unknown }
const result = (a: Answer): Record<string, unknown> | null => {
  const r = a.response as { ok?: unknown; result?: unknown } | null;
  return a.status === 200 && r?.ok === true && r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : null;
};

export interface Recheck { completeness: "complete" | "partial" | "failed"; hexagons: HexagonState[]; notes: string[] }

/** getChat is required; a failed photos call, or photo fields that contradict each other, leaves the photo hexagons "not_checked" (partial). */
export function recheckFrom(from: unknown, updateId: number, chatAnswer: Answer, photosAnswer: Answer): Recheck {
  const chat = result(chatAnswer);
  if (!chat) return { completeness: "failed", hexagons: [], notes: ["getChat failed"] };
  const photos = result(photosAnswer);
  const notes: string[] = [];
  const sets = photos && Array.isArray(photos.photos) ? photos.photos : [];
  const contradictory = !!photos && typeof photos.total_count === "number" && photos.total_count === 0 && !!chat.photo;
  if (!photos) notes.push("photos call failed");
  if (contradictory) notes.push("photo fields contradict each other");
  const all = hexagonStates({ update_id: updateId, message: { from: from ?? {} } }, chat, sets);
  const hexagons = all.map((h) => ({ ...h, state: !COMPARABLE_IDS.has(h.id) || (PHOTO_IDS.includes(h.id) && (!photos || contradictory)) ? "not_checked" as const : h.state }));
  return { completeness: notes.length ? "partial" : "complete", hexagons, notes };
}

export interface BaselineRow { id: string; created_at: string; scan_version: string; risk_version: string; report: { channel?: string; hexagons?: HexagonState[] } | null }
export const comparable = (b: BaselineRow): boolean =>
  b.scan_version === SCAN_VERSION && b.risk_version === RISK_VERSION && b.report?.channel === "TG" && Array.isArray(b.report.hexagons) && b.report.hexagons.length > 0;

const state = (hs: HexagonState[], id: string) => hs.find((h) => h.id === id)?.state ?? "not_checked";

export function issueOutcome(b: BaselineRow, r: Recheck, hexagonId: string): Outcome {
  if (r.completeness === "failed") return "unavailable";
  if (!comparable(b)) return "incomparable";
  const before = state(b.report!.hexagons!, hexagonId), after = state(r.hexagons, hexagonId);
  if (before === "not_checked" || after === "not_checked") return r.completeness === "partial" ? "partial" : "unavailable";
  if (before === "returned") return after === "returned" ? "no_change" : "verified_change";
  return after === "returned" ? "new_exposure" : "not_in_baseline";
}

export interface Summary { compared: number; before: number; after: number; gone: string[]; appeared: string[]; skipped: number }
export function summarise(b: BaselineRow, r: Recheck): Summary | null {
  if (r.completeness === "failed" || !comparable(b)) return null;
  const s: Summary = { compared: 0, before: 0, after: 0, gone: [], appeared: [], skipped: 0 };
  for (const id of COMPARABLE_IDS) {
    const x = state(b.report!.hexagons!, id), y = state(r.hexagons, id);
    if (x === "not_checked" || y === "not_checked") { s.skipped++; continue; }
    s.compared++;
    if (x === "returned") s.before++;
    if (y === "returned") s.after++;
    if (x === "returned" && y === "not_returned") s.gone.push(id);
    if (x === "not_returned" && y === "returned") s.appeared.push(id);
  }
  return s;
}
