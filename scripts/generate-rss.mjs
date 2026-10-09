// Generates dist/rss.xml from src/data/blogPosts.json at build time (run as an npm "postbuild" hook).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = "https://www.myprivacytool.io";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "October 7, 2026" -> Date at noon UTC so the RFC 822 date is stable in any timezone.
function parseDate(str) {
  const d = new Date(`${str} 12:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildRss(posts, now = new Date()) {
  const items = posts
    .map((p) => ({ ...p, pub: parseDate(p.date) }))
    .filter((p) => p.pub)
    .sort((a, b) => b.pub - a.pub);
  const lastBuild = items[0]?.pub ?? now;

  const itemXml = items.map((p) => {
    const url = `${SITE_URL}/blog/${p.slug}`;
    return [
      "    <item>",
      `      <title>${esc(p.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${p.pub.toUTCString()}</pubDate>`,
      p.category ? `      <category>${esc(p.category)}</category>` : null,
      `      <description>${esc(p.excerpt)}</description>`,
      "    </item>",
    ].filter(Boolean).join("\n");
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>MyPrivacyTOOL Blog</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Practical privacy guides: data brokers, search results, spam, AI training data and more.</description>
    <language>en</language>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
${itemXml.join("\n")}
  </channel>
</rss>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const posts = JSON.parse(readFileSync(path.join(ROOT, "src/data/blogPosts.json"), "utf8"));
  const distDir = path.join(ROOT, "dist");
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, "rss.xml"), buildRss(posts), "utf8");
  console.log(`rss.xml written with ${posts.length} items`);
}
