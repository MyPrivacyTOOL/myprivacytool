// MPC-11541: the Live / In build / Planned badge rule. Live is exactly the 54 checks of the web scan; nothing the scan does not run is ever Live.
import assert from 'node:assert/strict';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { HEXAGONS, HEXAGON_COUNT } from './registry.js';
import { EXTRA_HEXAGON_IDS } from './channels.js';
import { tileState, TILE_LABEL } from './tileState.js';

assert.deepEqual(TILE_LABEL, { live: 'Live', in_build: 'In build', planned: 'Planned' });
const by = (s) => HEXAGON_CATALOGUE.filter((i) => tileState(i) === s);
assert.equal(HEXAGON_COUNT, 54);
assert.deepEqual(by('live').map((i) => i.id).sort(), HEXAGONS.map((h) => h.id).sort(), 'Live = the 54 web scan checks, no more, no fewer');
assert.deepEqual([by('live').length, by('in_build').length, by('planned').length], [54, 137, 459]);
assert.equal(by('live').length + by('in_build').length + by('planned').length, HEXAGON_CATALOGUE.length, 'every tile has exactly one badge');
// In build = the 90 built extras (off until their switch is on) + the 47 defined items outside the 54 (email 7, Telegram 30, X 10).
for (const id of EXTRA_HEXAGON_IDS) assert.equal(tileState(HEXAGON_CATALOGUE.find((i) => i.id === id)), 'in_build', `${id} is built but off`);
assert.ok(by('in_build').every((i) => i.status === 'defined' || EXTRA_HEXAGON_IDS.includes(i.id)));
// A documented-only row is never Live or In build.
assert.ok(HEXAGON_CATALOGUE.filter((i) => i.status === 'new' && !EXTRA_HEXAGON_IDS.includes(i.id)).every((i) => tileState(i) === 'planned'));
assert.ok(HEXAGON_CATALOGUE.filter((i) => i.added).every((i) => i.status === 'new' ? tileState(i) !== 'live' : true));
console.log('tileState.test.mjs ok');
