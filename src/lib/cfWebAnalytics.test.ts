import { describe, it, expect } from "vitest";
import { loadCfWebAnalytics } from "./cfWebAnalytics";

describe("loadCfWebAnalytics", () => {
  it("does nothing without a token", () => {
    expect(loadCfWebAnalytics(undefined)).toBe(false);
    expect(loadCfWebAnalytics("  ")).toBe(false);
    expect(document.querySelector("script[data-cf-beacon]")).toBeNull();
  });
  it("injects the beacon once when a token is set", () => {
    expect(loadCfWebAnalytics("tok123")).toBe(true);
    expect(loadCfWebAnalytics("tok123")).toBe(false);
    const s = document.querySelectorAll("script[data-cf-beacon]");
    expect(s).toHaveLength(1);
    expect(JSON.parse(s[0].getAttribute("data-cf-beacon")!)).toEqual({ token: "tok123" });
  });
});
