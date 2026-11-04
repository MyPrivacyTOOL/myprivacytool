// Generates dist/feed.xml (RSS 2.0) at build time (run as an npm "postbuild" hook).
// One <item> per blog post in src/data/blogPosts.json, newest first. Guide posts
// are React components, so items carry the excerpt and link to the full article.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://www.myprivacytool.io";

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Post dates are human-readable ("October 7, 2026"); parse as UTC so the
// feed does not shift by the build machine's timezone.
function toTimestamp(dateStr) {
  const ms = Date.parse(`${dateStr} UTC`);
  return Number.isNaN(ms) ? null : ms;
}

function buildItem(post, ms) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  return [
    "    <item>",
    `      <title>${escapeXml(post.title)}</title>`,
    `      <link>${url}</link>`,
    `      <guid isPermaLink="true">${url}</guid>`,
    `      <pubDate>${new Date(ms).toUTCString()}</pubDate>`,
    `      <category>${escapeXml(post.category)}</category>`,
    `      <description>${escapeXml(post.excerpt)}</description>`,
    "    </item>",
  ].join("\n");
}

function generateFeed() {
  const posts = JSON.parse(readFileSync(path.join(ROOT, "src/data/blogPosts.json"), "utf8"))
    .map((post) => ({ post, ms: toTimestamp(post.date) }))
    .filter(({ post, ms }) => {
      if (ms === null) console.warn(`feed.xml: skipping "${post.slug}" (unparseable date "${post.date}")`);
      return ms !== null;
    })
    .sort((a, b) => b.ms - a.ms);

  const lastBuild = posts.length ? posts[0].ms : Date.now();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>MyPrivacyTOOL Blog</title>",
    `    <link>${SITE_URL}/blog</link>`,
    "    <description>Guides and news on data exposure, data brokers and taking back control of your personal information.</description>",
    "    <language>en</language>",
    `    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />`,
    ...posts.map(({ post, ms }) => buildItem(post, ms)),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  const distDir = path.join(ROOT, "dist");
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, "feed.xml"), xml, "utf8");

  console.log(`feed.xml written with ${posts.length} posts`);
}

generateFeed();
