// MPC-9893: the per-scan "who saw what during this scan, and why" panel renders what ran, not what the registry allows.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within, waitFor, act } from "@testing-library/react";
import { renderPage } from "@/test/render";
import ScanRecipientsPanel, { mergeRecords, noteAnalyticsSkips } from "./ScanRecipientsPanel";
import { recordRecipient, resetRecipientLogForTests } from "@/lib/recipientLog";
import type { RecipientLogEntry } from "../../shared/recipients/outbound";

const SCAN = "3f2b6c1e-8d4a-4e9b-9c11-7a5d2e0f4b10";
const at = (s: number) => new Date(Date.UTC(2026, 10, 9, 10, 0, s)).toISOString();

beforeEach(() => { resetRecipientLogForTests(); localStorage.clear(); vi.restoreAllMocks(); });

describe("mergeRecords", () => {
  it("merges browser and server records oldest first and shows a record seen by both halves once", () => {
    const a: RecipientLogEntry = { key: "ga4", items: [], at: at(3), status: "skipped_disabled" };
    const b: RecipientLogEntry = { key: "supabase", items: ["email"], at: at(1), status: "ran" };
    const rows = mergeRecords([a, b], [b]);
    expect(rows.map((r) => r.record.key)).toEqual(["supabase", "ga4"]);
  });
  it("collapses identical records into one row with a count, keeping the first time", () => {
    const stun = (sec: number): RecipientLogEntry => ({ key: "google-stun", items: ["ip"], at: at(sec), status: "ran" });
    const rows = mergeRecords([stun(1), stun(2), stun(3), { key: "google-stun", items: ["ip"], at: at(4), status: "failed" }], []);
    expect(rows.map((r) => [r.record.status, r.count, r.record.at])).toEqual([["ran", 3, at(1)], ["failed", 1, at(4)]]);
  });
  it("maps a refused call to the failed chip", () => {
    expect(mergeRecords([{ key: "hibp", items: [], at: at(1), status: "refused", code: "CONSENT_REQUIRED" }], [])[0].chip).toBe("failed");
  });
});

describe("<ScanRecipientsPanel />", () => {
  it("says so plainly when nothing outside our own site was contacted", () => {
    localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: true, at: at(0) }));
    renderPage(<ScanRecipientsPanel scanNumber={null} locale="en" />);
    expect(screen.getByTestId("scan-recipients-empty")).toBeInTheDocument();
  });

  it("shows a scan with analytics off as skipped: Google Analytics and the Cloudflare beacon each get a 'not enabled' row and no data items", () => {
    renderPage(<ScanRecipientsPanel scanNumber={null} locale="en" />);
    const rows = screen.getAllByTestId("scan-recipient-row");
    for (const key of ["ga4", "cloudflare-web-analytics"]) {
      const row = rows.find((r) => r.getAttribute("data-recipient") === key)!;
      expect(row, key).toBeTruthy();
      expect(within(row).getByTestId("scan-recipient-chip").textContent).toBe("Skipped: not enabled");
      expect(within(row).getByTestId("scan-recipient-items").textContent).toBe("—");
    }
  });

  it("does not record a skip when the visitor chose analytics, so a call that ran is the only row", () => {
    localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: true, at: at(0) }));
    noteAnalyticsSkips();
    recordRecipient({ key: "ga4", items: ["device_profile", "utm"], at: at(2), status: "ran" });
    renderPage(<ScanRecipientsPanel scanNumber={null} locale="en" />);
    const rows = screen.getAllByTestId("scan-recipient-row").filter((r) => r.getAttribute("data-recipient") === "ga4");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["ran"]);   // no "skipped" row beside the one that ran
  });

  it("shows item names, purpose and retention for a call that ran, and updates when a new record arrives", async () => {
    localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: true, at: at(0) }));
    renderPage(<ScanRecipientsPanel scanNumber={null} locale="en" />);
    act(() => recordRecipient({ key: "google-stun", items: ["ip"], at: at(5), status: "ran" }));
    const row = await screen.findByTestId("scan-recipient-row");
    expect(within(row).getByTestId("scan-recipient-chip").textContent).toBe("Ran");
    expect(within(row).getByTestId("scan-recipient-items").textContent).toBe("your IP address");
  });

  it("adds the saved rows our Workers wrote for the scan number, without listing its own read", async () => {
    localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: true, at: at(0) }));
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain(`/api/scan/recipients?scan_number=${SCAN}`);
      return new Response(JSON.stringify({ scan_number: SCAN, records: [{ key: "resend", items: ["email"], at: at(9), status: "ran", http_status: 200 }, { key: "hibp", items: [], at: at(8), status: "skipped_disabled", code: "DISABLED" }] }), { status: 200 });
    });
    const real = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    try {
      renderPage(<ScanRecipientsPanel scanNumber={SCAN} locale="de" />);
      await waitFor(() => expect(screen.getAllByTestId("scan-recipient-row").map((r) => r.getAttribute("data-recipient"))).toEqual(expect.arrayContaining(["hibp", "resend"])));
      const rows = screen.getAllByTestId("scan-recipient-row");
      const resend = rows.find((r) => r.getAttribute("data-recipient") === "resend")!;
      expect(within(resend).getByTestId("scan-recipient-chip").textContent).toBe("Ausgeführt");
      expect(rows.some((r) => r.getAttribute("data-recipient") === "scan-report")).toBe(false);
    } finally { globalThis.fetch = real; }
  });
});
