// MPC-7465: the site side of "save every completed web scan".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveCompletedScan, getScanNumber, toPayload } from "./webScan";
import type { HexagonData } from "./deviceDetection";

const NUMBER = "11111111-2222-4333-8444-555555555555";
const hex = (n = 3): HexagonData[] =>
  Array.from({ length: n }, (_, i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
const setConsent = (on: boolean) => {
  (window as unknown as { __cmp: unknown }).__cmp = (cmd: string) =>
    cmd === "getCMPData" ? { userChoiceExists: true, purposeConsents: { c1: on } } : undefined;
};
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete (window as unknown as { __cmp?: unknown }).__cmp; });

describe("saveCompletedScan", () => {
  it("saves a completed scan and keeps the scan number for the visit", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true"); setConsent(true);
    const f = vi.fn(async (..._args: unknown[]) => ok({ saved: true, scan_number: NUMBER }));
    vi.stubGlobal("fetch", f);
    expect(await saveCompletedScan(hex())).toBe(NUMBER);
    expect(getScanNumber()).toBe(NUMBER);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/web-scan$/);
    const body = JSON.parse(init.body as string);
    expect(body.consent).toBe(true);
    expect(body.hexagons).toHaveLength(3);
    await saveCompletedScan(hex());
    expect(f).toHaveBeenCalledTimes(1); // one save per visit
  });

  it("never saves when the consent banner was rejected or unanswered", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    setConsent(false);
    expect(await saveCompletedScan(hex())).toBeNull();
    delete (window as unknown as { __cmp?: unknown }).__cmp; // banner not loaded
    expect(await saveCompletedScan(hex())).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(getScanNumber()).toBeNull();
  });

  it("does nothing when the switch is off", async () => {
    setConsent(true);
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await saveCompletedScan(hex())).toBeNull();
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "false");
    expect(await saveCompletedScan(hex())).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("keeps no scan number when the Worker is off, rejects, or the request fails", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true"); setConsent(true);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ saved: false })));
    expect(await saveCompletedScan(hex())).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    expect(await saveCompletedScan(hex())).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await saveCompletedScan(hex())).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ saved: true, scan_number: "not-a-number" })));
    expect(await saveCompletedScan(hex())).toBeNull();
    expect(getScanNumber()).toBeNull();
  });
});

describe("toPayload", () => {
  it("trims to what the Worker accepts", () => {
    const h = [...hex(2), { ...hex(1)[0], id: "hx-0" }, { ...hex(1)[0], id: "bad id!" }, { ...hex(1)[0], id: "long", value: "a\u0000" + "x".repeat(2000) }];
    const p = toPayload(h);
    expect(p.hexagons.map((x) => x.id)).toEqual(["hx-0", "hx-1", "long"]);
    expect((p.hexagons[2].value as string).length).toBe(1000);
    expect(p.hexagons[2].value).not.toContain("\u0000");
  });
});
