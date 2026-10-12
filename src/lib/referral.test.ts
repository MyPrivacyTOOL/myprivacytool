// MPC-7645: the site's referral helpers. Off by default; the code in the address or this visit's storage goes to the Worker only while the switch is on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getReferralCode, parseManageHash, parseReferralCode, rememberReferralCode, referralsEnabled } from "./referral";
import { requestScanReport } from "./scanReport";
import { CODE_RE } from "../../workers/scan-report/lib/referral.js";

const TOKEN = "a".repeat(64);
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("referral codes and links", () => {
  it("accepts exactly what the Worker accepts", () => {
    for (const c of ["ABCDEFGH", "23456789", "abcdefgh"]) expect(parseReferralCode(c) !== null).toBe(CODE_RE.test(c.toUpperCase()));
    for (const bad of ["", "ABCDEFG", "ABCDEFGHI", "ABCDEF0H", "ABCDEFIH", "ABCDEFOH", "ABC DEFG", null, undefined, 5]) expect(parseReferralCode(bad)).toBeNull();
  });

  it("reads the private link from the fragment only when both parts are valid", () => {
    expect(parseManageHash(`#c=ABCDEFGH&t=${TOKEN}`)).toEqual({ code: "ABCDEFGH", token: TOKEN });
    expect(parseManageHash(`c=abcdefgh&t=${TOKEN}`)).toEqual({ code: "ABCDEFGH", token: TOKEN });
    for (const bad of ["", "#c=ABCDEFGH", `#t=${TOKEN}`, "#c=ABCDEFGH&t=short", `#c=BAD&t=${TOKEN}`, `#c=ABCDEFGH&t=${"G".repeat(64)}`]) expect(parseManageHash(bad)).toBeNull();
  });
});

describe("switch and storage", () => {
  it("is off unless exactly \"true\", and then returns no code at all", () => {
    for (const v of [undefined, "", "false", "TRUE", "1"]) {
      vi.stubEnv("VITE_REFERRALS_ENABLED", v as string);
      expect(referralsEnabled()).toBe(false);
      rememberReferralCode("ABCDEFGH");
      expect(getReferralCode("?ref=ABCDEFGH")).toBeNull();
    }
  });

  it("on: the address wins, else this visit's remembered code; junk is ignored", () => {
    vi.stubEnv("VITE_REFERRALS_ENABLED", "true");
    expect(getReferralCode("")).toBeNull();
    rememberReferralCode("junk");
    expect(sessionStorage.getItem("mpt_referral_code")).toBeNull();
    rememberReferralCode("abcdefgh");
    expect(getReferralCode("")).toBe("ABCDEFGH");
    expect(getReferralCode("?ref=23456789")).toBe("23456789");
    expect(getReferralCode("?ref=nope")).toBe("ABCDEFGH");
  });

  it("a blocked storage never breaks the page", () => {
    vi.stubEnv("VITE_REFERRALS_ENABLED", "true");
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => rememberReferralCode("ABCDEFGH")).not.toThrow();
    expect(getReferralCode("")).toBeNull();
    expect(getReferralCode("?ref=ABCDEFGH")).toBe("ABCDEFGH");
  });
});

describe("POST /api/scan carries the code", () => {
  const body = async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    await requestScanReport("ref+test@example.com", false, false);
    return JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
  };

  it("off: no ref field even if one was remembered", async () => {
    sessionStorage.setItem("mpt_referral_code", "ABCDEFGH");
    expect("ref" in (await body())).toBe(false);
  });

  it("on: the remembered code is sent, in the form the Worker validates", async () => {
    vi.stubEnv("VITE_REFERRALS_ENABLED", "true");
    sessionStorage.setItem("mpt_referral_code", "ABCDEFGH");
    const b = await body();
    expect(b.ref).toBe("ABCDEFGH");
    expect(CODE_RE.test(String(b.ref))).toBe(true);
  });

  it("on, nothing remembered: no ref field", async () => {
    vi.stubEnv("VITE_REFERRALS_ENABLED", "true");
    expect("ref" in (await body())).toBe(false);
  });
});
