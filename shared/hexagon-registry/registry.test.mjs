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

// MPC-7487
import { EMAIL_HEXAGONS } from './registry.js';
import { captureStatus } from './status.js';

test('six email hexagons are in the shared registry, outside the 54 web hexagons', () => {
  assert.deepEqual(EMAIL_HEXAGONS.map((h) => h.id), ['email-breaches', 'email-name', 'email-provider', 'email-profile', 'email-libravatar', 'email-domain-record']);
  assert.ok(EMAIL_HEXAGONS.every((h) => h.trust_score === null && !isKnownHexagonId(h.id)));
});

test('capture status: the 7 cannot-be-checked are always NOT_CHECKED; placeholders are NOT_CHECKED; CLEAR only where allowed', () => {
  const seven = HEXAGONS.filter((h) => h.truth.level === 'cannot_be_checked');
  assert.equal(seven.length, 7);
  for (const h of seven) assert.equal(captureStatus(h.id, '5 services'), 'not_checked');
  assert.equal(captureStatus('location', 'Location detected'), 'not_checked');
  assert.equal(captureStatus('location', 'Springfield, Exampleshire'), 'found');
  assert.equal(captureStatus('screen', 'Empty'), 'found');          // informational: never CLEAR
  assert.equal(captureStatus('cookies-status', 'Empty'), 'clear');
  assert.equal(captureStatus('indexeddb-status', 'Not Used'), 'not_checked'); // the registry does not allow CLEAR here
  assert.equal(captureStatus('not-a-hexagon', 'x'), 'not_checked');
  for (const h of HEXAGONS) {
    for (const v of ['Empty', 'None', 'Secure (HTTPS)', 'Disabled', 'Example 1']) {
      if (captureStatus(h.id, v) === 'clear') assert.ok(h.status.allowed.includes('CHECKED_AND_CLEAR'), `${h.id} must not be CLEAR`);
    }
  }
});
