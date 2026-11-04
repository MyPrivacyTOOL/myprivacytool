import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDeviceData, estimateDemographic, type DeviceData } from "./deviceDetection";

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

describe('estimateDemographic', () => {
  const at = (hour: number, os: string, browser = 'Chrome', type: 'Desktop' | 'Mobile' = 'Desktop') => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, hour, 0, 0));
    try { return estimateDemographic({ device: { os, browser, type } } as unknown as DeviceData); } finally { vi.useRealTimers(); }
  };
  it('calls only Android in the small hours a Young Adult (the late-night rule used to match any OS before 07:00)', () => {
    expect(at(23, 'Android 14', 'Chrome', 'Mobile')).toBe('Young Adult (18-30)');
    expect(at(3, 'Android 14', 'Chrome', 'Mobile')).toBe('Young Adult (18-30)');
    expect(at(3, 'Windows 11')).toBe('Adult (30-55)');
    expect(at(3, 'macOS 14')).toBe('Professional (25-50)');
    expect(at(3, 'Linux')).toBe('Adult (25-55)');
  });
  it('keeps the daytime answers', () => {
    expect(at(14, 'Android 14', 'Chrome', 'Mobile')).toBe('Adult (25-55)');
    expect(at(3, 'iOS 17', 'Safari', 'Mobile')).toBe('Adult (25-45)');
  });
});
