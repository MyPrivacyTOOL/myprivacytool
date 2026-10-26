// MPC-7446: consent clean-up opt-out text generator. Generic sender types only: no company names.
import { describe, expect, it } from "vitest";
import { SENDER_TYPES, buildOptOutText } from "./hkSpamOptOut";

describe("buildOptOutText", () => {
  it("English SMS speaks to the sender type and leaves the number for the user to fill in", () => {
    const t = buildOptOutText({ sender: "banks", channel: "sms", lang: "en" });
    expect(t).toContain("my bank");
    expect(t).toContain("[my phone number]");
    expect(t).toMatch(/withdraw any consent/i);
  });

  it("English email has a subject line and cites the ordinance; letter has none", () => {
    const email = buildOptOutText({ sender: "retailers", channel: "email", lang: "en" });
    expect(email.startsWith("Subject:")).toBe(true);
    expect(email).toContain("Unsolicited Electronic Messages Ordinance");
    const letter = buildOptOutText({ sender: "retailers", channel: "letter", lang: "en" });
    expect(letter.startsWith("Dear the shop")).toBe(true);
  });

  it("Traditional Chinese variants use Hong Kong wording and the number placeholder", () => {
    const sms = buildOptOutText({ sender: "telcos", channel: "sms", lang: "zh" });
    expect(sms).toContain("我的電訊商");
    expect(sms).toContain("[我的電話號碼]");
    const email = buildOptOutText({ sender: "loyalty", channel: "email", lang: "zh" });
    expect(email.startsWith("主旨：")).toBe(true);
    expect(email).toContain("《非應邀電子訊息條例》");
    expect(buildOptOutText({ sender: "loyalty", channel: "letter", lang: "zh" }).startsWith("主旨")).toBe(false);
  });

  it("covers banks, telcos, retailers and loyalty schemes, and never names a company", () => {
    expect(SENDER_TYPES).toEqual(["banks", "telcos", "retailers", "loyalty"]);
    for (const s of SENDER_TYPES) for (const lang of ["en", "zh"] as const) for (const channel of ["sms", "email", "letter"] as const) {
      const t = buildOptOutText({ sender: s, channel, lang });
      expect(t).not.toMatch(/hsbc|hang seng|bochk|standard chartered|csl|hkt|smartone|3hk|wellcome|parknshop|mannings|watsons|asia miles|yuu|octopus/i);
    }
  });
});
