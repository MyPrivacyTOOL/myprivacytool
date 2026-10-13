// MPC-7446: platform detection, the honest dial view (IVR unverified), language pick and date format.
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ verified: false }));

vi.mock("@/config/hkDnc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/hkDnc")>();
  return {
    ...actual,
    buildDialString: (...args: Parameters<typeof actual.buildDialString>) => ({
      ...actual.buildDialString(...args),
      verified: flags.verified,
    }),
  };
});

import { IVR_VERIFIED } from "@/config/hkDnc";
import {
  LANG_STORAGE_KEY,
  detectHkPlatform,
  formatHkDate,
  ivrLanguage,
  pickInitialLang,
  readInitialLang,
  resolveHkDial,
  storeLang,
} from "./hkSpamPage";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

beforeEach(() => {
  flags.verified = false;
  localStorage.clear();
});

describe("detectHkPlatform", () => {
  it("detects android, ios, iPadOS-as-Mac and desktop", () => {
    expect(detectHkPlatform(ANDROID)).toBe("android");
    expect(detectHkPlatform(IPHONE)).toBe("ios");
    expect(detectHkPlatform(MAC, 5)).toBe("ios");
    expect(detectHkPlatform(MAC, 0)).toBe("other");
    expect(detectHkPlatform(WINDOWS)).toBe("other");
  });
});

describe("resolveHkDial", () => {
  it("the real engine flag is still unverified (do not flip before MPC-7445)", () => {
    expect(IVR_VERIFIED).toBe(false);
  });

  it("public audience while unverified: bare dial, no keys, no auto-key claim, on every platform", () => {
    for (const p of ["android", "ios", "other"] as const) {
      const v = resolveHkDial(p, "en", false);
      expect(v.dial).toBe("tel:13571835000");
      expect(v.keys).toEqual([]);
      expect(v.keysHidden).toBe(true);
      expect(v.autoKeys).toBe(false);
      expect(v.keysUnverified).toBe(false);
    }
  });

  it("preview while unverified: placeholder keys are shown and flagged unverified", () => {
    const a = resolveHkDial("android", "en", true);
    expect(a.keysUnverified).toBe(true);
    expect(a.keysHidden).toBe(false);
    expect(a.autoKeys).toBe(true);
    expect(a.dial).toContain(",");
    expect(a.keys.map((k) => k.purpose)).toEqual(["language", "service", "register", "back", "service", "register"]);
    const i = resolveHkDial("ios", "en", true);
    expect(i.autoKeys).toBe(true);
    expect(i.dial).toBe(a.dial);
    expect(i.largeKeys).toBe(true);
    expect(a.largeKeys).toBe(false);
    expect(i.keysUnverified).toBe(true);
  });

  it("verified: everyone gets the keys, nothing is flagged unverified", () => {
    flags.verified = true;
    const v = resolveHkDial("android", "en", false);
    expect(v.keysHidden).toBe(false);
    expect(v.keysUnverified).toBe(false);
    expect(v.autoKeys).toBe(true);
    expect(v.keys).toHaveLength(6);
  });

  it("Traditional Chinese uses the Cantonese menu; desktop needs a phone", () => {
    expect(ivrLanguage("zh")).toBe("yue");
    expect(ivrLanguage("en")).toBe("en");
    expect(resolveHkDial("ios", "zh", true).keys[0].key).toBe("1");
    expect(resolveHkDial("other", "en", false).needsPhone).toBe(true);
    expect(resolveHkDial("ios", "en", false).needsPhone).toBe(false);
  });
});

describe("language selection", () => {
  it("?lang wins, then the stored choice, then the browser language", () => {
    expect(pickInitialLang("?lang=zh", "en", ["en-US"])).toBe("zh");
    expect(pickInitialLang("?lang=en", "zh", ["zh-HK"])).toBe("en");
    expect(pickInitialLang("", "zh", ["en-US"])).toBe("zh");
    expect(pickInitialLang("", "bogus", ["en-US", "zh-HK"])).toBe("zh");
    expect(pickInitialLang("", null, ["zh-TW"])).toBe("zh");
    expect(pickInitialLang("", null, ["en-HK"])).toBe("en");
    expect(pickInitialLang("?lang=fr", null, [])).toBe("en");
  });

  it("readInitialLang uses the stored choice and storeLang remembers it", () => {
    storeLang("zh");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("zh");
    expect(readInitialLang()).toBe("zh");
    storeLang("en");
    expect(readInitialLang()).toBe("en");
  });
});

describe("formatHkDate", () => {
  it("formats a Hong Kong date in both languages and passes junk through", () => {
    expect(formatHkDate("2026-10-27", "en")).toContain("2026");
    expect(formatHkDate("2026-10-27", "zh")).toContain("2026");
    expect(formatHkDate("not-a-date", "en")).toBe("not-a-date");
  });
});
