import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HK_SPAM_EVENTS, UTM_STORAGE_KEY, getUtm, parseUtm, track } from "./hkSpamTrack";

describe("hk spam track()", () => {
  const gtag = vi.fn();
  beforeEach(() => {
    gtag.mockClear();
    window.gtag = gtag;
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    delete window.gtag;
  });

  it("has exactly the agreed event names", () => {
    expect([...HK_SPAM_EVENTS]).toEqual([
      "hk_spam_view",
      "hk_spam_dial_tap",
      "hk_spam_registered",
      "hk_spam_email_submit",
      "hk_spam_optout_generated",
      "hk_spam_log_added",
      "hk_spam_scan_click",
      "hk_spam_lang_switch",
    ]);
  });

  it("sends through gtag with params", () => {
    track("hk_spam_dial_tap", { platform: "android" });
    expect(gtag).toHaveBeenCalledWith("event", "hk_spam_dial_tap", { platform: "android" });
  });

  it("carries UTM from the URL and remembers it for later events", () => {
    window.history.replaceState({}, "", "/HongKongSpam?utm_source=fb&utm_medium=cpc&utm_campaign=hk1&x=1");
    track("hk_spam_view");
    expect(gtag).toHaveBeenLastCalledWith("event", "hk_spam_view", { utm_source: "fb", utm_medium: "cpc", utm_campaign: "hk1" });
    window.history.replaceState({}, "", "/HongKongSpam");
    track("hk_spam_registered", { register: "all" });
    expect(gtag).toHaveBeenLastCalledWith("event", "hk_spam_registered", {
      utm_source: "fb", utm_medium: "cpc", utm_campaign: "hk1", register: "all",
    });
  });

  it("explicit params override UTM; no UTM sends none", () => {
    sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify({ utm_source: "a" }));
    track("hk_spam_scan_click", { utm_source: "b" });
    expect(gtag).toHaveBeenLastCalledWith("event", "hk_spam_scan_click", { utm_source: "b" });
    sessionStorage.clear();
    track("hk_spam_lang_switch", { to: "yue" });
    expect(gtag).toHaveBeenLastCalledWith("event", "hk_spam_lang_switch", { to: "yue" });
  });

  it("does nothing without gtag", () => {
    delete window.gtag;
    expect(() => track("hk_spam_view")).not.toThrow();
  });

  it("parseUtm trims, caps and ignores empties", () => {
    expect(parseUtm("?utm_source=%20x%20&utm_medium=&utm_campaign=" + "a".repeat(200))).toEqual({
      utm_source: "x",
      utm_campaign: "a".repeat(100),
    });
    expect(getUtm()).toEqual({});
  });
});
