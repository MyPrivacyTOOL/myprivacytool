// MPC-9893 (Open Tracker design 1.3 / 1.6): the browser-side half of "who saw what during this scan". Every call the SITE makes through the recipient
// wrapper logs {key, items, at, status} here (item NAMES only, never a value, a URL or a header). The per-scan panel merges these with the Worker's
// scan_recipient_log rows, so a script the browser loaded or a lookup it made shows up beside the ones our servers made.
//
// Memory only, on purpose: the records describe this visit, belong to this tab and go when it closes. Nothing here is sent anywhere, stored in
// localStorage or put in a cookie. "Deleting the scan deletes the rows" holds for the browser half by construction (reload = gone) and for the server
// half through the web_scans delete trigger (migration 20261109000000_mpc_9893_recipient_log_follows_scan.sql).
import type { RecipientLogEntry } from "../../shared/recipients/outbound";
import type { DataItem } from "../../shared/recipients/registry";

const CAP = 200;   // a runaway loop must not grow memory without bound; the newest records are the useful ones
const EVENT = "mpt:recipient-log";
// Two bundles load this module on one page (the React app and the classic-script client public/recipient-client.min.js that index.html uses for the
// Google tag), each with its own copy. The records therefore live on one shared holder, so a call made through either one reaches the same panel.
type Holder = { entries: RecipientLogEntry[] };
const holder = (): Holder => {
  const g = globalThis as unknown as { __mptRecipientLog?: Holder };
  return (g.__mptRecipientLog ??= { entries: [] });
};

/** The sink handed to the wrapper as `ctx.log`. Never throws: the log never breaks or changes the call it describes. */
export function recordRecipient(entry: RecipientLogEntry): void {
  try {
    const h = holder();
    h.entries = [...h.entries, { key: entry.key, items: [...entry.items], at: entry.at, status: entry.status, ...(entry.http_status !== undefined ? { http_status: entry.http_status } : {}), ...(entry.code ? { code: entry.code } : {}) }].slice(-CAP);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
  } catch {
    /* swallow: see above */
  }
}

/**
 * Records that a recipient was NOT contacted because the visitor's own choice or a switch kept it off (for example Google Analytics without the analytics
 * choice). This is a fact about this visit, so it belongs on the panel as "Skipped: not enabled"; it is recorded once per key.
 */
export function recordSkipped(key: string, items: readonly DataItem[]): void {
  if (holder().entries.some((e) => e.key === key && e.status === "skipped_disabled")) return;
  recordRecipient({ key, items: [...items], at: new Date().toISOString(), status: "skipped_disabled", code: "DISABLED" });
}

/** A copy of everything recorded so far in this tab, oldest first. */
export const browserRecipientLog = (): RecipientLogEntry[] => holder().entries.slice();

/** Calls `cb` whenever a record is added. Returns an unsubscribe function. */
export function onRecipientLog(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Tests only. */
export function resetRecipientLogForTests(): void {
  holder().entries = [];
}
