// MPC-7535: what the built site SENDS must be what the Worker ACCEPTS, field by field. The request body is captured from the real
// requestScanReport() and run through the Worker's own validators (workers/scan-report), for every combination of tick boxes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestScanReport, ReportRequestError } from "./scanReport";
import { rememberCompletedScan, resolveScanApiUrl, DEFAULT_SCAN_API_URL } from "./webScan";
import { parseSaveRequest } from "../../workers/scan-report/lib/webScan.js";
import type { HexagonData } from "./deviceDetection";

const hex = (): HexagonData[] =>
  [0, 1, 2].map((i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;   // same pattern as the Worker

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function sentBody(save: boolean, recognise: boolean) {
  const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as unknown as Response);
  vi.stubGlobal("fetch", f);
  await requestScanReport("mpc7535+contract@example.com", save, recognise);
  expect(f).toHaveBeenCalledTimes(1);
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`${DEFAULT_SCAN_API_URL}/api/scan`);
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("the site's POST /api/scan body is accepted by the Worker's validators", () => {
  it("email only (save box unticked or not shown)", async () => {
    const b = await sentBody(false, false);
    expect(EMAIL_RE.test(String(b.email))).toBe(true);
    expect(b.consent).toBe(true);
    expect(parseSaveRequest(b)).toEqual({ none: true });
  });

  it("email + saved scan", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    const b = await sentBody(true, false);
    expect(b.consent).toBe(true);
    const parsed = parseSaveRequest(b) as { error?: string; hexagons?: unknown[] };
    expect(parsed.error).toBeUndefined();
    expect(parsed.hexagons).toHaveLength(3);
  });

  it("email + saved scan + recognise opt-in", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    vi.stubEnv("VITE_RECOGNITION_ENABLED", "true");
    rememberCompletedScan(hex());
    const b = await sentBody(true, true);
    expect(b.recognise_consent).toBe(true);
    expect((parseSaveRequest(b) as { error?: string }).error).toBeUndefined();
  });
});

describe("requestScanReport reports every failure (never swallows it)", () => {
  it.each([[429, "rate_limited"], [500, "server"], [503, "server"], [400, "rejected"], [403, "rejected"], [413, "rejected"]])("HTTP %i is %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response));
    await expect(requestScanReport("a+b@example.com", false, false)).rejects.toMatchObject({ kind, status });
  });
  it("a network error is a ReportRequestError with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await requestScanReport("a+b@example.com", false, false).catch((e) => e);
    expect(err).toBeInstanceOf(ReportRequestError);
    expect(err.status).toBe(0);
  });
});

describe("resolveScanApiUrl: a blank Pages variable can no longer switch the request off", () => {
  it.each([[undefined], [""], ["   "]])("%j uses the default", (raw) => expect(resolveScanApiUrl(raw)).toBe(DEFAULT_SCAN_API_URL));
  it("an override is trimmed and loses a trailing slash", () => expect(resolveScanApiUrl(" https://example.test/ ")).toBe("https://example.test"));
  it('"off" is the explicit off switch', () => expect(resolveScanApiUrl("off")).toBe(""));
});
