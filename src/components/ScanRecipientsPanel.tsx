import { useEffect, useMemo, useState } from "react";
import { recipientByKey } from "@/config/recipients";
import { recipientFetch } from "@/lib/recipientClient";
import { browserRecipientLog, onRecipientLog, recordSkipped } from "@/lib/recipientLog";
import { hasConsent, onConsentChange } from "@/lib/cookieConsent";
import { SCAN_API_URL, getScanNumber } from "@/lib/webScan";
import type { RecipientLogEntry } from "../../shared/recipients/outbound";
import { RTL_LOCALES, describeEntry, statusChip, statusLabel, t, toLocale, type Locale, type StatusChip } from "../../shared/recipients/disclosure";

// MPC-9893 (Open Tracker design 1.6): "Who saw what during this scan, and why".
// One row per thing that actually happened, oldest first: the browser's own records for this visit plus, for a saved scan, the rows our Workers wrote to
// scan_recipient_log. Rows come from what ran (or was refused or skipped), never from what the registry merely allows. The words come from
// renderDisclosure's building block describeEntry, the same function /what-we-see uses, so the two views cannot disagree.

/** Analytics recipients that only run on the visitor's analytics choice. When that choice is off, recording the skip is the honest answer to "did Google see this?". */
const ANALYTICS_KEYS = ["ga4", "cloudflare-web-analytics"] as const;
export function noteAnalyticsSkips(consented: boolean = hasConsent()): void {
  if (consented) return;
  for (const key of ANALYTICS_KEYS) {
    const r = recipientByKey(key);
    if (r?.enabled) recordSkipped(key, []);   // nothing was sent: the row shows "—" under data received
  }
}

export interface PanelRow {
  record: RecipientLogEntry;
  chip: StatusChip;
  /** How many identical records (same recipient, same status, same data names) this row stands for; the first one's time is shown. */
  count: number;
}

/** Browser and server records merged oldest first. Same key, time and status twice (a record seen by both halves) is shown once. */
export function mergeRecords(browser: readonly RecipientLogEntry[], server: readonly RecipientLogEntry[]): PanelRow[] {
  const seen = new Set<string>();
  const all = [...browser, ...server]
    .filter((r) => {
      const id = `${r.key}|${r.at}|${r.status}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const rows: PanelRow[] = [];
  const byShape = new Map<string, PanelRow>();
  for (const record of all) {
    const shape = `${record.key}|${record.status}|${record.code ?? ""}|${[...record.items].sort().join(",")}`;
    const hit = byShape.get(shape);
    if (hit) { hit.count += 1; continue; }
    const row: PanelRow = { record, chip: statusChip(record.status), count: 1 };
    byShape.set(shape, row);
    rows.push(row);
  }
  return rows;
}

const CHIP_CLASS: Record<StatusChip, string> = {
  ran: "border-emerald-500/40 bg-emerald-500/10 text-foreground",
  skipped_country: "border-amber-500/40 bg-amber-500/10 text-foreground",
  skipped_disabled: "border-surface-border bg-muted text-muted-foreground",
  failed: "border-red-500/40 bg-red-500/10 text-foreground",
};

async function readServerRecords(scanNumber: string): Promise<RecipientLogEntry[]> {
  const base = SCAN_API_URL.replace(/\/$/, "");
  if (!base) return [];
  try {
    const res = await recipientFetch("scan-report", `${base}/api/scan/recipients?scan_number=${encodeURIComponent(scanNumber)}`, undefined, [], { silent: true });
    if (!res.ok) return [];
    const body = (await res.json()) as { records?: RecipientLogEntry[] };
    return Array.isArray(body.records) ? body.records.filter((r) => r && typeof r.key === "string" && typeof r.at === "string") : [];
  } catch {
    return [];   // the panel still shows this visit's own records; a missing server half is never an error on the result screen
  }
}

export interface ScanRecipientsPanelProps {
  /** The scan number of the saved scan, when there is one. Defaults to the one kept on this device. */
  scanNumber?: string | null;
  locale?: Locale;
}

export default function ScanRecipientsPanel({ scanNumber, locale }: ScanRecipientsPanelProps) {
  const loc: Locale = locale ?? toLocale(typeof navigator !== "undefined" ? navigator.language : "en");
  const number = scanNumber === undefined ? getScanNumber() : scanNumber;
  const [browser, setBrowser] = useState<RecipientLogEntry[]>(() => browserRecipientLog());
  const [server, setServer] = useState<RecipientLogEntry[]>([]);

  useEffect(() => {
    noteAnalyticsSkips();
    setBrowser(browserRecipientLog());
    const offLog = onRecipientLog(() => setBrowser(browserRecipientLog()));
    // The visitor changing their analytics choice while the panel is open changes what ran from now on; a skip already recorded stays true for the time it was recorded.
    const offConsent = onConsentChange(() => noteAnalyticsSkips());
    return () => { offLog(); offConsent(); };
  }, []);

  useEffect(() => {
    let live = true;
    if (!number) { setServer([]); return; }
    void readServerRecords(number).then((r) => { if (live) setServer(r); });
    return () => { live = false; };
  }, [number]);

  const rows = useMemo(() => mergeRecords(browser, server), [browser, server]);
  const dir = RTL_LOCALES.includes(loc) ? "rtl" : "ltr";

  return (
    <section className="mx-auto mt-6 w-full max-w-3xl rounded-xl border border-surface-border bg-card p-4 text-start" data-testid="scan-recipients-panel" dir={dir} aria-labelledby="scan-recipients-title">
      <h2 id="scan-recipients-title" className="text-base font-semibold text-foreground">Who saw what during this scan, and why</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every outside party this visit contacted, what it was sent, and why. <a className="underline" href="/what-we-see">See the full list of who can ever see anything</a>.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="scan-recipients-empty">Nothing outside our own site has been contacted during this visit.</p>
      ) : (
        <ol className="mt-3 space-y-3" data-testid="scan-recipients-list">
          {rows.map(({ record, chip, count }, i) => {
            const entry = recipientByKey(record.key);
            if (!entry) return null;
            const p = describeEntry(entry, loc, record.items);
            const time = new Date(record.at);
            return (
              <li key={`${record.key}-${record.at}-${i}`} className="rounded-lg border border-surface-border p-3" data-testid="scan-recipient-row" data-recipient={record.key} data-status={record.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{p.who}{count > 1 && <span className="ms-2 text-xs font-normal text-muted-foreground" data-testid="scan-recipient-count">×{count}</span>}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${CHIP_CLASS[chip]}`} data-testid="scan-recipient-chip">{statusLabel(chip, loc)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted-foreground">{t(loc, "dataItems")}</dt>
                  <dd className="text-foreground" data-testid="scan-recipient-items">{p.sees}</dd>
                  <dt className="text-muted-foreground">{t(loc, "purpose")}</dt>
                  <dd className="text-foreground">{p.why}</dd>
                  <dt className="text-muted-foreground">{t(loc, "retention")}</dt>
                  <dd className="text-foreground">{p.howLong}</dd>
                  <dt className="text-muted-foreground">{t(loc, "time")}</dt>
                  <dd className="text-foreground"><time dateTime={record.at}>{Number.isNaN(time.getTime()) ? record.at : time.toLocaleTimeString()}</time></dd>
                </dl>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Deleting your saved scan deletes the saved rows. This visit's own list is kept only in this tab and goes when you close it.</p>
    </section>
  );
}
