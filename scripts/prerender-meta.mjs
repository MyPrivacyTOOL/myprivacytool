// Build-time "prerender" of the <head> for every indexable route (MPC-7169).
// The site is a client-only SPA: every URL used to ship the homepage <title>/og tags, which is all
// non-JS crawlers (LinkedIn, X, Facebook, Slack) ever see. After `vite build` this writes
// dist/<route>/index.html with that route's own title, description, canonical, Open Graph and
// Twitter tags; Cloudflare Pages serves it for the matching URL and the SPA hydrates as before.
// Metadata sources: src/data/pageMeta.json (static routes), blogPosts.json, optOutGuides.json.
// Keep the title formulas for posts/guides in sync with BlogPost.tsx / OptOutGuide.tsx.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SITE_URL = "https://www.myprivacytool.io";
const SUFFIX = " | MyPrivacyTOOL";
const DEFAULT_IMAGE = `${SITE_URL}/og-image.jpg`;
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildRoutes() {
  const routes = [];
  const pageMeta = readJson("src/data/pageMeta.json");
  for (const [route, m] of Object.entries(pageMeta)) {
    const placeholder = Boolean(m.noindex);
    routes.push({
      route,
      title: placeholder ? `${m.title}${SUFFIX}` : m.title,
      description: m.description,
      noindex: placeholder,
    });
  }
  for (const post of readJson("src/data/blogPosts.json")) {
    routes.push({
      route: `/blog/${post.slug}`,
      title: `${post.title}${SUFFIX}`,
      description: post.excerpt,
      type: "article",
      image: post.image ? `${SITE_URL}${post.image}` : undefined,
    });
  }
  for (const g of readJson("src/data/optOutGuides.json")) {
    routes.push({
      route: `/opt-out-guides/${g.slug}`,
      title: `How to opt out of ${g.name} (${g.countryName})${SUFFIX}`,
      description: g.summary,
    });
  }
  return routes;
}

function headBlock(r) {
  const url = r.route === "/" ? SITE_URL : `${SITE_URL}${r.route}`;
  const image = r.image ?? DEFAULT_IMAGE;
  const t = esc(r.title);
  const d = esc(r.description);
  const tag = (s) => s.replace(/ \/>$/, ' data-react-helmet="true" />');
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta name="robots" content="${r.noindex ? "noindex" : "index, follow"}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${r.type ?? "website"}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:site_name" content="MyPrivacyTOOL.IO" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ]
    .map(tag)
    .map((s) => `    ${s}`)
    .join("\n");
}

// Strip the homepage defaults from index.html: <title> plus every tag Helmet owns
// (marked data-react-helmet). react-helmet strips and re-adds these on hydration, so no duplicates.
function stripHomepageTags(html) {
  return html
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\r?\n?/, "")
    .replace(/[ \t]*<(?:meta|link)\b[^>]*data-react-helmet="true"[^>]*>\r?\n?/g, "")
    .replace(/[ \t]*<meta name="title"[^>]*>\r?\n?/g, "");
}

function main() {
  const indexPath = path.join(DIST, "index.html");
  if (!existsSync(indexPath)) throw new Error("dist/index.html missing: run `vite build` first");
  const template = stripHomepageTags(readFileSync(indexPath, "utf8"));
  if (/<title>|data-react-helmet/.test(template)) throw new Error("template still has Helmet-owned tags");

  const routes = buildRoutes();
  for (const r of routes) {
    const html = template.replace("</head>", `${headBlock(r)}\n  </head>`);
    const out = r.route === "/" ? indexPath : path.join(DIST, r.route, "index.html");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, html, "utf8");
  }
  console.log(`prerender-meta: wrote head tags for ${routes.length} routes`);
}

main();
