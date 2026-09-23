// Generates dist/sitemap.xml at build time (run as an npm "postbuild" hook).
// Static routes get a real lastmod from git history; blog posts get their
// own published date. Noindex placeholder pages are intentionally excluded.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://www.myprivacytool.io";

const STATIC_ROUTES = [
  { path: "/", file: "src/pages/Index.tsx", priority: "1.0", changefreq: "daily" },
  { path: "/scan", file: "src/pages/Scan.tsx", priority: "0.8", changefreq: "weekly" },
  { path: "/report", file: "src/pages/Report.tsx", priority: "0.6", changefreq: "monthly" },
  { path: "/business", file: "src/pages/Business.tsx", priority: "0.8", changefreq: "weekly" },
  { path: "/start", file: "src/pages/Start.tsx", priority: "0.5", changefreq: "monthly" },
  { path: "/newsletter", file: "src/pages/Newsletter.tsx", priority: "0.5", changefreq: "monthly" },
  { path: "/blog", file: "src/pages/Blog.tsx", priority: "0.7", changefreq: "weekly" },
];

function gitLastmod(relativeFile) {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${relativeFile}"`, {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    return iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function postDateToLastmod(dateStr) {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function loadBlogPosts() {
  const jsonPath = path.join(ROOT, "src/data/blogPosts.json");
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

function buildUrlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

function generateSitemap() {
  const entries = STATIC_ROUTES.map((route) =>
    buildUrlEntry({
      loc: `${SITE_URL}${route.path}`,
      lastmod: gitLastmod(route.file),
      changefreq: route.changefreq,
      priority: route.priority,
    }),
  );

  for (const post of loadBlogPosts()) {
    entries.push(
      buildUrlEntry({
        loc: `${SITE_URL}/blog/${post.slug}`,
        lastmod: postDateToLastmod(post.date),
        changefreq: "monthly",
        priority: "0.6",
      }),
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  const distDir = path.join(ROOT, "dist");
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, "sitemap.xml"), xml, "utf8");

  console.log(`sitemap.xml written with ${entries.length} URLs`);
}

generateSitemap();
