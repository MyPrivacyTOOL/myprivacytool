import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPrivacyExtensions } from "./fingerprintDetection";

// MPC-7350: the ad-blocker check must not contact any third party before the visitor has consented.
describe("detectPrivacyExtensions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes no network request, in particular none to google-analytics.com", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(""));
    vi.stubGlobal("fetch", fetchSpy);

    await detectPrivacyExtensions();

    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((u) => u.includes("google-analytics.com"))).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removes its bait element from the page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await detectPrivacyExtensions();
    expect(document.querySelector(".adsbox")).toBeNull();
  });
});
