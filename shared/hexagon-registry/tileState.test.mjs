// MPC-11541: the Live / In build / Planned badge rule. Live = the 54 checks of the web scan; nothing the scan does not run is ever Live.
// MPC-11569: plus the email checks that genuinely run at first contact and have returned real data in production (6 of the 7; email-breaches is not built and stays In build).
import assert from 'node:assert/strict';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { HEXAGONS, HEXAGON_COUNT } from './registry.js';
import { EXTRA_HEXAGON_IDS } from './channels.js';
import { tileState, TILE_LABEL } from './tileState.js';
import { LIVE_EMAIL_IDS_V2, EMAIL_IDS_V2 } from './score-v2.js';

assert.deepEqual(TILE_LABEL, { live: 'Live', in_build: 'In build', planned: 'Planned' });
const by = (s) => HEXAGON_CATALOGUE.filter((i) => tileState(i) === s);
assert.equal(HEXAGON_COUNT, 54);
assert.deepEqual(by('live').map((i) => i.id).sort(), [...HEXAGONS.map((h) => h.id), ...LIVE_EMAIL_IDS_V2].sort(), 'Live = the 54 web scan checks + the genuinely running email checks, no more, no fewer');
assert.equal(LIVE_EMAIL_IDS_V2.length, 6);
assert.equal(tileState(HEXAGON_CATALOGUE.find((i) => i.id === 'email-breaches')), 'in_build', 'not built: never Live');
assert.equal(HEXAGON_CATALOGUE.length, 650, 'badges change, the published catalogue does not');
assert.deepEqual([by('live').length, by('in_build').length, by('planned').length], [60, 131, 459]);
assert.equal(EMAIL_IDS_V2.filter((id) => tileState(HEXAGON_CATALOGUE.find((i) => i.id === id)) !== 'live').length, 1);
assert.equal(by('live').length + by('in_build').length + by('planned').length, HEXAGON_CATALOGUE.length, 'every tile has exactly one badge');
// In build = the 90 built extras (off until their switch is on) + the 41 defined items that are not Live (email-breaches 1, Telegram 30, X 10).
for (const id of EXTRA_HEXAGON_IDS) assert.equal(tileState(HEXAGON_CATALOGUE.find((i) => i.id === id)), 'in_build', `${id} is built but off`);
assert.ok(by('in_build').every((i) => i.status === 'defined' || EXTRA_HEXAGON_IDS.includes(i.id)));
// A documented-only row is never Live or In build.
assert.ok(HEXAGON_CATALOGUE.filter((i) => i.status === 'new' && !EXTRA_HEXAGON_IDS.includes(i.id)).every((i) => tileState(i) === 'planned'));
assert.ok(HEXAGON_CATALOGUE.filter((i) => i.added).every((i) => i.status === 'new' ? tileState(i) !== 'live' : true));
console.log('tileState.test.mjs ok');
