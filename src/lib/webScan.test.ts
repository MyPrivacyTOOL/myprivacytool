// MPC-7465: the site side of "save every completed web scan".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveCompletedScan, getScanNumber, visitScanNumber, toPayload, SCAN_NUMBER_EVENT } from "./webScan";
import { hasScanSaveConsent } from "./cookieConsent";
import type { HexagonData } from "./deviceDetection";

const NUMBER = "11111111-2222-4333-8444-555555555555";
const hex = (n = 3): HexagonData[] =>
  Array.from({ length: n }, (_, i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
// The consent purpose that covers saving a scan (MPC-7488). Any other purpose id is "a different purpose".
const PURPOSE = "c42";
const setPurposes = (purposeConsents: Record<string, boolean>, userChoiceExists = true) => {
  (window as unknown as { __cmp: unknown }).__cmp = (cmd: string) =>
    cmd === "getCMPData" ? { userChoiceExists, purposeConsents } : undefined;
};
const setConsent = (on: boolean) => setPurposes({ [PURPOSE]: on });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.stubEnv("VITE_SCAN_SAVE_CONSENT_PURPOSE", PURPOSE); });
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

describe("specific consent (MPC-7488)", () => {
  it("accepting a different purpose alone does not save", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    const f = vi.fn(async (..._args: unknown[]) => ok({ saved: true, scan_number: NUMBER })); vi.stubGlobal("fetch", f);
    setPurposes({ c1: true, "1": true, "3": true, [PURPOSE]: false });
    expect(hasScanSaveConsent()).toBe(false);
    expect(await saveCompletedScan(hex())).toBeNull();
    setPurposes({ c1: true, "1": true }); // purpose absent altogether
    expect(await saveCompletedScan(hex())).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(getScanNumber()).toBeNull();
  });

  it("saves once the scan-saving purpose is accepted", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ saved: true, scan_number: NUMBER })));
    setPurposes({ c1: false, [PURPOSE]: true });
    expect(await saveCompletedScan(hex())).toBe(NUMBER);
  });

  it("saves nothing for anyone while the purpose id is not configured", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    vi.stubEnv("VITE_SCAN_SAVE_CONSENT_PURPOSE", "");
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    setPurposes({ c1: true, [PURPOSE]: true, "": true });
    expect(hasScanSaveConsent()).toBe(false);
    expect(await saveCompletedScan(hex())).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("needs a recorded choice, not just a purpose flag", () => {
    setPurposes({ [PURPOSE]: true }, false);
    expect(hasScanSaveConsent()).toBe(false);
  });
});

describe("scan number kept in this browser (MPC-7488)", () => {
  it("is kept on the device after the visit ends, announced to the screen, and a new visit saves a new scan", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true"); setConsent(true);
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<string>).detail);
    window.addEventListener(SCAN_NUMBER_EVENT, on);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ saved: true, scan_number: NUMBER })));
    expect(await saveCompletedScan(hex())).toBe(NUMBER);
    window.removeEventListener(SCAN_NUMBER_EVENT, on);
    expect(seen).toEqual([NUMBER]);
    expect(localStorage.getItem("mpt_web_scan_number")).toBe(NUMBER);
    sessionStorage.clear(); // tab closed, same device
    expect(visitScanNumber()).toBeNull();
    expect(getScanNumber()).toBe(NUMBER);
    const NEXT = "11111111-2222-4333-8444-666666666666";
    const f = vi.fn(async (..._args: unknown[]) => ok({ saved: true, scan_number: NEXT })); vi.stubGlobal("fetch", f);
    expect(await saveCompletedScan(hex())).toBe(NEXT);
    expect(f).toHaveBeenCalledTimes(1);
    expect(getScanNumber()).toBe(NEXT);
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

  // MPC-7487: the status of each hexagon is decided at capture
  it("records FOUND / CHECKED AND CLEAR / NOT CHECKED per hexagon, and flags estimates", () => {
    const mk = (id: string, value: string) => ({ ...hex(1)[0], id, value });
    const p = toPayload([
      mk("device", "Desktop (macOS)"), mk("location", "Location detected"), mk("isp", "Unknown ISP"), mk("dns-leak", "Checking..."),
      mk("google-services", "4 services"), mk("sessionstorage-status", "Empty"), mk("canvas-fingerprint", "a1b2c3d4..."), mk("demographic", "Tech professional"),
    ]);
    const by = Object.fromEntries(p.hexagons.map((x) => [x.id as string, x]));
    expect(by.device.status).toBe("found");
    expect(by.location.status).toBe("not_checked");
    expect(by.isp.status).toBe("not_checked");
    expect(by["dns-leak"].status).toBe("not_checked");
    expect(by["google-services"].status).toBe("not_checked"); // one of the 7 the site cannot check
    expect(by["sessionstorage-status"].status).toBe("clear");
    expect(by["canvas-fingerprint"].status).toBe("found");
    expect(by.demographic).toMatchObject({ status: "found", estimate: true });
    expect(by.device.estimate).toBeUndefined();
  });

  it("treats the connection type as NOT CHECKED when the browser did not report one (the WiFi on screen is an assumption)", () => {
    const conn = { ...hex(1)[0], id: "connection", value: "WiFi" };
    expect(toPayload([conn]).hexagons[0].status).toBe("not_checked");
    vi.stubGlobal("navigator", { ...navigator, connection: { type: "wifi" } });
    expect(toPayload([conn]).hexagons[0].status).toBe("found");
  });
});
