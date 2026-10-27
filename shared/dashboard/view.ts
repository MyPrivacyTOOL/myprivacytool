// MPC-7893: builds the three dashboard views from stored rows. Pure functions, no I/O. The rules here are the honesty rules:
//  - Baseline is the snapshot the link was issued for. It is never overwritten by later data.
//  - Enhanced shows what the DEEP job actually stored, and names pending / partial / failed / not run. A username match is not identity.
//  - Final compares two snapshots ONLY when scan, risk and schema versions match; a gap counts as closed only when the bot received the field in the
//    baseline and no longer receives it in the re-check. Self-reported actions are a separate list (none are recorded yet).
import { ARRIVAL, TELEGRAM_HEXAGONS } from "../hexagon-registry/channels.js";
import type { DeepJobRow, DeepResultRow, Read, SnapshotRow } from "./store";

type Hex = { id: string; state: string };
const OBSERVED = new Set(["returned", "not_returned"]);

const meta = new Map<string, { label: string; arrival: string; enabled: boolean; disabledReason?: string }>(
  (TELEGRAM_HEXAGONS as Array<{ id: string; label: string; arrival: string; enabled: boolean; disabledReason?: string }>).map((h) => [h.id, { label: h.label, arrival: h.arrival, enabled: h.enabled, disabledReason: h.disabledReason }]),
);

/** Why a field has no value. "Not returned" is good news for the person, but the bot cannot tell a privacy setting from an empty field, so the text says both. */
export const NOT_RETURNED_EXPLAIN =
  "Good news: Telegram did not send this to the bot, so nothing was exposed through this check. Either your privacy settings are blocking it, or it is not set on your profile. The bot cannot tell which.";
export const NOT_CHECKED_DEFAULT = "This scan does not look this up yet, so we cannot say whether it is exposed. A check for it has not been built.";
export const explainNotChecked = (id: string): string => {
  const m = meta.get(id);
  return m && !m.enabled && m.disabledReason ? `Not looked at in this scan: ${m.disabledReason}.` : NOT_CHECKED_DEFAULT;
};
const arrivalLabel = (a: string): string => (ARRIVAL as Record<string, { label: string }>)[a]?.label ?? "";
const hexView = (h: Hex, values: Record<string, string> = {}) => {
  const m = meta.get(h.id);
  const value = h.state === "returned" ? (values[h.id] ?? null) : null;
  return {
    id: h.id, label: m?.label ?? h.id, arrival: m?.arrival ?? "", arrival_label: m ? arrivalLabel(m.arrival) : "", state: h.state,
    value, value_note: h.state === "returned" && value === null ? NOT_KEPT : null,
    explain: h.state === "not_returned" ? NOT_RETURNED_EXPLAIN : h.state === "not_checked" ? explainNotChecked(h.id) : null,
  };
};

// ---- The person's own values. Only a fixed list of fields is read from the stored Telegram answers; the raw payload itself is never returned.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// eslint-disable-next-line no-control-regex
const clean = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : null);
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const yesNo = (v: unknown): string | null => (v === true ? "Yes" : v === false ? "No" : null);

export const NOT_KEPT = "Received when you confirmed, but not kept in the stored scan.";

/** Display value per hexagon id, for fields that were returned. A missing key means there is nothing to show (not returned or not kept). */
export function valuesOf(snap: SnapshotRow): Record<string, string> {
  const out: Record<string, string> = {};
  const chat: Obj = isObj(snap.get_chat?.response?.result) ? snap.get_chat.response.result : {};
  const sets: unknown[] = Array.isArray(snap.photos?.response?.result?.photos) ? snap.photos.response.result.photos : [];
  const put = (id: string, v: string | null) => { if (v) out[id] = v; };
  if (typeof chat.id === "number") put("tg.numeric_id", String(chat.id));
  put("tg.first_name", clean(chat.first_name)); put("tg.last_name", clean(chat.last_name));
  if (clean(chat.username)) put("tg.username", `@${clean(chat.username, 64)}`);
  const extra = Array.isArray(chat.active_usernames) ? chat.active_usernames.map((u: unknown) => clean(u, 64)).filter(Boolean) : [];
  if (extra.length > 1) put("tg.extra_usernames", extra.map((u) => `@${u}`).join(", "));
  put("tg.bio", clean(chat.bio, 500));
  if (isObj(chat.birthdate) && Number.isInteger(chat.birthdate.day) && Number.isInteger(chat.birthdate.month) && chat.birthdate.month >= 1 && chat.birthdate.month <= 12) {
    put("tg.birthday", `${chat.birthdate.day} ${MONTHS[chat.birthdate.month - 1]}${Number.isInteger(chat.birthdate.year) ? ` ${chat.birthdate.year}` : " (no year)"}`);
  }
  const newest = Array.isArray(sets[0]) ? (sets[0] as Obj[]) : [];
  const biggest = newest.length ? newest[newest.length - 1] : null;
  if (sets.length) {
    put("tg.photo_current", `${sets.length} profile photo${sets.length === 1 ? "" : "s"} received${biggest?.width && biggest?.height ? `; newest ${biggest.width}×${biggest.height} px` : ""}. The image itself is not stored.`);
  }
  if (sets.length > 1) put("tg.photo_history", `${sets.length - 1} older photo${sets.length === 2 ? "" : "s"}`);
  const fingerprints = sets.map((x) => (Array.isArray(x) ? (x as Obj[]).map((p) => clean(p?.file_unique_id, 80)).filter(Boolean).pop() : null)).filter(Boolean);
  if (fingerprints.length) put("tg.photo_fingerprint", (fingerprints as string[]).join(", "));
  if (chat.is_premium === true) put("tg.premium", "Yes");
  put("tg.emoji_status", clean(chat.emoji_status_custom_emoji_id, 64));
  if (Number.isInteger(chat.profile_accent_color_id)) put("tg.profile_colour", `Profile colour ${chat.profile_accent_color_id}`);
  else if (Number.isInteger(chat.accent_color_id)) put("tg.profile_colour", `Name colour ${chat.accent_color_id}`);
  put("tg.profile_background", clean(chat.profile_background_custom_emoji_id, 64));
  if (isObj(chat.accepted_gift_types)) {
    put("tg.gift_settings", Object.entries(chat.accepted_gift_types).filter(([, v]) => typeof v === "boolean").slice(0, 8).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v ? "yes" : "no"}`).join("; ") || null);
  }
  if (isObj(chat.business_intro)) put("tg.business_intro", [clean(chat.business_intro.title, 120), clean(chat.business_intro.message, 300)].filter(Boolean).join(": ") || null);
  if (isObj(chat.business_location)) put("tg.business_location", clean(chat.business_location.address, 300));
  if (isObj(chat.business_opening_hours)) {
    const n = Array.isArray(chat.business_opening_hours.opening_hours) ? chat.business_opening_hours.opening_hours.length : 0;
    put("tg.business_hours", `${n} opening interval${n === 1 ? "" : "s"}${clean(chat.business_opening_hours.time_zone_name, 64) ? `, ${clean(chat.business_opening_hours.time_zone_name, 64)}` : ""}`);
  }
  if (isObj(chat.personal_chat)) put("tg.personal_channel", [clean(chat.personal_chat.title, 120), clean(chat.personal_chat.username, 64) ? `@${clean(chat.personal_chat.username, 64)}` : null].filter(Boolean).join(" ") || null);
  put("tg.forward_privacy", chat.has_private_forwards === true ? "Forwarding of your messages is restricted" : chat.has_private_forwards === false ? "Forwarding of your messages is allowed" : null);
  put("tg.voice_restriction", yesNo(chat.has_restricted_voice_and_video_messages));
  const upd = snap.consent?.confirming_update_id;
  if (Number.isInteger(upd)) put("tg.update_counter", String(upd));
  if (typeof snap.consent_at === "string") put("tg.message_time", snap.consent_at);
  return out;
}
export const BASELINE_LIMITS = [
  "This shows what the Telegram bot received for your account when the scan ran. It is not a check of your own privacy settings.",
  "A field that was not returned may be hidden by your settings or simply empty, so it is not proof of privacy.",
  "Fields marked not checked were not looked at in this scan.",
];
export const ENHANCED_LIMITS = [
  "A username match on another site shows the same name exists there. It does not prove the account is yours.",
  "Not found, blocked or unavailable is not an all-clear: the site may have refused or not answered.",
];

export function baselineView(snap: SnapshotRow | null, read: Read<unknown>["ok"] = true) {
  if (!read) return { state: "unavailable", reason: "The scan could not be loaded just now. Try again in a few minutes." };
  if (!snap) return { state: "unavailable", reason: "This scan is no longer stored, or it has expired." };
  const r = snap.report;
  if (snap.status !== "complete" || !r || !Array.isArray(r.hexagons) || !r.risk) {
    return { state: "unavailable", reason: "This scan did not complete, so nothing was scored.", taken_at: snap.created_at };
  }
  const values = valuesOf(snap);
  return {
    state: "available",
    taken_at: snap.created_at,
    scan_version: snap.scan_version, risk_version: snap.risk_version, schema_version: snap.schema_version,
    risk: r.risk,
    hexagons: (r.hexagons as Hex[]).map((h) => hexView(h, values)),
    insights: Array.isArray(r.insights) ? r.insights : [],
    never_sent: Array.isArray(r.never_sent) ? r.never_sent : [],
    disabled: r.disabled ?? {},
    limits: BASELINE_LIMITS,
  };
}

const JOB_STATE: Record<string, string> = {
  awaiting_consent: "pending", running: "pending", complete: "complete", partial: "partial",
  failed: "failed", interrupted: "failed", cancelled: "failed", expired: "failed",
};
const JOB_NOTE: Record<string, string> = {
  pending: "The DEEP check has not finished. Results appear here when it has.",
  complete: "The DEEP check finished.",
  partial: "The DEEP check finished only in part. Sites without an answer are listed as such.",
  failed: "The DEEP check did not finish. Nothing below is a complete picture.",
};

export function enhancedView(job: Read<DeepJobRow | null>, results: Read<DeepResultRow[]> | null) {
  if (!job.ok) return { state: "unavailable", note: "DEEP results could not be loaded just now.", limits: ENHANCED_LIMITS };
  if (!job.value) {
    return { state: "not_run", note: "DEEP has not been run. Opening this page does not run it: go back to Telegram and type DEEP if you want it.", limits: ENHANCED_LIMITS };
  }
  const state = JOB_STATE[job.value.status] ?? "failed";
  const base = { state, note: JOB_NOTE[state], status: job.value.status, started_at: job.value.created_at, finished_at: job.value.finished_at, detector_version: job.value.detector_version, limits: ENHANCED_LIMITS };
  if (!results || !results.ok) return { ...base, results: [], results_unavailable: true };
  return { ...base, results: results.value };
}

export interface Change { id: string; label: string; before: string; after: string; kind: "no_longer_returned" | "newly_returned" | "unchanged" | "inconclusive" }

export function finalView(base: SnapshotRow | null, later: Read<SnapshotRow | null>) {
  if (!later.ok) return { state: "unavailable", note: "The re-check could not be loaded just now." };
  if (!later.value) {
    return { state: "not_run", note: "No re-check yet. After you change a setting in Telegram, ask the bot to scan again and it will be compared here.", self_reported: { recorded: false, note: "No self-reported actions are recorded." } };
  }
  const b = base?.report, a = later.value.report;
  const mismatches: string[] = [];
  if (!base) mismatches.push("baseline missing");
  else {
    if (base.scan_version !== later.value.scan_version) mismatches.push(`scan version ${base.scan_version} vs ${later.value.scan_version}`);
    if (base.risk_version !== later.value.risk_version) mismatches.push(`risk version ${base.risk_version} vs ${later.value.risk_version}`);
    if (base.schema_version !== later.value.schema_version) mismatches.push(`schema version ${base.schema_version} vs ${later.value.schema_version}`);
  }
  const common = { baseline_at: base?.created_at, recheck_at: later.value.created_at, self_reported: { recorded: false, note: "No self-reported actions are recorded." } };
  if (mismatches.length) {
    return { state: "incomparable", ...common, reasons: mismatches, note: "These two scans were made with different versions, so their counts cannot be compared. Both are kept as they were." };
  }
  if (!b?.hexagons || !a?.hexagons || !b.risk || !a.risk) {
    return { state: "incomparable", ...common, reasons: ["a scan has no stored result"], note: "One of the scans has no stored result, so there is nothing to compare." };
  }
  const afterById = new Map<string, string>((a.hexagons as Hex[]).map((h) => [h.id, h.state]));
  const changes: Change[] = (b.hexagons as Hex[]).map((h) => {
    const after = afterById.get(h.id) ?? "missing";
    const label = meta.get(h.id)?.label ?? h.id;
    let kind: Change["kind"] = "inconclusive";
    if (OBSERVED.has(h.state) && OBSERVED.has(after)) {
      kind = h.state === after ? "unchanged" : h.state === "returned" ? "no_longer_returned" : "newly_returned";
    }
    return { id: h.id, label, before: h.state, after, kind };
  });
  const count = (k: Change["kind"]) => changes.filter((c) => c.kind === k).length;
  return {
    state: "comparable", ...common, scan_version: base!.scan_version, risk_version: base!.risk_version,
    risk_before: b.risk, risk_after: a.risk,
    summary: { no_longer_returned: count("no_longer_returned"), newly_returned: count("newly_returned"), unchanged: count("unchanged"), inconclusive: count("inconclusive") },
    changes: changes.filter((c) => c.kind !== "unchanged"),
    note: "Only fields the bot received in the first scan and no longer receives now are counted as closed. That shows what the bot receives today, not why.",
  };
}
