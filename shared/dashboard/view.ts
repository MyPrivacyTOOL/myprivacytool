// MPC-7893: builds the three dashboard views from stored rows. Pure functions, no I/O. The rules here are the honesty rules:
//  - Baseline is the snapshot the link was issued for. It is never overwritten by later data.
//  - Enhanced shows what the DEEP job actually stored, and names pending / partial / failed / not run. A username match is not identity.
//  - Final compares two snapshots ONLY when scan, risk and schema versions match; a gap counts as closed only when the bot received the field in the
//    baseline and no longer receives it in the re-check. Self-reported actions are a separate list (none are recorded yet).
import { ARRIVAL, TELEGRAM_HEXAGONS } from "../hexagon-registry/channels.js";
import type { DeepJobRow, DeepResultRow, Read, SnapshotRow } from "./store";

type Hex = { id: string; state: string };
const OBSERVED = new Set(["returned", "not_returned"]);

const meta = new Map<string, { label: string; arrival: string }>(
  (TELEGRAM_HEXAGONS as Array<{ id: string; label: string; arrival: string }>).map((h) => [h.id, { label: h.label, arrival: h.arrival }]),
);
const arrivalLabel = (a: string): string => (ARRIVAL as Record<string, { label: string }>)[a]?.label ?? "";
const hexView = (h: Hex) => {
  const m = meta.get(h.id);
  return { id: h.id, label: m?.label ?? h.id, arrival: m?.arrival ?? "", arrival_label: m ? arrivalLabel(m.arrival) : "", state: h.state };
};

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
  return {
    state: "available",
    taken_at: snap.created_at,
    scan_version: snap.scan_version, risk_version: snap.risk_version, schema_version: snap.schema_version,
    risk: r.risk,
    hexagons: (r.hexagons as Hex[]).map(hexView),
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
