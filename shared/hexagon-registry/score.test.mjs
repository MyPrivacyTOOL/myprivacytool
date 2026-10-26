// MPC-7471-F4: the mathematical requirements of exposure-v1, under plain node (same runtime style as registry.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGONS, HEXAGON_COUNT, getHexagon } from './registry.js';
import {
  SCORE_VERSION, BANDS, BAND_MEDIUM_FROM, BAND_HIGH_FROM, CATEGORY_WEIGHTS, WEIGHT_TOTAL, CATEGORY_OF, SEVERITY_OF_SENSITIVITY,
  computeExposure, bandFor, percentHalfUp, itemInfo, SCORABLE_IDS,
} from './score.js';

// Small seeded generator so the property tests are reproducible.
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a, r) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// A hexagon the contract may mark clear (registry allows it); the others can only be found or not checked.
const canClear = (id) => getHexagon(id).status.allowed.includes('CHECKED_AND_CLEAR');
const randomScan = (r) => SCORABLE_IDS.map((id) => {
  const x = r();
  return { id, status: x < 0.35 ? 'found' : x < 0.65 && canClear(id) ? 'clear' : 'not_checked' };
});
const idsIn = (cat) => SCORABLE_IDS.filter((id) => itemInfo(id).category === cat);

test('every registry category and sensitivity maps to a weight category and a severity (nothing silently dropped)', () => {
  for (const h of HEXAGONS) {
    assert.ok(CATEGORY_OF[h.category], `category ${h.category} of ${h.id}`);
    assert.ok(SEVERITY_OF_SENSITIVITY[h.truth.sensitivity], `sensitivity of ${h.id}`);
    assert.ok(CATEGORY_WEIGHTS[CATEGORY_OF[h.category]] > 0);
  }
});

test('approved weights sum to exactly 1 (100 whole percent, no floating point)', () => {
  const sum = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, WEIGHT_TOTAL);
  assert.equal(WEIGHT_TOTAL, 100);
  assert.ok(Object.values(CATEGORY_WEIGHTS).every(Number.isInteger));
});

test('bands: one definition, boundaries 39/40 and 69/70', () => {
  assert.equal(BAND_MEDIUM_FROM, 40);
  assert.equal(BAND_HIGH_FROM, 70);
  assert.deepEqual(BANDS.map((b) => [b.key, b.from, b.to]), [['low', 0, 39], ['medium', 40, 69], ['high', 70, 100]]);
  assert.equal(bandFor(0), 'low');
  assert.equal(bandFor(39), 'low');
  assert.equal(bandFor(40), 'medium');
  assert.equal(bandFor(69), 'medium');
  assert.equal(bandFor(70), 'high');
  assert.equal(bandFor(100), 'high');
  assert.equal(bandFor(null), null);
  for (let s = 0; s <= 100; s++) assert.equal(bandFor(s), BANDS.find((b) => s >= b.from && s <= b.to).key);
  assert.throws(() => bandFor(39.5));
  assert.throws(() => bandFor(101));
  assert.throws(() => bandFor(-1));
});

test('half-up rounding at .5 (exact, not floating point)', () => {
  assert.equal(percentHalfUp(1, 8), 13);    // 12.5
  assert.equal(percentHalfUp(3, 8), 38);    // 37.5
  assert.equal(percentHalfUp(1, 200), 1);   // 0.5
  assert.equal(percentHalfUp(199, 200), 100); // 99.5
  assert.equal(percentHalfUp(0, 54), 0);
  assert.equal(percentHalfUp(54, 54), 100);
  assert.equal(percentHalfUp(1, 3), 33);
  assert.equal(percentHalfUp(2, 3), 67);
  // Overall score: one category (weight irrelevant when alone), found 1 / checked 8 severity = 12.5 -> 13
  const low = SCORABLE_IDS.filter((id) => itemInfo(id).category === 'language' && itemInfo(id).severity === 1);
  assert.ok(low.length >= 1);
});

test('overall score rounds .5 up: independent exact oracle finds scans whose exact score ends in .5', () => {
  // Oracle: recompute S from the registry with BigInt fractions in the test itself, and require round_half_up.
  const oracle = (items) => {
    const per = {};
    for (const { id, status } of items) {
      if (status === 'not_checked') continue;
      const { category, severity } = itemInfo(id);
      per[category] ??= { f: 0n, c: 0n };
      per[category].c += BigInt(severity);
      if (status === 'found') per[category].f += BigInt(severity);
    }
    let n = 0n, d = 1n, w = 0n;
    const act = Object.entries(per);
    for (const [, v] of act) d *= v.c;
    for (const [k, v] of act) { n += BigInt(CATEGORY_WEIGHTS[k]) * v.f * (d / v.c); w += BigInt(CATEGORY_WEIGHTS[k]); }
    if (!act.length) return null;
    const num = 100n * n, den = d * w;
    return { half: (2n * num) % (2n * den) === den, score: Number((2n * num + den) / (2n * den)) };
  };
  const r = rng(5);
  let halves = 0;
  for (let i = 0; i < 20000 && halves < 25; i++) {
    const scan = randomScan(r).filter(() => r() < 0.25);
    const o = oracle(scan);
    if (!o) continue;
    assert.equal(computeExposure(scan).score, o.score);
    if (o.half) halves++;
  }
  assert.ok(halves >= 5, `only ${halves} exact .5 cases found; widen the search`);
});

test('no checked items: no score, no band, not 0 and not safe', () => {
  const r = computeExposure([]);
  assert.equal(r.score, null);
  assert.equal(r.band, null);
  assert.equal(r.status, 'no_checked_items');
  assert.equal(r.coverage.checked, 0);
  assert.equal(r.coverage.percent, 0);
  const allNot = computeExposure(SCORABLE_IDS.map((id) => ({ id, status: 'not_checked' })));
  assert.equal(allNot.score, null);
  assert.equal(allNot.band, null);
  assert.equal(allNot.counts.not_checked, SCORABLE_IDS.length);
});

test('checked and all clear is a real 0 (Low), unlike nothing checked', () => {
  const clearable = SCORABLE_IDS.filter(canClear);
  assert.ok(clearable.length > 0);
  const r = computeExposure(clearable.map((id) => ({ id, status: 'clear' })));
  assert.equal(r.score, 0);
  assert.equal(r.band, 'low');
  assert.equal(r.status, 'scored');
});

test('everything found is 100 (High)', () => {
  const r = computeExposure(SCORABLE_IDS.map((id) => ({ id, status: 'found' })), { final: true });
  assert.equal(r.score, 100);
  assert.equal(r.band, 'high');
  assert.equal(r.provisional, false);
});

test('categories with no checked item are skipped and the remaining weights renormalise', () => {
  // only fingerprint (25) and storage (10) active: S = (25*Ef + 10*Es)/35
  const fp = idsIn('fingerprint')[0];
  const st = idsIn('storage').find(canClear);
  const r = computeExposure([{ id: fp, status: 'found' }, { id: st, status: 'clear' }]);
  assert.deepEqual(r.excluded_categories.sort(), ['behavior', 'device', 'language', 'orientation', 'privacy', 'security', 'social']);
  assert.equal(r.categories.fingerprint.exposure, 100);
  assert.equal(r.categories.storage.exposure, 0);
  assert.equal(r.score, Math.floor((25 * 100 + 10 * 0) / 35 + 0.5)); // 71.43 -> 71
  assert.equal(r.band, 'high');
});

test('mixed severities weight inside a category', () => {
  const fpIds = idsIn('fingerprint');
  const high = fpIds.find((id) => itemInfo(id).severity === 3);
  const low = fpIds.find((id) => itemInfo(id).severity === 1);
  assert.ok(high && low);
  const hf = computeExposure([{ id: high, status: 'found' }, { id: low, status: 'not_checked' }]);
  assert.equal(hf.categories.fingerprint.exposure, 100);
  // low found, high checked: only possible if the high item can be clear; otherwise use found for both and compare
  const both = computeExposure([{ id: high, status: 'found' }, { id: low, status: canClear(low) ? 'clear' : 'found' }]);
  if (canClear(low)) assert.equal(both.categories.fingerprint.exposure, percentHalfUp(3, 4)); // 75
});

test('determinism and input-order invariance (200 random scans)', () => {
  const r = rng(7471);
  for (let i = 0; i < 200; i++) {
    const scan = randomScan(r);
    const a = computeExposure(scan);
    const b = computeExposure(scan);
    const c = computeExposure(shuffle(scan, r));
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  }
});

test('score is always a whole number within 0-100 and band matches (500 random scans)', () => {
  const r = rng(40);
  for (let i = 0; i < 500; i++) {
    const res = computeExposure(randomScan(r));
    if (res.score === null) continue;
    assert.ok(Number.isInteger(res.score) && res.score >= 0 && res.score <= 100);
    assert.equal(res.band, bandFor(res.score));
    assert.ok(res.coverage.percent >= 0 && res.coverage.percent <= 100);
  }
});

test('monotonic: with the checked set fixed, turning clear into found never lowers the score (300 random scans, every flip)', () => {
  const r = rng(70);
  for (let i = 0; i < 300; i++) {
    const scan = randomScan(r);
    const base = computeExposure(scan);
    scan.forEach((it, k) => {
      if (it.status !== 'clear') return;
      const flipped = scan.map((x, j) => (j === k ? { ...x, status: 'found' } : x));
      const after = computeExposure(flipped);
      assert.ok(after.score >= base.score, `${it.id}: ${base.score} -> ${after.score}`);
      assert.equal(after.coverage.checked, base.coverage.checked);
    });
  }
});

test('not-checked items do not contribute: adding or removing them changes neither score nor band, only coverage stays put', () => {
  const r = rng(54);
  for (let i = 0; i < 200; i++) {
    const scan = randomScan(r);
    const checkedOnly = scan.filter((x) => x.status !== 'not_checked');
    const withNot = computeExposure(scan);
    const without = computeExposure(checkedOnly);
    assert.equal(withNot.score, without.score);
    assert.equal(withNot.band, without.band);
    assert.deepEqual(withNot.coverage, without.coverage);
    assert.deepEqual(withNot.categories, without.categories);
  }
});

test('newly checked evidence CAN change a provisional score (not an invariance requirement)', () => {
  // Same scan, one more item becomes checked: the provisional number may move, and that is allowed and expected.
  const a = idsIn('fingerprint')[0];
  const b = idsIn('storage').find(canClear);
  const before = computeExposure([{ id: a, status: 'found' }, { id: b, status: 'not_checked' }]);
  const after = computeExposure([{ id: a, status: 'found' }, { id: b, status: 'clear' }]);
  assert.equal(before.score, 100);
  assert.equal(after.score, 71);
  assert.notEqual(before.score, after.score);
  assert.equal(before.provisional, true);
});

test('documented edge conflict: clearing/adding a checked item in a NEW category can lower the score (renormalised weights)', () => {
  // This is why "monotonic" is stated with the checked set held fixed. Adding a checked-clear item to a category that was skipped
  // changes the set of active weights, so the score may fall although nothing became less exposed.
  const fp = idsIn('fingerprint')[0];
  const clearItem = SCORABLE_IDS.find((id) => canClear(id) && itemInfo(id).category !== 'fingerprint');
  const before = computeExposure([{ id: fp, status: 'found' }]);
  const after = computeExposure([{ id: fp, status: 'found' }, { id: clearItem, status: 'clear' }]);
  assert.equal(before.score, 100);
  assert.ok(after.score < before.score);
});

test('coverage uses the true registry total Z, not the number reported', () => {
  const one = [{ id: SCORABLE_IDS[0], status: 'found' }];
  assert.equal(computeExposure(one).coverage.total, HEXAGON_COUNT);
  assert.equal(computeExposure(one).coverage.percent, percentHalfUp(1, HEXAGON_COUNT));
  assert.equal(computeExposure(one, { total: 100 }).coverage.percent, 1);
  assert.equal(computeExposure(one, { total: 2 }).coverage.percent, 50);
  const all = computeExposure(SCORABLE_IDS.map((id) => ({ id, status: 'found' })));
  assert.equal(all.coverage.checked, SCORABLE_IDS.length);
  assert.ok(all.coverage.percent < 100, 'the hexagons the site cannot check keep coverage below 100');
  assert.throws(() => computeExposure(one, { total: 0 }));
  assert.throws(() => computeExposure(one, { total: 1.5 }));
  const over = computeExposure(SCORABLE_IDS.slice(0, 5).map((id) => ({ id, status: 'found' })), { total: 3 });
  assert.equal(over.coverage.percent, 100);
  assert.deepEqual(over.warnings, ['checked_exceeds_total']);
});

test('invalid, unknown and duplicate inputs are handled explicitly, never as safe', () => {
  const [a, b] = SCORABLE_IDS;
  const r = computeExposure([
    { id: 'no-such-hexagon', status: 'found' },
    { id: a, status: 'maybe' },
    { id: b, status: 'found' },
    { id: b, status: 'found' },              // same status twice: counted once
    null,
    { id: 42, status: 'found' },
  ]);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['invalid_status', 'unknown_id', 'unknown_id', 'unknown_id']);
  assert.equal(r.counts.found, 1);
  assert.equal(r.counts.checked, 1);

  // conflicting statuses for one id: not checked, in either order
  const c1 = computeExposure([{ id: b, status: 'found' }, { id: b, status: 'clear' }]);
  const c2 = computeExposure([{ id: b, status: 'clear' }, { id: b, status: 'found' }]);
  assert.deepEqual(c1, c2);
  assert.equal(c1.counts.checked, 0);
  assert.equal(c1.score, null);
  assert.ok(c1.rejected.some((x) => x.reason === 'conflicting_status'));

  assert.throws(() => computeExposure('nope'));
});

test('a hexagon the site cannot check is never counted, whatever the client sends; clear is refused where the registry forbids it', () => {
  const cannot = HEXAGONS.find((h) => h.truth.level === 'cannot_be_checked').id;
  const r = computeExposure([{ id: cannot, status: 'found' }]);
  assert.equal(r.counts.checked, 0);
  assert.equal(r.score, null);
  assert.ok(r.rejected.some((x) => x.reason === 'cannot_be_checked'));

  const noClear = SCORABLE_IDS.find((id) => !canClear(id));
  const r2 = computeExposure([{ id: noClear, status: 'clear' }]);
  assert.equal(r2.counts.checked, 0);
  assert.equal(r2.score, null);
  assert.ok(r2.rejected.some((x) => x.reason === 'clear_not_allowed'));
});

test('status names are case-insensitive and accept the registry spelling', () => {
  const id = SCORABLE_IDS.find(canClear);
  assert.equal(computeExposure([{ id, status: 'FOUND' }]).counts.found, 1);
  assert.equal(computeExposure([{ id, status: 'CHECKED_AND_CLEAR' }]).counts.clear, 1);
  assert.equal(computeExposure([{ id, status: 'NOT_CHECKED' }]).counts.not_checked, 1);
});

test('result carries the version and is provisional unless the caller says final', () => {
  const r = computeExposure([{ id: SCORABLE_IDS[0], status: 'found' }]);
  assert.equal(r.score_version, SCORE_VERSION);
  assert.equal(SCORE_VERSION, 'exposure-v1');
  assert.equal(r.provisional, true);
  assert.equal(computeExposure([{ id: SCORABLE_IDS[0], status: 'found' }], { final: true }).provisional, false);
});

// KNOWN LIMITATION, recorded on purpose and NOT a requirement (see docs/exposure-score-spec.md, "Open decision O-1"): only 5 of the 54 registry hexagons
// can ever be CHECKED AND CLEAR (3 storage, 2 security). In every other category a checked item is necessarily FOUND, so its category exposure is 100.
// With the proposed weights a scan that checked every item the site can check scores at least 83 even if everything clearable is clear, so Low and Medium
// are unreachable on a complete scan. If the weights, severity map or registry change, this test changes with them, and Chris should see the new range.
test('KNOWN LIMITATION: the lowest score of a complete scan is 83 (High); Low and Medium only occur on partial scans', () => {
  const lowestFull = computeExposure(SCORABLE_IDS.map((id) => ({ id, status: canClear(id) ? 'clear' : 'found' })), { final: true });
  assert.equal(lowestFull.score, 83);
  assert.equal(lowestFull.band, 'high');
  assert.equal(SCORABLE_IDS.filter(canClear).length, 5);
  assert.equal(SCORABLE_IDS.length, 47);
  assert.equal(lowestFull.coverage.percent, 87);   // 47 of 54: the 7 hexagons the site cannot check cap coverage at 87%
  // Low is reachable only when the checked set is dominated by clearable items.
  const onlyClear = computeExposure(SCORABLE_IDS.filter(canClear).map((id) => ({ id, status: 'clear' })));
  assert.equal(onlyClear.score, 0);
  assert.equal(onlyClear.band, 'low');
});
