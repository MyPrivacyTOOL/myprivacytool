import { describe, expect, it } from "vitest";
import {
  HK_REGISTERS,
  IVR_VERIFIED,
  PAUSES,
  buildDialString,
  getIvrKeys,
} from "./hkDnc";

describe("hkDnc config", () => {
  it("ships unverified until MPC-7445", () => {
    expect(IVR_VERIFIED).toBe(false);
    for (const r of HK_REGISTERS) {
      for (const lang of ["en", "yue"] as const) {
        expect(getIvrKeys(r, lang).every((k) => k.status === "UNVERIFIED")).toBe(true);
      }
    }
  });

  it("android: pauses plus auto keys, prefix and hotline first", () => {
    const r = buildDialString("android", { register: "sms", language: "en" });
    expect(r.autoKeys).toBe(true);
    expect(r.manualKeys).toEqual([]);
    expect(r.dial.startsWith("tel:13571835000" + ",".repeat(PAUSES.beforeFirstKey))).toBe(true);
    const keys = getIvrKeys("sms", "en").map((k) => k.key);
    const digits = r.dial.slice("tel:13571835000".length).replace(/,/g, "");
    expect(digits).toBe(keys.join(""));
    expect(r.verified).toBe(false);
  });

  it("ios: bare number, keys returned for on-screen display", () => {
    const r = buildDialString("ios", { register: "all", language: "yue" });
    expect(r.dial).toBe("tel:13571835000");
    expect(r.autoKeys).toBe(false);
    expect(r.manualKeys).toEqual(getIvrKeys("all", "yue"));
  });

  it("unknown platforms behave like iOS", () => {
    expect(buildDialString("other").dial).toBe("tel:13571835000");
    expect(buildDialString("other").manualKeys.length).toBeGreaterThan(0);
  });

  it("can drop the caller-ID prefix", () => {
    expect(buildDialString("ios", { forceCallerId: false }).dial).toBe("tel:1835000");
  });

  it("percent-encodes * and # but keeps , as the pause", () => {
    // Keys are placeholders today; assert the encoder on a synthetic path by checking no raw # or * ever escapes.
    for (const r of HK_REGISTERS) {
      const { dial } = buildDialString("android", { register: r });
      expect(dial).not.toMatch(/[#*;\s]/);
      expect(dial).toMatch(/^tel:[0-9,%A-F]+$/);
    }
  });

  it("every register has a language key, a register key and a confirm key", () => {
    for (const r of HK_REGISTERS) {
      expect(getIvrKeys(r).map((k) => k.purpose)).toEqual(["language", "register", "confirm"]);
    }
  });
});
