// MPC-9813: the confirm gate and the "Listings you showed us" block on the live panel. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LiveScanPanel from "./LiveScanPanel";
import { readListings } from "@/lib/liveScan";
import { hasListingFields, emptyListingFields, listingPayload, listingProblem } from "@/lib/listingFields";

const snap = (extra: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ items: [], done: true, report_sent: false, verified: true, ...extra }) }) as unknown as Response;
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const row = (state: string, extra: Record<string, unknown> = {}) => ({ key: "spokeo", name: "Spokeo", state, match: null, is_guess: false, not_checked_reason: null, note: null, evidence_url: "https://www.spokeo.com/p/1", guide: { slug: "spokeo", name: "Spokeo", optOutUrl: "https://www.spokeo.com/optout" }, ...extra });

describe("confirm gate on the live panel", () => {
  it("email-link view: shows the honest sentence and a button; pressing it POSTs the key in a header, then shows the listings", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let confirmed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/scan/confirm")) { confirmed = true; return { ok: true, status: 200, json: async () => ({ confirmed: true }) } as unknown as Response; }
      return confirmed ? snap({ confirm_required: true, confirmed: true, listings: { pending: false, items: [row("listed", { match: "exact" })] } }) : snap({ confirm_required: true, confirmed: false });
    }));
    render(<MemoryRouter><LiveScanPanel token="a.1.sig" kind="verified" /></MemoryRouter>);
    await advance(1100);
    expect(screen.getByTestId("confirm-box").textContent).toContain("We only check details you've confirmed are yours.");
    expect(screen.queryByTestId("listings-block")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /yes, this is my email/i })); });
    const post = calls.find((c) => c.url.endsWith("/api/scan/confirm"))!;
    expect(post.init?.method).toBe("POST");
    expect((post.init?.headers as Record<string, string>).Authorization).toBe("Bearer a.1.sig");
    expect(post.url).not.toContain("a.1.sig");
    await advance(1500);
    expect(screen.getByTestId("listings-block").textContent).toMatch(/Listed: a match for the details you gave/);
    expect(screen.getByRole("link", { name: "The page" }).getAttribute("href")).toBe("https://www.spokeo.com/p/1");
    expect(screen.getByRole("link", { name: /how to remove it/i }).getAttribute("href")).toBe("/opt-out-guides/spokeo");
  });
  it("request view: no button, only the sentence; no listings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => snap({ verified: false, confirm_required: true, confirmed: false })));
    render(<MemoryRouter><LiveScanPanel token="t.1.sig" /></MemoryRouter>);
    await advance(1100);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("confirm-note").textContent).toContain("confirmed are yours");
  });
  it("a blocked page reads as not checked, never as not listed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => snap({ confirm_required: true, confirmed: true, listings: { pending: false, items: [row("not_checked", { not_checked_reason: "fetch_blocked" })] } })));
    render(<MemoryRouter><LiveScanPanel token="a.1.sig" kind="verified" /></MemoryRouter>);
    await advance(1100);
    const t = screen.getByTestId("listings-block").textContent ?? "";
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
