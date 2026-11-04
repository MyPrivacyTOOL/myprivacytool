import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// MPC-8529: the prepared limited-mode page must stay honest and self-contained.
const html = readFileSync("fallback/help/index.html", "utf8");

describe("fallback/help/index.html", () => {
  it("says it cannot save a request or issue a case reference", () => {
    expect(html).toMatch(/cannot save a request/i);
    expect(html).toMatch(/case reference/i);
  });
  it("never promises a person, a reply time or an outcome", () => {
    const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\b(within \d|our team|a (human|person) will|we will (reply|respond|get back)|guarantee)/i);
    expect(text).toMatch(/not a person/i);
    expect(text).toMatch(/cannot promise/i);
  });
  it("has no scripts, forms, iframes or external requests (only a mailto link)", () => {
    expect(html).not.toMatch(/<script|<form|<iframe|<img|<link|@import|url\(/i);
    const urls = [...html.matchAll(/(?:href|src|action)="([^"]+)"/g)].map((m) => m[1]);
    for (const u of urls) expect(u.startsWith("mailto:"), u).toBe(true);
  });
  it("is not under public/ (it would share the site's host and could not be called independent)", () => {
    expect("fallback/help/index.html".startsWith("public/")).toBe(false);
    expect(readFileSync("fallback/README.md", "utf8")).toMatch(/Prepared, not deployed/);
  });
  it("is accessible at a basic level", () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/name="viewport"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<h1>/);
  });
});
