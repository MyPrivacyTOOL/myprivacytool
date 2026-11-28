// MPC-11622: the channel-agnostic core, tested with a TOY channel that is not Telegram, to prove the module has no Telegram in it
// (web, email and WhatsApp plug in with their own definition and no fork). Run: node --test shared/exposure/exposure.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  EXPOSURE_METHOD, TIER_WEIGHT, GROUPS, NOT_RETURNED_COPY, FORBIDDEN_FOR_NOT_RETURNED,
  defineChannel, scoreExposure, scoreFromWeights, computeScore, changesIndicator, methodChangeSentence, countText, recoverableText, positionText,
} from './exposure.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// A made-up channel: 2 always-sent fields (weights 3+1 = 4) and 4 settings fields (3, 2, 2, 1 = 8). Total 12, floor round(100*4/12) = 33.
const TOY = defineChannel({
  channel: 'TOY', label: 'Toy', scopeVersion: 'toy-scope-1',
  fields: [
    { id: 'toy.a1', tier: 'high', group: 'base' }, { id: 'toy.a2', tier: 'low', group: 'base' },
    { id: 'toy.s1', tier: 'high', group: 'settings', label: 'S1' }, { id: 'toy.s2', tier: 'medium', group: 'settings' },
    { id: 'toy.s3', tier: 'medium', group: 'settings' }, { id: 'toy.s4', tier: 'low', group: 'settings' },
  ],
});
const obs = (def, returned) => def.fields.map((f) => ({ id: f.id, state: returned.includes(f.id) ? 'returned' : 'not_returned' }));

test('tiers are low 1, medium 2, high 3 and nothing else is a weight', () => {
  assert.deepEqual({ ...TIER_WEIGHT }, { low: 1, medium: 2, high: 3 });
  assert.equal(EXPOSURE_METHOD, 'exposure-tier-1');
  assert.throws(() => defineChannel({ channel: 'X', scopeVersion: 'v', fields: [{ id: 'x', tier: 'critical', group: 'base' }] }), /tier/);
  assert.throws(() => defineChannel({ channel: 'X', scopeVersion: 'v', fields: [{ id: 'x', tier: 'low', group: 'category:identity' }] }), /group/);
});

test('formula: round_half_up(100 * weight of returned / weight scored), fixed denominator', () => {
  assert.equal(TOY.totalWeight, 12); assert.equal(TOY.floor, 33);
  const r = scoreExposure(TOY, obs(TOY, ['toy.a1', 'toy.a2', 'toy.s1'])); // 4 + 3 = 7 of 12 = 58.33
  assert.equal(r.score, 58); assert.equal(r.countText, '3 of 6 fields returned');
  assert.equal(scoreFromWeights(1, 2), 50); assert.equal(scoreFromWeights(1, 8), 13); // 12.5 rounds up, never down
  assert.equal(scoreFromWeights(0, 5), 0); assert.equal(scoreFromWeights(5, 5), 100);
});

test('the denominator is fixed: a field that did not come back stays in it and adds 0', () => {
  const none = scoreExposure(TOY, obs(TOY, []));
  assert.equal(none.score, 0); assert.equal(none.weight.scored, 12); assert.equal(none.scored, 6);
  const some = scoreExposure(TOY, obs(TOY, ['toy.s1']));
  assert.equal(some.weight.scored, 12);
});

test('an unobserved scope field makes the result incomplete: no score is invented and the denominator does not shrink', () => {
  const partial = obs(TOY, ['toy.a1']).filter((o) => o.id !== 'toy.s4');
  const r = scoreExposure(TOY, partial);
  assert.equal(r.status, 'incomplete'); assert.equal(r.score, null); assert.equal(r.countText, null); assert.deepEqual(r.unobserved, ['toy.s4']);
  const failed = obs(TOY, ['toy.a1']).map((o) => (o.id === 'toy.s2' ? { id: o.id, state: 'check_failed' } : o));
  assert.equal(scoreExposure(TOY, failed).status, 'incomplete');
  const conflict = [...obs(TOY, []), { id: 'toy.s1', state: 'returned' }];
  const c = scoreExposure(TOY, conflict);
  assert.equal(c.status, 'incomplete'); assert.deepEqual(c.rejected, [{ id: 'toy.s1', reason: 'conflicting_state' }]);
});

test('ids outside the scope are ignored and listed, never counted', () => {
  const r = scoreExposure(TOY, [...obs(TOY, ['toy.s1']), { id: 'toy.extra', state: 'returned' }]);
  assert.equal(r.score, scoreExposure(TOY, obs(TOY, ['toy.s1'])).score); assert.deepEqual(r.ignored, ['toy.extra']);
});

test('NO effort, awareness, default-ness, "I fixed it" or wizard input can reach the score: extra properties on an observation are ignored', () => {
  const plain = obs(TOY, ['toy.a1', 'toy.s1', 'toy.s3']);
  const decorated = plain.map((o) => ({ ...o, selfConfirmed: true, fixed: true, changedFromDefault: true, fromDefault: true, wizardComplete: true, intention: 'fix', effort: 99, bonus: 50, aware: true, weight: 100, tier: 'low' }));
  assert.deepEqual(scoreExposure(TOY, decorated), scoreExposure(TOY, plain));
  // and the function takes no third argument that could carry one
  assert.equal(scoreExposure.length, 2); assert.equal(computeScore.length, 2);
});

test('identical settings score identically, whatever the order of the observations', () => {
  const a = obs(TOY, ['toy.a1', 'toy.s2']);
  assert.deepEqual(scoreExposure(TOY, [...a].reverse()), scoreExposure(TOY, a));
});

test('stacked bar: grey base "Always sent" plus coloured "Your settings", and they add up to the score', () => {
  const r = scoreExposure(TOY, obs(TOY, ['toy.a1', 'toy.a2', 'toy.s1', 'toy.s2']));
  assert.equal(r.bar.base.label, 'Always sent'); assert.equal(r.bar.settings.label, 'Your settings');
  assert.equal(r.bar.base.points + r.bar.settings.points, r.score);
  assert.equal(r.bar.base.capacity, TOY.floor); assert.equal(r.bar.base.capacity + r.bar.settings.capacity, 100);
  assert.deepEqual(r.bar.base.fields, { returned: 2, total: 2 }); assert.deepEqual(r.bar.settings.fields, { returned: 2, total: 4 });
  assert.equal(GROUPS.base.note, 'This part is the platform, not your settings.');
});

test('position within the achievable range = (exposure - floor) / (100 - floor), clamped at 0 below the floor and flagged', () => {
  assert.equal(scoreExposure(TOY, obs(TOY, ['toy.a1', 'toy.a2'])).position.percent, 0);
  assert.equal(scoreExposure(TOY, obs(TOY, TOY.fields.map((f) => f.id))).position.percent, 100);
  const mid = scoreExposure(TOY, obs(TOY, ['toy.a1', 'toy.a2', 'toy.s1', 'toy.s2'])); // 9/12 = 75; (75-33)/67 = 62.7
  assert.equal(mid.score, 75); assert.equal(mid.position.percent, 63);
  const sparse = scoreExposure(TOY, obs(TOY, ['toy.a1'])); // 3/12 = 25, below the floor of 33
  assert.equal(sparse.position.belowFloor, true); assert.equal(sparse.position.percent, 0); assert.match(positionText(sparse), /below the usual floor/);
});

test('fix list is ordered by points recoverable (exact drop), not by risk tier, and bundles are one item', () => {
  const B = defineChannel({
    channel: 'B', scopeVersion: 'b-1',
    fields: [
      { id: 'b.base', tier: 'low', group: 'base' },
      { id: 'b.high', tier: 'high', group: 'settings' }, // alone: 3
      { id: 'b.m1', tier: 'medium', group: 'settings' }, { id: 'b.m2', tier: 'medium', group: 'settings' }, { id: 'b.m3', tier: 'medium', group: 'settings' }, // one setting controls all three: 6
    ],
    bundles: [{ id: 'b.group', label: 'One setting, three fields', fields: ['b.m1', 'b.m2', 'b.m3'] }],
  });
  const r = scoreExposure(B, obs(B, B.fields.map((f) => f.id)));
  assert.deepEqual(r.fixes.map((f) => f.id), ['b.group', 'b.high']); // the medium-tier bundle outranks the single high-tier field
  assert.ok(r.fixes[0].points > r.fixes[1].points);
  assert.equal(r.recoverable.items, 2);
  // a bundle only counts the fields that actually came back
  const part = scoreExposure(B, obs(B, ['b.base', 'b.m1', 'b.high']));
  assert.deepEqual(part.fixes.map((f) => [f.id, f.fields.length]), [['b.high', 1], ['b.group', 1]]);
  assert.throws(() => defineChannel({ channel: 'C', scopeVersion: 'c', fields: [{ id: 'c.a', tier: 'low', group: 'base' }], bundles: [{ id: 'g', fields: ['c.a'] }] }), /not a settings field/);
});

test('every fix item points figure is falsifiable: re-scoring without that item drops the score by exactly that many points', () => {
  const returned = TOY.fields.map((f) => f.id);
  const r = scoreExposure(TOY, obs(TOY, returned));
  for (const fx of r.fixes) {
    const after = scoreExposure(TOY, obs(TOY, returned.filter((id) => !fx.fields.includes(id))));
    assert.equal(r.score - after.score, fx.points);
  }
  const allFixed = scoreExposure(TOY, obs(TOY, returned.filter((id) => TOY.byId.get(id).group === 'base')));
  assert.equal(r.score - allFixed.score, r.recoverable.points); assert.equal(allFixed.score, TOY.floor);
});

test('copy helpers: the count is unweighted and always available, and never uses forbidden words', () => {
  assert.equal(countText(14, 25), '14 of 25 fields returned');
  assert.equal(recoverableText(22, 4), '22 points from 4 settings you can change');
  assert.equal(recoverableText(1, 1), '1 point from 1 setting you can change');
  const r = scoreExposure(TOY, obs(TOY, TOY.fields.map((f) => f.id)));
  const strings = [NOT_RETURNED_COPY.replace(/ - a single scan cannot tell the difference\.$/, ''), r.countText, r.recoverable.text, positionText(r), ...r.fixes.map((f) => f.label), GROUPS.base.label, GROUPS.settings.label, GROUPS.settings.note, GROUPS.base.note];
  for (const s of strings) for (const w of FORBIDDEN_FOR_NOT_RETURNED) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(s), `"${s}" contains "${w}"`);
  // the required copy is exactly the rules page text
  assert.equal(NOT_RETURNED_COPY, 'This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.');
});

test('Changes indicator: evidence from a re-scan only, kept out of the score', () => {
  const base = obs(TOY, ['toy.a1', 'toy.s1', 'toy.s2', 'toy.s3', 'toy.s4']);
  const re = obs(TOY, ['toy.a1', 'toy.s4']); // s1, s2, s3 stopped coming back
  const c = changesIndicator(TOY, base, re);
  assert.equal(c.text, '3 of 4 settings changed'); assert.deepEqual(c.changedIds, ['toy.s1', 'toy.s2', 'toy.s3']);
  assert.equal(changesIndicator(TOY, base, base).text, '0 of 4 settings changed');
  // a field the re-scan did not observe is not counted as changed, and not in the "of"
  const partialRe = re.filter((o) => o.id !== 'toy.s1');
  const p = changesIndicator(TOY, base, partialRe);
  assert.equal(p.text, '2 of 3 settings changed'); assert.deepEqual(p.notComparable, ['toy.s1']);
  // always-sent fields are never "changes"
  assert.equal(changesIndicator(TOY, obs(TOY, ['toy.a1']), obs(TOY, [])).of, 0);
  // newly returned fields are reported separately and never netted against the changes
  assert.deepEqual(changesIndicator(TOY, obs(TOY, ['toy.s1']), obs(TOY, ['toy.s2'])).newlyReturned, ['toy.s2']);
  // a user's claim has nowhere to go: the function takes (definition, baseline, rescan) only
  assert.equal(changesIndicator.length, 3);
});

test('method-change sentence: one sentence, names both numbers, says nothing about the account changed', () => {
  const r = scoreExposure(TOY, obs(TOY, ['toy.a1', 'toy.a2', 'toy.s1', 'toy.s2']));
  const s = methodChangeSentence({ percent: 47, text: '14 of 30 = 47%' }, r);
  assert.match(s, /reads 75 now instead of 47%/); assert.match(s, /nothing about your account changed/); assert.match(s, /previous method: 14 of 30 = 47%/);
  assert.equal((s.match(/\.(\s|$)/g) ?? []).length, 1); // one sentence
  assert.equal(methodChangeSentence(null, r), null);
});

test('source audit: no effort / awareness / default-ness / self-report / wizard / category-weight vocabulary in the scoring code', () => {
  const files = [path.join(here, 'exposure.js'), ...readdirSync(path.join(here, 'channels')).filter((f) => f.endsWith('.js') && !f.includes('fixtures')).map((f) => path.join(here, 'channels', f))];
  // strip comments: the header comments NAME these concepts in order to forbid them
  const code = files.map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')).join('\n');
  for (const word of ['bonus', 'effort', 'awareness', 'selfConfirm', 'self_confirm', 'wizard', 'intention', 'fromDefault', 'isDefault', 'changedFromDefault', 'CATEGORY_WEIGHT', 'categoryWeight', 'multiplier'])
    assert.ok(!new RegExp(word, 'i').test(code), `scoring code mentions "${word}"`);
});
