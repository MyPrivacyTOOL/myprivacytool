import type { HexagonData } from "@/lib/deviceDetection";
import { hasScanSaveConsent } from "@/lib/cookieConsent";
import { captureStatus, isEstimate } from "../../shared/hexagon-registry/status.js";

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

// MPC-7493: when this visit's scan began (set once by the home page), so the saved scan can be dated "started" as well as "finished".
const MAX_SCAN_MS = 10 * 60 * 1000;
let scanStartedAt: number | null = null;
export function markScanStarted(): void {
  if (scanStartedAt === null) scanStartedAt = Date.now();
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
  // MPC-7493: how long the scan took, and the scan number this browser already held from an earlier visit (how a return visit is
  // recognised: the number kept here, never a fingerprint match). Both are optional and only ever sent along with a scan that is being saved.
  const previous = read(() => localStorage);
  return {
    consent: true,
    hexagons: out,
    ...(scanStartedAt !== null ? { started_ms: Math.min(MAX_SCAN_MS, Math.max(0, Math.round(Date.now() - scanStartedAt))) } : {}),
    ...(previous ? { previous_scan_number: previous } : {}),
  };
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

// MPC-7493: funnel steps for the scan saved on this visit. Sent only when saving is on, the visitor accepted the scan-saving consent
// purpose and a scan was saved (so there is a scan number to attach to). A failure never affects the visitor.
export type FunnelStep = "results_viewed" | "contact_step_opened" | "results_time";
const MAX_RESULTS_SECONDS = 3600;
const sent = new Set<string>();

export function reportStep(step: FunnelStep, seconds?: number): void {
  const scanNumber = visitScanNumber();
  if (!saveWebScansEnabled() || !API_URL || !hasScanSaveConsent() || !scanNumber) return;
  if (step !== "results_time") {
    if (sent.has(`${scanNumber}:${step}`)) return;
    sent.add(`${scanNumber}:${step}`);
  }
  try {
    void fetch(`${API_URL.replace(/\/$/, "")}/api/web-scan/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        scan_number: scanNumber,
        step,
        ...(step === "results_time" ? { seconds: Math.min(MAX_RESULTS_SECONDS, Math.max(0, Math.round(seconds ?? 0))) } : {}),
      }),
    }).catch(() => undefined);
  } catch {
    /* never affects the visitor */
  }
}

/**
 * Call when the results are on screen. Reports "results viewed" as soon as the scan has a number, and the seconds the visitor spent
 * on the results (tab visible) each time they hide or leave the page. Returns a cleanup function.
 */
export function trackResults(): () => void {
  let visibleSince: number | null = typeof document !== "undefined" && document.visibilityState === "hidden" ? null : Date.now();
  let total = 0;
  const viewed = () => reportStep("results_viewed");
  const flush = () => {
    if (visibleSince !== null) {
      total += (Date.now() - visibleSince) / 1000;
      visibleSince = null;
    }
    if (total > 0) reportStep("results_time", total);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
    else visibleSince = Date.now();
  };
  viewed();
  window.addEventListener(SCAN_NUMBER_EVENT, viewed);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  return () => {
    window.removeEventListener(SCAN_NUMBER_EVENT, viewed);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
    flush();
  };
}
