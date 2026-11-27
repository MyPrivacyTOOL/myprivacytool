import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveChannel, safeUtmSource } from "./funnelParams";

// CK-11491: the funnel events obey the existing consent gate, carry channel + utm_source, and can carry no personal data.
const gate = vi.hoisted(() => ({ analytics: false, scan: false }));
vi.mock("./cookieConsent", async (orig) => ({ ...(await orig<typeof import("./cookieConsent")>()), hasConsent: () => gate.analytics }));
vi.mock("./scanConsent", async (orig) => ({ ...(await orig<typeof import("./scanConsent")>()), hasScanConsent: () => gate.scan }));

let gtag: ReturnType<typeof vi.fn>;
const sent = (name: string) => gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === name).map((c) => c[2]);
const FUNNEL = ["scan_start", "scan_complete", "report_view", "pricing_view", "checkout_start"];

beforeEach(() => {
  vi.resetModules();
  gate.analytics = false;
  gate.scan = false;
  gtag = vi.fn();
  window.gtag = gtag;
});
afterEach(() => {
  delete window.gtag;
  window.history.replaceState({}, "", "/");
});

describe("funnel events (CK-11491)", () => {
  const fireAll = (a: typeof import("./analytics")) => {
    a.trackScanStart("home");
    a.trackScanComplete("home");
    a.trackReportView();
    a.trackPricingView();
    a.trackCheckoutStart("pro", "waitlist");
  };

  it("sends nothing with either consent missing, and an early call does not use up the once-only send", async () => {
    const a = await import("./analytics");
    for (const [analytics, scan] of [[false, false], [true, false], [false, true]]) {
      gate.analytics = analytics;
      gate.scan = scan;
      fireAll(a);
    }
    expect(FUNNEL.flatMap(sent)).toEqual([]);
    gate.analytics = true;
    gate.scan = true;
    fireAll(a);
    for (const name of FUNNEL) expect(sent(name)).toHaveLength(1);
  });

  it("carries channel and the landing utm_source after in-app navigation", async () => {
    gate.analytics = true;
    gate.scan = true;
    const { captureAttribution } = await import("./attribution");
    captureAttribution("?utm_source=Reddit&utm_medium=social");
    window.history.replaceState({}, "", "/pricing");
    const a = await import("./analytics");
    fireAll(a);
    for (const name of FUNNEL) expect(sent(name)[0]).toMatchObject({ channel: "social", utm_source: "reddit" });
  });

  it("sends once-only events once, scan_complete once per surface, and checkout_start every time", async () => {
    gate.analytics = true;
    gate.scan = true;
    const a = await import("./analytics");
    fireAll(a);
    fireAll(a);
    a.trackScanStart("scan_page");
    a.trackScanComplete("scan_page");
    expect(sent("scan_start")).toHaveLength(1);
    expect(sent("scan_complete").map((p) => (p as { scan_surface: string }).scan_surface)).toEqual(["home", "scan_page"]);
    expect(sent("report_view")).toHaveLength(1);
    expect(sent("checkout_start")).toHaveLength(2);
  });

  it("the older events still fire and now lead into the new ones", async () => {
    gate.analytics = true;
    gate.scan = true;
    const a = await import("./analytics");
    a.trackScanStarted();
    a.trackScanCompleted(54);
    expect(sent("scan_started")).toHaveLength(1);
    expect(sent("privacy_scan_completed")).toHaveLength(1);
    expect(sent("scan_start")).toHaveLength(1);
    expect(sent("scan_complete")).toHaveLength(1);
  });

  it("never passes an address, a phone number or free text through utm_source", async () => {
    gate.analytics = true;
    gate.scan = true;
    window.history.replaceState({}, "", "/scan?utm_source=ada%40example.com");
    const a = await import("./analytics");
    a.trackScanStart("scan_page");
    expect(sent("scan_start")[0]).toEqual({ channel: "campaign", utm_source: "invalid", scan_surface: "scan_page" });
    for (const bad of ["ada@example.com", "85291234567", "tel-85291234567", "John Smith", "x".repeat(41)]) expect(safeUtmSource(bad)).toBe("invalid");
    expect(safeUtmSource(undefined)).toBe("(none)");
    expect(safeUtmSource("HK_spam.v2")).toBe("hk_spam.v2");
  });

  it("derives the channel from the medium, then the source, then the referrer", () => {
    const c = (utm: Record<string, string>, ref = "") => deriveChannel(utm, ref, "www.myprivacytool.io");
    expect(c({ utm_medium: "cpc", utm_source: "google" })).toBe("paid");
    expect(c({ utm_medium: "email" })).toBe("email");
    expect(c({ utm_medium: "channel_osint", utm_source: "telegram" })).toBe("bot");
    expect(c({ utm_source: "twitter" })).toBe("social");
    expect(c({ utm_source: "partner-list" })).toBe("campaign");
    expect(c({}, "https://www.google.co.uk/search?q=x")).toBe("organic_search");
    expect(c({}, "https://t.co/abc")).toBe("social");
    expect(c({}, "https://example.org/post")).toBe("referral");
    expect(c({}, "https://myprivacytool.io/blog")).toBe("direct");
    expect(c({}, "not a url")).toBe("direct");
    expect(c({})).toBe("direct");
  });
});
