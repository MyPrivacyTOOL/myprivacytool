// MPC-9809 (EXT-22): what a crawler that does not run JavaScript reads from the static head and body of every route.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import pageMeta from "@/data/pageMeta.json";

const SUFFIX = " | MyPrivacyTOOL"; // the same suffix scripts/prerender-meta.mjs adds to noindex placeholder routes

describe("index.html structured data (SEO-002)", () => {
  const html = readFileSync("index.html", "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  it("every JSON-LD block is valid JSON", () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(() => JSON.parse(b)).not.toThrow();
  });

  it("carries only the site-wide WebApplication block: no static FAQPage or Home-only BreadcrumbList copied onto every route", () => {
    const types = blocks.map((b) => (JSON.parse(b) as { "@type": string })["@type"]);
    expect(types).toEqual(["WebApplication"]);
  });

  it("no schema.org '@name' typo and no claim that contradicts the privacy policy", () => {
    expect(html).not.toContain('"@name"');
    expect(html).not.toMatch(/free IP geolocation APIs/i);
    expect(html).not.toMatch(/No personal information is stored/i);
  });
});

describe("titles and descriptions a non-JS fetch sees (SEO-001)", () => {
  const titleIn = (file: string) => /<Seo[^>]*?\btitle="([^"]+)"/s.exec(readFileSync(file, "utf8"))?.[1];
  const meta = pageMeta as Record<string, { title: string; description: string; noindex?: boolean }>;

  it.each([
    ["/monitoring", "src/pages/Monitoring.tsx"],
    ["/deep-research", "src/pages/DeepResearch.tsx"],
  ])("%s has its own prerendered head that matches the title the page sets after JavaScript runs", (route, file) => {
    const m = meta[route];
    expect(m, `${route} missing from pageMeta.json: a non-JS fetch gets the home page head`).toBeDefined();
    expect(m.noindex).toBe(true);
    expect(`${m.title}${SUFFIX}`).toBe(titleIn(file));
  });

  it("/footprint/ (a static page) has a title with the site suffix, a description and a canonical", () => {
    const html = readFileSync("public/footprint/index.html", "utf8");
    expect(/<title>([^<]+)<\/title>/.exec(html)?.[1]).toMatch(/ \| MyPrivacyTOOL$/);
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
    expect(html).toContain('<link rel="canonical" href="https://www.myprivacytool.io/footprint/">');
  });
});
