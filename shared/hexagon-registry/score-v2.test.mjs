// MPC-11569: exposure-v2 under plain node. v1 is pinned at 54 and must not move; v2 is the 54 plus the 7 email hexagons = 61.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGONS, HEXAGON_COUNT, EMAIL_HEXAGONS } from './registry.js';
import { SCORE_VERSION, CATEGORY_WEIGHTS, WEIGHT_TOTAL, computeExposure, SCORABLE_IDS } from './score.js';
import {
  SCORE_VERSION_V2, CATEGORY_WEIGHTS_V2, SCORED_IDS_V2, SCORED_TOTAL_V2, EMAIL_IDS_V2, WEB_IDS_V2, EMAIL_CLASSIFICATION, LIVE_EMAIL_IDS_V2,
  SCORE_V2_EXPLANATION, computeExposureV2, itemInfoV2,
} from './score-v2.js';
import { WEB_COMPLETE, WEB_LIGHT, EMAIL_OBSERVED, EMAIL_IF_FOUND, beforeAfterRows } from './score-v2.fixtures.mjs';

const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

test('v1 is untouched: still 54, exposure-v1, weights sum 100, email ids unknown to it', () => {
  assert.equal(HEXAGON_COUNT, 54);
  assert.equal(SCORE_VERSION, 'exposure-v1');
  assert.equal(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0), WEIGHT_TOTAL);
  assert.equal(computeExposure([], { final: true }).coverage.total, 54);
  const r = computeExposure([{ id: 'email-name', status: 'found' }], { final: true });
  assert.deepEqual(r.rejected, [{ id: 'email-name', reason: 'unknown_id' }]);
  assert.equal(r.score, null);
});

test('v2 scored set is 54 web + 7 email = 61 (asserted, not derived)', () => {
  assert.equal(SCORED_TOTAL_V2, 61);
  assert.equal(SCORED_IDS_V2.length, 61);
  assert.equal(new Set(SCORED_IDS_V2).size, 61);
  assert.equal(WEB_IDS_V2.length, 54);
  assert.equal(EMAIL_IDS_V2.length, 7);
  assert.deepEqual([...EMAIL_IDS_V2], ['email-breaches', 'email-name', 'email-provider', 'email-profile', 'email-libravatar', 'email-domain-record', 'email-github-commits']);
  assert.equal(SCORE_VERSION_V2, 'exposure-v2');
  assert.equal(computeExposureV2([], { final: true }).coverage.total, 61);
  assert.equal(computeExposureV2([], { final: true }).score, null);
  for (const id of SCORED_IDS_V2) assert.ok(itemInfoV2(id), id);
  assert.equal(CATEGORY_WEIGHTS_V2.email, 10);
  for (const [k, w] of Object.entries(CATEGORY_WEIGHTS)) assert.equal(CATEGORY_WEIGHTS_V2[k], w, `v1 weight ${k} unchanged in v2`);
});

test('classification: 6 of 7 are Live at first contact, email-breaches stays In build, none needs a forwarded message', () => {
  assert.deepEqual(Object.keys(EMAIL_CLASSIFICATION).sort(), [...EMAIL_IDS_V2].sort());
  assert.deepEqual([...LIVE_EMAIL_IDS_V2].sort(), ['email-domain-record', 'email-github-commits', 'email-libravatar', 'email-name', 'email-profile', 'email-provider']);
  assert.equal(EMAIL_CLASSIFICATION['email-breaches'].tile, 'in_build');
  assert.ok(Object.values(EMAIL_CLASSIFICATION).every((c) => c.needsForward === false));
  // The registry itself says breaches is not built; the classification must agree with it.
  assert.match(EMAIL_HEXAGONS.find((h) => h.id === 'email-breaches').build_status, /^not built/);
  for (const h of EMAIL_HEXAGONS.filter((x) => LIVE_EMAIL_IDS_V2.includes(x.id))) assert.equal(h.build_status, 'built', h.id);
});

test('parity: with no email result v2 scores exactly what v1 scores (score, band, categories); only coverage differs (Z 61 vs 54)', () => {
  const r = rng(11);
  for (let i = 0; i < 500; i++) {
    const web = SCORABLE_IDS.map((id) => ({ id, status: ['found', 'clear', 'not_checked'][Math.floor(r() * 3)] }));
    const v1 = computeExposure(web, { final: true });
    const v2 = computeExposureV2(web, { final: true });
    assert.equal(v2.score, v1.score);
    assert.equal(v2.band, v1.band);
    assert.equal(v2.counts.checked, v1.counts.checked);
    assert.equal(v2.coverage.total, 61);
    for (const k of Object.keys(CATEGORY_WEIGHTS)) assert.deepEqual(v2.categories[k], v1.categories[k]);
    assert.equal(v2.categories.email.severity_checked, 0);
  }
  for (const web of [WEB_COMPLETE, WEB_LIGHT]) {
    const v1 = computeExposure(web, { final: true });
    const v2 = computeExposureV2(web, { final: true });
    assert.equal(v2.score, v1.score);
    assert.equal(v1.coverage.total, 54);
    assert.equal(v2.coverage.total, 61);
    assert.ok(v2.coverage.percent < v1.coverage.percent, 'same checks over a bigger total: coverage falls');
  }
});

test('email-breaches can never move the score: found or clear is demoted to not checked (not built)', () => {
  for (const status of ['found', 'clear']) {
    const r = computeExposureV2([...WEB_COMPLETE, { id: 'email-breaches', status }], { final: true });
    assert.deepEqual(r.rejected, [{ id: 'email-breaches', reason: 'not_built' }]);
    assert.equal(r.score, computeExposure(WEB_COMPLETE, { final: true }).score);
    assert.equal(r.categories.email.severity_checked, 0);
    assert.equal(r.counts.checked, computeExposure(WEB_COMPLETE, { final: true }).counts.checked);
  }
});

test('email-provider is informational: clear is demoted; the other five email checks may be clear', () => {
  assert.equal(computeExposureV2([{ id: 'email-provider', status: 'clear' }]).rejected[0].reason, 'clear_not_allowed');
  for (const id of ['email-name', 'email-profile', 'email-libravatar', 'email-domain-record', 'email-github-commits']) {
    assert.deepEqual(computeExposureV2([{ id, status: 'clear' }]).rejected, [], id);
  }
});

test('v2 bad input is handled like v1: unknown id, invalid status, conflicting status, duplicates', () => {
  const r = computeExposureV2([
    { id: 'nope', status: 'found' }, { id: 'email-name', status: 'maybe' },
    { id: 'email-profile', status: 'found' }, { id: 'email-profile', status: 'clear' },
    { id: 'email-libravatar', status: 'found' }, { id: 'email-libravatar', status: 'found' },
  ], { final: true });
  assert.deepEqual(r.rejected.map((x) => `${x.id}:${x.reason}`).sort(), ['email-name:invalid_status', 'email-profile:conflicting_status', 'nope:unknown_id']);
  assert.equal(r.counts.checked, 1);
  assert.throws(() => computeExposureV2([], { total: 0 }));
  assert.throws(() => computeExposureV2('x'));
});

test('email category: weight 10 over the categories present, exact and half-up', () => {
  // Email alone: found severity 2 (provider) of checked 2+2 (provider + name clear) = 50 -> score 50 (single category, weight irrelevant).
  const alone = computeExposureV2([{ id: 'email-provider', status: 'found' }, { id: 'email-name', status: 'clear' }], { final: true });
  assert.equal(alone.score, 50);
  assert.equal(alone.categories.email.exposure, 50);
  // Hand check on fixture B: v1 score S1 = round(sum(w E)/sum(w)); adding an all-clear email category (E=0, w=10) pulls it down: S2 = round(S1num/(W+10)).
  const v1 = computeExposure(WEB_LIGHT, { final: true });
  const v2 = computeExposureV2([...WEB_LIGHT, { id: 'email-name', status: 'clear' }], { final: true });
  const activeW = Object.values(v1.categories).filter((c) => c.severity_checked > 0).reduce((a, c) => a + c.weight, 0);
  const num = Object.values(v1.categories).filter((c) => c.severity_checked > 0).reduce((a, c) => a + c.weight * c.exposure, 0);
  assert.equal(v2.score, Math.round(num / (activeW + 10) + 1e-9));
  assert.ok(v2.score < v1.score);
});

test('monotonic with the checked set fixed: clear -> found on an email check never lowers v2', () => {
  for (const web of [WEB_COMPLETE, WEB_LIGHT]) {
    for (const id of ['email-name', 'email-profile', 'email-libravatar', 'email-domain-record', 'email-github-commits']) {
      const clear = computeExposureV2([...web, { id, status: 'clear' }], { final: true }).score;
      const found = computeExposureV2([...web, { id, status: 'found' }], { final: true }).score;
      assert.ok(found >= clear, `${id}: found ${found} >= clear ${clear}`);
    }
  }
});

test('before/after table: every email hexagon is invisible to v1 (unknown_id) and counted by v2; breaches changes coverage denominator only', () => {
  const rows = beforeAfterRows(EMAIL_OBSERVED);
  assert.equal(rows.length, 2 * (7 + 2));
  for (const row of rows.filter((x) => EMAIL_IDS_V2.includes(x.id))) {
    assert.deepEqual(row.v1.rejected, [`${row.id}:unknown_id`], 'v1 cannot see it');
    if (row.id === 'email-breaches') assert.deepEqual(row.v2.rejected, [], 'not_checked is accepted as is');
  }
  for (const fixture of ['A complete web scan', 'B light web scan']) {
    const fr = rows.filter((x) => x.fixture === fixture);
    const base = fr.find((x) => x.id === 'no email result');
    assert.equal(fr.find((x) => x.id === 'email-breaches').v2.score, base.v2.score, 'breaches never moves the score');
    assert.equal(base.v1.score, base.v2.score, 'no email: same score');
  }
  // Every hexagon, if it found something, is still counted (not rejected) except breaches.
  for (const id of EMAIL_IDS_V2.filter((x) => x !== 'email-breaches')) {
    assert.equal(computeExposureV2([...WEB_COMPLETE, { id, status: EMAIL_IF_FOUND[id] }]).counts.found, computeExposure(WEB_COMPLETE).counts.found + 1);
  }
});

test('the explanation sentence is fixed text and rides on every v2 result', () => {
  assert.equal(SCORE_V2_EXPLANATION, 'We now check more things than before, so your score can change. You did not become more exposed.');
  assert.equal(computeExposureV2([], {}).explanation, SCORE_V2_EXPLANATION);
});

test('the registry still holds exactly the 54 web ids apart from the email list', () => {
  assert.equal(HEXAGONS.length, 54);
  assert.equal(new Set([...HEXAGONS.map((h) => h.id), ...EMAIL_HEXAGONS.map((h) => h.id)]).size, 61);
});
