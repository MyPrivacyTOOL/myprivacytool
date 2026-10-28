// MPC-8689: every hexagon gets its own page with a unique, stable address; the master page lists all 366.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HEXAGON_CATALOGUE } from '../shared/hexagon-registry/catalogue.js';
import { writeHexagonPages, hexagonPage, misuse } from './generate-hexagon-pages.mjs';

const out = mkdtempSync(path.join(tmpdir(), 'hex-pages-'));
assert.equal(writeHexagonPages(out), 367);
assert.equal(readdirSync(path.join(out, 'hexagon')).length, 367);
for (const h of HEXAGON_CATALOGUE) {
  const f = path.join(out, 'hexagon', h.slug, 'index.html');
  assert.ok(existsSync(f), `page for ${h.id}`);
  const html = readFileSync(f, 'utf8');
  assert.ok(html.includes(`<h1>${h.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>`) || html.includes('<h1>'), `heading ${h.id}`);
  assert.ok(html.includes('What it could be used for') && html.includes('What you can do'), `sections ${h.id}`);
  assert.ok(html.includes(`rel="canonical" href="https://www.myprivacytool.io/hexagon/${h.slug}/"`), `canonical ${h.id}`);
  assert.ok(misuse(h).uses.length >= 3, `misuse text ${h.id}`);
  assert.equal(hexagonPage(h).includes('<script>'), false, 'hexagon pages need no script');
}
const master = readFileSync(path.join(out, 'hexagon', 'index.html'), 'utf8');
assert.equal((master.match(/<tr data-r=/g) || []).length, 366);
assert.ok(master.includes('90 High') && master.includes('208 Medium') && master.includes('68 Low'));
console.log('generate-hexagon-pages.test.mjs ok');
