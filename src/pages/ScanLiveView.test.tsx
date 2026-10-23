// MPC-8452: the page behind the email button. The key comes from the URL fragment, is read once and removed from the address bar,
// and with it the panel shows the detail; without it the page explains what to do and asks nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, jsonResponse } from "@/test/render";
import ScanLiveView from "./ScanLiveView";
import { readVerifyKey } from "@/lib/liveScan";

const KEY = "0eb12fbe-bf51-4186-9c12-0449fa526322.1800000000000.abcDEF_-123";
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("readVerifyKey", () => {
  it("reads v= from the fragment and rejects anything that is not a plausible key", () => {
    expect(readVerifyKey(`#v=${KEY}`)).toBe(KEY);
    expect(readVerifyKey(`#x=1&v=${KEY}`)).toBe(KEY);
    for (const bad of ["", "#", "#v=", "#v=short", "#v=<script>alert(1)</script>", `#v=${"a".repeat(300)}`, `#w=${KEY}`]) expect(readVerifyKey(bad)).toBe("");
  });
});

describe("ScanLiveView", () => {
  it("shows the detail for a visitor with the email key, sends it as a Bearer header, and removes it from the address bar", async () => {
    const f = vi.fn(async () => jsonResponse({ items: [{ id: "email-profile", label: "Public profile or avatar", status: "found", value: "https://gravatar.com/someone" }], done: false, report_sent: false, verified: true }));
    vi.stubGlobal("fetch", f);
    window.history.replaceState(null, "", `/scan/live#v=${KEY}`);
    renderPage(<ScanLiveView />, "/scan/live");
    expect(await screen.findByText("https://gravatar.com/someone", undefined, { timeout: 4000 })).toBeTruthy();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/scan\/live$/);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(KEY);
  });

  it("without a key it explains and asks nothing", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    renderPage(<ScanLiveView />, "/scan/live");
    expect(screen.getByText(/Open the button in your email/)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).not.toHaveBeenCalled();
  });

  it("an expired link says so and stops", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    window.history.replaceState(null, "", `/scan/live#v=${KEY}`);
    renderPage(<ScanLiveView />, "/scan/live");
    expect(await screen.findByText(/This link has expired/, undefined, { timeout: 4000 })).toBeTruthy();
    const n = f.mock.calls.length;
    await vi.advanceTimersByTimeAsync(40000);
    expect(f.mock.calls.length).toBe(n);
  });
});
