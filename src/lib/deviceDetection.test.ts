import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDeviceData } from "./deviceDetection";

// MPC-7350: the IP and location lookup goes to our own Worker, never to third-party lookup services.
describe("captureDeviceData IP and location lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks only our own /whoami endpoint and maps its fields", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ip: "203.0.113.7", city: "London", region: "England", country_name: "United Kingdom",
        latitude: 51.5, longitude: -0.12, org: "Example ISP",
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const data = await captureDeviceData();

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/whoami$/);
    expect(urls.join(" ")).not.toMatch(/ipify|ipapi/);
    expect(data.ip).toBe("203.0.113.7");
    expect(data.location).toMatchObject({ city: "London", region: "England", country: "United Kingdom" });
    expect(data.network.isp).toBe("Example ISP");
  });

  it("falls back to Unknown values when the endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const data = await captureDeviceData();
    expect(data.ip).toBe("Unknown");
    expect(data.location.city).toBe("Unknown");
    expect(data.network.isp).toBe("Unknown ISP");
  });
});
