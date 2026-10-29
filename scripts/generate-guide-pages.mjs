// MPC-7561: builds /guides/ and one guide page per approved hexagon (/guides/<hexagon id>/) into dist/ at deploy time (npm "postbuild" hook),
// from shared/hexagon-registry/guides.js. Static HTML, no script. Each page leads with what to change and how to check it worked, then
// explains what the hexagon is. The text is the owner-approved text; this file only lays it out.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { GUIDES } from '../shared/hexagon-registry/guides.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://www.myprivacytool.io';
export const BASE = '/guides';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const firstSentence = (t) => (String(t).match(/^.*?[.!?](?=\s|$)/) || [t])[0];

const CSS = `<style>:root{--bg:#f7f6f3;--ink:#25231f;--mute:#5f5b53;--line:#e3e0d8;--card:#fff;--teal:#1f6f6b;--tealbg:#e8f2f1}
@media(prefers-color-scheme:dark){:root{--bg:#171614;--ink:#f1eee8;--mute:#a29e94;--line:#34312c;--card:#211f1c;--teal:#59b8b2;--tealbg:#1c2b2a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 80px}nav{font-size:14px;color:var(--mute)}a{color:var(--teal)}
.eyebrow{color:var(--teal);font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-top:20px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.12;margin:6px 0 16px}h2{font-size:19px;margin:28px 0 6px}
.act{border:1px solid var(--teal);background:var(--tealbg);border-radius:12px;padding:4px 16px 14px;margin:10px 0}.act h2{margin-top:12px}
.note{font-size:13px;color:var(--mute);border-top:1px solid var(--line);margin-top:36px;padding-top:12px}
ul.l{list-style:none;padding:0}ul.l li{margin:0;border-bottom:1px solid var(--line)}ul.l a{display:block;padding:10px 2px;text-decoration:none}
.cta{display:inline-block;margin-top:8px;border:1px solid var(--teal);border-radius:8px;padding:8px 14px;text-decoration:none;font-weight:600}</style>`;

function page({ title, desc, body, canonical, ld }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | MyPrivacyTOOL</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="article"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE_URL}/og-image.jpg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${SITE_URL}/og-image.jpg">
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}${CSS}</head><body><div class="wrap">${body}</div></body></html>`;
}

export function guidePage(g) {
  const url = `${SITE_URL}${BASE}/${g.id}/`;
  const title = `${g.label}: what to change and how to check it worked`;
  const desc = firstSentence(g.what).slice(0, 200);
  return page({
    title, desc, canonical: url,
    ld: { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: desc, url, publisher: { '@type': 'Organization', name: 'MyPrivacyTOOL' } },
    body: `<nav><a href="${BASE}/">All guides</a> › ${esc(g.group)}</nav>
<div class="eyebrow">MyPrivacyTOOL · Guide</div><h1>${esc(g.label)}</h1>
<div class="act"><h2>What to change</h2><p>${esc(g.change)}</p><h2>Check it worked</h2><p>${esc(g.check)}</p></div>
<h2>What this is</h2><p>${esc(g.what)}</p>
<h2>How a site sees it</h2><p>${esc(g.seen)}</p>
<h2>Why it matters</h2><p>${esc(g.why)}</p>
<h2>In your report</h2><p>${esc(g.inReport)}</p>
<p><a class="cta" href="/scan">Run the scan again</a></p>
<p class="note">${g.source ? `Steps follow the vendor's help pages as we last checked them (October 2026): ${esc(g.source)}. Menu names change between versions, so check the vendor's current page if yours looks different. ` : ''}This is general guidance, not a statement that anything has happened to you.</p>`,
  });
}

export function indexPage() {
  const groups = [...new Set(GUIDES.map((g) => g.group))];
  const title = 'Guides: what to change for each thing a website can see';
  const desc = `${GUIDES.length} short guides, one for each thing your privacy scan can show, with what to change and how to check it worked.`;
  return page({
    title, desc, canonical: `${SITE_URL}${BASE}/`,
    body: `<nav><a href="/">Home</a> › Guides</nav>
<div class="eyebrow">MyPrivacyTOOL</div><h1>${GUIDES.length} guides, one for each hexagon</h1>
<p style="color:var(--mute)">Each guide says what to change first, then how to check it worked.</p>
${groups.map((grp) => `<h2>${esc(grp)}</h2><ul class="l">${GUIDES.filter((g) => g.group === grp).map((g) => `<li><a href="${BASE}/${g.id}/">${esc(g.label)}</a></li>`).join('')}</ul>`).join('')}`,
  });
}

export function writeGuidePages(outDir) {
  const dir = path.join(outDir, 'guides');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), indexPage());
  for (const g of GUIDES) {
    mkdirSync(path.join(dir, g.id), { recursive: true });
    writeFileSync(path.join(dir, g.id, 'index.html'), guidePage(g));
  }
  return GUIDES.length + 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = writeGuidePages(path.resolve(ROOT, process.argv[2] || 'dist'));
  console.log(`guide pages written: ${n} (1 index + ${n - 1} guides)`);
}
