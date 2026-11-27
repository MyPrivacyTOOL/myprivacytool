// MPC-8689: every hexagon gets its own page with a unique, stable address; the master page lists all of them (650 since the 2026-11-27 registry export, MPC-11541).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HEXAGON_CATALOGUE } from '../shared/hexagon-registry/catalogue.js';
import { writeHexagonPages, hexagonPage, misuse } from './generate-hexagon-pages.mjs';

const out = mkdtempSync(path.join(tmpdir(), 'hex-pages-'));
assert.equal(writeHexagonPages(out), 651);
assert.equal(readdirSync(path.join(out, 'hexagon')).length, 651);
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
assert.equal((master.match(/<tr data-r=/g) || []).length, 650);
assert.ok(master.includes('54 run in the scan'), 'master page carries the one count sentence');
assert.ok(!/\b(650|654|653|662|368|366)\b/.test(master.replace(/<tr data-r=[\s\S]*<\/tbody>/, '')), 'no headline total in the master page copy (MPC-11541)');
assert.ok(master.includes('284 High') && master.includes('268 Medium') && master.includes('98 Low'));
// A registry row with no access recorded says so instead of printing an empty access line.
const noAccess = HEXAGON_CATALOGUE.find((h) => !h.access);
assert.ok(noAccess && hexagonPage(noAccess).includes('<dt>Access</dt><dd>Not recorded yet</dd>'));
console.log('generate-hexagon-pages.test.mjs ok');

// Owner decision 7 (batch 2, 2026-10-29): the 14 share-list pages carry hand-written text, and it does not borrow generic claims that do not fit.
import { REVIEWED } from './hexagon-reviewed-copy.mjs';
const SHARE = ['webrtc-leak', 'name-in-your-address', 'at-username', 'sms-phone-number', 'phone-number-whatsapp-id', 'profile-name', 'username-and-display-name', 'viber-name-and-photo', 'if-they-email-us-signature-block', 'caller-number', 'voice', 'header-line', 'return-address', 'voice-recording'];
// MPC-9791: connected-devices is a draft entry (owner review pending), not one of the 14 owner-reviewed share-list pages.
const DRAFTS = ['connected-devices'];
assert.deepEqual(Object.keys(REVIEWED).sort(), [...SHARE, ...DRAFTS].sort());
// MPC-11541: the owner dropped 'If they email us: signature block' (Decision = Dropped), so it has no page any more; its reviewed text stays on file.
const UNPUBLISHED = ['if-they-email-us-signature-block'];
for (const slug of UNPUBLISHED) assert.ok(!HEXAGON_CATALOGUE.some((x) => x.slug === slug), `${slug} is not published`);
for (const slug of SHARE.filter((x) => !UNPUBLISHED.includes(x))) {
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
// MPC-9791 (CONTENT-010): 'microphones' contains 'phone', so the keyword theme gave Connected Devices SIM-swap text. It now has its own text and says it is a draft.
for (const slug of DRAFTS) {
  const h = HEXAGON_CATALOGUE.find((x) => x.slug === slug);
  const html = hexagonPage(h);
  assert.equal(REVIEWED[slug].uses.length, 4); assert.equal(REVIEWED[slug].todo.length, 3);
  assert.ok(html.includes('Text drafted 2026-11-18 (owner review pending)'), `${slug}: tagged as a draft, not as reviewed`);
  assert.ok(!html.includes('Text reviewed 2026-10-29'), `${slug}: not tagged as owner reviewed`);
  assert.ok(html.includes(REVIEWED[slug].uses[0]), `${slug}: shows the drafted text`);
  assert.ok(!/SIM-swap/.test(html), `${slug}: no SIM-swap text on a page about cameras and microphones`);
  assert.ok(!/SIM-swap/.test(REVIEWED[slug].uses.join(' ')), `${slug}: reviewed copy has no SIM-swap`);
}
console.log('hexagon-reviewed-copy ok');
