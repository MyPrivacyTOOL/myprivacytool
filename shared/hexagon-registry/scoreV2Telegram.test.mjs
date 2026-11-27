// MPC-11569 (Telegram): the Telegram hexagons in the exposure-v2 scored set. v1 and the report's v2 (web + email) must not move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGON_COUNT } from './registry.js';
import { TELEGRAM_HEXAGONS } from './channels.js';
import { SCORABLE_IDS, computeExposure } from './score.js';
import { HEXAGON_COUNT_V2, EMAIL_SCORED_IDS, EMAIL_NOT_SCORED, computeExposureV2, totalForV2, CATEGORY_WEIGHTS_V2, SCORED_HEXAGONS_V2 } from './scoreV2.js';
import {
  TELEGRAM_SCORED_IDS, TELEGRAM_NOT_SCORED, TELEGRAM_CATEGORY_WEIGHT, CATEGORY_WEIGHTS_V2_ALL, HEXAGON_COUNT_V2_ALL, SCORED_HEXAGONS_V2_ALL,
  totalForV2All, telegramStatus, telegramItems, computeExposureV2All, itemInfoV2All,
} from './scoreV2Telegram.js';
import { OWNER_TEST_SNAPSHOT, WORST_ACCOUNT, MINIMAL_ACCOUNT, oldTelegramRisk, newTelegramScore, summaryRows } from './scoreV2Telegram.fixtures.mjs';

const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

test('v1 and the report scorer are untouched: 54 and 60', () => {
  assert.equal(HEXAGON_COUNT, 54);
  assert.equal(HEXAGON_COUNT_V2, 60);
  assert.equal(computeExposure([], { final: true }).coverage.total, 54);
  assert.equal(computeExposureV2([], { final: true }).coverage.total, 60);
  assert.equal(totalForV2(true), 60);
  assert.equal(totalForV2(false), 54);
  assert.ok(!SCORED_HEXAGONS_V2.some((h) => h.id.startsWith('tg.')), 'no Telegram id leaks into the report scorer (scan-report must not bundle channels/catalogue)');
});

test('30 Telegram hexagons: 25 scored, 5 not scored with a reason; total with web and email = 85', () => {
  assert.equal(TELEGRAM_HEXAGONS.length, 30);
  assert.equal(TELEGRAM_SCORED_IDS.length, 25);
  assert.deepEqual(Object.keys(TELEGRAM_NOT_SCORED).sort(), ['tg.channel_posts', 'tg.group_role', 'tg.location_shared', 'tg.message_counter', 'tg.phone_shared']);
  for (const reason of Object.values(TELEGRAM_NOT_SCORED)) assert.ok(reason.length > 10);
  assert.equal(TELEGRAM_SCORED_IDS.length + Object.keys(TELEGRAM_NOT_SCORED).length, 30);
  assert.equal(HEXAGON_COUNT_V2_ALL, 54 + EMAIL_SCORED_IDS.length + 25);
  assert.equal(HEXAGON_COUNT_V2_ALL, 85);
  assert.equal(new Set(SCORED_HEXAGONS_V2_ALL.map((h) => h.id)).size, 85);
  // The brief's 91 (54 + 7 + 30) is short by exactly the hexagons that are not built: 1 email + 5 Telegram.
  assert.equal(54 + 7 + 30 - (Object.keys(EMAIL_NOT_SCORED).length + Object.keys(TELEGRAM_NOT_SCORED).length), 85);
});

test('Z follows the channels a scan covers', () => {
  assert.equal(totalForV2All({ web: true }), 54);
  assert.equal(totalForV2All({ web: true, email: true }), 60);
  assert.equal(totalForV2All({ web: false, telegram: true }), 25);
  assert.equal(totalForV2All({ web: true, email: true, telegram: true }), 85);
  assert.equal(totalForV2All(), 54);
});

test('weights: the ten approved v2 weights unchanged, telegram 10 proposed', () => {
  assert.equal(TELEGRAM_CATEGORY_WEIGHT, 10);
  for (const [k, w] of Object.entries(CATEGORY_WEIGHTS_V2)) assert.equal(CATEGORY_WEIGHTS_V2_ALL[k], w);
  assert.equal(CATEGORY_WEIGHTS_V2_ALL.telegram, 10);
});

test('severity is the approved catalogue risk tier: 6 low, 11 medium, 8 high', () => {
  const sev = TELEGRAM_SCORED_IDS.map((id) => itemInfoV2All(id).severity);
  assert.deepEqual([1, 2, 3].map((n) => sev.filter((x) => x === n).length), [6, 11, 8]);
  assert.equal(itemInfoV2All('tg.first_name').severity, 3);
  assert.equal(itemInfoV2All('tg.update_counter').severity, 1);
});

test('state mapping: returned and user_provided found, not_returned clear, the rest not checked, unknown never guessed', () => {
  assert.deepEqual(['returned', 'user_provided', 'not_returned', 'not_checked', 'check_failed', 'bogus'].map(telegramStatus), ['found', 'found', 'clear', 'not_checked', 'not_checked', 'not_checked']);
});

test('the 5 not-scored hexagons are rejected as not_built and never counted, whatever their state', () => {
  for (const id of Object.keys(TELEGRAM_NOT_SCORED)) {
    for (const status of ['found', 'clear']) {
      const r = computeExposureV2All([{ id, status }, { id: 'tg.first_name', status: 'found' }], { final: true });
      assert.deepEqual(r.rejected, [{ id, reason: 'not_built' }]);
      assert.equal(r.counts.checked, 1, id);
    }
  }
});

test('hand-checked: the owner test snapshot is found 32 of checked 52 = 61.5 -> 62 (half up), coverage 25 of 25', () => {
  const r = newTelegramScore(OWNER_TEST_SNAPSHOT);
  assert.deepEqual([r.score, r.band, r.counts.found, r.counts.clear, r.counts.not_checked], [62, 'medium', 14, 11, 0]);
  assert.deepEqual([r.categories.telegram.severity_found, r.categories.telegram.severity_checked], [32, 52]);
  assert.deepEqual([r.coverage.checked, r.coverage.total, r.coverage.percent], [25, 25, 100]);
  assert.deepEqual(r.rejected.map((x) => `${x.id}:${x.reason}`).sort(), Object.keys(TELEGRAM_NOT_SCORED).sort().map((id) => `${id}:not_built`));
});

test('worst and minimal accounts', () => {
  assert.deepEqual([newTelegramScore(WORST_ACCOUNT).score, newTelegramScore(WORST_ACCOUNT).band], [100, 'high']);
  const m = newTelegramScore(MINIMAL_ACCOUNT);
  assert.deepEqual([m.score, m.band, m.categories.telegram.severity_found], [35, 'low', 18]);
});

test('old number: returned of 30, unweighted; the never-evaluated five cap it at 83%', () => {
  assert.deepEqual(oldTelegramRisk(OWNER_TEST_SNAPSHOT), { returned: 14, possible: 30, percent: 47, band: 'medium' });
  assert.deepEqual(oldTelegramRisk(WORST_ACCOUNT), { returned: 25, possible: 30, percent: 83, band: 'high' });
  assert.equal(summaryRows().length, 3);
});

test('parity: a scan with no Telegram item scores exactly what the report scorer scores (web + email), over 300 random scans', () => {
  const r = rng(29);
  const ids = [...SCORABLE_IDS, ...EMAIL_SCORED_IDS];
  for (let i = 0; i < 300; i++) {
    const items = ids.map((id) => ({ id, status: ['found', 'clear', 'not_checked'][Math.floor(r() * 3)] }));
    const a = computeExposureV2(items, { final: true });
    const b = computeExposureV2All(items, { final: true, total: 60 });
    assert.equal(b.score, a.score);
    assert.equal(b.band, a.band);
    assert.deepEqual(b.rejected, a.rejected);
    assert.equal(b.categories.telegram.severity_checked, 0);
    for (const k of Object.keys(CATEGORY_WEIGHTS_V2)) assert.deepEqual(b.categories[k], a.categories[k]);
  }
});

test('adding the Telegram category moves a combined score by the proposed weight, up or down, never beyond the extremes', () => {
  const web = SCORABLE_IDS.map((id) => ({ id, status: 'found' }));
  const base = computeExposureV2All(web, { final: true }).score;
  const withBare = computeExposureV2All([...web, ...telegramItems(MINIMAL_ACCOUNT)], { final: true, total: 79 }).score;
  const withWorst = computeExposureV2All([...web, ...telegramItems(WORST_ACCOUNT)], { final: true, total: 79 }).score;
  assert.ok(withBare < base, 'a bare Telegram account pulls a high web score down (more checks, not less exposed)');
  assert.ok(withWorst >= withBare, 'returning more never lowers the combined score');
  for (const s of [base, withBare, withWorst]) assert.ok(s >= 0 && s <= 100);
});

test('monotonic with the checked set fixed: not_returned -> returned never lowers the score', () => {
  for (const id of TELEGRAM_SCORED_IDS) {
    const items = telegramItems(MINIMAL_ACCOUNT);
    const clear = computeExposureV2All(items.map((x) => (x.id === id ? { ...x, status: 'clear' } : x)), { final: true, total: 25 }).score;
    const found = computeExposureV2All(items.map((x) => (x.id === id ? { ...x, status: 'found' } : x)), { final: true, total: 25 }).score;
    assert.ok(found >= clear, id);
  }
});
