// MPC-8689: the whole-footprint numbers. Only defined, checked hexagons count; "new" ones never do; nothing is invented.
import assert from 'node:assert/strict';
import { footprintSummary, footprintLine, footprintChannelsLine, FOOTPRINT_TOTAL } from './footprint.js';
import { HEXAGONS } from './registry.js';
import { TELEGRAM_HEXAGONS, TELEGRAM_EXTRA_IDS, EMAIL_EXTRA_IDS, EXTRA_HEXAGON_IDS } from './channels.js';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { scanCounts } from './counts.js';

// MPC-11541: the per-person denominator stays on the catalogue as published before the 2026-11-27 registry export, less the rows now Decision = Dropped (368 - 5 = 363); the 287 added rows never move it.
assert.equal(FOOTPRINT_TOTAL, 363);
assert.equal(HEXAGON_CATALOGUE.length, 650);
const none = footprintSummary();
assert.deepEqual([none.checked, none.toReview, none.total], [0, 363, 363]);

// Web (54) + Telegram (30) checked = 84 of 363, 279 to review.
const both = footprintSummary([...HEXAGONS.map((h) => h.id), ...TELEGRAM_HEXAGONS.map((h) => h.id)]);
assert.deepEqual([both.checked, both.toReview], [84, 279]);
assert.equal(footprintLine(both), '84 of 363 footprint hexagons checked, 279 still to review');
assert.equal(footprintChannelsLine(both), 'Web scan 54 of 87, Telegram 30 of 44');

// Telegram on its own: 30 of 363, not 30 of 30.
assert.equal(footprintSummary(TELEGRAM_HEXAGONS.map((h) => h.id)).toReview, 333);

// A hexagon that is only documented ("new"), an unknown id and a duplicate never count as checked.
const newId = HEXAGON_CATALOGUE.find((h) => h.status === 'new' && !h.added && !EXTRA_HEXAGON_IDS.includes(h.id)).id;
const odd = footprintSummary([newId, 'not-a-hexagon', 'location', 'location']);
assert.deepEqual([odd.checked, odd.toReview], [1, 362]);

// The eight built Telegram extras (MPC-8689 pilot) count as checked: Telegram 38 of 44, still outside the 30 and every score.
const withExtras = footprintSummary([...TELEGRAM_HEXAGONS.map((h) => h.id), ...TELEGRAM_EXTRA_IDS]);
assert.deepEqual([withExtras.checked, withExtras.toReview], [38, 325]);
assert.equal(footprintChannelsLine(withExtras), 'Telegram 38 of 44');
// The four built email extras count as checked too (email 7 + 4 of 21), still outside every score.
const emailBuilt = footprintSummary(EMAIL_EXTRA_IDS);
assert.deepEqual([emailBuilt.checked, emailBuilt.byChannel.find((c) => c.key === 'email').checked], [4, 4]);

// scanCounts exposes which hexagons were checked, without changing X, Y or Z.
const c = scanCounts([{ id: 'location', value: 'Springfield', confirmed: true }]);
assert.ok(c.checkedIds.every((id) => HEXAGONS.some((h) => h.id === id)));
assert.equal(c.checkedIds.length, c.checked);
assert.equal(c.total, 54);
console.log('footprint.test.mjs ok');
