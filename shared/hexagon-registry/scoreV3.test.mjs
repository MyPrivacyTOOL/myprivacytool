// MPC-11569: exposure-v3 against the owner's scoring rules page (decided 2026-11-27), under plain node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGONS, HEXAGON_COUNT } from './registry.js';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { SCORE_VERSION, computeExposure } from './score.js';
import { SCORE_VERSION_V2, EMAIL_SCORED_IDS, HEXAGON_COUNT_V2 } from './scoreV2.js';
import { SCOPE_V3, NOT_OBSERVABLE_WEB } from './scopeV3.js';
import { SCORE_VERSION_V3, NOT_RETURNED_COPY, STACK_LABELS, scopeFor, computeExposureV3, crossChannel, crossChannelLine, exposureLine } from './scoreV3.js';
import { WEB_PROFILES, EMAIL_PROFILES } from './scoreV3.fixtures.mjs';
import { render as renderScope } from '../../scripts/build-scope-v3.mjs';
import { readFileSync } from 'node:fs';

const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a, r) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const web = scopeFor('web'); const email = scopeFor('email');
const run = (items, channel, final = true) => computeExposureV3(items, { channel, final });
const all = (rows, status) => rows.map((r) => ({ id: r.id, status }));
const withFound = (rows, foundIds) => rows.map((r) => ({ id: r.id, status: foundIds.has(r.id) ? 'found' : 'clear' }));

test('v1 and v2 are untouched and exposure-v3 is its own version', () => {
  assert.equal(SCORE_VERSION, 'exposure-v1'); assert.equal(SCORE_VERSION_V2, 'exposure-v2'); assert.equal(SCORE_VERSION_V3, 'exposure-v3');
  assert.equal(HEXAGON_COUNT, 54); assert.equal(HEXAGON_COUNT_V2, 60);
  assert.equal(run(all(web, 'found'), 'web').score_version, 'exposure-v3');
});

test('scope: 47 observable web data points + 6 built email checks; the 7 the site cannot observe are not in N', () => {
  assert.equal(web.length, 47); assert.equal(email.length, 6); assert.equal(SCOPE_V3.length, 53);
  assert.equal(NOT_OBSERVABLE_WEB.length, 7);
  assert.deepEqual(new Set([...web.map((r) => r.id), ...NOT_OBSERVABLE_WEB]), new Set(HEXAGONS.map((h) => h.id)), 'web scope + not observable = the 54, nothing lost');
  assert.deepEqual(email.map((r) => r.id).sort(), [...EMAIL_SCORED_IDS].sort());
  assert.equal(new Set(SCOPE_V3.map((r) => r.id)).size, 53);
});

test('rule 2: the tier is the APPROVED risk tier (catalogue), low 1 / medium 2 / high 3, never a category weight', () => {
  const cat = new Map(HEXAGON_CATALOGUE.map((i) => [i.id, i]));
  for (const r of SCOPE_V3) assert.equal(r.tier, { low: 1, medium: 2, high: 3 }[cat.get(r.id).risk], r.id);
  assert.ok(SCOPE_V3.every((r) => !('category' in r) && !('weight' in r)));
});

test('the generated scope file is current (node scripts/build-scope-v3.mjs)', () => {
  assert.equal(readFileSync(new URL('./scopeV3.js', import.meta.url), 'utf8'), renderScope());
});

test('rule 2 by hand: exposure = tier weight found / tier weight in scope, fixed denominator', () => {
  // email scope: name 3 (high), provider 1 (low), profile 3, libravatar 3, domain-record 2, github 3 = 15
  assert.equal(email.reduce((a, r) => a + r.tier, 0), 15);
  const r = run(withFound(email, new Set(['email-name', 'email-provider'])), 'email');
  assert.equal(r.exposure, Math.round((100 * 4) / 15)); // 27
  assert.deepEqual(r.fields, { returned: 2, total: 6 });
  // the same data point not returned vs not run: both stay in the denominator at 0
  const a = run([...withFound(email, new Set(['email-name'])).filter((x) => x.id !== 'email-github-commits'), { id: 'email-github-commits', status: 'not_checked' }], 'email');
  const b = run(withFound(email, new Set(['email-name'])), 'email');
  assert.equal(a.exposure, b.exposure); assert.equal(a.fields.total, 6); assert.equal(b.fields.total, 6);
});

test('rule 4: nothing returned stays in the denominator at 0; "clear" and "not_checked" are both not returned; nothing evaluated at all is NO score, never 0', () => {
  const allClear = run(all(web, 'clear'), 'web');
  assert.equal(allClear.exposure, 0); assert.equal(allClear.status, 'scored'); assert.deepEqual(allClear.fields, { returned: 0, total: 47 });
  const none = run(all(web, 'not_checked'), 'web');
  assert.equal(none.exposure, null); assert.equal(none.status, 'no_checked_items'); assert.equal(none.achievable_percent, null);
  // a failed detector lowers the number; it never shrinks the denominator
  const full = run(all(web, 'found'), 'web');
  const oneFailed = run(all(web, 'found').map((x, i) => (i === 0 ? { ...x, status: 'not_checked' } : x)), 'web');
  assert.ok(oneFailed.exposure < full.exposure && oneFailed.fields.total === full.fields.total);
});

test('rule 4 wording: the required copy is exact, and no user-facing string says clear, protected, safe or fixed', () => {
  assert.equal(NOT_RETURNED_COPY, 'This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.');
  const strings = [NOT_RETURNED_COPY, ...Object.values(STACK_LABELS), exposureLine(run(all(web, 'found'), 'web')), exposureLine(run(all(web, 'not_checked'), 'web')), crossChannelLine(crossChannel([run(all(web, 'found'), 'web')]))];
  for (const s of strings) assert.doesNotMatch(s, /\b(clear|protected|safe|fixed)\b/i, s);
});

test('rule 1: both numbers side by side with those names, and the line carries no band (rule 7)', () => {
  assert.equal(exposureLine(run(WEB_PROFILES[3].items, 'web')), `Exposure ${run(WEB_PROFILES[3].items, 'web').exposure} · 44 of 47 fields returned`);
  assert.match(exposureLine(run(all(web, 'not_checked'), 'web')), /^Not enough checked to score · 0 of 47 fields returned$/);
  assert.ok(!('band' in run(all(web, 'found'), 'web')), 'no band key: bands are not calibrated for a channel with a floor');
  assert.equal(run(all(web, 'found'), 'web').band_proposal.calibrated, false);
});

test('rules 5 and 7: the floor is the always-sent part; achievable range is 0 at the floor and 100 with everything; the stack adds up to the score', () => {
  const floorWeb = run(withFound(web, new Set(web.filter((r) => !r.changeable).map((r) => r.id))), 'web');
  assert.equal(floorWeb.exposure, floorWeb.floor); assert.equal(floorWeb.achievable_percent, 0); assert.deepEqual(floorWeb.stack, { always_sent: floorWeb.floor, settings: 0 });
  const topWeb = run(all(web, 'found'), 'web');
  assert.equal(topWeb.exposure, 100); assert.equal(topWeb.achievable_percent, 100);
  for (const p of [...WEB_PROFILES, ...EMAIL_PROFILES]) {
    const r = run(p.items, p.channel); if (r.stack) assert.equal(r.stack.always_sent + r.stack.settings, r.exposure, p.name);
  }
  assert.equal(floorWeb.floor, 76); assert.equal(run(all(email, 'found'), 'email').floor, 40);
});

test('rule 8: monotonic. Hardening a setting never raises the score. Exhaustive over every one of the 64 email outcomes, the whole web ladder, and 300 random web chains', () => {
  const ids = email.map((r) => r.id);
  const exp = (mask) => run(withFound(email, new Set(ids.filter((_, i) => mask & (1 << i)))), 'email');
  for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) {
    if ((a & b) === a) { const x = exp(a); const y = exp(b); assert.ok(x.exposure <= y.exposure && x.achievable_percent <= y.achievable_percent, `${a} subset of ${b}`); }
  }
  const ladder = WEB_PROFILES.slice(0, 10).map((p) => run(p.items, 'web').exposure);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] < ladder[i - 1], `web ladder step ${i}: ${ladder[i - 1]} -> ${ladder[i]}`);
  const r = rng(11569);
  for (let t = 0; t < 300; t++) {
    const order = shuffle(web.map((x) => x.id), r); let on = new Set(order); let prev = run(withFound(web, on), 'web').exposure;
    for (const id of order.slice(0, 12)) { on = new Set([...on].filter((x) => x !== id)); const cur = run(withFound(web, on), 'web').exposure; assert.ok(cur <= prev); prev = cur; }
  }
});

test('rule 8: the floor holds (any scan that returns every always-sent field scores at least the floor) and two runs on the same profile give the same number, in any order', () => {
  const r = rng(7); const always = web.filter((x) => !x.changeable).map((x) => x.id);
  for (let t = 0; t < 200; t++) {
    const extra = new Set(web.filter((x) => x.changeable && r() < 0.5).map((x) => x.id));
    const out = run(withFound(web, new Set([...always, ...extra])), 'web');
    assert.ok(out.exposure >= out.floor);
  }
  for (const p of [...WEB_PROFILES, ...EMAIL_PROFILES]) {
    const a = run(p.items, p.channel); const b = run(p.items, p.channel); const c = run(shuffle(p.items, rng(3)), p.channel);
    assert.deepEqual(a, b); assert.deepEqual(a, c, `${p.name}: input order must not matter`);
  }
});

test('rule 3: nothing but the statuses can move the score: effort, "I fixed it" ticks, wizard state and default-ness are ignored', () => {
  const base = WEB_PROFILES[2].items;
  const noisy = base.map((x) => ({ ...x, fixed: true, confirmed: true, wizard_complete: true, from_default: true, effort: 99, bonus: 50, weight: 1000 }));
  assert.deepEqual(run(noisy, 'web'), run(base, 'web'));
});

test('rule 9: the recoverable list is the changeable fields that came back, ordered by points recoverable, highest first, and adds up', () => {
  const r = run(all(web, 'found'), 'web');
  assert.ok(r.recoverable.length === 9 && r.recoverable.every((x) => web.find((w) => w.id === x.id).changeable));
  for (let i = 1; i < r.recoverable.length; i++) assert.ok(r.recoverable[i - 1].points >= r.recoverable[i].points);
  assert.ok(Math.abs(r.recoverable_points - (100 - r.floor)) <= 1, `recoverable ${r.recoverable_points} vs ${100 - r.floor}`);
  assert.equal(run(WEB_PROFILES[9].items, 'web').recoverable.length, 0);
});

test('rule 10: within-channel only. An email id is out of scope for web and the other way round; the only cross-channel figure is lit / potential with the channel set', () => {
  assert.deepEqual(run([{ id: 'email-name', status: 'found' }], 'web').rejected, [{ id: 'email-name', reason: 'out_of_scope' }]);
  assert.deepEqual(run([{ id: 'location', status: 'found' }], 'email').rejected, [{ id: 'location', reason: 'out_of_scope' }]);
  assert.deepEqual(run([{ id: 'google-services', status: 'found' }], 'web').rejected, [{ id: 'google-services', reason: 'not_observable' }]);
  assert.deepEqual(run([{ id: 'email-breaches', status: 'found' }], 'email').rejected, [{ id: 'email-breaches', reason: 'out_of_scope' }]);
  const c = crossChannel([run(WEB_PROFILES[0].items, 'web'), run(EMAIL_PROFILES[1].items, 'email')]);
  assert.deepEqual(c, { channels: ['web', 'email'], lit: 47 + 5, potential: 53 });
  assert.equal(crossChannelLine(c), '52 of 53 data points lit across web + email');
  assert.ok(!('exposure' in c) && !('score' in c), 'no combined exposure exists');
  assert.throws(() => crossChannel([run([], 'web'), run([], 'web')]), RangeError);
  assert.throws(() => scopeFor('whatsapp'), RangeError);
});

test('bad input: invalid status rejected, same id twice with different statuses is not returned, same status twice counts once', () => {
  const r = run([{ id: 'location', status: 'maybe' }, { id: 'isp', status: 'found' }, { id: 'isp', status: 'clear' }, { id: 'browser', status: 'found' }, { id: 'browser', status: 'found' }], 'web');
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['conflicting_status', 'invalid_status']);
  assert.equal(r.fields.returned, 1);
  assert.throws(() => computeExposureV3('nope'), TypeError);
});

test('v3 agrees with v1 where it should: a scan with nothing but always-sent fields found is not "low" under either; the difference is shown, not hidden', () => {
  const floorItems = withFound(web, new Set(web.filter((r) => !r.changeable).map((r) => r.id)));
  assert.ok(computeExposure(floorItems.map((x) => ({ ...x, status: x.status === 'clear' ? 'not_checked' : x.status }))).score >= 40);
  assert.equal(run(floorItems, 'web').achievable_percent, 0, 'v3 says it plainly: nothing changeable is exposed');
});
