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
  it("is noindex with a self-referencing absolute canonical and link-preview tags", () => {
    expect(html).toContain('name="robots" content="noindex, nofollow"');
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
  it("serves the guide PDF from an unlisted path that exists, is a real PDF and is kept out of search", () => {
    const m = html.match(/var PDF_URL = '(\/guides\/[A-Za-z0-9._-]+\.pdf)';/);
    expect(m, "PDF_URL must point under /guides/").toBeTruthy();
    const file = path.join(repo, "public", m[1]);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    const headers = readFileSync(path.join(repo, "public/_headers"), "utf8");
    expect(headers).toMatch(/\/guides\/\*\n(?:\s+.*\n)*?\s+X-Robots-Tag: noindex/);
    expect(html).not.toMatch(/<a[^>]+href=["']\/guides\//i);
  });
});
