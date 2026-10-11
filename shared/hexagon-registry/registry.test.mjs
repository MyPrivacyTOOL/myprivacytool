// MPC-7466: runs under plain node (the same runtime style as the Worker tests): the registry loads and is consistent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGONS, HEXAGON_COUNT, HEXAGON_ALWAYS_COUNT, HEXAGON_CONDITIONAL_COUNT, getHexagon, isKnownHexagonId } from './registry.js';

test('54 hexagons: 41 always, 13 conditional, unique ids', () => {
  assert.equal(HEXAGON_COUNT, 54);
  assert.equal(HEXAGON_ALWAYS_COUNT, 41);
  assert.equal(HEXAGON_CONDITIONAL_COUNT, 13);
  assert.equal(new Set(HEXAGONS.map((h) => h.id)).size, 54);
  assert.ok(isKnownHexagonId('location'));
  assert.ok(!isKnownHexagonId('<script>'));
});

test('trust score is empty everywhere; unclear hexagons default to NOT_CHECKED and never allow CLEAR', () => {
  assert.ok(HEXAGONS.every((h) => h.trust_score === null));
  const flagged = HEXAGONS.filter((h) => h.status.code_cannot_tell_clear_from_not_checked);
  assert.equal(flagged.length, 29);
  for (const h of flagged) {
    assert.equal(h.status.default, 'NOT_CHECKED');
    assert.ok(!h.status.allowed.includes('CHECKED_AND_CLEAR'));
  }
  assert.equal(getHexagon('google-services').truth.level, 'cannot_be_checked');
  assert.equal(getHexagon('demographic').truth.level, 'estimated');
});
