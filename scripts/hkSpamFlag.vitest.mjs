// @vitest-environment node
// MPC-7446: the single /HongKongSpam launch flag drives prerender head, sitemap and robots.txt together.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hkSpamDisallowPaths, hkSpamPrerenderRoute, hkSpamSitemapEntry, patchRobots, readHkSpamConfig } from "./hkSpamFlag.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.myprivacytool.io";
const base = { indexable: false, path: "/HongKongSpam", en: { title: "T", description: "D" }, zh: { title: "ZT", description: "ZD" } };
/** Runs fn with VITE_HK_SPAM_ENABLED=false, the build-time kill switch (same parsing as hkDnc.ts). */
const withKillSwitch = (fn) => {
  const before = process.env.VITE_HK_SPAM_ENABLED;
  process.env.VITE_HK_SPAM_ENABLED = "false";
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.VITE_HK_SPAM_ENABLED;
    else process.env.VITE_HK_SPAM_ENABLED = before;
  }
};
const robots = readFileSync(path.join(ROOT, "public/robots.txt"), "utf8");

describe("hkSpam launch flag", () => {
  it("ships not indexable: the committed config is noindex", () => {
    const cfg = readHkSpamConfig(ROOT);
    expect(cfg.indexable).toBe(false);
    expect(cfg.path).toBe("/HongKongSpam");
  });

  it("prerender route is noindex with hreflang en-HK / zh-HK until the flag is on", () => {
    const off = hkSpamPrerenderRoute(base, SITE);
    expect(off.noindex).toBe(true);
    expect(off.route).toBe("/HongKongSpam");
    expect(off.alternates.map((a) => a.hreflang)).toEqual(["en-HK", "zh-HK", "x-default"]);
    expect(off.alternates[1].href).toBe(`${SITE}/HongKongSpam?lang=zh`);
    expect(hkSpamPrerenderRoute({ ...base, indexable: true }, SITE).noindex).toBe(false);
    // the kill switch wins over the SEO flag
    withKillSwitch(() => expect(hkSpamPrerenderRoute({ ...base, indexable: true }, SITE).noindex).toBe(true));
  });

  it("sitemap entry exists only when enabled AND indexable", () => {
    expect(hkSpamSitemapEntry(base, SITE)).toBeNull();
    withKillSwitch(() => expect(hkSpamSitemapEntry({ ...base, indexable: true }, SITE)).toBeNull());
    expect(hkSpamSitemapEntry({ ...base, indexable: true }, SITE)).toEqual({
      loc: `${SITE}/HongKongSpam`,
      changefreq: "monthly",
      priority: "0.8",
    });
  });

  it("robots.txt disallows the page (both cases) in every group while off, and is untouched once indexable", () => {
    expect(hkSpamDisallowPaths(base)).toEqual(["/HongKongSpam", "/hongkongspam"]);
    const patched = patchRobots(robots, base);
    expect(patched).toContain("Disallow: /HongKongSpam");
    expect(patched).toContain("Disallow: /hongkongspam");
    const groups = (robots.match(/^Allow: \/[ \t]*$/gm) ?? []).length;
    expect(patched.match(/^Disallow: \/HongKongSpam$/gm)).toHaveLength(groups);
    expect(patchRobots(patched, base)).toBe(patched); // idempotent
    expect(patchRobots(robots, { ...base, indexable: true })).toBe(robots);
    withKillSwitch(() => expect(patchRobots(robots, { ...base, indexable: true })).not.toBe(robots));
  });
});
