// MPC-11622: Telegram validation. >= 10 synthetic profiles (the fixture table), monotonic, floor, deterministic. Run: node --test shared/exposure/channels/telegram.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TELEGRAM_EXPOSURE, TELEGRAM_NOT_SCORED, TELEGRAM_SCOPE_VERSION, scoreTelegram, telegramChanges } from './telegram.js';
import { FIXTURES, ALWAYS_SENT, observationsOf, fixtureTable } from './telegram.fixtures.js';
import { computeScore, scoreExposure, positionText, NOT_RETURNED_COPY } from '../exposure.js';
import { TELEGRAM_HEXAGONS } from '../../hexagon-registry/channels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEF = TELEGRAM_EXPOSURE;

test('scope: 25 fields = 8 always sent + 17 settings; total tier weight 52 (always sent 18); floor 35', () => {
  assert.equal(DEF.total, 25); assert.equal(DEF.baseCount, 8); assert.equal(DEF.settingsCount, 17);
  assert.equal(DEF.totalWeight, 52); assert.equal(DEF.baseWeight, 18); assert.equal(DEF.floor, 35);
  assert.equal(TELEGRAM_SCOPE_VERSION, 'telegram-scope-1');
});

test('the tier table is pinned: change a tier or the scope and this fails until TELEGRAM_SCOPE_VERSION is bumped on purpose', () => {
  const table = DEF.fields.map((f) => `${f.id}:${f.group}:${f.tier}`).join('\n');
  assert.equal(table, [
    'tg.numeric_id:base:medium', 'tg.first_name:base:high', 'tg.last_name:base:high', 'tg.username:base:high', 'tg.language:base:medium', 'tg.message_time:base:medium', 'tg.message_text:base:medium', 'tg.update_counter:base:low',
    'tg.bio:settings:medium', 'tg.birthday:settings:high', 'tg.photo_current:settings:high', 'tg.photo_history:settings:high', 'tg.photo_fingerprint:settings:medium', 'tg.extra_usernames:settings:high', 'tg.premium:settings:medium',
    'tg.emoji_status:settings:low', 'tg.profile_colour:settings:medium', 'tg.profile_background:settings:medium', 'tg.gift_settings:settings:low', 'tg.business_intro:settings:low', 'tg.business_location:settings:high',
    'tg.business_hours:settings:low', 'tg.personal_channel:settings:medium', 'tg.forward_privacy:settings:medium', 'tg.voice_restriction:settings:low',
  ].join('\n'));
});

test('every Telegram hexagon is either scored or listed as not scored with a reason (nothing silently dropped), and tiers are weights, not categories', () => {
  const scored = new Set(DEF.fields.map((f) => f.id));
  for (const h of TELEGRAM_HEXAGONS) {
    if (h.arrival === 'C' || h.arrival === 'D') assert.ok(!scored.has(h.id) || h.enabled, h.id);
    assert.ok(scored.has(h.id) || Object.hasOwn(TELEGRAM_NOT_SCORED, h.id) || !h.enabled, `${h.id} is neither scored nor explained`);
  }
  for (const id of Object.keys(TELEGRAM_NOT_SCORED)) assert.ok(TELEGRAM_HEXAGONS.some((h) => h.id === id), `${id} is not a Telegram hexagon`);
  for (const f of DEF.fields) assert.ok([1, 2, 3].includes(f.weight));
});

test('fixture table: at least 10 synthetic profiles, each matching its hand-worked expectation', () => {
  assert.ok(FIXTURES.length >= 10);
  assert.equal(new Set(FIXTURES.map((f) => f.id)).size, FIXTURES.length);
  for (const fx of FIXTURES) {
    const r = scoreTelegram(observationsOf(fx));
    assert.equal(r.status, 'scored', fx.id);
    assert.equal(r.returned, fx.expect.returned, `${fx.id} returned`);
    assert.equal(r.weight.found, fx.expect.found, `${fx.id} found weight`);
    assert.equal(r.score, fx.expect.score, `${fx.id} score`);
    assert.equal(r.position.percent, fx.expect.position, `${fx.id} position`);
    assert.equal(r.position.belowFloor, fx.expect.belowFloor, `${fx.id} belowFloor`);
    assert.equal(r.countText, `${fx.expect.returned} of 25 fields returned`);
  }
  // the four families the rules ask for are all present
  const scores = FIXTURES.map((f) => f.expect.score);
  assert.ok(scores.includes(35) && scores.includes(100) && FIXTURES.some((f) => /default/.test(f.name)) && FIXTURES.some((f) => /partial/.test(f.name)) && FIXTURES.some((f) => /hardened/.test(f.name)));
});

test('the published fixture table in docs matches the live scorer exactly', () => {
  const doc = readFileSync(path.join(here, '..', '..', '..', 'docs', 'exposure-tier-1-telegram-fixtures.md'), 'utf8');
  assert.ok(doc.includes(fixtureTable()), 'docs/exposure-tier-1-telegram-fixtures.md is out of date; regenerate the table from fixtureTable()');
});

test('the floor holds: a complete account never scores below 35, and only the always-sent fields give exactly 35', () => {
  for (const fx of FIXTURES) {
    const complete = ALWAYS_SENT.every((id) => fx.returned.includes(id));
    const r = scoreTelegram(observationsOf(fx));
    if (complete) assert.ok(r.score >= DEF.floor && !r.position.belowFloor, `${fx.id} scored ${r.score} below the floor`);
    // an account missing an always-sent field (no last name, no username) has less than the platform floor to give; the flag must say exactly when it is below it
    else assert.equal(r.position.belowFloor, r.score < DEF.floor, `${fx.id} belowFloor flag`);
    // whatever else, a score is never less than the weight of the always-sent fields that were returned
    const baseFound = DEF.fields.filter((f) => f.group === 'base' && fx.returned.includes(f.id)).reduce((a, f) => a + f.weight, 0);
    assert.ok(r.score >= Math.floor((100 * baseFound) / DEF.totalWeight), `${fx.id} below its own always-sent weight`);
  }
  assert.equal(scoreTelegram(observationsOf(FIXTURES.find((f) => f.id === 'P01'))).score, 35);
  // for every one of the 2^17 settings combinations (always-sent complete) the floor holds and the score never exceeds 100
  const settingsIds = DEF.fields.filter((f) => f.group === 'settings').map((f) => f.id);
  const baseIds = DEF.fields.filter((f) => f.group === 'base').map((f) => f.id);
  for (let mask = 0; mask < 1 << settingsIds.length; mask++) {
    const s = computeScore(DEF, [...baseIds, ...settingsIds.filter((_, i) => mask & (1 << i))]);
    assert.ok(s >= DEF.floor && s <= 100);
  }
});

test('monotonic: hardening any one setting never raises the score (checked over all 131,072 combinations of the 17 settings)', () => {
  const settingsIds = DEF.fields.filter((f) => f.group === 'settings').map((f) => f.id);
  const baseIds = DEF.fields.filter((f) => f.group === 'base').map((f) => f.id);
  const n = settingsIds.length; const scores = new Array(1 << n);
  for (let mask = 0; mask < 1 << n; mask++) scores[mask] = computeScore(DEF, [...baseIds, ...settingsIds.filter((_, i) => mask & (1 << i))]);
  let strictDrops = 0;
  for (let mask = 0; mask < 1 << n; mask++) for (let i = 0; i < n; i++) if (mask & (1 << i)) { // set bit = returned; clearing it = that setting hardened
    assert.ok(scores[mask ^ (1 << i)] <= scores[mask]);
    if (scores[mask ^ (1 << i)] < scores[mask]) strictDrops++;
  }
  assert.ok(strictDrops > 0);
  assert.equal(scores[0], 35); assert.equal(scores[(1 << n) - 1], 100);
  // and the full function agrees with the fast path on a spread of combinations
  for (let mask = 0; mask < 1 << n; mask += 997) {
    const returned = [...baseIds, ...settingsIds.filter((_, i) => mask & (1 << i))];
    assert.equal(scoreExposure(DEF, DEF.fields.map((f) => ({ id: f.id, state: returned.includes(f.id) ? 'returned' : 'not_returned' }))).score, scores[mask]);
  }
});

test('monotonic along a hardening ladder from fully exposed to all-off, and the position falls with it', () => {
  const order = DEF.fields.filter((f) => f.group === 'settings').map((f) => f.id);
  let returned = DEF.fields.map((f) => f.id); let last = Infinity; let lastPos = Infinity;
  for (let i = 0; i <= order.length; i++) {
    const r = scoreTelegram(DEF.fields.map((f) => ({ id: f.id, state: returned.includes(f.id) ? 'returned' : 'not_returned' })));
    assert.ok(r.score <= last && r.position.percent <= lastPos, `step ${i}`); last = r.score; lastPos = r.position.percent;
    returned = returned.filter((id) => id !== order[i]);
  }
  assert.equal(last, 35);
});

test('deterministic: the same profile gives the same result every run, in any observation order', () => {
  for (const fx of FIXTURES) {
    const o = observationsOf(fx); const first = JSON.stringify(scoreTelegram(o));
    for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(scoreTelegram(o)), first);
    assert.equal(JSON.stringify(scoreTelegram([...o].reverse())), first);
  }
});

test('identical settings score identically: a profile that differs only by "effort" fields in the input scores the same', () => {
  for (const fx of FIXTURES) {
    const o = observationsOf(fx);
    const decorated = o.map((x) => ({ ...x, selfConfirmed: true, fixed: true, recheckOutcome: 'verified_change', changed: true, default: true }));
    assert.deepEqual(scoreTelegram(decorated), scoreTelegram(o));
  }
});

test('fix list on every fixture: sorted by points recoverable, total shown, and each figure is the exact drop', () => {
  for (const fx of FIXTURES) {
    const o = observationsOf(fx); const r = scoreTelegram(o);
    for (let i = 1; i < r.fixes.length; i++) assert.ok(r.fixes[i - 1].points >= r.fixes[i].points - 1, `${fx.id} order`); // exact-weight order; rounded points can tie
    for (const f of r.fixes) assert.equal(r.score - scoreTelegram(o.map((x) => (f.fields.includes(x.id) ? { ...x, state: 'not_returned' } : x))).score, f.points);
    assert.equal(r.recoverable.points, r.bar.settings.points); assert.equal(r.recoverable.items, r.fixes.length);
    assert.equal(r.score - r.recoverable.points, r.bar.base.points);
  }
  const p9 = scoreTelegram(observationsOf(FIXTURES.find((f) => f.id === 'P09')));
  assert.equal(p9.recoverable.text, '27 points from 6 settings you can change');
});

test('the owner example: 14 returned reads "Exposure 62 · 14 of 25 fields returned" and the old method said 14 of 30 = 47%', () => {
  const r = scoreTelegram(observationsOf(FIXTURES.find((f) => f.id === 'P09')));
  assert.equal(`Exposure ${r.score} · ${r.countText}`, 'Exposure 62 · 14 of 25 fields returned');
  assert.equal(Math.round((14 / 30) * 100), 47);
});

test('Telegram bar is 8 always-sent fields under 17 settings fields', () => {
  const r = scoreTelegram(observationsOf(FIXTURES.find((f) => f.id === 'P11')));
  assert.deepEqual(r.bar.base.fields, { returned: 8, total: 8 }); assert.deepEqual(r.bar.settings.fields, { returned: 17, total: 17 });
  assert.equal(r.bar.base.points, 35); assert.equal(r.bar.settings.points, 65);
});

test('Changes indicator on Telegram: 3 of 4 settings changed, from re-scan observations only', () => {
  const before = observationsOf({ returned: [...ALWAYS_SENT, 'tg.bio', 'tg.birthday', 'tg.photo_current', 'tg.photo_fingerprint'] });
  const after = observationsOf({ returned: [...ALWAYS_SENT, 'tg.bio'] });
  const c = telegramChanges(before, after);
  assert.equal(c.text, '3 of 4 settings changed');
  // the score fell by the same facts, but the Changes indicator is not an input to it
  assert.ok(scoreTelegram(after).score < scoreTelegram(before).score);
});

test('copy: position line names the floor; not-returned copy is the rules text', () => {
  const r = scoreTelegram(observationsOf(FIXTURES.find((f) => f.id === 'P09')));
  assert.match(positionText(r), /42% of the range you can change/); assert.match(positionText(r), /lowest possible score is 35/);
  assert.match(NOT_RETURNED_COPY, /single scan cannot tell the difference/);
});
