// MPC-9894 (Open Tracker design section 5): the recipient text on Privacy, Cookies, the DPA and the FAQ comes from shared/recipients/recipients.json and
// nowhere else. These tests fail if the generated file is stale, if a page omits a live recipient or names one the registry does not have, and if a
// recipient host or provider name is typed by hand in a legal page outside the generated blocks.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { renderPage } from "@/test/render";
import Privacy from "@/pages/Privacy";
import Cookies from "@/pages/Cookies";
import DPA from "@/pages/DPA";
import { FEATURE_STATUS } from "@/config/featureStatus";
import { RECIPIENT_LIST } from "@/config/recipients";
import { hostMatches } from "../../shared/recipients/registry";
import { LOCALES } from "../../shared/recipients/disclosure";
import { buildAllLegalBlocks, buildLegalBlocks, FLAGS_KNOWN_OFF, TRANSLATION_PENDING_NOTE } from "../../shared/recipients/legal-blocks";
import { legalBlocks } from "@/lib/legalBlocks";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const flat = (t: string | null) => (t ?? "").replace(/\s+/g, " ");

describe("generated legal blocks track the registry", () => {
  it("src/data/legalBlocks.generated.json is exactly what the registry produces (run scripts/render-privacy-from-registry.mjs)", () => {
    const file = JSON.parse(read("src/data/legalBlocks.generated.json")) as { blocks: unknown };
    expect(file.blocks).toEqual(JSON.parse(JSON.stringify(buildAllLegalBlocks(RECIPIENT_LIST))));
  });

  it("a flag known to be off is Stripe's, and only while F3 (paid plans) is not live", () => {
    expect(FLAGS_KNOWN_OFF.includes("CHECKOUT_ENABLED")).toBe(FEATURE_STATUS.F3 !== "live");
  });

  it("the visit-log sentence carries the registry's raw-IP window", () => {
    const visit = RECIPIENT_LIST.find((r) => r.key === "visit-log")!;
    expect(legalBlocks().privacy.visit_log_sentence).toContain(`in full for up to ${visit.retention.days} days in some countries`);
    expect(legalBlocks().privacy.visit_log_sentence).toContain("never joined to them");
  });

  it("the other nine locales carry the same blocks in English with a translation-pending note", () => {
    const en = buildLegalBlocks(RECIPIENT_LIST, "en");
    expect(en.translation_pending).toBe(false);
    for (const l of LOCALES.filter((x) => x !== "en")) {
      const b = buildLegalBlocks(RECIPIENT_LIST, l);
      expect(b.translation_pending, l).toBe(true);
      expect(b.translation_note, l).toBe(TRANSLATION_PENDING_NOTE);
      expect(b.privacy.groups, l).toEqual(en.privacy.groups);
    }
  });
});

describe("Privacy, Cookies and DPA name exactly the registry's recipients", () => {
  const live = () => legalBlocks().privacy.groups.flatMap((g) => g.items).map((i) => i.key);

  it("/privacy lists every live recipient once, and no hand-written one", () => {
    renderPage(<Privacy />);
    const shown = [...document.querySelectorAll('[data-generated="privacy-recipients"] [data-recipient]')].map((e) => e.getAttribute("data-recipient"));
    expect(shown.sort()).toEqual([...live(), ...legalBlocks().privacy.switched_off.map((i) => i.key)].sort());
    for (const k of shown) expect(RECIPIENT_LIST.some((r) => r.key === k), String(k)).toBe(true);
  });

  it("/privacy says the free record goes after 7 days and gives the retention by relationship and consent text A with its version", () => {
    renderPage(<Privacy />);
    const t = flat(document.body.textContent);
    expect(t).toContain("is gone within 7 days");
    expect(t).toContain("wording version 2026-11-v1");
    expect(t).toContain("When you press Scan me, MyPrivacyTOOL does what trackers do, in the open.");
    expect(t).toContain("Pressing Scan me means you agree.");
    expect(document.querySelector('[data-testid="retention-by-relationship"]')?.textContent).toMatch(/free scan[\s\S]*signed up[\s\S]*paying customer/i);
    expect(t).toContain(legalBlocks().privacy.visit_log_sentence);
  });

  it("/cookies lists the browser-side services from the registry", () => {
    renderPage(<Cookies />);
    const shown = [...document.querySelectorAll('[data-generated="cookies-recipients"] [data-recipient]')].map((e) => e.getAttribute("data-recipient"));
    expect(shown.sort()).toEqual(legalBlocks().cookies.items.map((i) => i.key).concat(legalBlocks().cookies.switched_off.map((i) => i.key)).sort());
    expect(shown).toContain("google-stun");
  });

  it("/dpa lists every dpa_listed, non-first-party live recipient and no ended one", () => {
    renderPage(<DPA />);
    const shown = [...document.querySelectorAll("[data-recipient]")].map((e) => e.getAttribute("data-recipient"));
    expect(shown.sort()).toEqual(legalBlocks().dpa.sub_processors.map((s) => s.key).sort());
    expect(shown).not.toContain("google-fonts");
    for (const r of RECIPIENT_LIST.filter((x) => x.dpa_listed && x.party !== "first" && x.enabled && !x.until && !x.planned)) expect(shown, r.key).toContain(r.key);
  });

  it("every host written in the rendered pages is a registry host or ours", () => {
    const allHosts = RECIPIENT_LIST.flatMap((r) => r.hosts);
    // Ours, plus the two Hong Kong regulators the HK spam policy block links to (not recipients of anything).
    const own = /(^|\.)myprivacytool\.(io|com)$|\.workers\.dev$|(^|\.)pcpd\.org(\.hk)?$|(^|\.)dnc\.gov\.hk$/;
    for (const el of [<Privacy key="p" />, <Cookies key="c" />, <DPA key="d" />]) {
      renderPage(el);
      const found = flat(document.body.textContent).replace(/([a-z])\.([A-Z])/g, "$1. $2").match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|org|net|co|ai|app|dev|tv)\b/gi) ?? [];
      for (const h of new Set(found.map((x) => x.toLowerCase()))) expect(own.test(h) || hostMatches(h, allHosts) || allHosts.includes("*." + h) || allHosts.some((x) => x.endsWith("." + h)), `unregistered host in page text: ${h}`).toBe(true);
    }
  });
});

// Recipient hosts and provider names are not typed in a page. Cookie names (_ga, hubspotutk) are not recipients and are allowed.
const PROVIDERS = /Cloudflare|Supabase|HubSpot|Resend|Notion|Slack|Stripe|Google Analytics|Google Fonts|Google STUN|Google Cloud|Google Firestore|Google Ads|Gravatar|Libravatar|Have I Been Pwned|haveibeenpwned|Alibaba|Qwen|Firestore|Hunter\.io|Turnstile|ipify|ipapi/;
const SOURCES = ["src/pages/Privacy.tsx", "src/pages/Cookies.tsx", "src/pages/DPA.tsx", "src/data/faqs.ts"];

describe("no hand-written recipient outside the generated blocks", () => {
  const strip = (s: string) => s.replace(/hubspotutk|_ga\b/g, "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}/g, "");

  it.each(SOURCES)("%s contains no registry host and no provider name", (rel) => {
    const src = strip(read(rel));
    const hosts = [...new Set(RECIPIENT_LIST.flatMap((r) => r.hosts))].filter((h) => !/myprivacytool/.test(h)).map((h) => h.replace(/^\*\./, ""));
    for (const h of hosts) expect(src, `${rel} names the host ${h}`).not.toContain(h);
    const hit = src.match(PROVIDERS);
    expect(hit, `${rel} names a provider by hand: ${hit?.[0]}`).toBeNull();
  });

  it("the false sentences are gone from the site", () => {
    const scan = (dir: string, out: string[] = []): string[] => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) scan(p, out);
        else if (/\.(tsx?|json)$/.test(f) && !/\.test\./.test(f) && !/generated/.test(f)) out.push(p);
      }
      return out;
    };
    for (const f of scan(resolve(root, "src"))) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/not a tracker|mirror, not (a )?tracker|no separate (lookup )?service sees your IP|ipify|ipapi/i);
    }
  });
});
