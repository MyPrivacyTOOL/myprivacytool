import { resolveScanApiUrl } from "@/lib/webScan";

// MPC-8452: the live view after a scan request. The Worker returns a short-lived stream token with POST /api/scan; this reads
// GET /api/scan/live with it. Only low-sensitivity facts come back (what was checked and whether it found something), never a value.
export type LiveStatus = "found" | "clear" | "not_checked";
export type LiveItem = { id: string; label: string; status: LiveStatus; value?: string };
/** MPC-9813: one page the visitor showed us, as the Worker reports it. `state` is the three-state result; a block or timeout is never "not_listed". */
export type ListingResult = {
  key: string;
  name: string;
  state: "listed" | "not_listed" | "not_checked";
  match: "exact" | "probable" | "possible" | null;
  is_guess: boolean;
  not_checked_reason: string | null;
  note: string | null;
  evidence_url: string | null;
  guide: { slug: string; name: string; optOutUrl: string | null } | null;
};
export type LiveListings = { pending: boolean; items: ListingResult[] };
export type LiveSnapshot = {
  items: LiveItem[]; done: boolean; reportSent: boolean; verified: boolean;
  /** MPC-9813: present only while the email-confirm gate is on. */
  confirmRequired?: boolean; confirmed?: boolean; listings?: LiveListings;
};
/** "stream" = the short-lived key from the request (low-sensitivity view). "verified" = the key from the email link (proves inbox ownership; values shown). */
export type LiveKind = "stream" | "verified";

/** One read of the live view. null = try again later (network error or a busy server); "gone" = the token is invalid or expired, stop polling. */
export async function fetchLive(token: string, kind: LiveKind = "stream"): Promise<LiveSnapshot | null | "gone"> {
  const base = resolveScanApiUrl();
  if (!base) return "gone";
  try {
    // The email-link key travels in a header, not the URL, so it never lands in a request log.
    const res = kind === "verified"
      ? await fetch(`${base}/api/scan/live`, { headers: { Authorization: `Bearer ${token}` } })
      : await fetch(`${base}/api/scan/live?t=${encodeURIComponent(token)}`);
    if (res.status === 401 || res.status === 403 || res.status === 503) return "gone";
    if (!res.ok) return null;
    const b = (await res.json()) as { items?: unknown; done?: unknown; report_sent?: unknown; verified?: unknown; confirm_required?: unknown; confirmed?: unknown; listings?: unknown };
    const items = Array.isArray(b.items)
      ? b.items.flatMap((i: Partial<LiveItem>) =>
          typeof i?.id === "string" && typeof i?.label === "string" && (i.status === "found" || i.status === "clear" || i.status === "not_checked")
            ? [{ id: i.id, label: i.label, status: i.status, ...(typeof i.value === "string" ? { value: i.value } : {}) }]
            : [],
        )
      : [];
    return {
      items, done: b.done === true, reportSent: b.report_sent === true, verified: b.verified === true,
      ...(typeof b.confirm_required === "boolean" ? { confirmRequired: b.confirm_required, confirmed: b.confirmed === true } : {}),
      ...(readListings(b.listings) ? { listings: readListings(b.listings)! } : {}),
    };
  } catch {
    return null;
  }
}

export function readVerifyKey(hash: string): string {
  const m = /(?:^#|&)v=([A-Za-z0-9._-]{20,200})(?:&|$)/.exec(hash);
  return m ? m[1] : "";
}

const STATES = ["listed", "not_listed", "not_checked"];
const MATCHES = ["exact", "probable", "possible"];
const str = (v: unknown, n = 300): string | null => (typeof v === "string" ? v.slice(0, n) : null);
/** Only well-formed rows are kept; the evidence link must be https. */
export function readListings(raw: unknown): LiveListings | null {
  const l = raw as { pending?: unknown; items?: unknown } | null;
  if (!l || typeof l !== "object" || !Array.isArray(l.items)) return null;
  const items = l.items.flatMap((r: Record<string, unknown>): ListingResult[] => {
    if (!r || typeof r.state !== "string" || !STATES.includes(r.state) || typeof r.name !== "string") return [];
    const url = str(r.evidence_url, 500);
    const g = r.guide as { slug?: unknown; name?: unknown; optOutUrl?: unknown } | null;
    const optOut = g ? str(g.optOutUrl, 500) : null;
    return [{
      key: str(r.key, 64) ?? "other", name: r.name.slice(0, 120), state: r.state as ListingResult["state"],
      match: typeof r.match === "string" && MATCHES.includes(r.match) ? (r.match as ListingResult["match"]) : null,
      is_guess: r.is_guess === true, not_checked_reason: str(r.not_checked_reason, 40), note: str(r.note, 40),
      evidence_url: url && url.startsWith("https://") ? url : null,
      guide: g && str(g.slug, 80) ? { slug: str(g.slug, 80)!, name: str(g.name, 120) ?? "", optOutUrl: optOut && optOut.startsWith("https://") ? optOut : null } : null,
    }];
  });
  return { pending: l.pending === true, items };
}

/** MPC-9813: the click-to-confirm. POST /api/scan/confirm with the key from the email link (header, never the URL). true = the Worker confirmed the address. */
export async function confirmEmail(token: string): Promise<boolean> {
  const base = resolveScanApiUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/scan/confirm`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const b = (await res.json().catch(() => null)) as { confirmed?: unknown } | null;
    return b?.confirmed === true;
  } catch {
    return false;
  }
}
