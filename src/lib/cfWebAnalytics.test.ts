import { describe, it, expect } from "vitest";
import { loadCfWebAnalytics, loadCfWebAnalyticsWhenConsented } from "./cfWebAnalytics";

describe("loadCfWebAnalytics", () => {
  it("does nothing without a token", () => {
    expect(loadCfWebAnalytics(undefined)).toBe(false);
    expect(loadCfWebAnalytics("  ")).toBe(false);
    expect(document.querySelector("script[data-cf-beacon]")).toBeNull();
  });
  it("injects the beacon once when a token is set", async () => {
    expect(loadCfWebAnalytics("tok123")).toBe(true);
    expect(loadCfWebAnalytics("tok123")).toBe(false); // second call in the gap before the wrapper adds the tag (MPC-9886)
    await new Promise((r) => setTimeout(r, 0));
    const s = document.querySelectorAll("script[data-cf-beacon]");
    expect(s).toHaveLength(1);
    expect(JSON.parse(s[0].getAttribute("data-cf-beacon")!)).toEqual({ token: "tok123" });
  });
});

describe("loadCfWebAnalyticsWhenConsented (MPC-9057)", () => {
  const harness = (initial: boolean) => {
    let consent = initial;
    let listener: (() => void) | null = null;
    let loads = 0;
    const stop = loadCfWebAnalyticsWhenConsented(
      () => (loads++, true),
      () => consent,
      (cb) => ((listener = cb), () => (listener = null)),
    );
    return { stop, loads: () => loads, choose: (v: boolean) => ((consent = v), listener?.()) };
  };
  it("makes no load before the visitor chooses", () => {
    expect(harness(false).loads()).toBe(0);
  });
  it("makes no load when the visitor declines", () => {
    const h = harness(false);
    h.choose(false);
    expect(h.loads()).toBe(0);
  });
  it("loads exactly once at the moment the visitor accepts", () => {
    const h = harness(false);
    h.choose(true);
    expect(h.loads()).toBe(1);
  });
  it("loads at once for a visitor who already accepted on an earlier visit", () => {
    expect(harness(true).loads()).toBe(1);
  });
  it("returns an unsubscribe function", () => {
    const h = harness(false);
    h.stop();
    h.choose(true);
    expect(h.loads()).toBe(0);
  });
});
