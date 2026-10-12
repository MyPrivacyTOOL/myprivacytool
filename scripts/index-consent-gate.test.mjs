// Regression test for the GA4 consent gate in index.html (MPC-6545 follow-up, PR #197).
// Runs the REAL inline gtag script from index.html in a sandbox with a fake consentmanager (__cmp) and checks that the
// googletagmanager script is only requested after consent, never on Reject, and that withdrawing consent disables hits.
// Not covered (needs a browser and the live consentmanager): the real shape of getCMPData. Run: node --test scripts/index-consent-gate.test.mjs
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

function load({ host = 'www.myprivacytool.io', cmp = true, data = { userChoiceExists: false, purposeConsents: {} } } = {}) {
  const appended = [];
  const listeners = [];
  const state = { data };
  const ctx = vm.createContext({
    location: { hostname: host },
    document: { createElement: () => ({}), head: { appendChild: (el) => appended.push(el) } },
    Date,
  });
  ctx.window = ctx;
  if (cmp) {
    ctx.__cmp = (cmd, arg) => {
      if (cmd === 'getCMPData') return state.data;
      if (cmd === 'addEventListener') listeners.push(arg[1]);
      return undefined;
    };
  }
  vm.runInContext(script, ctx);
  return {
    ctx, appended,
    choose(d) { state.data = d; listeners.forEach((fn) => fn()); },
    disabled: () => ctx['ga-disable-G-1BWMDBJSPL'],
    gtagScripts: () => appended.filter((e) => String(e.src).includes('googletagmanager.com/gtag/js')),
  };
}
const REJECT = { userChoiceExists: true, purposeConsents: { c1: false, c2: false, c3: false } };
const ACCEPT = { userChoiceExists: true, purposeConsents: { c1: true, c2: true, c3: true } };

test('fresh visit, banner untouched: no gtag request, hits disabled', () => {
  const p = load();
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test('Reject all: no gtag request, hits stay disabled', () => {
  const p = load();
  p.choose(REJECT);
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test('Accept all: gtag loads exactly once and hits are enabled', () => {
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
  const p = load({ data: ACCEPT });
  assert.equal(p.gtagScripts().length, 1);
  assert.equal(p.disabled(), false);
});
test('consentmanager missing or erroring: fails closed', () => {
  assert.equal(load({ cmp: false }).gtagScripts().length, 0);
  const p = load({ data: null });
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test('previews and localhost never send hits, even with consent', () => {
  for (const host of ['localhost', 'abc123.wwwmyprivacytool.pages.dev']) {
    const p = load({ host, data: ACCEPT });
    assert.equal(p.gtagScripts().length, 0, host);
    assert.equal(p.disabled(), true, host);
  }
});
