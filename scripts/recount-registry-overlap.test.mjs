// MPC-11307: tests for scripts/recount-registry-overlap.mjs. Run: node --test scripts/recount-registry-overlap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, pageIdOf, recount } from './recount-registry-overlap.mjs';

const catalogue = new Map([
  ['tg.bio', 'telegram'],
  ['x.bio', 'x'],
  ['email-profile', 'email'],
  ['email-libravatar', 'email'],
]);
const row = (over) => ({ url: 'https://app.notion.com/p/40c28547eaa781d89a55f8c7150a6beb', 'Hexagon ID': 1, Channel: 'Cross-Channel / General', 'Catalogue Code': '', 'Evidence Key': '', 'Overlap Channels': null, ...over });

test('clean undoes Notion markdown escaping', () => {
  assert.equal(clean('breach\\_data\\_classes'), 'breach_data_classes');
  assert.equal(clean('[wa.ad](http://wa.ad)\\_referral'), 'wa.ad_referral');
  assert.equal(clean(null), '');
});

test('pageIdOf reads a 32 hex id from a url', () => {
  assert.equal(pageIdOf({ url: 'https://app.notion.com/p/40c28547eaa781d89a55f8c7150a6beb' }), '40c28547eaa781d89a55f8c7150a6beb');
  assert.equal(pageIdOf({ url: 'https://app.notion.com/p/40c28547eaa781d89a55f8c7150a6beb?pvs=204' }), '40c28547eaa781d89a55f8c7150a6beb');
});

test('same key on two catalogue channels counts 2 on both rows, even when the registry Channel says Cross-Channel', () => {
  const rows = [row({ 'Hexagon ID': 1, 'Catalogue Code': 'tg.bio', 'Evidence Key': 'bio' }), row({ 'Hexagon ID': 2, 'Catalogue Code': 'x.bio', 'Evidence Key': 'bio' })];
  const { changes, summary } = recount(rows, catalogue);
  assert.deepEqual(changes.map((c) => [c.hexagon_id, c.from, c.to]), [[1, null, 2], [2, null, 2]]);
  assert.equal(summary.keys_on_2_plus_channels, 1);
});

test('two rows on the SAME channel are not overlap (same field, same channel)', () => {
  const rows = [row({ 'Catalogue Code': 'email-profile', 'Evidence Key': 'profile_photo' }), row({ 'Hexagon ID': 2, 'Catalogue Code': 'email-libravatar', 'Evidence Key': 'profile_photo' })];
  const { changes } = recount(rows, catalogue);
  assert.equal(changes.length, 0);
});

test('a key seen on one channel leaves the column empty and clears a stale count', () => {
  const rows = [row({ 'Catalogue Code': 'tg.bio', 'Evidence Key': 'bio', 'Overlap Channels': 3 })];
  const { changes } = recount(rows, catalogue);
  assert.deepEqual(changes.map((c) => [c.from, c.to]), [[3, null]]);
});

test('rows without a catalogue code use the registry Channel; an up-to-date count produces no write', () => {
  const rows = [
    row({ 'Hexagon ID': 541, Channel: 'Email', 'Evidence Key': 'breach_data_classes', 'Overlap Channels': 2 }),
    row({ 'Hexagon ID': 3, Channel: 'Web Scan', 'Evidence Key': 'breach_data_classes', 'Overlap Channels': 2 }),
  ];
  assert.equal(recount(rows, catalogue).changes.length, 0);
});

test('a row that lost its Evidence Key but still has a count is cleared', () => {
  const rows = [row({ 'Evidence Key': '', 'Overlap Channels': 4 })];
  const { changes } = recount(rows, catalogue);
  assert.deepEqual(changes.map((c) => [c.from, c.to]), [[4, null]]);
});
