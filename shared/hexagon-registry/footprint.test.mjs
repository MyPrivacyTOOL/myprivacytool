// MPC-8689: the whole-footprint numbers. Only defined, checked hexagons count; "new" ones never do; nothing is invented.
import assert from 'node:assert/strict';
import { footprintSummary, footprintLine, footprintChannelsLine, FOOTPRINT_TOTAL } from './footprint.js';
import { HEXAGONS } from './registry.js';
import { TELEGRAM_HEXAGONS } from './channels.js';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { scanCounts } from './counts.js';

assert.equal(FOOTPRINT_TOTAL, 366);
const none = footprintSummary();
assert.deepEqual([none.checked, none.toReview, none.total], [0, 366, 366]);

// Web (54) + Telegram (30) checked = 84 of 366, 282 to review.
const both = footprintSummary([...HEXAGONS.map((h) => h.id), ...TELEGRAM_HEXAGONS.map((h) => h.id)]);
assert.deepEqual([both.checked, both.toReview], [84, 282]);
assert.equal(footprintLine(both), '84 of 366 footprint hexagons checked, 282 still to review');
assert.equal(footprintChannelsLine(both), 'Web scan 54 of 83, Telegram 30 of 47');

// Telegram on its own: 30 of 366, not 30 of 30.
assert.equal(footprintSummary(TELEGRAM_HEXAGONS.map((h) => h.id)).toReview, 336);

// A hexagon that is only documented ("new"), an unknown id and a duplicate never count as checked.
const newId = HEXAGON_CATALOGUE.find((h) => h.status === 'new').id;
const odd = footprintSummary([newId, 'not-a-hexagon', 'location', 'location']);
assert.deepEqual([odd.checked, odd.toReview], [1, 365]);

// scanCounts exposes which hexagons were checked, without changing X, Y or Z.
const c = scanCounts([{ id: 'location', value: 'Springfield', confirmed: true }]);
assert.ok(c.checkedIds.every((id) => HEXAGONS.some((h) => h.id === id)));
assert.equal(c.checkedIds.length, c.checked);
assert.equal(c.total, 54);
console.log('footprint.test.mjs ok');
