// MPC-8689: the 366-hexagon catalogue matches the approved discovery and the code, and changes no existing count.
import assert from 'node:assert/strict';
import { HEXAGON_CATALOGUE, CATALOGUE_CHANNELS } from './catalogue.js';
import { HEXAGONS, EMAIL_HEXAGONS, HEXAGON_COUNT } from './registry.js';
import { TELEGRAM_HEXAGONS, CHANNELS, channelOfHexagon } from './channels.js';

const count = (f, k) => HEXAGON_CATALOGUE.filter(f).reduce((m, i) => ((m[i[k]] = (m[i[k]] || 0) + 1), m), {});
assert.equal(HEXAGON_CATALOGUE.length, 366);
assert.equal(CATALOGUE_CHANNELS.length, 26);
assert.deepEqual(count(() => true, 'risk'), { high: 90, medium: 208, low: 68 });
assert.deepEqual(count(() => true, 'arrival'), { A: 201, B: 92, C: 64, D: 9 });
assert.deepEqual(count(() => true, 'group'), { Core: 188, 'Global social': 75, Asian: 74, Offline: 29 });
assert.deepEqual(count(() => true, 'status'), { defined: 91, new: 275 });
assert.equal(new Set(HEXAGON_CATALOGUE.map((i) => i.id)).size, 366, 'ids are unique');
assert.equal(new Set(HEXAGON_CATALOGUE.map((i) => i.slug)).size, 366, 'slugs are unique');
assert.ok(HEXAGON_CATALOGUE.every((i) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.slug)), 'slugs are url-safe');
for (const c of CATALOGUE_CHANNELS) assert.ok(CHANNELS[c.key], `channel ${c.key} is in CHANNELS`);
const perChannel = count((i) => i.channel, 'channel');
assert.equal(perChannel.web, 83); assert.equal(perChannel.telegram, 47); assert.equal(perChannel.email, 21);

// The 91 defined ids are exactly what the code defines: 54 web + 7 email + 30 Telegram. Nothing was renamed.
const code = new Set([...HEXAGONS.map((h) => h.id), ...EMAIL_HEXAGONS.map((h) => h.id), ...TELEGRAM_HEXAGONS.map((h) => h.id)]);
const defined = new Set(HEXAGON_CATALOGUE.filter((i) => i.status === 'defined').map((i) => i.id));
assert.deepEqual([...defined].filter((id) => !code.has(id)), []);
assert.deepEqual([...code].filter((id) => !defined.has(id)), []);
assert.equal(HEXAGON_COUNT, 54, 'web scan total stays 54');
assert.equal(channelOfHexagon('tg.username'), 'TG');
console.log('catalogue.test.mjs ok');
