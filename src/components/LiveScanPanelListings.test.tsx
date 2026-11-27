// MPC-9813: the confirm gate and the "Listings you showed us" block on the live panel. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LiveScanPanel from "./LiveScanPanel";
import { readListings } from "@/lib/liveScan";
import { buildBrokerPanel } from "../../workers/scan-report/lib/brokerPanel.js";
import { hasListingFields, emptyListingFields, listingPayload, listingProblem } from "@/lib/listingFields";

const snap = (extra: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ items: [], done: true, report_sent: false, verified: true, ...extra }) }) as unknown as Response;
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const panelOf = (items: unknown[], pending = false) => JSON.parse(JSON.stringify(buildBrokerPanel({ pending, items }, { pasteAvailable: true })));
const row = (state: string, extra: Record<string, unknown> = {}) => ({ key: "spokeo", name: "Spokeo", state, match: null, is_guess: false, not_checked_reason: null, note: null, evidence_url: "https://www.spokeo.com/p/1", guide: { slug: "spokeo", name: "Spokeo", optOutUrl: "https://www.spokeo.com/optout" }, ...extra });

describe("confirm gate on the live panel", () => {
  it("email-link view: shows the honest sentence and a button; pressing it POSTs the key in a header, then shows the listings", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let confirmed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/scan/confirm")) { confirmed = true; return { ok: true, status: 200, json: async () => ({ confirmed: true }) } as unknown as Response; }
      return confirmed ? snap({ confirm_required: true, confirmed: true, broker_panel: panelOf([row("listed", { match: "exact", confidence: "high", source: { checked_at: "2026-11-07T10:00:00Z" } })]) }) : snap({ confirm_required: true, confirmed: false, broker_panel: panelOf([]) });
    }));
    render(<MemoryRouter><LiveScanPanel token="a.1.sig" kind="verified" /></MemoryRouter>);
    await advance(1100);
    expect(screen.getByTestId("confirm-box").textContent).toContain("We only check details you've confirmed are yours.");
    expect(screen.getByTestId("broker-panel").querySelector('[data-broker="spokeo"]')?.getAttribute("data-state")).toBe("not_checked"); // before the click nothing was read
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /yes, this is my email/i })); });
    const post = calls.find((c) => c.url.endsWith("/api/scan/confirm"))!;
    expect(post.init?.method).toBe("POST");
    expect((post.init?.headers as Record<string, string>).Authorization).toBe("Bearer a.1.sig");
    expect(post.url).not.toContain("a.1.sig");
    await advance(1500);
    const spokeo = screen.getByTestId("broker-panel").querySelector('[data-broker="spokeo"]')!;
    expect(spokeo.getAttribute("data-state")).toBe("listed");
    expect(spokeo.textContent).toMatch(/We found a listing that matches what you told us/);
    expect(spokeo.textContent).toMatch(/Confidence: High/);
    expect(spokeo.querySelector('a[href="https://www.spokeo.com/p/1"]')?.textContent).toBe("Evidence: the page");
    expect(spokeo.querySelector('a[href="/opt-out-guides/spokeo"]')?.textContent).toMatch(/^How to remove it/);
  });
  it("request view: no button, only the sentence; the broker panel is already there, all nine not checked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => snap({ verified: false, confirm_required: true, confirmed: false, broker_panel: panelOf([]) })));
    render(<MemoryRouter><LiveScanPanel token="t.1.sig" /></MemoryRouter>);
    await advance(1100);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("confirm-note").textContent).toContain("confirmed are yours");
    const rows = screen.getByTestId("broker-panel").querySelectorAll("li");
    expect(rows).toHaveLength(9);
    expect([...rows].every((r) => r.getAttribute("data-state") === "not_checked")).toBe(true);
    expect(screen.getByTestId("broker-panel").textContent).toContain("We don't search broker sites for you. Paste a page that lists you, or paid coverage (coming) will check for you.");
  });
  it("a blocked page reads as not checked, never as not listed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => snap({ confirm_required: true, confirmed: true, broker_panel: panelOf([row("not_checked", { not_checked_reason: "fetch_blocked" })]) })));
    render(<MemoryRouter><LiveScanPanel token="a.1.sig" kind="verified" /></MemoryRouter>);
    await advance(1100);
    const t = screen.getByTestId("broker-panel").querySelector('[data-broker="spokeo"]')!.textContent ?? "";
    expect(t).toMatch(/Not checked: the site would not let us read that page/);
    expect(t).not.toMatch(/Not listed/);
  });
});

describe("readListings / listing fields", () => {
  it("drops malformed rows and non-https links", () => {
    const l = readListings({ pending: false, items: [row("listed", { evidence_url: "javascript:alert(1)" }), { state: "bogus", name: "x" }, "junk"] });
    expect(l?.items).toHaveLength(1);
    expect(l?.items[0].evidence_url).toBeNull();
  });
  it("fields are all optional, validated, and sent only when typed", () => {
    const f = emptyListingFields();
    expect(hasListingFields(f)).toBe(false);
    expect(listingPayload(f)).toBeNull();
    expect(listingProblem({ ...f, urls: ["http://x.example/p", "", ""] })).toMatch(/https/);
    expect(listingProblem({ ...f, country: "USA" })).toMatch(/two-letter/);
    expect(listingPayload({ ...f, fullName: " Zelda Quillfeather ", country: "us", urls: [" https://a.example/p ", "", ""] })).toEqual({ full_name: "Zelda Quillfeather", country: "US", urls: ["https://a.example/p"] });
  });
});
