// MPC-9888: the consent wording is the signed-off one, renders {N} from config, and every locale hashes deterministically.
import { describe, expect, it } from "vitest";
import { CONSENT_LOCALES, consentTextSha256, pickConsentLocale, renderConsent } from "./consent-text";

describe("consent text (wording A)", () => {
  it("English is the signed-off 107-word text with N = 7 days", () => {
    const c = renderConsent("en");
    expect(c.plain.split(/\s+/).length).toBe(107);   // Chris: "A: my draft (107 words)"; {N} renders as two words ("7 days") so the count is of the filled text
    expect(c.plain).toContain("we delete your personal record 7 days after your report is delivered");
    expect(c.plain).toMatch(/Pressing Scan me means you agree\.$/);
    expect(c.link).toBe("who saw what");
    expect(c.plain).not.toMatch(/[\[\]{}]/);
  });
  it("N comes from config: 24 hours renders as 1 day, 36 as hours", () => {
    expect(renderConsent("en", 24).plain).toContain("1 day after");
    expect(renderConsent("en", 36).plain).toContain("36 hours after");
  });
  it("all ten locales render with a link and the button, and hash to 64 hex chars", async () => {
    const hashes = new Set<string>();
    for (const l of CONSENT_LOCALES) {
      const c = renderConsent(l);
      expect(c.link.length).toBeGreaterThan(0);
      expect(c.button.length).toBeGreaterThan(0);
      expect(c.plain).not.toMatch(/\{N\}/);
      const h = await consentTextSha256(c.plain);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      hashes.add(h);
    }
    expect(hashes.size).toBe(CONSENT_LOCALES.length);
  });
  it("picks a supported locale from a BCP-47 tag, English otherwise", () => {
    expect(pickConsentLocale("pt-BR")).toBe("pt");
    expect(pickConsentLocale("zh-Hant-HK")).toBe("zh");
    expect(pickConsentLocale("sv-SE")).toBe("en");
    expect(pickConsentLocale(undefined)).toBe("en");
  });
});
