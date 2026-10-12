// Build-time side of the /HongKongSpam launch switch (MPC-7446).
// The ONE SEO flag is `indexable` (HK_SPAM_INDEXABLE) in src/data/hkSpam.json; the React page reads the same file via
// src/config/hkSpamPage.ts. While it is false the page is noindex, absent from the sitemap and disallowed in
// robots.txt. Flipping it to true (only after MPC-7445 confirms the IVR keys) makes all three indexable at once.
// `enabled` (HK_SPAM_ENABLED) is the kill switch: when false the page is also out of the sitemap and disallowed.
import { readFileSync } from "node:fs";
import path from "node:path";

export function readHkSpamConfig(root) {
  return JSON.parse(readFileSync(path.join(root, "src/data/hkSpam.json"), "utf8"));
}

/** Indexable only when the feature is on AND the SEO flag is on. */
export function hkSpamIsIndexable(cfg) {
  return cfg.enabled === true && cfg.indexable === true;
}

/** Variants that must not be crawled while the page is unlaunched (robots.txt paths are case-sensitive). */
export function hkSpamDisallowPaths(cfg) {
  return [...new Set([cfg.path, cfg.path.toLowerCase()])];
}

/** Route record for prerender-meta.mjs: English head for non-JS crawlers, hreflang pair, noindex until launch. */
export function hkSpamPrerenderRoute(cfg, siteUrl) {
  const url = `${siteUrl}${cfg.path}`;
  return {
    route: cfg.path,
    title: cfg.en.title,
    description: cfg.en.description,
    noindex: !hkSpamIsIndexable(cfg),
    alternates: [
      { hreflang: "en-HK", href: url },
      { hreflang: "zh-HK", href: `${url}?lang=zh` },
      { hreflang: "x-default", href: url },
    ],
  };
}

/** Sitemap entry fields, or null while the page is not public. */
export function hkSpamSitemapEntry(cfg, siteUrl) {
  if (!hkSpamIsIndexable(cfg)) return null;
  return { loc: `${siteUrl}${cfg.path}`, changefreq: "monthly", priority: "0.8" };
}

/** Adds Disallow lines after every `Allow: /` while unlaunched; returns the text unchanged once public. */
export function patchRobots(text, cfg) {
  if (hkSpamIsIndexable(cfg)) return text;
  const lines = hkSpamDisallowPaths(cfg).map((p) => `Disallow: ${p}`);
  if (text.includes(lines[0])) return text;
  return text.replace(/^Allow: \/[ \t]*$/gm, (m) => [m.trimEnd(), ...lines].join("\n"));
}
