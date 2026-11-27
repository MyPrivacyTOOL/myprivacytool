import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { setChoice } from "./cookieConsent";
import { __resetScanConsentForTests, __seedScanConsentForTests } from "./scanConsent";
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

// MPC-10790 (decision A): with the real consent sources (no injected harness), "Accept analytics" alone loads nothing; the beacon loads at the Scan me click.
describe("loadCfWebAnalyticsWhenConsented with the real consents (MPC-10790)", () => {
  beforeEach(() => { __resetScanConsentForTests(); }); // src/test/setup.ts seeds a scan consent before every test; these start without one
  afterEach(() => { window.localStorage.removeItem("mpt_cookie_consent"); __resetScanConsentForTests(); });
  it("Accept analytics alone: no load; then Scan me: one load", () => {
    let loads = 0;
    const stop = loadCfWebAnalyticsWhenConsented(() => (loads++, true));
    setChoice(true);
    expect(loads).toBe(0);
    __seedScanConsentForTests();
    window.dispatchEvent(new Event("mpt:scan-consent"));
    expect(loads).toBe(1);
    stop();
  });
  it("Scan me alone (analytics declined): no load", () => {
    let loads = 0;
    const stop = loadCfWebAnalyticsWhenConsented(() => (loads++, true));
    setChoice(false);
    __seedScanConsentForTests();
    window.dispatchEvent(new Event("mpt:scan-consent"));
    expect(loads).toBe(0);
    stop();
  });
  it("both already held on arrival: loads at once", () => {
    setChoice(true);
    __seedScanConsentForTests();
    let loads = 0;
    loadCfWebAnalyticsWhenConsented(() => (loads++, true))();
    expect(loads).toBe(1);
  });
});
