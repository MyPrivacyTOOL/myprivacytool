import type { HexagonData } from "@/lib/deviceDetection";
import { SAVE_CONSENT_VERSION } from "@/lib/saveConsent";
import { captureStatus, isEstimate } from "../../shared/hexagon-registry/status.js";

// MPC-7470 (decision D12): the finished scan stays in THIS browser (sessionStorage) and is never sent anywhere until the visitor
// reaches the contact step, gives an email address and ticks the separate "save my scan result" box. Only then is the full scan
// posted, in the same request as the email (POST /api/scan with save_consent:true), saved, linked to the contact and stored with a
// consent record. A visitor who gives no contact has nothing saved. (MPC-7465 saved at completion; MPC-7488 gated it on a consent-tool
// purpose that the Free consentmanager package cannot create. Both are replaced by this.)
// OFF unless VITE_SAVE_WEB_SCANS is exactly "true"; the Worker has its own switch (WEB_SCAN_SAVE_ENABLED). Both stay off until Chris approves the wording.
// A saved scan is personal data: the visitor is shown the scan number afterwards and can quote it to have the scan deleted.
// The number is kept in this browser (localStorage) so it is still there on this device later; sessionStorage marks "this visit".
const KEY = "mpt_web_scan_number";
const PENDING_KEY = "mpt_pending_scan";
export const SCAN_NUMBER_EVENT = "mpt-scan-number";
const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SCAN_API_URL =
  (import.meta.env.VITE_SCAN_API_URL as string | undefined) ?? "https://mpt-scan-report.myprivacytool.workers.dev";

export const saveWebScansEnabled = (): boolean => import.meta.env.VITE_SAVE_WEB_SCANS === "true";

const read = (store: () => Storage): string | null => {
  try {
    const v = store().getItem(KEY);
    return v && SCAN_NUMBER_RE.test(v) ? v : null;
  } catch {
    return null;
  }
};

/** The scan number saved on this visit (tab session), or null. */
export const visitScanNumber = (): string | null => read(() => sessionStorage);

/** The scan number kept on this device (the latest scan saved from this browser), or null. */
export function getScanNumber(): string | null {
  return read(() => localStorage) ?? visitScanNumber();
}

// Trim to what the Worker accepts: only known fields, short text, no control characters, one entry per id.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const text = (v: unknown, n: number) => String(v ?? "").replace(CONTROL, "").slice(0, n);

// MPC-7487: the status is decided here, at capture, so the report can show FOUND with the real value instead of guessing later.
// The Network Information API is the only source for the connection type; without it the "WiFi" on screen is an assumed default.
function captureContext(hexagons: HexagonData[]) {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }) : undefined;
  const browser = hexagons.find((h) => h.id === "browser")?.value ?? "";
  return {
    connectionIsMeasured: Boolean(nav?.connection?.type === "wifi" || nav?.connection?.effectiveType),
    browserKnown: !/^unknown\b/i.test(browser),
  };
}

/** The hexagons in the shape the Worker accepts. */
export function toPayload(hexagons: HexagonData[]) {
  const ctx = captureContext(hexagons);
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const h of hexagons.slice(0, 100)) {
    const id = text(h.id, 64);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: text(h.label, 120) || id,
      value: text(h.value, 1000),
      icon: text(h.icon, 64),
      confidence: Number.isFinite(h.confidence) ? Math.min(100, Math.max(0, h.confidence)) : 0,
      risk: text(h.risk, 32),
      confirmed: Boolean(h.confirmed),
      status: captureStatus(id, h.value, ctx),
      ...(isEstimate(id) ? { estimate: true } : {}),
      ...(h.category ? { category: text(h.category, 32) } : {}),
    });
  }
  return out;
}


/**
 * Keeps the completed scan in this browser (sessionStorage) until the contact step. Nothing is sent. Does nothing while saving is off.
 */
export function rememberCompletedScan(hexagons: HexagonData[]): void {
  if (!saveWebScansEnabled() || hexagons.length === 0) return;
  try {
    const list = toPayload(hexagons);
    if (list.length > 0) sessionStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked or full: the visitor simply has no scan to save, the contact step works as before */
  }
}

/** The scan kept in this browser for the contact step, or null (arrived without a scan, storage blocked, nothing valid stored). */
export function pendingScan(): Record<string, unknown>[] | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list) || list.length < 1 || list.length > 100) return null;
    if (!list.every((h) => h && typeof h === "object" && !Array.isArray(h))) return null;
    return list as Record<string, unknown>[];
  } catch {
    return null;
  }
}

/** True when saving is on and this browser holds a finished scan: only then does the contact step show the save tick box. */
export const canOfferScanSave = (): boolean => saveWebScansEnabled() && pendingScan() !== null;

/**
 * The extra fields for POST /api/scan when the visitor ticked the save box, or {} when there is nothing to save.
 * Call it only after the box is ticked.
 */
export function scanSaveFields(): Record<string, unknown> {
  const scan = saveWebScansEnabled() ? pendingScan() : null;
  return scan ? { scan, save_consent: true, save_consent_version: SAVE_CONSENT_VERSION } : {};
}

/**
 * Reads the Worker's answer to a request that carried a scan. When it says the scan was saved, keeps the scan number on this
 * device, shows it, and drops the copy held for the contact step. Returns the number or null.
 */
export function noteSaveResult(data: unknown): string | null {
  const d = data as { scan_saved?: unknown; scan_number?: unknown } | null;
  if (!d || d.scan_saved !== true || typeof d.scan_number !== "string" || !SCAN_NUMBER_RE.test(d.scan_number)) return null;
  try {
    sessionStorage.setItem(KEY, d.scan_number);
  } catch {
    /* storage blocked: the scan is saved, the number is still in the report email */
  }
  try {
    localStorage.setItem(KEY, d.scan_number);
  } catch {
    /* storage blocked */
  }
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to drop */
  }
  try {
    window.dispatchEvent(new CustomEvent(SCAN_NUMBER_EVENT, { detail: d.scan_number }));
  } catch {
    /* no window: nothing to tell */
  }
  return d.scan_number;
}
