// MPC-8452: the live results under the thank-you: items appear as the Worker finishes them, only redacted facts are shown, polling stops when done,
// when the key is refused, and while the tab is hidden; a result is never taken away.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import LiveScanPanel from "./LiveScanPanel";

const snap = (items: unknown[], done = false) => ({ ok: true, status: 200, json: async () => ({ items, done, report_sent: false }) }) as unknown as Response;
const NAME = { id: "email-name", label: "Name in your address", status: "found" };
const PROV = { id: "email-provider", label: "Mail provider and domain", status: "clear" };
const PROF = { id: "email-profile", label: "Public profile or avatar", status: "not_checked" };

let calls: string[];
beforeEach(() => { vi.useFakeTimers(); calls = []; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const stubFetch = (...responses: (Response | (() => Response))[]) => {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); const r = responses[Math.min(i++, responses.length - 1)]; return typeof r === "function" ? r() : r; }));
};
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("LiveScanPanel", () => {
  it("shows Alice, then each result as it lands, and stops polling once everything is in", async () => {
    stubFetch(snap([]), snap([NAME]), snap([NAME, PROV, PROF], true));
    render(<LiveScanPanel token="tok.1.sig" />);
    expect(screen.getByAltText(/Alice drawing back a curtain/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/having a look/);
    await advance(1100);
    expect(screen.queryByText("Name in your address")).toBeNull();
    await advance(3000);
    expect(screen.getByText("Name in your address")).toBeTruthy();
    expect(screen.getByText("Found something")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/found something/i);
    await advance(3000);
    expect(screen.getByText("Nothing seen in the places we looked")).toBeTruthy();
    expect(screen.getByText("Could not check this one")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/fuller report is on its way/);
    const n = calls.length;
    await advance(30000);
    expect(calls.length).toBe(n);
    expect(calls[0]).toContain("/api/scan/live?t=tok.1.sig");
  });

  it("never takes a result away if a later read comes back shorter", async () => {
    stubFetch(snap([NAME, PROV]), snap([NAME]), snap([NAME]));
    render(<LiveScanPanel token="t" />);
    await advance(1100);
    expect(screen.getByText("Mail provider and domain")).toBeTruthy();
    await advance(6000);
    expect(screen.getByText("Mail provider and domain")).toBeTruthy();
  });

  it("stops when the key is refused (expired or forged)", async () => {
    stubFetch({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    render(<LiveScanPanel token="t" />);
    await advance(1100);
    const n = calls.length;
    await advance(30000);
    expect(calls.length).toBe(n);
  });

  it("keeps trying through a network error or a busy server", async () => {
    stubFetch(() => { throw new TypeError("Failed to fetch"); }, { ok: false, status: 500, json: async () => ({}) } as unknown as Response, snap([NAME]));
    render(<LiveScanPanel token="t" />);
    await advance(1100 + 3000 + 3000);
    expect(screen.getByText("Name in your address")).toBeTruthy();
  });

  it("asks nothing while the tab is hidden", async () => {
    stubFetch(snap([NAME]));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    render(<LiveScanPanel token="t" />);
    await advance(10000);
    expect(calls.length).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await advance(3100);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("ignores malformed items and shows no values", async () => {
    stubFetch(snap([NAME, { id: 5 }, { id: "x", label: "y", status: "weird" }, { ...PROV, value: "secret@x.com", details: "private" }]));
    render(<LiveScanPanel token="t" />);
    await advance(1100);
    expect(screen.getByText("Name in your address")).toBeTruthy();
    expect(screen.getByText("Mail provider and domain")).toBeTruthy();
    expect(screen.queryByText(/secret@x.com|private/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
