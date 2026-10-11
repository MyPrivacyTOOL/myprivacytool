// MPC-7446: consent clean-up opt-out text generator.
import { describe, expect, it } from "vitest";
import { buildOptOutText } from "./hkSpamOptOut";

describe("buildOptOutText", () => {
  it("English SMS names the company and leaves the number for the user to fill in", () => {
    const t = buildOptOutText({ company: " HSBC ", channel: "sms", lang: "en" });
    expect(t).toContain("HSBC");
    expect(t).toContain("[my phone number]");
    expect(t).toMatch(/withdraw any consent/i);
  });

  it("English email has a subject line and cites the ordinance; letter has none", () => {
    const email = buildOptOutText({ company: "Shop", channel: "email", lang: "en" });
    expect(email.startsWith("Subject:")).toBe(true);
    expect(email).toContain("Unsolicited Electronic Messages Ordinance");
    const letter = buildOptOutText({ company: "Shop", channel: "letter", lang: "en" });
    expect(letter.startsWith("Dear Shop")).toBe(true);
  });

  it("Traditional Chinese variants use Hong Kong wording and the number placeholder", () => {
    const sms = buildOptOutText({ company: "某銀行", channel: "sms", lang: "zh" });
    expect(sms).toContain("某銀行");
    expect(sms).toContain("[我的電話號碼]");
    const email = buildOptOutText({ company: "某銀行", channel: "email", lang: "zh" });
    expect(email.startsWith("主旨：")).toBe(true);
    expect(email).toContain("《非應邀電子訊息條例》");
    expect(buildOptOutText({ company: "某銀行", channel: "letter", lang: "zh" }).startsWith("主旨")).toBe(false);
  });

  it("falls back to a generic name when empty and caps very long names", () => {
    expect(buildOptOutText({ company: "  ", channel: "sms", lang: "en" })).toContain("your company");
    expect(buildOptOutText({ company: "", channel: "sms", lang: "zh" })).toContain("貴公司");
    const long = buildOptOutText({ company: "x".repeat(500), channel: "sms", lang: "en" });
    expect(long).not.toContain("x".repeat(81));
  });
});
