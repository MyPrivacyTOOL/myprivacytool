import { resolveScanApiUrl } from "@/lib/webScan";

// MPC-8452: the live view after a scan request. The Worker returns a short-lived stream token with POST /api/scan; this reads
// GET /api/scan/live with it. Only low-sensitivity facts come back (what was checked and whether it found something), never a value.
export type LiveStatus = "found" | "clear" | "not_checked";
export type LiveItem = { id: string; label: string; status: LiveStatus };
export type LiveSnapshot = { items: LiveItem[]; done: boolean; reportSent: boolean };

/** One read of the live view. null = try again later (network error or a busy server); "gone" = the token is invalid or expired, stop polling. */
export async function fetchLive(token: string): Promise<LiveSnapshot | null | "gone"> {
  const base = resolveScanApiUrl();
  if (!base) return "gone";
  try {
    const res = await fetch(`${base}/api/scan/live?t=${encodeURIComponent(token)}`);
    if (res.status === 401 || res.status === 403 || res.status === 503) return "gone";
    if (!res.ok) return null;
    const b = (await res.json()) as { items?: unknown; done?: unknown; report_sent?: unknown };
    const items = Array.isArray(b.items)
      ? b.items.flatMap((i: Partial<LiveItem>) =>
          typeof i?.id === "string" && typeof i?.label === "string" && (i.status === "found" || i.status === "clear" || i.status === "not_checked")
            ? [{ id: i.id, label: i.label, status: i.status }]
            : [],
        )
      : [];
    return { items, done: b.done === true, reportSent: b.report_sent === true };
  } catch {
    return null;
  }
}
