import type { HexagonData } from "@/lib/deviceDetection";
import { hasConsent } from "@/lib/cookieConsent";
import { captureStatus, isEstimate } from "../../shared/hexagon-registry/status.js";

// MPC-7465: every completed web scan is saved under an anonymous scan number, and the number is carried to the contact step.
// OFF unless VITE_SAVE_WEB_SCANS is exactly "true" (production keeps it off until the privacy wording, MPC-7470, is signed off).
// A visitor who has not accepted the consent banner (or rejected it) is never saved: hasConsent() is false by default.
const KEY = "mpt_web_scan_number";
const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_URL =
  (import.meta.env.VITE_SCAN_API_URL as string | undefined) ?? "https://mpt-scan-report.myprivacytool.workers.dev";

export const saveWebScansEnabled = (): boolean => import.meta.env.VITE_SAVE_WEB_SCANS === "true";

/** The scan number kept for this visit (tab session), or null. */
export function getScanNumber(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && SCAN_NUMBER_RE.test(v) ? v : null;
  } catch {
    return null;
  }
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
  return { consent: true, hexagons: out };
}

/**
 * Posts a completed scan and keeps the scan number for the visit. Returns the number, or null when saving is off,
 * consent is missing, there is nothing to save, or the request fails (a failure never affects the visitor).
 */
export async function saveCompletedScan(hexagons: HexagonData[]): Promise<string | null> {
  if (!saveWebScansEnabled() || !API_URL || !hasConsent() || hexagons.length === 0) return null;
  const existing = getScanNumber();
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
    return data.scan_number;
  } catch {
    return null;
  }
}
