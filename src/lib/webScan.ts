import type { HexagonData } from "@/lib/deviceDetection";
import { hasScanSaveConsent } from "@/lib/cookieConsent";

// MPC-7465: every completed web scan is saved under a random scan number, and the number is carried to the contact step.
// OFF unless VITE_SAVE_WEB_SCANS is exactly "true" (production keeps it off until the privacy wording, MPC-7470, is signed off).
// MPC-7488: saved only when the visitor accepted the specific consent purpose for saving their scan (hasScanSaveConsent()),
// not any one purpose. A saved scan is personal data: the visitor is shown the number and can quote it to have the scan deleted.
// The number is kept in this browser (localStorage) so it is still there on this device later; sessionStorage only marks
// "already saved on this visit" so a new visit saves a new scan.
const KEY = "mpt_web_scan_number";
export const SCAN_NUMBER_EVENT = "mpt-scan-number";
const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_URL =
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

/** The scan number saved on this visit (tab session), or null. This is the one linked to a contact given on this visit. */
export const visitScanNumber = (): string | null => read(() => sessionStorage);

/** The scan number kept on this device (the latest scan saved from this browser), or null. */
export function getScanNumber(): string | null {
  return read(() => localStorage) ?? visitScanNumber();
}

// Trim to what the Worker accepts: only known fields, short text, no control characters, one entry per id.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const text = (v: unknown, n: number) => String(v ?? "").replace(CONTROL, "").slice(0, n);

export function toPayload(hexagons: HexagonData[]) {
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
      ...(h.category ? { category: text(h.category, 32) } : {}),
    });
  }
  return { consent: true, hexagons: out };
}

/**
 * Posts a completed scan and keeps the scan number for the visit. Returns the number, or null when saving is off,
 * consent is missing, there is nothing to save, or the request fails (a failure never affects the visitor).
 */
export async function saveCompletedScan(hexagons: HexagonData[]): Promise<string | null> {
  if (!saveWebScansEnabled() || !API_URL || !hasScanSaveConsent() || hexagons.length === 0) return null;
  const existing = visitScanNumber();
  if (existing) return existing;
  try {
    const payload = toPayload(hexagons);
    if (payload.hexagons.length === 0) return null;
    const res = await fetch(`${API_URL.replace(/\/$/, "")}/api/web-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { saved?: boolean; scan_number?: string };
    if (!data.saved || !data.scan_number || !SCAN_NUMBER_RE.test(data.scan_number)) return null;
    try {
      sessionStorage.setItem(KEY, data.scan_number);
    } catch {
      /* storage blocked: the scan is saved, it just cannot be linked */
    }
    try {
      localStorage.setItem(KEY, data.scan_number);
    } catch {
      /* storage blocked: the number is still shown on this screen */
    }
    try {
      window.dispatchEvent(new CustomEvent(SCAN_NUMBER_EVENT, { detail: data.scan_number }));
    } catch {
      /* no window: nothing to tell */
    }
    return data.scan_number;
  } catch {
    return null;
  }
}
