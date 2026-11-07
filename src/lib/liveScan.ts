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
/** MPC-9814: one broker row of the panel the Worker builds (workers/scan-report/lib/brokerPanel.js owns the wording). All nine shortlist brokers always come back. */
export type BrokerRow = {
  key: string; name: string; region: string | null;
  state: "listed" | "not_listed" | "not_checked"; match: "exact" | "probable" | "possible" | null; is_guess: boolean;
  confidence: "high" | "medium" | "low" | null; confidenceWord: string | null; confidenceLevel: number;
  text: string; checkedOn: string | null; evidenceUrl: string | null;
  also: { state: string; evidenceUrl: string | null }[];
  guide: { slug: string; timeNeeded: string | null } | null; noGuideText: string | null;
};
export type BrokerPanel = { pending: boolean; pasteAvailable: boolean; intro: string; rows: BrokerRow[]; others: BrokerRow[]; regionNote: string; coverageNote: string };
export type LiveSnapshot = {
  items: LiveItem[]; done: boolean; reportSent: boolean; verified: boolean;
  /** MPC-9813: present only while the email-confirm gate is on. */
  confirmRequired?: boolean; confirmed?: boolean; listings?: LiveListings;
  /** MPC-9814: the broker section of every scan's result. */
  brokerPanel?: BrokerPanel;
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
    const b = (await res.json()) as { items?: unknown; done?: unknown; report_sent?: unknown; verified?: unknown; confirm_required?: unknown; confirmed?: unknown; listings?: unknown; broker_panel?: unknown };
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
      ...(readBrokerPanel(b.broker_panel) ? { brokerPanel: readBrokerPanel(b.broker_panel)! } : {}),
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

const LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1 };
const readRow = (r: Record<string, unknown>): BrokerRow[] => {
  if (!r || typeof r !== "object" || typeof r.state !== "string" || !STATES.includes(r.state) || typeof r.name !== "string" || typeof r.text !== "string") return [];
  const https = (v: unknown) => { const u = str(v, 500); return u && u.startsWith("https://") ? u : null; };
  const conf = typeof r.confidence === "string" && r.confidence in LEVEL ? (r.confidence as BrokerRow["confidence"]) : null;
  const g = r.guide as { slug?: unknown; timeNeeded?: unknown } | null;
  const slug = g ? str(g.slug, 80) : null;
  return [{
    key: str(r.key, 64) ?? "other", name: r.name.slice(0, 120), region: str(r.region, 40), state: r.state as BrokerRow["state"],
    match: typeof r.match === "string" && MATCHES.includes(r.match) ? (r.match as BrokerRow["match"]) : null, is_guess: r.is_guess === true,
    confidence: conf, confidenceWord: conf ? str(r.confidence_word, 20) : null, confidenceLevel: conf ? LEVEL[conf] : 0,
    text: r.text.slice(0, 400), checkedOn: str(r.checked_on, 10), evidenceUrl: https(r.evidence_url),
    also: Array.isArray(r.also) ? (r.also as Record<string, unknown>[]).slice(0, 3).flatMap((a) => (a && typeof a.state === "string" ? [{ state: a.state, evidenceUrl: https(a.evidence_url) }] : [])) : [],
    guide: slug ? { slug, timeNeeded: str(g!.timeNeeded, 60) } : null, noGuideText: str(r.no_guide_text, 400),
  }];
};
/** Only a well-formed panel is kept. The panel is the Worker's own wording; this page adds none of its own. */
export function readBrokerPanel(raw: unknown): BrokerPanel | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.rows) || typeof p.intro !== "string") return null;
  const rows = (p.rows as Record<string, unknown>[]).flatMap(readRow);
  if (!rows.length) return null;
  const others = Array.isArray(p.others) ? (p.others as Record<string, unknown>[]).flatMap(readRow) : [];
  return { pending: p.pending === true, pasteAvailable: p.paste_available !== false, intro: p.intro.slice(0, 500), rows, others, regionNote: str(p.region_note, 600) ?? "", coverageNote: str(p.coverage_note, 300) ?? "" };
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
