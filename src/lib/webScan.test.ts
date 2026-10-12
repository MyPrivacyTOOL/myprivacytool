// MPC-7470 (D12): the site side of "save the scan only at the contact step, with its own tick box".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  rememberCompletedScan, pendingScan, canOfferScanSave, scanSaveFields, noteSaveResult,
  getScanNumber, visitScanNumber, toPayload, SCAN_NUMBER_EVENT,
} from "./webScan";
import { SAVE_CONSENT_LABEL, SAVE_CONSENT_VERSION } from "./saveConsent";
import type { HexagonData } from "./deviceDetection";

const NUMBER = "11111111-2222-4333-8444-555555555555";
const hex = (n = 3): HexagonData[] =>
  Array.from({ length: n }, (_, i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the finished scan stays in the browser until the contact step", () => {
  it("is kept in sessionStorage and nothing is sent when the scan completes", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    rememberCompletedScan(hex());
    expect(pendingScan()).toHaveLength(3);
    expect(canOfferScanSave()).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(getScanNumber()).toBeNull(); // no scan number: nothing was saved
  });

  it("keeps nothing while the switch is off", () => {
    rememberCompletedScan(hex());
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "false");
    rememberCompletedScan(hex());
    expect(pendingScan()).toBeNull();
    expect(canOfferScanSave()).toBe(false);
    expect(scanSaveFields()).toEqual({});
  });

  it("a visitor with no scan in the browser (arrived at /scan directly) has nothing to save, without error", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    expect(pendingScan()).toBeNull();
    expect(canOfferScanSave()).toBe(false);
    expect(scanSaveFields()).toEqual({});
    rememberCompletedScan([]); // an empty scan is not kept either
    expect(pendingScan()).toBeNull();
  });

  it("ignores a damaged copy in storage", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    for (const bad of ["{nope", "{}", "[]", "[1,2]", JSON.stringify(Array.from({ length: 101 }, () => ({})))]) {
      sessionStorage.setItem("mpt_pending_scan", bad);
      expect(pendingScan()).toBeNull();
    }
  });

  it("survives storage that throws", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => rememberCompletedScan(hex())).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("scanSaveFields (sent only after the save box is ticked)", () => {
  it("carries the scan, save_consent: true and the wording version", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    const f = scanSaveFields();
    expect(f.save_consent).toBe(true);
    expect(f.save_consent_version).toBe(SAVE_CONSENT_VERSION);
    expect(f.scan).toHaveLength(3);
  });
});

describe("the tick-box wording", () => {
  it("is exactly the approved label, with a version", () => {
    expect(SAVE_CONSENT_LABEL).toBe("Save my scan result with my email, including technical details from my browser such as my IP address, so my report can show it.");
    expect(SAVE_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/);
  });
});

describe("noteSaveResult", () => {
  it("keeps the scan number on this device, announces it and drops the copy held for the contact step", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<string>).detail);
    window.addEventListener(SCAN_NUMBER_EVENT, on);
    expect(noteSaveResult({ success: true, scan_saved: true, scan_number: NUMBER })).toBe(NUMBER);
    window.removeEventListener(SCAN_NUMBER_EVENT, on);
    expect(seen).toEqual([NUMBER]);
    expect(visitScanNumber()).toBe(NUMBER);
    expect(localStorage.getItem("mpt_web_scan_number")).toBe(NUMBER);
    expect(pendingScan()).toBeNull();
    sessionStorage.clear(); // tab closed, same device
    expect(visitScanNumber()).toBeNull();
    expect(getScanNumber()).toBe(NUMBER);
  });

  it("keeps nothing when the Worker did not save, or answers oddly", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    for (const r of [null, undefined, {}, { scan_saved: false }, { scan_saved: false, scan_number: NUMBER }, { scan_saved: true }, { scan_saved: true, scan_number: "not-a-number" }, { scan_saved: "true", scan_number: NUMBER }]) {
      expect(noteSaveResult(r)).toBeNull();
    }
    expect(getScanNumber()).toBeNull();
    expect(pendingScan()).not.toBeNull(); // the visitor can still try again
  });
});

describe("toPayload", () => {
  it("trims to what the Worker accepts", () => {
    const h = [...hex(2), { ...hex(1)[0], id: "hx-0" }, { ...hex(1)[0], id: "bad id!" }, { ...hex(1)[0], id: "long", value: "a\u0000" + "x".repeat(2000) }];
    const p = { hexagons: toPayload(h) };
    expect(p.hexagons.map((x) => x.id)).toEqual(["hx-0", "hx-1", "long"]);
    expect((p.hexagons[2].value as string).length).toBe(1000);
    expect(p.hexagons[2].value).not.toContain("\u0000");
  });

  // MPC-7487: the status of each hexagon is decided at capture
  it("records FOUND / CHECKED AND CLEAR / NOT CHECKED per hexagon, and flags estimates", () => {
    const mk = (id: string, value: string) => ({ ...hex(1)[0], id, value });
    const p = { hexagons: toPayload([
      mk("device", "Desktop (macOS)"), mk("location", "Location detected"), mk("isp", "Unknown ISP"), mk("dns-leak", "Checking..."),
      mk("google-services", "4 services"), mk("sessionstorage-status", "Empty"), mk("canvas-fingerprint", "a1b2c3d4..."), mk("demographic", "Tech professional"),
    ]) };
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
    expect(toPayload([conn])[0].status).toBe("not_checked");
    vi.stubGlobal("navigator", { ...navigator, connection: { type: "wifi" } });
    expect(toPayload([conn])[0].status).toBe("found");
  });
});
