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

  it("recorded menu: language 1 Cantonese / 3 English, service 3 SMS / 1 pre-recorded, then 1 = register this number", () => {
    expect(IVR_DATA.language.yue.key).toBe("1");
    expect(IVR_DATA.language.en.key).toBe("3");
    expect(IVR_DATA.services.sms.key).toBe("3");
    expect(IVR_DATA.services.prerecorded.key).toBe("1");
    expect(IVR_DATA.register.key).toBe("1");
    expect(IVR_DATA.back.key).toBe("*");
  });

  it("fax is not offered (nobody uses it)", () => {
    expect(HK_REGISTERS).toEqual(["sms", "prerecorded", "all"]);
  });

  it("the JSON only holds valid DTMF keys and known statuses", () => {
    const keys = [IVR_DATA.language.en, IVR_DATA.language.yue, IVR_DATA.services.sms, IVR_DATA.services.prerecorded, IVR_DATA.register, IVR_DATA.back];
    for (const k of keys) {
      expect(k.key).toMatch(/^[0-9*#]$/);
      expect(["UNVERIFIED", "REPORTED", "VERIFIED"].includes(k.status)).toBe(true);
    }
    for (const n of [PAUSES.beforeFirstKey, PAUSES.betweenKeys, PAUSES.afterRegister]) {
      expect(Number.isInteger(n) && n >= 0).toBe(true);
    }
  });

  it("android: pauses plus auto keys, prefix and hotline first", () => {
    const r = buildDialString("android", { register: "sms", language: "en" });
    expect(r.autoKeys).toBe(true);
    expect(r.manualKeys).toEqual([]);
    expect(r.dial.startsWith("tel:13571835000" + ",".repeat(PAUSES.beforeFirstKey))).toBe(true);
    const keys = getIvrKeys("sms", "en").map((k) => k.key);
    const digits = r.dial.slice("tel:13571835000".length).replace(/,/g, "");
    expect(digits.replace(/%2A/g, "*")).toBe(keys.join(""));
    expect(keys.join("")).toBe("331");
    expect(r.verified).toBe(false);
  });

  it("ios: same pauses and keys in the dial string as Android, plus the keys on screen as a backup", () => {
    const r = buildDialString("ios", { register: "all", language: "yue" });
    expect(r.dial).toBe(buildDialString("android", { register: "all", language: "yue" }).dial);
    expect(r.autoKeys).toBe(true);
    expect(r.manualKeys).toEqual(getIvrKeys("all", "yue"));
  });

  it("unknown platforms (desktop) get the bare number and the manual key script", () => {
    expect(buildDialString("other").dial).toBe("tel:13571835000");
    expect(buildDialString("other").manualKeys.length).toBeGreaterThan(0);
  });

  it("can drop the caller-ID prefix", () => {
    expect(buildDialString("other", { forceCallerId: false }).dial).toBe("tel:1835000");
    expect(buildDialString("ios", { forceCallerId: false }).dial.startsWith("tel:1835000,")).toBe(true);
  });

  it("percent-encodes * and # but keeps , as the pause", () => {
    for (const r of HK_REGISTERS) {
      const { dial } = buildDialString("android", { register: r });
      expect(dial).not.toMatch(/[#*;\s]/);
      expect(dial).toMatch(/^tel:[0-9,%A-F]+$/);
    }
  });

  it("single services are language, service, register; 'all' chains SMS then pre-recorded with star between", () => {
    expect(getIvrKeys("sms", "en").map((k) => k.purpose)).toEqual(["language", "service", "register"]);
    expect(getIvrKeys("prerecorded", "yue").map((k) => k.key).join("")).toBe("111");
    expect(getIvrKeys("all", "en").map((k) => k.purpose)).toEqual(["language", "service", "register", "back", "service", "register"]);
    expect(getIvrKeys("all", "en").map((k) => k.key).join("")).toBe("331*11");
    expect(getIvrKeys("all", "yue").map((k) => k.key).join("")).toBe("131*11");
  });

  it("android 'all' dial string waits longer before star so the 'registered' message can play", () => {
    const { dial } = buildDialString("android", { register: "all", language: "en" });
    const body = dial.slice("tel:13571835000".length);
    expect(body).toBe(
      ",".repeat(PAUSES.beforeFirstKey) + "3" + ",".repeat(PAUSES.betweenKeys) + "3" + ",".repeat(PAUSES.betweenKeys) + "1" +
        ",".repeat(PAUSES.afterRegister) + "%2A" + ",".repeat(PAUSES.betweenKeys) + "1" + ",".repeat(PAUSES.betweenKeys) + "1",
    );
    expect(PAUSES.afterRegister).toBeGreaterThan(PAUSES.betweenKeys);
  });
});

describe("HK_SPAM_ENABLED kill switch", () => {
  it("defaults to true and only an explicit off value disables it", () => {
    expect(HK_SPAM_ENABLED).toBe(true);
    for (const v of [undefined, "", "true", "1", "on", "anything"]) expect(parseHkSpamEnabled(v)).toBe(true);
    for (const v of ["false", "FALSE", " 0 ", "off", "No"]) expect(parseHkSpamEnabled(v)).toBe(false);
  });
});
