import { describe, expect, it } from "vitest";
import {
  HK_REGISTERS,
  IVR_DATA,
  IVR_VERIFIED,
  HK_SPAM_ENABLED,
  PAUSES,
  parseHkSpamEnabled,
  buildDialString,
  getIvrKeys,
} from "./hkDnc";

describe("hkDnc config", () => {
  it("IVR_VERIFIED is false until every key is VERIFIED (and only then may it be true)", () => {
    const all = HK_REGISTERS.flatMap((r) => (["en", "yue"] as const).flatMap((l) => getIvrKeys(r, l)));
    const everyVerified = all.every((k) => k.status === "VERIFIED");
    expect(IVR_VERIFIED).toBe(false);
    if (IVR_VERIFIED) expect(everyVerified).toBe(true);
    expect(everyVerified).toBe(false);
  });

  it("reported language menu: 1 Cantonese, 3 English; 'register a number' is 1", () => {
    expect(IVR_DATA.language.yue.key).toBe("1");
    expect(IVR_DATA.language.en.key).toBe("3");
    expect(IVR_DATA.menu.key).toBe("1");
  });

  it("the JSON only holds valid DTMF keys and known statuses", () => {
    const keys = [IVR_DATA.language.en, IVR_DATA.language.yue, IVR_DATA.menu, ...HK_REGISTERS.flatMap((r) => IVR_DATA.registers[r])];
    for (const k of keys) {
      expect(k.key).toMatch(/^[0-9*#]$/);
      expect(["UNVERIFIED", "REPORTED", "VERIFIED"].includes(k.status)).toBe(true);
    }
    expect(Number.isInteger(PAUSES.beforeFirstKey) && PAUSES.beforeFirstKey >= 0).toBe(true);
    expect(Number.isInteger(PAUSES.betweenKeys) && PAUSES.betweenKeys >= 0).toBe(true);
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

  it("every register has language, menu, register and confirm keys in that order", () => {
    for (const r of HK_REGISTERS) {
      expect(getIvrKeys(r).map((k) => k.purpose)).toEqual(["language", "menu", "register", "confirm"]);
    }
  });
});

describe("HK_SPAM_ENABLED kill switch", () => {
  it("defaults to true and only an explicit off value disables it", () => {
    expect(HK_SPAM_ENABLED).toBe(true);
    for (const v of [undefined, "", "true", "1", "on", "anything"]) expect(parseHkSpamEnabled(v)).toBe(true);
    for (const v of ["false", "FALSE", " 0 ", "off", "No"]) expect(parseHkSpamEnabled(v)).toBe(false);
  });
});
