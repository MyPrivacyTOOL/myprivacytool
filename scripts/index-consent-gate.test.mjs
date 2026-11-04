// Regression test for the GA4 consent gate in index.html (MPC-6545 follow-up, PR #197; own cookie banner since MPC-8450).
// Runs the REAL inline gtag script from index.html in a sandbox with a fake localStorage and checks that the
// googletagmanager script is only requested after "Accept analytics", never on "Essential only", and that withdrawing consent disables hits.
// Run: node --test scripts/index-consent-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('G-1BWMDBJSPL'));
assert.ok(script, 'found the inline gtag script in index.html');
assert.ok(!/<script[^>]+src="https:\/\/www\.googletagmanager\.com/.test(html), 'index.html has no static googletagmanager script tag');

const KEY = 'mpt_cookie_consent';
function load({ host = 'www.myprivacytool.io', stored = null, storage = true } = {}) {
  const appended = [];
  const listeners = [];
  const state = { stored };
  const ctx = vm.createContext({
    location: { hostname: host },
    document: { createElement: () => ({}), head: { appendChild: (el) => appended.push(el) } },
    Date, JSON,
  });
  ctx.window = ctx;
  ctx.addEventListener = (type, fn) => { if (type === 'mpt:consent') listeners.push(fn); };
  ctx.localStorage = storage
    ? { getItem: (k) => (k === KEY ? state.stored : null) }
    : { getItem: () => { throw new Error('blocked'); } };
  vm.runInContext(script, ctx);
  return {
    ctx, appended,
    choose(value) { state.stored = value; listeners.forEach((fn) => fn()); },
    disabled: () => ctx['ga-disable-G-1BWMDBJSPL'],
    gtagScripts: () => appended.filter((e) => String(e.src).includes('googletagmanager.com/gtag/js')),
  };
}
const REJECT = JSON.stringify({ v: 1, analytics: false, at: '2026-10-23T00:00:00.000Z' });
const ACCEPT = JSON.stringify({ v: 1, analytics: true, at: '2026-10-23T00:00:00.000Z' });

test('fresh visit, no choice yet: no gtag request, hits disabled', () => {
  const p = load();
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test('Essential only: no gtag request, hits stay disabled', () => {
  const p = load();
  p.choose(REJECT);
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test('Accept analytics: gtag loads exactly once and hits are enabled', () => {
  const p = load();
  p.choose(ACCEPT);
  assert.equal(p.gtagScripts().length, 1);
  assert.match(p.gtagScripts()[0].src, /id=G-1BWMDBJSPL$/);
  assert.equal(p.disabled(), false);
  assert.ok(p.ctx.dataLayer.length >= 2, 'js and config calls queued');
});
test('accept, then reject again: hits disabled, no second script', () => {
  const p = load();
  p.choose(ACCEPT);
  p.choose(REJECT);
  assert.equal(p.disabled(), true);
  assert.equal(p.gtagScripts().length, 1);
  p.choose(ACCEPT);
  assert.equal(p.disabled(), false);
  assert.equal(p.gtagScripts().length, 1, 'loaded guard: still one script after re-accept');
});
test('returning visitor who already accepted: loads at once', () => {
  const p = load({ stored: ACCEPT });
  assert.equal(p.gtagScripts().length, 1);
  assert.equal(p.disabled(), false);
});
test('storage blocked, damaged or from another version: fails closed', () => {
  assert.equal(load({ storage: false }).gtagScripts().length, 0);
  for (const bad of ['not json', '{"v":2,"analytics":true}', '{"v":1,"analytics":"yes"}', 'null']) {
    const p = load({ stored: bad });
    assert.equal(p.gtagScripts().length, 0, bad);
    assert.equal(p.disabled(), true, bad);
  }
});
test('previews and localhost never send hits, even with consent', () => {
  for (const host of ['localhost', 'abc123.wwwmyprivacytool.pages.dev']) {
    const p = load({ host, stored: ACCEPT });
    assert.equal(p.gtagScripts().length, 0, host);
    assert.equal(p.disabled(), true, host);
  }
});
