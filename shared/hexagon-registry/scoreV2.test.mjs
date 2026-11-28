// MPC-11569: exposure-v2 under plain node. The scored set is 60 = the 54 web hexagons + the 6 built email checks; email-breaches stays out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGONS, HEXAGON_COUNT, EMAIL_HEXAGONS, getHexagon } from './registry.js';
import { SCORE_VERSION, CATEGORY_WEIGHTS, WEIGHT_TOTAL, SCORABLE_IDS, computeExposure } from './score.js';
import {
  SCORE_VERSION_V2, EMAIL_SCORED_IDS, EMAIL_NOT_SCORED, SCORED_HEXAGONS_V2, HEXAGON_COUNT_V2, EMAIL_CATEGORY_WEIGHT,
  CATEGORY_WEIGHTS_V2, CATEGORY_OF_V2, WEIGHTS_LABEL_V2, itemInfoV2, isScoredV2, computeExposureV2, totalForV2,
} from './scoreV2.js';
import { SEVERITY_OF_SENSITIVITY } from './score.js';

const BUILT_EMAIL = ['email-name', 'email-provider', 'email-profile', 'email-libravatar', 'email-domain-record', 'email-github-commits'];
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const canClear = (id) => getHexagon(id).status.allowed.includes('CHECKED_AND_CLEAR');
const randomWebScan = (r) => SCORABLE_IDS.map((id) => {
  const x = r();
  return { id, status: x < 0.35 ? 'found' : x < 0.65 && canClear(id) ? 'clear' : 'not_checked' };
});

test('the v2 scored set is 60: the 54 web hexagons plus the 6 built email checks', () => {
  assert.equal(HEXAGON_COUNT_V2, 60);
  assert.equal(SCORED_HEXAGONS_V2.length, 60);
  assert.equal(new Set(SCORED_HEXAGONS_V2.map((h) => h.id)).size, 60, 'unique ids');
  assert.deepEqual([...EMAIL_SCORED_IDS].sort(), [...BUILT_EMAIL].sort());
  assert.equal(HEXAGON_COUNT_V2, HEXAGON_COUNT + EMAIL_SCORED_IDS.length);
});

test('the web 54 and exposure-v1 are untouched', () => {
  assert.equal(HEXAGON_COUNT, 54);
  assert.equal(HEXAGONS.length, 54);
  assert.equal(SCORE_VERSION, 'exposure-v1');
  assert.equal(SCORE_VERSION_V2, 'exposure-v2');
  assert.equal(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0), WEIGHT_TOTAL);
  // v1 still does not know the email checks: it rejects them, it never scores them.
  const v1 = computeExposure([{ id: 'email-provider', status: 'found' }]);
  assert.deepEqual(v1.rejected, [{ id: 'email-provider', reason: 'unknown_id' }]);
  assert.equal(v1.score, null);
  assert.equal(v1.coverage.total, 54);
});

test('email-breaches is NOT scored: it is not built, so it stays out whatever its status, with the registry\'s reason', () => {
  assert.equal(EMAIL_HEXAGONS.length, 7);
  assert.equal(isScoredV2('email-breaches'), false);
  assert.deepEqual({ ...EMAIL_NOT_SCORED }, { 'email-breaches': 'not built: terms unconfirmed' });
  for (const status of ['found', 'clear', 'not_checked']) {
    const r = computeExposureV2([{ id: 'email-breaches', status }]);
    assert.deepEqual(r.rejected, [{ id: 'email-breaches', reason: 'not_built' }]);
    assert.equal(r.score, null);
    assert.equal(r.coverage.checked, 0);
  }
});

test('v2 weights: the nine v1 weights are unchanged, the new email weight is the only addition', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CATEGORY_WEIGHTS_V2).filter(([k]) => k !== 'email')), { ...CATEGORY_WEIGHTS });
  assert.equal(CATEGORY_WEIGHTS_V2.email, EMAIL_CATEGORY_WEIGHT);
  assert.equal(Object.values(CATEGORY_WEIGHTS_V2).reduce((a, b) => a + b, 0), WEIGHT_TOTAL + EMAIL_CATEGORY_WEIGHT);
});

test('every scored email check maps to the email category and a severity (nothing silently dropped)', () => {
  for (const id of EMAIL_SCORED_IDS) {
    const info = itemInfoV2(id);
    assert.ok(info, id);
    assert.equal(info.category, 'email');
    assert.equal(info.severity, SEVERITY_OF_SENSITIVITY[getEmail(id).truth.sensitivity]);
  }
  assert.equal(CATEGORY_OF_V2.email, 'email');
});
function getEmail(id) { return EMAIL_HEXAGONS.find((h) => h.id === id); }

test('a scan with no email item scores EXACTLY the v1 score: only the coverage denominator grows (54 to 60)', () => {
  const r = rng(11569);
  for (let i = 0; i < 300; i++) {
    const scan = randomWebScan(r);
    const a = computeExposure(scan);
    const b = computeExposureV2(scan);
    assert.equal(b.score, a.score);
    assert.equal(b.band, a.band);
    assert.equal(b.coverage.checked, a.coverage.checked);
    assert.equal(a.coverage.total, 54);
    assert.equal(b.coverage.total, 60);
    for (const [k, c] of Object.entries(a.categories)) assert.deepEqual(b.categories[k], c, k);
    assert.equal(b.categories.email.exposure, null);
    assert.ok(b.excluded_categories.includes('email'));
    assert.equal(b.score_version, 'exposure-v2');
  }
});

test('email-provider can never be clear (registry allows found or not checked): a clear is demoted, never counted', () => {
  const r = computeExposureV2([{ id: 'email-provider', status: 'clear' }]);
  assert.equal(r.counts.checked, 0);
  assert.deepEqual(r.rejected, [{ id: 'email-provider', reason: 'clear_not_allowed' }]);
});

test('fixture: the replay scan (src/lib/exposureScore.replay.test.tsx) with the email pattern seen in production', () => {
  // Web: 5 found, 4 clear, 3 not checked (hand calculation in the replay test: S = 55, Medium, coverage 17).
  const web = [
    ['location', 'found'], ['canvas-fingerprint', 'found'], ['webrtc-leak', 'found'], ['timezone-locale', 'found'], ['screen-fingerprint', 'found'],
    ['cookies-status', 'clear'], ['localstorage-status', 'clear'], ['mixed-content', 'clear'], ['https-status', 'clear'],
    ['font-detection', 'not_checked'], ['google-services', 'not_checked'], ['dns-leak', 'not_checked'],
  ].map(([id, status]) => ({ id, status }));
  // Email: what production returned (2026-11-07 to 2026-11-27): provider found, the other five clear. Breaches not built.
  const email = [
    ['email-name', 'clear'], ['email-provider', 'found'], ['email-profile', 'clear'], ['email-libravatar', 'clear'],
    ['email-domain-record', 'clear'], ['email-github-commits', 'clear'],
  ].map(([id, status]) => ({ id, status }));
  const v1 = computeExposure(web, { final: true });
  assert.deepEqual([v1.score, v1.band, v1.coverage.checked, v1.coverage.total, v1.coverage.percent], [55, 'medium', 9, 54, 17]);
  const v2 = computeExposureV2([...web, ...email], { final: true });
  // E_email = 2/12 = 17 (half-up of 16.67); S = round_half_up((5*100 + 25*100 + 10*16.67) / 65) = round_half_up(48.72) = 49.
  assert.deepEqual([v2.score, v2.band, v2.coverage.checked, v2.coverage.total, v2.coverage.percent], [49, 'medium', 15, 60, 25]);
  assert.equal(v2.categories.email.exposure, 17);
  assert.deepEqual(v2.rejected, []);
});

test('order does not matter and duplicates behave as in v1', () => {
  const items = [{ id: 'email-name', status: 'found' }, { id: 'location', status: 'found' }, { id: 'email-profile', status: 'clear' }];
  const a = computeExposureV2(items);
  const b = computeExposureV2([...items].reverse());
  assert.deepEqual(a, b);
  const dup = computeExposureV2([{ id: 'email-name', status: 'found' }, { id: 'email-name', status: 'clear' }]);
  assert.deepEqual(dup.rejected, [{ id: 'email-name', reason: 'conflicting_status' }]);
  assert.equal(dup.counts.checked, 0);
  assert.throws(() => computeExposureV2([], { total: 0 }), RangeError);
});

test('Z follows whether the email checks can apply: 60 with an address, 54 for a page-only scan (coverage is not lowered by checks that never applied)', () => {
  assert.equal(totalForV2(true), 60);
  assert.equal(totalForV2(false), 54);
  const r = rng(7);
  for (let i = 0; i < 100; i++) {
    const scan = randomWebScan(r);
    const a = computeExposure(scan);
    const b = computeExposureV2(scan, { total: totalForV2(false) });
    assert.deepEqual(b.coverage, a.coverage, 'page-only scan: coverage identical to v1');
    assert.equal(b.score, a.score);
  }
});

test('the email weight is labelled interim and approved (2026-11-27), never "proposed"', () => {
  assert.equal(EMAIL_CATEGORY_WEIGHT, 10);
  assert.match(WEIGHTS_LABEL_V2, /interim, approved 2026-11-27/);
  assert.doesNotMatch(WEIGHTS_LABEL_V2, /PROPOSED|awaiting/i);
});
