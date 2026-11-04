import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HK_OVERRIDE_KEY,
  hasHongKongOverride,
  isHongKongVisitor,
  resetHkGeoCache,
  setHongKongOverride,
} from "./hkVisitor";

describe("isHongKongVisitor", () => {
  beforeEach(() => {
    localStorage.clear();
    resetHkGeoCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (body: unknown, ok = true) => {
    const f = vi.fn().mockResolvedValue({ ok, json: async () => body });
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("true for a Hong Kong IP", async () => {
    stubFetch({ country: "HK" });
    expect(await isHongKongVisitor()).toBe(true);
  });

  it("false for another country", async () => {
    stubFetch({ country: "AU" });
    expect(await isHongKongVisitor()).toBe(false);
  });

  it("override wins and skips the network", async () => {
    const f = stubFetch({ country: "AU" });
    setHongKongOverride(true);
    expect(hasHongKongOverride()).toBe(true);
    expect(localStorage.getItem(HK_OVERRIDE_KEY)).toBe("1");
    expect(await isHongKongVisitor()).toBe(true);
    expect(f).not.toHaveBeenCalled();
    setHongKongOverride(false);
    expect(hasHongKongOverride()).toBe(false);
  });

  it("fails closed on network or HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await isHongKongVisitor()).toBe(false);
    resetHkGeoCache();
    stubFetch({}, false);
    expect(await isHongKongVisitor()).toBe(false);
  });

  it("looks the country up once per page", async () => {
    const f = stubFetch({ country: "HK" });
    await isHongKongVisitor();
    await isHongKongVisitor();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
