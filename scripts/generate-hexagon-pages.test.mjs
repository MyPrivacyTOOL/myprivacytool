// MPC-8689: every hexagon gets its own page with a unique, stable address; the master page lists all 368.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HEXAGON_CATALOGUE } from '../shared/hexagon-registry/catalogue.js';
import { writeHexagonPages, hexagonPage, misuse } from './generate-hexagon-pages.mjs';

const out = mkdtempSync(path.join(tmpdir(), 'hex-pages-'));
assert.equal(writeHexagonPages(out), 369);
assert.equal(readdirSync(path.join(out, 'hexagon')).length, 369);
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
assert.equal((master.match(/<tr data-r=/g) || []).length, 368);
assert.ok(master.includes('92 High') && master.includes('208 Medium') && master.includes('68 Low'));
console.log('generate-hexagon-pages.test.mjs ok');

// Owner decision 7 (batch 2, 2026-10-29): the 14 share-list pages carry hand-written text, and it does not borrow generic claims that do not fit.
import { REVIEWED } from './hexagon-reviewed-copy.mjs';
const SHARE = ['webrtc-leak', 'name-in-your-address', 'at-username', 'sms-phone-number', 'phone-number-whatsapp-id', 'profile-name', 'username-and-display-name', 'viber-name-and-photo', 'if-they-email-us-signature-block', 'caller-number', 'voice', 'header-line', 'return-address', 'voice-recording'];
assert.deepEqual(Object.keys(REVIEWED).sort(), [...SHARE].sort());
for (const slug of SHARE) {
  const h = HEXAGON_CATALOGUE.find((x) => x.slug === slug);
  assert.ok(h, `${slug} is in the catalogue`);
  assert.equal(REVIEWED[slug].uses.length, 4, `${slug}: four uses`);
  assert.equal(REVIEWED[slug].todo.length, 3, `${slug}: three things to do`);
  const html = hexagonPage(h);
  assert.ok(html.includes('Text reviewed 2026-10-29'), `${slug}: tagged as reviewed`);
  assert.ok(html.includes(REVIEWED[slug].uses[0].replace(/'/g, '&#39;')), `${slug}: shows the reviewed text`);
}
// SIM-swap only belongs on pages about a phone number that logins can use.
for (const slug of SHARE) assert.equal(/SIM-swap/.test(REVIEWED[slug].uses.join(' ')), ['sms-phone-number', 'phone-number-whatsapp-id'].includes(slug), `${slug}: SIM-swap only where a number is a login`);
console.log('hexagon-reviewed-copy ok');
