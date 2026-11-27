// MPC-9893: renderDisclosure / describeEntry are pure and shared by /what-we-see, the per-scan panel and (later) the Privacy generator.
import { describe, it, expect } from "vitest";
import recipientsData from "./recipients.json";
import { parseRegistry, DATA_ITEMS, PARTIES, CONSENT_BASES, PHASES } from "./registry.ts";
import { LOCALES, describeEntry, isLive, isRemoved, itemLabel, itemsFor, registryDate, renderDisclosure, statusChip, statusLabel, t, toLocale, partyLabel, basisLabel, whenLabel } from "./disclosure.ts";

const reg = parseRegistry(recipientsData);
const ga4 = reg.recipients.find((r) => r.key === "ga4")!;
const fonts = reg.recipients.find((r) => r.key === "google-fonts")!;

describe("vocabulary", () => {
  it("has a label in every locale for every data item, party, basis, phase, status and heading", () => {
    for (const l of LOCALES) {
      for (const d of DATA_ITEMS) expect(itemLabel(d, l), `${l}/${d}`).toMatch(/\S/);
      for (const p of PARTIES) expect(partyLabel(p, l), `${l}/${p}`).toMatch(/\S/);
      for (const b of CONSENT_BASES) expect(basisLabel(b, l), `${l}/${b}`).toMatch(/\S/);
      for (const p of PHASES) expect(whenLabel(p, l), `${l}/${p}`).toMatch(/\S/);
      for (const s of ["ran", "skipped_country", "skipped_disabled", "failed"] as const) expect(statusLabel(s, l), `${l}/${s}`).toMatch(/\S/);
      for (const k of ["who", "sees", "why", "howLong", "basis", "when", "dataItems", "status", "time", "sentence"] as const) expect(t(l, k), `${l}/${k}`).toMatch(/\S/);
    }
  });
  it("covers the nine non-English locales of locales/master_keys.json plus English", () => {
    expect([...LOCALES].sort()).toEqual(["ar", "de", "en", "es", "fr", "ja", "ko", "pt", "vi", "zh"]);
  });
  it("maps browser language tags to a carried locale, defaulting to English", () => {
    expect(toLocale("zh-HK")).toBe("zh");
    expect(toLocale("pt_BR")).toBe("pt");
    expect(toLocale("sv-SE")).toBe("en");
    expect(toLocale(null)).toBe("en");
  });
  it("shows a refused call as failed, so the panel has exactly four chips", () => {
    expect(statusChip("refused")).toBe("failed");
    expect(statusChip("skipped_country")).toBe("skipped_country");
  });
});

describe("renderDisclosure", () => {
  it("names the recipient, what it sees, why and how long, in English", () => {
    const s = renderDisclosure(ga4, "en");
    expect(s).toContain("Google Analytics 4");
    expect(s).toContain(itemLabel("device_profile", "en"));
    expect(s).toContain(ga4.purpose);
    expect(s).toContain(ga4.retention.text);
  });
  it("uses the locale's vocabulary and template for every locale", () => {
    for (const l of LOCALES.filter((x) => x !== "en")) {
      const s = renderDisclosure(ga4, l);
      expect(s, l).toContain(itemLabel("device_profile", l));
      expect(s, l).not.toContain("{");
      expect(s, l).not.toContain(itemLabel("device_profile", "en"));
    }
  });
  it("lets an entry's own sentence for a locale replace the generated one", () => {
    const e = { ...ga4, disclosure: { de: "Eigener Satz." } };
    expect(renderDisclosure(e, "de")).toBe("Eigener Satz.");
    expect(describeEntry(e, "de").usedFallback).toBe(false);
    expect(describeEntry(e, "ja").usedFallback).toBe(true);
    expect(describeEntry(e, "en").usedFallback).toBe(false);
  });
  it("renders only the item names it is given (the panel passes what was logged) and a dash for none", () => {
    expect(describeEntry(ga4, "en", ["utm"]).sees).toBe(itemLabel("utm", "en"));
    expect(describeEntry(ga4, "en", []).sees).toBe("—");
  });
  it("localises a retention in days and falls back to the registry text when there is no number", () => {
    const withDays = reg.recipients.find((r) => r.retention.days !== null)!;
    expect(describeEntry(withDays, "en").howLong).toBe(withDays.retention.text);
    expect(describeEntry(withDays, "de").howLong).toBe(`${withDays.retention.days} Tage`);
    expect(describeEntry(ga4, "de").howLong).toBe(ga4.retention.text);
  });
});

describe("what runs when", () => {
  it("says when each recipient runs from its phase", () => {
    const pre = reg.recipients.find((r) => r.phase === "pre_click")!;
    expect(describeEntry(pre, "en").when).toBe("when the page loads");
    expect(describeEntry(ga4, "en").when).toBe("only after you press Scan me");
  });
  it("treats an entry as removed on and after its until date, and live only while enabled and not removed", () => {
    expect(isRemoved(fonts, "2026-11-07")).toBe(false);
    expect(isRemoved(fonts, "2026-11-08")).toBe(true);
    expect(isLive(fonts, "2026-11-08")).toBe(false);
    expect(isLive(ga4, "2026-11-08")).toBe(true);
    expect(isLive({ ...ga4, enabled: false }, "2026-11-08")).toBe(false);
  });
  it("applies a country's excluded items", () => {
    const e = { ...ga4, country_overrides: { HK: { data_items_exclude: ["utm" as const] } } };
    expect(itemsFor(e, "hk")).toEqual(["device_profile"]);
    expect(itemsFor(e, "DE")).toEqual(["device_profile", "utm"]);
    expect(itemsFor(e)).toEqual(["device_profile", "utm"]);
  });
  it("dates the registry by the latest date it mentions", () => {
    const d = registryDate(reg.recipients);
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const r of reg.recipients) { expect(r.since <= d).toBe(true); if (r.until) expect(r.until <= d).toBe(true); }
  });
});
