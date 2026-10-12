// MPC-7446: launch flag and preview detection.
import { beforeEach, describe, expect, it } from "vitest";
import {
  HK_PREVIEW_KEY,
  HK_SPAM_META,
  HK_SPAM_PATH,
  HK_SPAM_ENABLED,
  HK_SPAM_INDEXABLE,
  computePreview,
  isHkSpamPreview,
  isHkSpamSurfaceEnabled,
} from "./hkSpamPage";
import { IVR_VERIFIED } from "./hkDnc";

const base = { search: "", hostname: "www.myprivacytool.io", stored: null, dev: false };

describe("launch flag", () => {
  it("ships switched off, and stays off while the IVR keys are unverified", () => {
    expect(HK_SPAM_ENABLED).toBe(true);
    expect(HK_SPAM_INDEXABLE).toBe(false);
    expect(IVR_VERIFIED).toBe(false);
    expect(HK_SPAM_PATH).toBe("/HongKongSpam");
  });

  it("has English and Traditional Chinese title and description", () => {
    for (const lang of ["en", "zh"] as const) {
      expect(HK_SPAM_META[lang].title.length).toBeGreaterThan(10);
      expect(HK_SPAM_META[lang].description.length).toBeGreaterThan(30);
    }
    expect(HK_SPAM_META.en.title).not.toBe(HK_SPAM_META.zh.title);
    expect(HK_SPAM_META.en.description.length).toBeLessThanOrEqual(170);
  });
});

describe("computePreview", () => {
  it("is off for the public on production", () => {
    expect(computePreview(base)).toBe(false);
  });
  it("?hkpreview=1 turns it on and ?hkpreview=0 forces it off", () => {
    expect(computePreview({ ...base, search: "?hkpreview=1" })).toBe(true);
    expect(computePreview({ ...base, dev: true, search: "?hkpreview=0" })).toBe(false);
  });
  it("is on for dev, localhost and Cloudflare Pages preview hosts", () => {
    expect(computePreview({ ...base, dev: true })).toBe(true);
    expect(computePreview({ ...base, hostname: "localhost" })).toBe(true);
    expect(computePreview({ ...base, hostname: "abc123.myprivacytool.pages.dev" })).toBe(true);
  });
  it("remembers the choice for the tab on production", () => {
    expect(computePreview({ ...base, stored: "1" })).toBe(true);
    expect(computePreview({ ...base, hostname: "example.org", stored: "1" })).toBe(true);
  });
});

describe("isHkSpamPreview / isHkSpamSurfaceEnabled (jsdom, localhost)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.pushState({}, "", "/");
  });
  it("stores ?hkpreview=1 for the tab and clears it with ?hkpreview=0", () => {
    window.history.pushState({}, "", "/?hkpreview=1");
    expect(isHkSpamPreview()).toBe(true);
    expect(sessionStorage.getItem(HK_PREVIEW_KEY)).toBe("1");
    window.history.pushState({}, "", "/?hkpreview=0");
    expect(isHkSpamPreview()).toBe(false);
    expect(sessionStorage.getItem(HK_PREVIEW_KEY)).toBeNull();
  });
  it("surfaces are enabled in a preview even though the page is not public", () => {
    window.history.pushState({}, "", "/?hkpreview=1");
    expect(isHkSpamSurfaceEnabled()).toBe(true);
    window.history.pushState({}, "", "/?hkpreview=0");
    expect(isHkSpamSurfaceEnabled()).toBe(HK_SPAM_INDEXABLE);
  });
});
