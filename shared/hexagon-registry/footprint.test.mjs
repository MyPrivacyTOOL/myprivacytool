// MPC-8689: the whole-footprint numbers. Only defined, checked hexagons count; "new" ones never do; nothing is invented.
import assert from 'node:assert/strict';
import { footprintSummary, footprintLine, footprintChannelsLine, FOOTPRINT_TOTAL } from './footprint.js';
import { HEXAGONS } from './registry.js';
import { TELEGRAM_HEXAGONS, TELEGRAM_EXTRA_IDS, EMAIL_EXTRA_IDS, EXTRA_HEXAGON_IDS } from './channels.js';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { scanCounts } from './counts.js';

assert.equal(FOOTPRINT_TOTAL, 368);
const none = footprintSummary();
assert.deepEqual([none.checked, none.toReview, none.total], [0, 368, 368]);

// Web (54) + Telegram (30) checked = 84 of 368, 284 to review.
const both = footprintSummary([...HEXAGONS.map((h) => h.id), ...TELEGRAM_HEXAGONS.map((h) => h.id)]);
assert.deepEqual([both.checked, both.toReview], [84, 284]);
assert.equal(footprintLine(both), '84 of 368 footprint hexagons checked, 284 still to review');
assert.equal(footprintChannelsLine(both), 'Web scan 54 of 83, Telegram 30 of 47');

// Telegram on its own: 30 of 368, not 30 of 30.
assert.equal(footprintSummary(TELEGRAM_HEXAGONS.map((h) => h.id)).toReview, 338);

// A hexagon that is only documented ("new"), an unknown id and a duplicate never count as checked.
const newId = HEXAGON_CATALOGUE.find((h) => h.status === 'new' && !EXTRA_HEXAGON_IDS.includes(h.id)).id;
const odd = footprintSummary([newId, 'not-a-hexagon', 'location', 'location']);
assert.deepEqual([odd.checked, odd.toReview], [1, 367]);

// The six built Telegram extras (MPC-8689 pilot) count as checked: Telegram 35 of 47, still outside the 30 and every score.
const withExtras = footprintSummary([...TELEGRAM_HEXAGONS.map((h) => h.id), ...TELEGRAM_EXTRA_IDS]);
assert.deepEqual([withExtras.checked, withExtras.toReview], [36, 332]);
assert.equal(footprintChannelsLine(withExtras), 'Telegram 36 of 47');
// The four built email extras count as checked too (email 7 + 4 of 21), still outside every score.
const emailBuilt = footprintSummary(EMAIL_EXTRA_IDS);
assert.deepEqual([emailBuilt.checked, emailBuilt.byChannel.find((c) => c.key === 'email').checked], [4, 4]);

// scanCounts exposes which hexagons were checked, without changing X, Y or Z.
const c = scanCounts([{ id: 'location', value: 'Springfield', confirmed: true }]);
assert.ok(c.checkedIds.every((id) => HEXAGONS.some((h) => h.id === id)));
assert.equal(c.checkedIds.length, c.checked);
assert.equal(c.total, 54);
console.log('footprint.test.mjs ok');
