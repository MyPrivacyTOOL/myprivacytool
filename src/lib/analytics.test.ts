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
