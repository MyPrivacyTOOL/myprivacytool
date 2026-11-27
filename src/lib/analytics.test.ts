import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let gtag: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  gtag = vi.fn();
  window.gtag = gtag;
});
afterEach(() => {
  delete window.gtag;
});

describe("scan_started (MPC-7376)", () => {
  it("fires once per page session", async () => {
    const { trackScanStarted } = await import("./analytics");
    trackScanStarted();
    trackScanStarted();
    const calls = gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === "scan_started");
    expect(calls).toHaveLength(1);
  });
});

describe("funnel_step numbering (MPC-7376)", () => {
  it("keeps the historical numbers and numbers the wave steps", async () => {
    const { trackFunnelStep } = await import("./analytics");
    const num = (step: string) => {
      gtag.mockClear();
      trackFunnelStep(step);
      return (gtag.mock.calls[0][2] as { step_number: number }).step_number;
    };
    expect(num("page_load")).toBe(1);
    expect(num("deep_scan_triggered")).toBe(6);
    expect(num("all_hexagons_confirmed")).toBe(7);
    for (const s of ["language", "orientation", "fingerprint", "advanced_fingerprint", "storage", "social", "security", "behavior"]) {
      expect(num(`${s}_scan_triggered`)).toBeGreaterThan(8);
    }
  });
});

describe("report_requested (MPC-7470)", () => {
  it("fires once per request with only non-personal values, and reaches nothing without gtag (analytics consent)", async () => {
    const { trackReportRequested } = await import("./analytics");
    trackReportRequested("scan_page", true);
    const calls = gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === "report_requested");
    expect(calls).toHaveLength(1);
    const params = calls[0][2] as Record<string, unknown>;
    expect(params).toMatchObject({ source: "scan_page", scan_save_ticked: true });
    for (const v of Object.values(params)) expect(String(v)).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i); // no email, no scan number
    delete window.gtag;
    expect(() => trackReportRequested("web_scan_summary", false)).not.toThrow();
  });
});


// MPC-10790 (decision A): the device profile (city, country, ISP) is the one event with place and network values. It reaches GA4 only when the analytics choice
// AND the scan consent (the Scan me click) both exist; before that nothing is called, so nothing can be queued and flushed later.
describe("device_profile (MPC-10790)", () => {
  const profile = {
    device: { type: "phone", os: "iOS", browser: "Safari" },
    location: { city: "Hong Kong", country: "HK" },
    network: { isp: "ExampleNet" },
    screen: { resolution: "390x844" },
    session: { timezone: "Asia/Hong_Kong" },
    privacy: { doNotTrack: false },
  };
  const choose = (analytics: boolean) => window.localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics, at: "2026-11-24T00:00:00.000Z" }));
  afterEach(() => { window.localStorage.removeItem("mpt_cookie_consent"); window.sessionStorage.removeItem("mpt_scan_consent"); });

  it("sends nothing on 'Accept analytics' alone", async () => {
    choose(true);
    const { trackDeviceProfile } = await import("./analytics");
    const scan = await import("./scanConsent");
    scan.__resetScanConsentForTests();
    trackDeviceProfile(profile);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends nothing on the scan consent alone", async () => {
    const { trackDeviceProfile } = await import("./analytics");
    const scan = await import("./scanConsent");
    scan.__seedScanConsentForTests();
    trackDeviceProfile(profile);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends it once both exist", async () => {
    choose(true);
    const { trackDeviceProfile } = await import("./analytics");
    const scan = await import("./scanConsent");
    scan.__seedScanConsentForTests();
    trackDeviceProfile(profile);
    expect(gtag).toHaveBeenCalledWith("event", "device_profile", expect.objectContaining({ location_city: "Hong Kong", isp: "ExampleNet" }));
  });
});
