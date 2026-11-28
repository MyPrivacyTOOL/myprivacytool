// MPC-11569 / MPC-11622: validation of the WEB and EMAIL channels on the shared exposure core (rules page section 8): at least ten synthetic profiles each, monotonic, floor holds,
// deterministic, nothing but the observed state moves the score. Run: node --test shared/exposure/channels/webEmail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEB_EXPOSURE, WEB_SCOPE_VERSION, scoreWeb, webObservations, webChanges } from './web.js';
import { EMAIL_EXPOSURE, EMAIL_SCOPE_VERSION, scoreEmail, emailObservations } from './email.js';
import { WEB_FIXTURES, EMAIL_FIXTURES } from './webEmail.fixtures.js';
import { NOT_OBSERVABLE_WEB, EMAIL_NOT_BUILT } from './scope.generated.js';
import { scoreExposure, NOT_RETURNED_COPY, FORBIDDEN_FOR_NOT_RETURNED, EXPOSURE_METHOD } from '../exposure.js';
import { HEXAGONS, HEXAGON_COUNT, EMAIL_HEXAGONS } from '../../hexagon-registry/registry.js';
import { HEXAGON_CATALOGUE } from '../../hexagon-registry/catalogue.js';
import { SCORE_VERSION } from '../../hexagon-registry/score.js';
import { render as renderScope } from '../../../scripts/build-exposure-scope.mjs';

const W = { low: 1, medium: 2, high: 3 };
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a, r) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// independent oracle: round_half_up(100 * found / total) from the tier table alone, not from the module under test
const oracle = (def, ids) => { const f = ids.reduce((a, id) => a + W[def.byId.get(id).tier], 0); const t = def.fields.reduce((a, x) => a + W[x.tier], 0); return Math.floor((2 * 100 * f + t) / (2 * t)); };
const foundIds = (items) => items.filter((i) => i.status === 'found').map((i) => i.id);

test('the shared core is the one engine: exposure-tier-1; v1 and the 54 are untouched', () => {
  assert.equal(scoreWeb(WEB_FIXTURES[0].items).method, EXPOSURE_METHOD); assert.equal(EXPOSURE_METHOD, 'exposure-tier-1');
  assert.equal(SCORE_VERSION, 'exposure-v1'); assert.equal(HEXAGON_COUNT, 54);
});

test('scope: web 47 observable = 38 always sent + 9 settings, weight 78 (59 always sent), floor 76; email 6 = 3 + 3, weight 15 (6), floor 40', () => {
  const w = WEB_EXPOSURE; const e = EMAIL_EXPOSURE;
  assert.deepEqual([w.total, w.baseCount, w.settingsCount, w.totalWeight, w.baseWeight, w.floor], [47, 38, 9, 78, 59, 76]);
  assert.deepEqual([e.total, e.baseCount, e.settingsCount, e.totalWeight, e.baseWeight, e.floor], [6, 3, 3, 15, 6, 40]);
  assert.equal(WEB_SCOPE_VERSION, 'web-scope-1'); assert.equal(EMAIL_SCOPE_VERSION, 'email-scope-1');
  assert.deepEqual(new Set([...w.fields.map((f) => f.id), ...NOT_OBSERVABLE_WEB]), new Set(HEXAGONS.map((h) => h.id)), 'web scope + not observable = the 54, nothing lost');
  assert.equal(NOT_OBSERVABLE_WEB.length, 7);
  assert.deepEqual(EMAIL_NOT_BUILT, { 'email-breaches': 'not built: terms unconfirmed' });
  assert.ok(!e.byId.has('email-breaches'));
  assert.equal(EMAIL_HEXAGONS.length, 7);
});

test('tiers are the APPROVED catalogue risk tiers, never a category weight', () => {
  const cat = new Map(HEXAGON_CATALOGUE.map((i) => [i.id, i.risk]));
  for (const f of [...WEB_EXPOSURE.fields, ...EMAIL_EXPOSURE.fields]) assert.equal(f.tier, cat.get(f.id), f.id);
});

test('the pinned tier table: change a tier, the scope or the split and this fails until the scope version is bumped on purpose', () => {
  const table = (def) => def.fields.map((f) => `${f.id}:${f.group}:${f.tier}`).join('|');
  assert.equal(table(EMAIL_EXPOSURE), 'email-name:base:high|email-provider:base:low|email-profile:settings:high|email-libravatar:settings:high|email-domain-record:base:medium|email-github-commits:settings:high');
  const settings = WEB_EXPOSURE.fields.filter((f) => f.group === 'settings').map((f) => `${f.id}:${f.tier}`).sort().join('|');
  assert.equal(settings, 'audio-fingerprint:medium|canvas-fingerprint:medium|demographic:medium|isp:medium|language-mismatch:medium|location:medium|user-profile:medium|webgl-fingerprint:medium|webrtc-leak:high');
  assert.equal(WEB_EXPOSURE.fields.filter((f) => f.group === 'settings').reduce((a, f) => a + { low: 1, medium: 2, high: 3 }[f.tier], 0), 19, 'settings weight 19 of 78');
});

test('the generated scope file is current (node scripts/build-exposure-scope.mjs)', () => {
  assert.equal(readFileSync(new URL('./scope.generated.js', import.meta.url), 'utf8'), renderScope());
});

test('rule 8: at least ten synthetic profiles per channel, and every pinned score equals both the engine and an independent oracle', () => {
  assert.ok(WEB_FIXTURES.length >= 10 && EMAIL_FIXTURES.length >= 10);
  for (const [fixtures, def, score] of [[WEB_FIXTURES, WEB_EXPOSURE, scoreWeb], [EMAIL_FIXTURES, EMAIL_EXPOSURE, scoreEmail]]) {
    for (const p of fixtures) {
      const r = score(p.items);
      if (p.expect.status === 'incomplete') { assert.equal(r.status, 'incomplete', p.id); assert.equal(r.score, null, p.id); continue; }
      assert.equal(r.status, 'scored', p.id); assert.equal(r.score, p.expect.score, `${p.id} pinned`); assert.equal(r.returned, p.expect.returned, `${p.id} returned`);
      assert.equal(r.score, oracle(def, foundIds(p.items)), `${p.id} oracle`);
    }
  }
});

test('rule 8, monotonic: hardening a setting never raises the score. Exhaustive over all 64 email outcomes; the whole web ladder strictly falls; 300 random web chains', () => {
  const ids = EMAIL_EXPOSURE.fields.map((f) => f.id);
  const sc = (mask) => scoreEmail(ids.map((id, i) => ({ id, status: mask & (1 << i) ? 'found' : 'clear' }))).score;
  for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) if ((a & b) === a) assert.ok(sc(a) <= sc(b), `${a} subset of ${b}`);
  const ladder = WEB_FIXTURES.slice(0, 10).map((p) => scoreWeb(p.items).score);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] < ladder[i - 1], `web ladder step ${i}`);
  const r = rng(11569); const all = WEB_EXPOSURE.fields.map((f) => f.id);
  for (let t = 0; t < 300; t++) {
    let on = new Set(all); let prev = scoreWeb(all.map((id) => ({ id, status: 'found' }))).score;
    for (const id of shuffle(all, r).slice(0, 12)) { on = new Set([...on].filter((x) => x !== id)); const cur = scoreWeb(all.map((x) => ({ id: x, status: on.has(x) ? 'found' : 'not_checked' }))).score; assert.ok(cur <= prev); prev = cur; }
  }
});

test('rule 8, the floor holds: a scan returning every always-sent field scores at least the floor, and the fully hardened profiles score exactly the floor', () => {
  const r = rng(7);
  for (const def of [WEB_EXPOSURE, EMAIL_EXPOSURE]) {
    const base = def.fields.filter((f) => f.group === 'base').map((f) => f.id);
    for (let t = 0; t < 200; t++) {
      const on = new Set([...base, ...def.fields.filter((f) => f.group === 'settings' && r() < 0.5).map((f) => f.id)]);
      const res = scoreExposure(def, def.fields.map((f) => ({ id: f.id, state: on.has(f.id) ? 'returned' : 'not_returned' })));
      assert.ok(res.score >= def.floor); assert.equal(res.position.belowFloor, false);
    }
  }
  assert.equal(scoreWeb(WEB_FIXTURES[9].items).score, 76); assert.equal(scoreEmail(EMAIL_FIXTURES[3].items).score, 40);
  assert.equal(scoreWeb(WEB_FIXTURES[9].items).position.percent, 0);
});

test('rule 8, deterministic: the same profile gives the same result twice and in any input order', () => {
  for (const p of [...WEB_FIXTURES, ...EMAIL_FIXTURES]) {
    const score = p.id.startsWith('W') ? scoreWeb : scoreEmail;
    assert.deepEqual(score(p.items), score(p.items), p.id); assert.deepEqual(score(p.items), score(shuffle(p.items, rng(3))), `${p.id}: input order must not matter`);
  }
});

test('rule 3: nothing but the observed state moves the score: effort, "I fixed it", wizard state and default-ness are ignored', () => {
  const noisy = WEB_FIXTURES[2].items.map((x) => ({ ...x, fixed: true, confirmed: true, wizard_complete: true, from_default: true, effort: 99, bonus: 50, weight: 1000, tier: 'low' }));
  assert.deepEqual(scoreWeb(noisy), scoreWeb(WEB_FIXTURES[2].items));
});

test('rule 4: nothing returned stays in the denominator at 0; required copy is exact; none of the forbidden words appear in what the module says about it', () => {
  assert.equal(NOT_RETURNED_COPY, 'This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.');
  const r = scoreWeb(WEB_FIXTURES[5].items);
  assert.equal(r.scored, 47); assert.equal(r.countText, '42 of 47 fields returned');
  for (const text of [r.countText, r.recoverable.text, NOT_RETURNED_COPY, r.bar.base.label, r.bar.settings.label, r.bar.base.note, r.bar.settings.note]) for (const w of FORBIDDEN_FOR_NOT_RETURNED) assert.doesNotMatch(text, new RegExp(`\\b${w}\\b`, 'i'), `${w} in: ${text}`);
});

test('web adapter: found = returned; clear and not_checked = not returned (still in the denominator); a scan in which nothing produced a result has no score', () => {
  const obs = webObservations([{ id: 'location', status: 'found' }, { id: 'device', status: 'not_checked' }, { id: 'browser', status: 'clear' }]);
  assert.equal(obs.length, 47); assert.equal(obs.filter((o) => o.state === 'returned').length, 1);
  assert.deepEqual(webObservations(WEB_FIXTURES[12].items), []);
  assert.deepEqual(webObservations(undefined), []);
  assert.equal(scoreWeb(WEB_FIXTURES[12].items).score, null);
  // an id the site can never observe is ignored, never counted
  assert.equal(scoreWeb([...WEB_FIXTURES[0].items, { id: 'google-services', status: 'found' }]).score, 100);
});

test('email adapter: found = returned, clear = not returned, not_checked = NOT observed (incomplete, no score); email-breaches is ignored whatever its status', () => {
  assert.deepEqual(emailObservations([{ id: 'email-name', status: 'not_checked' }]), []);
  assert.equal(scoreEmail(EMAIL_FIXTURES[10].items).status, 'incomplete');
  assert.deepEqual(scoreEmail(EMAIL_FIXTURES[10].items).unobserved, ['email-libravatar']);
  for (const status of ['found', 'clear', 'not_checked']) assert.equal(scoreEmail([...EMAIL_FIXTURES[3].items, { id: 'email-breaches', status }]).score, 40);
  assert.ok(scoreEmail([...EMAIL_FIXTURES[3].items, { id: 'email-breaches', status: 'found' }]).ignored.includes('email-breaches'));
});

test('within-channel only (rule 10): a web id means nothing to the email channel and the other way round', () => {
  assert.equal(scoreEmail([...EMAIL_FIXTURES[0].items, { id: 'location', status: 'found' }]).score, 100);
  assert.ok(scoreEmail([{ id: 'location', status: 'found' }]).status === 'incomplete');
  assert.equal(scoreWeb([...WEB_FIXTURES[0].items, { id: 'email-name', status: 'found' }]).score, 100, 'an email id adds nothing to the web score');
  assert.equal(scoreWeb([...WEB_FIXTURES[9].items, { id: 'email-name', status: 'found' }]).score, 76);
});

test('changes indicator (rule 6): evidence from two scans only, settings only, never a claim', () => {
  const before = webObservations(WEB_FIXTURES[0].items); const after = webObservations(WEB_FIXTURES[2].items);
  const c = webChanges(before, after);
  assert.equal(c.of, 9); assert.equal(c.changed, 2); assert.match(c.text, /^2 of 9 settings changed$/);
});

test('fix list (rule 9) is ordered by points recoverable, highest first, and names only changeable fields', () => {
  const r = scoreWeb(WEB_FIXTURES[0].items);
  assert.equal(r.fixes.length, 9); assert.ok(r.fixes.every((x) => WEB_EXPOSURE.byId.get(x.fields[0]).group === 'settings'));
  for (let i = 1; i < r.fixes.length; i++) assert.ok(r.fixes[i - 1].points >= r.fixes[i].points);
  assert.equal(r.recoverable.text, '24 points from 9 settings you can change');
  assert.equal(scoreWeb(WEB_FIXTURES[9].items).fixes.length, 0);
});
