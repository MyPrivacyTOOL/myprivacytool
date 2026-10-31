// MPC-8684: the Telegram security self-check landing page (public/telegram-security-check.html).
// Guards the promises the page makes: it is a self-assessment (no scan claims), analytics only after consent,
// no third-party requests before consent, the three GA4 events, and an email gate that stays closed until a
// HubSpot form id is configured.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(path.join(repo, "public/telegram-security-check.html"), "utf8");
const visible = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");

describe("Telegram security check page", () => {
  it("is indexable (launched), with a self-referencing absolute canonical and link-preview tags, and is in the sitemap", () => {
    expect(html).not.toMatch(/name="robots"[^>]*noindex/i);
    expect(readFileSync(path.join(repo, "scripts/generate-sitemap.mjs"), "utf8")).toContain("/telegram-security-check`");
    expect(html).toContain('rel="canonical" href="https://myprivacytool.io/telegram-security-check"');
    for (const tag of ["og:title", "og:description", "og:image", "twitter:card"]) expect(html).toContain(tag);
  });
  it("never claims to scan the visitor's account", () => {
    expect(visible).toMatch(/not a scan of your account/i);
    expect(visible).not.toMatch(/we (scanned|checked|found)|scan(s|ning)? your (account|telegram)/i);
    expect(html).not.toMatch(/<input[^>]*name="(username|phone)"/i);
  });
  it("loads Google Tag Manager only through the consent-gated snippet", () => {
    expect(html).not.toMatch(/<script[^>]+src=["'][^"']*googletagmanager/i);
    expect(html).toContain("mpt_cookie_consent");
    expect(html).toContain("window['ga-disable-' + GA_ID] = true");
    expect(html).toContain("G-1BWMDBJSPL");
  });
  it("makes no third-party request before consent (no web fonts, no external CSS)", () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|<link[^>]+rel=["']stylesheet["']/i);
  });
  it("fires the three campaign GA4 events", () => {
    for (const ev of ["telegram_scan_started", "telegram_scan_completed", "telegram_pdf_downloaded"]) expect(html).toContain(`'${ev}'`);
  });
  it("shows no score when too few questions are answered (nothing checked is not 0)", () => {
    expect(html).toContain("MIN_ANSWERED");
    expect(html).toContain("r.value === null");
  });
  it("keeps the email gate closed until a HubSpot form id is set, and asks for consent", () => {
    expect(html).toMatch(/var HUBSPOT_FORM_ID = '[0-9a-f-]*';/);
    expect(html).toContain("if (!HUBSPOT_FORM_ID)");
    expect(html).toContain("gateBtn.disabled = true");
    expect(html).toContain('id="consent"');
    expect(html).toContain("consent_given_at");
    expect(html).toContain("source_tag");
  });
  it("serves the guide PDF from an unlisted /downloads/ path that exists, is a real PDF and is kept out of search", () => {
    const m = html.match(/var PDF_URL = '(\/downloads\/[A-Za-z0-9._-]+\.pdf)';/);
    expect(m, "PDF_URL must point under /downloads/").toBeTruthy();
    const file = path.join(repo, "public", m[1]);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    const headers = readFileSync(path.join(repo, "public/_headers"), "utf8");
    expect(headers).toMatch(/\/downloads\/\*\n(?:\s+.*\n)*?\s+X-Robots-Tag: noindex/);
    expect(html).not.toMatch(/<a[^>]+href=["']\/downloads\//i);
    // The public, sitemap-listed guide pages under /guides/ must never be noindexed (regression from the first MPC-8684 merge).
    expect(headers).not.toMatch(/^\/guides[^\n]*\n(?:\s+.*\n)*?\s+X-Robots-Tag: noindex/m);
  });
  it("opens the Alice curtain on the headline without hiding anything from people who need it plain", () => {
    // Decorative clip of Alice pushing the curtain, hidden from assistive tech, muted, no request until the script runs.
    expect(html).toMatch(/<div class="curtain" id="curtain" aria-hidden="true"><video id="curtainVideo" muted playsinline preload="none" poster="\/media\/alice-curtain-pull-poster\.jpg"/);
    for (const f of ["public/media/alice-curtain-pull.mp4", "public/media/alice-curtain-pull-poster.jpg", "public/curtain/curtain-pleat.js"]) {
      expect(existsSync(path.join(repo, f)), f).toBe(true);
    }
    expect(readFileSync(path.join(repo, "public/media/alice-curtain-pull.mp4")).subarray(4, 8).toString()).toBe("ftyp");
    expect(html).toContain("/curtain/curtain-pleat.js");
    // The old effect slid a whole picture sideways as a block; it must not come back.
    expect(html).not.toMatch(/translateX\(-101%\)/);
    // The headline is real text in the page: the words are separate spans, but the heading still reads as one sentence.
    const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    expect(h1).toBe("How exposed are your Telegram settings?");
    // Animation is opt-in per visitor: off for prefers-reduced-motion, and everything is visible without JS (the .cur class is added by script).
    expect(html).toContain("(prefers-reduced-motion: reduce)");
    expect(html).toMatch(/\.curtain\{display:none\}/);
    expect(html).toMatch(/\.cur \.reveal\{opacity:0/);
    expect(html).not.toMatch(/(?<!\.cur )\.reveal\{opacity:0/);
    // Failsafe: the curtain always opens, and a tap opens it at once.
    expect(html).toContain("setTimeout(open, 8000)");
    expect(html).toContain("addEventListener('click', window.__mptOpenCurtain)");
  });
});
