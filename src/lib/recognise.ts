import type { HexagonData } from "@/lib/deviceDetection";
import { SCAN_API_URL, earlierScanNumber, saveWebScansEnabled, toPayload } from "@/lib/webScan";

// MPC-7494 (F5, the open mirror). Recognition happens in the open: the visitor is told, shown how, and decides. Off unless the site save flag
// AND VITE_RECOGNITION_ENABLED are exactly "true"; the Worker has its own switch (RECOGNITION_ENABLED). Contract: docs/open-mirror-mpc-7494.md.
export const recognitionEnabled = (): boolean => saveWebScansEnabled() && import.meta.env.VITE_RECOGNITION_ENABLED === "true";

export interface Recognised {
  scan_number: string;
  last_seen: string;
  signals: { id: string; label: string }[];
  signals_compared?: number;
  caveat: string;
}

const base = () => SCAN_API_URL.replace(/\/$/, "");
const isRecognised = (d: unknown): d is Recognised => {
  const r = d as Partial<Recognised> | null;
  return !!r && typeof r.scan_number === "string" && typeof r.last_seen === "string" && Array.isArray(r.signals) && typeof r.caveat === "string";
};

/**
 * Asks the Worker whether the scan just finished matches the scan this browser kept from an earlier visit. Makes NO call unless the
 * flags are on and this browser holds an earlier scan number. Any failure or "no" returns null: the screen shows nothing.
 */
export async function recogniseReturningDevice(hexagons: HexagonData[]): Promise<Recognised | null> {
  const held = recognitionEnabled() && hexagons.length > 0 ? earlierScanNumber() : null;
  if (!held) return null;
  try {
    const res = await fetch(`${base()}/api/recognise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hexagons: toPayload(hexagons), held_scan_number: held }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { recognised?: unknown };
    return data.recognised === true && isRecognised(data) ? data : null;
  } catch {
    return null;
  }
}

/** The visitor's "Delete my record": the MPC-7488 deletion route by the matched scan number. True only when the Worker says it is gone. */
export async function deleteRecognisedRecord(scanNumber: string): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/recognise/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scan_number: scanNumber }),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { deleted?: unknown }).deleted === true;
  } catch {
    return false;
  }
}
