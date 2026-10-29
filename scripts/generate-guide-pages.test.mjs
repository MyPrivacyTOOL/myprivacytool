// MPC-7561: every approved hexagon guide has a page, and every Guide link in a report points at a page that exists (no 404s).
// Run: node scripts/generate-guide-pages.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GUIDES, UNGUIDED_IDS, hasGuide } from '../shared/hexagon-registry/guides.js';
import { HEXAGONS, EMAIL_HEXAGONS } from '../shared/hexagon-registry/registry.js';
import { guideUrl } from '../workers/scan-report/lib/reportHex.js';
import { writeGuidePages } from './generate-guide-pages.mjs';

const out = mkdtempSync(path.join(tmpdir(), 'guide-pages-'));
assert.equal(writeGuidePages(out), GUIDES.length + 1);

const all = [...HEXAGONS, ...EMAIL_HEXAGONS];
const ids = new Set(all.map((h) => h.id));
assert.equal(all.length, 61, '54 web + 7 email hexagons');
// Every hexagon has either an approved guide or is listed as waiting for one; nothing is in both, and nothing is unknown.
for (const h of all) assert.ok(hasGuide(h.id) !== UNGUIDED_IDS.includes(h.id), `${h.id}: exactly one of guide / unguided`);
for (const g of GUIDES) assert.ok(ids.has(g.id), `guide ${g.id} is a real hexagon`);
assert.equal(new Set(GUIDES.map((g) => g.id)).size, GUIDES.length, 'no duplicate guides');
assert.equal(GUIDES.length + UNGUIDED_IDS.length, 61);

for (const g of GUIDES) {
  const f = path.join(out, 'guides', g.id, 'index.html');
  assert.ok(existsSync(f), `page for ${g.id}`);
  const html = readFileSync(f, 'utf8');
  assert.ok(html.includes(`rel="canonical" href="https://www.myprivacytool.io/guides/${g.id}/"`), `canonical ${g.id}`);
  assert.ok(!html.includes('<script>'), `${g.id}: no script needed`);
  // Action first: what to change and the check come before the explanation.
  const at = (s) => html.indexOf(`<h2>${s}</h2>`);
  assert.ok(at('What to change') > 0 && at('What to change') < at('Check it worked') && at('Check it worked') < at('What this is') && at('What this is') < at('How a site sees it') && at('How a site sees it') < at('Why it matters') && at('Why it matters') < at('In your report'), `${g.id}: section order`);
  for (const k of ['change', 'check', 'what', 'seen', 'why', 'inReport']) assert.ok(g[k] && g[k].length > 10, `${g.id}.${k} is filled`);
  // Report link: points at the guide page, keeps the tracking tag the report tests rely on.
  const link = guideUrl({ id: g.id, category: 'device' });
  assert.ok(link.startsWith(`https://myprivacytool.io/guides/${g.id}/?utm_source=email`) && link.endsWith(`utm_content=${g.id}`), `report link ${g.id}`);
  assert.ok(existsSync(path.join(out, 'guides', link.split('/guides/')[1].split('/')[0], 'index.html')), `report link ${g.id} resolves to a built page`);
}
// Hexagons without a guide keep the generic guide instead of a dead link.
for (const id of UNGUIDED_IDS) assert.ok(guideUrl({ id, category: 'email' }).includes('/blog/remove-personal-information-from-internet'), `${id} falls back to the generic guide`);
const index = readFileSync(path.join(out, 'guides', 'index.html'), 'utf8');
assert.equal((index.match(/<li><a href="\/guides\//g) || []).length, GUIDES.length);
// Honest wording rules from the approved text: no page claims a hexagon is clear when the registry says it cannot be.
for (const g of GUIDES) assert.ok(!/\bsecure your data\b|guarantee/i.test(JSON.stringify(g)), `${g.id}: no guarantee wording`);
console.log(`generate-guide-pages.test.mjs ok (${GUIDES.length} guides)`);
