// Regression test for the GA4 consent gate in index.html (MPC-6545 follow-up, PR #197; own cookie banner since MPC-8450).
// Runs the REAL inline gtag script from index.html in a sandbox with a fake localStorage / sessionStorage and checks that the
// googletagmanager script is only requested when the visitor has BOTH "Accept analytics" AND the scan consent of the Scan me click (MPC-10790, decision A),
// never on "Essential only", that no event is queued before that point, and that withdrawing consent disables hits.
// Run: node --test scripts/index-consent-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MPC-10790: the same cases run against the two static pages outside the app that carry their own copy of the gate (public/shared-landing.html, public/telegram-security-check.html).
for (const FILE of ['index.html', 'public/shared-landing.html', 'public/telegram-security-check.html']) {
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', FILE), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('G-1BWMDBJSPL'));
assert.ok(script, `found the inline gtag script in ${FILE}`);
assert.ok(!/<script[^>]+src="https:\/\/www\.googletagmanager\.com/.test(html), `${FILE} has no static googletagmanager script tag`);
assert.ok(/<script src="\/recipient-client\.min\.js" defer><\/script>/.test(html), `${FILE} loads the recipient client`);

const KEY = 'mpt_cookie_consent';
const SCAN_KEY = 'mpt_scan_consent';
const SCANNED = JSON.stringify({ scanId: '11111111-1111-4111-8111-111111111111', consentId: '22222222-2222-4222-8222-222222222222', version: 'x', at: '2026-11-24T00:00:00.000Z' });
const NOT_SCANNED = JSON.stringify({ scanId: '11111111-1111-4111-8111-111111111111', consentId: null, version: null, at: null });
function load({ host = 'www.myprivacytool.io', stored = null, scan = null, storage = true, clientReady = true } = {}) {
  const appended = [];
  const listeners = [];
  const state = { stored, scan };
  const ctx = vm.createContext({
    location: { hostname: host },
    document: { createElement: () => ({}), head: { appendChild: (el) => appended.push(el) } },
    Date, JSON,
  });
  // MPC-9886: the tag is loaded through the recipient client (window.mptRecipients, /recipient-client.min.js), which the page gets deferred.
  const recipients = { script: (key, src) => { appended.push({ key, src }); return Promise.resolve(); } };
  if (clientReady) ctx.mptRecipients = recipients;
  ctx.window = ctx;
  ctx.addEventListener = (type, fn) => { if (type === 'mpt:consent' || type === 'mpt:scan-consent' || type === 'mpt:recipients-ready') listeners.push(fn); };
  ctx.localStorage = storage
    ? { getItem: (k) => (k === KEY ? state.stored : null) }
    : { getItem: () => { throw new Error('blocked'); } };
  ctx.sessionStorage = storage
    ? { getItem: (k) => (k === SCAN_KEY ? state.scan : null) }
    : { getItem: () => { throw new Error('blocked'); } };
  vm.runInContext(script, ctx);
  return {
    ctx, appended,
    choose(value) { state.stored = value; listeners.forEach((fn) => fn()); },
    scanMe(value = SCANNED) { state.scan = value; listeners.forEach((fn) => fn()); },
    disabled: () => ctx['ga-disable-G-1BWMDBJSPL'],
    clientReady() { ctx.mptRecipients = recipients; listeners.forEach((fn) => fn()); },
    gtagScripts: () => appended.filter((e) => String(e.src).includes('googletagmanager.com/gtag/js')),
  };
}
const REJECT = JSON.stringify({ v: 1, analytics: false, at: '2026-10-23T00:00:00.000Z' });
const ACCEPT = JSON.stringify({ v: 1, analytics: true, at: '2026-10-23T00:00:00.000Z' });

test(`${FILE}: fresh visit, no choice yet: no gtag request, hits disabled`, () => {
  const p = load();
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test(`${FILE}: Essential only: no gtag request, hits stay disabled`, () => {
  const p = load();
  p.choose(REJECT);
  p.scanMe();
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test(`${FILE}: decision A: Accept analytics ALONE sends nothing and queues nothing`, () => {
  const p = load();
  p.choose(ACCEPT);
  assert.equal(p.gtagScripts().length, 0, 'no googletagmanager request on Accept alone');
  assert.equal(p.disabled(), true);
  p.ctx.gtag('event', 'device_profile', { location_city: 'x' });
  assert.equal(p.ctx.dataLayer.length, 0, 'an event before the consent point is dropped, not queued');
  p.scanMe(NOT_SCANNED);
  assert.equal(p.gtagScripts().length, 0, 'a journey id without a consent id is not the Scan me click');
});
test(`${FILE}: the Scan me click without the analytics choice sends nothing either`, () => {
  const p = load();
  p.scanMe();
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test(`${FILE}: Accept analytics then Scan me: gtag loads exactly once, hits are enabled, and nothing from before is replayed`, () => {
  const p = load();
  p.ctx.gtag('event', 'funnel_step', { step_name: 'page_load' });   // before the consent point
  p.choose(ACCEPT);
  p.scanMe();
  assert.equal(p.gtagScripts().length, 1);
  assert.match(p.gtagScripts()[0].src, /id=G-1BWMDBJSPL$/);
  assert.equal(p.disabled(), false);
  assert.equal(p.ctx.dataLayer.length, 2, 'only the js and config calls: no event from before the click was queued');
  p.ctx.gtag('event', 'after_click');
  assert.equal(p.ctx.dataLayer.length, 3, 'events after the consent point go through');
});
test(`${FILE}: Scan me first, then Accept analytics: loads once`, () => {
  const p = load();
  p.scanMe();
  assert.equal(p.gtagScripts().length, 0);
  p.choose(ACCEPT);
  assert.equal(p.gtagScripts().length, 1);
});
test(`${FILE}: accept, then reject again: hits disabled, events dropped again, no second script`, () => {
  const p = load({ scan: SCANNED });
  p.choose(ACCEPT);
  p.choose(REJECT);
  assert.equal(p.disabled(), true);
  const n = p.ctx.dataLayer.length;
  p.ctx.gtag('event', 'x');
  assert.equal(p.ctx.dataLayer.length, n, 'dropped while withdrawn');
  assert.equal(p.gtagScripts().length, 1);
  p.choose(ACCEPT);
  assert.equal(p.disabled(), false);
  assert.equal(p.gtagScripts().length, 1, 'loaded guard: still one script after re-accept');
});
test(`${FILE}: returning visitor in the same tab journey (accepted, already pressed Scan me): loads at once`, () => {
  const p = load({ stored: ACCEPT, scan: SCANNED });
  assert.equal(p.gtagScripts().length, 1);
  assert.equal(p.disabled(), false);
});
test(`${FILE}: returning visitor who accepted in an earlier visit but has not pressed Scan me in this tab: nothing`, () => {
  const p = load({ stored: ACCEPT });
  assert.equal(p.gtagScripts().length, 0);
  assert.equal(p.disabled(), true);
});
test(`${FILE}: storage blocked, damaged or from another version: fails closed`, () => {
  assert.equal(load({ storage: false }).gtagScripts().length, 0);
  for (const bad of ['not json', '{"v":2,"analytics":true}', '{"v":1,"analytics":"yes"}', 'null']) {
    const p = load({ stored: bad, scan: SCANNED });
    assert.equal(p.gtagScripts().length, 0, bad);
    assert.equal(p.disabled(), true, bad);
  }
  for (const bad of ['not json', 'null', '{"consentId":5}', '{"consentId":""}']) {
    const p = load({ stored: ACCEPT, scan: bad });
    assert.equal(p.gtagScripts().length, 0, bad);
  }
});
test(`${FILE}: previews and localhost never send hits, even with both consents`, () => {
  for (const host of ['localhost', 'abc123.wwwmyprivacytool.pages.dev']) {
    const p = load({ host, stored: ACCEPT, scan: SCANNED });
    assert.equal(p.gtagScripts().length, 0, host);
    assert.equal(p.disabled(), true, host);
  }
});
test(`${FILE}: MPC-9886: goes through the registry key "ga4", and waits for the recipient client if it is not ready yet`, () => {
  const p = load({ stored: ACCEPT, scan: SCANNED, clientReady: false });
  assert.equal(p.gtagScripts().length, 0, 'nothing is requested before the client exists');
  p.clientReady();
  assert.equal(p.gtagScripts().length, 1);
  assert.equal(p.gtagScripts()[0].key, 'ga4');
  p.clientReady();
  assert.equal(p.gtagScripts().length, 1, 'still once');
});
}

// MPC-10790 follow-up: the placeholder form on /shared-landing must not send the visitor's email domain to Google Analytics.
test('public/shared-landing.html does not put the email address or its domain in any analytics event', () => {
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/shared-landing.html'), 'utf8');
  assert.ok(!/email_domain/.test(page), 'no email_domain parameter');
  assert.ok(!/trackEvent\([^)]*email/s.test(page.replace(/\/\/[^\n]*/g, '')), 'no trackEvent call carries the email');
});
