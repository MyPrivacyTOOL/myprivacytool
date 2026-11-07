// MPC-9813: the email click-to-confirm gate and the "show us your listing" check. No network, no secrets, SYNTHETIC identity and SYNTHETIC listing pages only:
// "Zelda Quillfeather" does not exist; the pages are built here. No real person's listing is ever fetched.
// Run: node workers/scan-report/listing-check.test.mjs
import worker, { handleScan, runReportJob } from './index.js';
import { fake } from './test-support/fake-backend.mjs';
import { matchPage, classifyPage, checkListingPages, checkPage, parseListingRequest, pageText, looksLikeSearch, brokerForHost, PAGE_TIMEOUT_MS } from './lib/listingCheck.js';
import { runStoredListingChecks, loadListings } from './lib/confirmGate.js';
import { makeLiveLink, readVerifyToken } from './lib/live.js';
import { buildConfirmationEmail, buildReportEmail } from './lib/email.js';
import { computeScore } from './lib/score.js';
import guides from './lib/guides.generated.js';
import { BROKER_SITES } from './lib/brokers.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const EMAIL = 'zelda.quillfeather@example.test';
const IDS = { email: EMAIL, full_name: 'Zelda Quillfeather', city_region: 'Austin, TX', phone: '+1 512 555 0142' };
const html = (body) => `<!doctype html><html><head><title>Profile</title><script>var secret="Zelda Quillfeather"</script></head><body>${body}${' filler text about public records and people. '.repeat(10)}</body></html>`;
const text = (h) => pageText(h);
const m = (h, ids = IDS) => matchPage(text(h), h.toLowerCase(), ids);

// ---- the matcher: exact / probable / possible / none
check(m(html('<h1>Zelda Quillfeather</h1><p>Age 41, Austin, TX</p>')).match === 'exact', 'matcher: name + city + region => exact, high');
check(m(html('<h1>Quillfeather, Zelda</h1><p>Austin, TX 78701</p>')).match === 'exact', 'matcher: "last, first" listing style still matches');
check(m(html('<h1>Zelda M. Quillfeather</h1><p>Austin, TX</p>')).match === 'exact', 'matcher: a middle initial does not stop a match');
check(m(html('<h1>Zelda Quillfeather</h1><p>Lives in Dallas, TX</p>')).match === 'probable' && m(html('<h1>Zelda Quillfeather</h1><p>Lives in Dallas, TX</p>')).confidence === 'medium', 'matcher: name + region only (city differs) => probable, medium');
const poss = m(html('<h1>Zelda Quillfeather</h1><p>Lives in Reykjavik</p>'));
check(poss.match === 'possible' && poss.confidence === 'low', 'matcher: name only => possible, low');
check(m(html('<h1>Zelda Quillfeather</h1><p>Call (512) 555-0142</p>')).match === 'exact', 'matcher: name + phone (any formatting) => exact');
check(m(html('<h1>Someone Else</h1><p>Austin, TX</p>')).match === null, 'matcher: place without the name => none');
check(m(html('<h1>Zeldaquillfeather</h1>')).match === null && m(html('<h1>Zelda Quillfeathers</h1>')).match === null, 'matcher: whole words only, no partial-word match');
check(m(html('<p>contact zelda.quillfeather@example.test</p>')).match === 'exact', 'matcher: the confirmed email itself on the page => exact');
check(m(html('<h1>Hello</h1>'), { email: EMAIL }).match === null, 'matcher: nothing to look for beyond the email and it is absent => none');
check(!text(html('<h1>x</h1>')).includes('secret'), 'page text ignores script contents');

// ---- classification: not_listed ONLY when the page answered normally
const page = (o) => ({ status: 200, contentType: 'text/html; charset=utf-8', body: html('<h1>Someone Else</h1>'), truncated: false, ...o });
check(classifyPage(page({}), IDS).state === 'not_listed', 'page loads normally, details absent => not_listed');
check(classifyPage(page({ status: 404 }), IDS).state === 'not_listed' && classifyPage(page({ status: 410 }), IDS).note === 'page_gone', '404/410 => not_listed (the page is gone)');
for (const status of [401, 403, 429, 451]) { const r = classifyPage(page({ status }), IDS); check(r.state === 'not_checked' && r.not_checked_reason === 'fetch_blocked', `HTTP ${status} => not_checked / fetch_blocked, NEVER not_listed`); }
check(classifyPage(page({ status: 503 }), IDS).not_checked_reason === 'fetch_blocked', 'HTTP 503 => not_checked / fetch_blocked');
check(classifyPage(page({ body: html('<h1>Just a moment...</h1><p>Checking your browser before accessing</p>').replace(/ filler[^<]*/g, ' ') }), IDS).state === 'not_checked', 'bot challenge page => not_checked, not not_listed');
check(classifyPage(page({ body: '<html><body>Loading…</body></html>' }), IDS).not_checked_reason === 'fetch_blocked', 'page with no readable content (needs a browser) => not_checked, not not_listed');
check(classifyPage(page({ contentType: 'application/pdf' }), IDS).not_checked_reason === 'not_a_listing_page', 'not a web page => not_checked / not_a_listing_page');
check(classifyPage(page({ truncated: true }), IDS).not_checked_reason === 'not_a_listing_page' && classifyPage(page({ truncated: true, body: html('<h1>Zelda Quillfeather</h1><p>Austin, TX</p>') }), IDS).state === 'listed', 'too big to read: not_checked unless the details were already seen');

// ---- the full result per URL, through checkListingPages (injected fetch)
const respond = (status, body, headers = {}) => ({ status, headers: { get: (k) => ({ 'content-type': 'text/html', ...headers })[k.toLowerCase()] ?? null }, body: null, text: async () => body });
const calls = [];
const fetchImpl = async (url, init) => {
  calls.push(String(url));
  if (String(url).includes('/profile/listed')) return respond(200, html('<h1>Zelda Quillfeather</h1><p>Austin, TX</p>'));
  if (String(url).includes('/profile/other')) return respond(200, html('<h1>Another Person</h1>'));
  if (String(url).includes('/profile/blocked')) return respond(403, 'Access denied');
  if (String(url).includes('/profile/hang')) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  return respond(404, 'gone');
};
const fixedNow = () => new Date('2026-11-07T12:00:00Z');
let rs = await checkListingPages([
  'https://www.spokeo.com/profile/listed', 'https://www.fastpeoplesearch.com/profile/other', 'https://www.beenverified.com/profile/blocked',
], IDS, { fetchImpl, now: fixedNow });
check(rs.length === 3 && rs[0].state === 'listed' && rs[0].match === 'exact' && rs[0].confidence === 'high' && rs[0].is_guess === false, 'result 1: listed, exact, high, not a guess');
check(rs[0].key === 'spokeo' && rs[0].guide === 'spokeo' && rs[0].evidence_url === 'https://www.spokeo.com/profile/listed', 'result carries the broker, its guide and the page itself as evidence_url');
check(JSON.stringify(rs[0].source) === JSON.stringify({ class: 'free', provider: 'user_supplied_page', method: 'page_read', checked_at: '2026-11-07T12:00:00.000Z' }), 'source = {class: free, provider: user_supplied_page, ...}');
check(rs[1].state === 'not_listed' && rs[1].not_checked_reason === null && rs[1].key === 'fastpeoplesearch', 'result 2: page loaded, details absent => not_listed');
check(rs[2].state === 'not_checked' && rs[2].not_checked_reason === 'fetch_blocked', 'result 3: 403 => not_checked / fetch_blocked');
check(rs.every((r) => r.state !== 'not_listed' || r.not_checked_reason === null), 'a not_checked reason never rides on a not_listed result');

const poss2 = await checkListingPages(['https://www.mylife.com/profile/listed'], { email: EMAIL, full_name: 'Zelda Quillfeather' }, { fetchImpl: async () => respond(200, html('<h1>Zelda Quillfeather</h1><p>Reykjavik</p>')), now: fixedNow });
check(poss2[0].state === 'listed' && poss2[0].match === 'possible' && poss2[0].is_guess === true, 'a name-only hit is listed / possible / is_guess');

// timeout: a hanging site is not_checked / timeout, not not_listed. (the real limit is 8 s; the test shortens the wait by aborting through checkPage's own timer)
{
  const t0 = Date.now();
  const r = await checkListingPages(['https://example.test/profile/hang'], IDS, { fetchImpl, now: fixedNow });
  check(r[0].state === 'not_checked' && r[0].not_checked_reason === 'timeout' && Date.now() - t0 >= PAGE_TIMEOUT_MS - 200 && Date.now() - t0 < PAGE_TIMEOUT_MS + 3000, `hanging site => not_checked / timeout after about ${PAGE_TIMEOUT_MS / 1000} s`);
}

// no_identifiers: nothing but an email address => nothing is fetched, nothing is guessed
{
  const before = calls.length;
  const r = await checkListingPages(['https://www.spokeo.com/profile/listed'], { email: EMAIL }, { fetchImpl, now: fixedNow });
  check(r[0].state === 'not_checked' && r[0].not_checked_reason === 'no_identifiers' && calls.length === before, 'no name or phone => not_checked / no_identifiers, and the page is not even fetched');
}
// a search address is never fetched; Truecaller (sign-in) is never fetched
{
  const before = calls.length;
  const r = await checkListingPages(['https://www.spokeo.com/search?q=Zelda+Quillfeather', 'https://www.whitepages.com/search/FindPerson?name=Zelda', 'https://www.truecaller.com/search/us/5125550142'], IDS, { fetchImpl, now: fixedNow });
  check(calls.length === before && r.every((x) => x.state === 'not_checked'), 'search addresses and Truecaller are NEVER fetched (no broker search endpoint is called)');
  check(r[0].not_checked_reason === 'not_a_listing_page' && r[2].not_checked_reason === 'fetch_blocked' && r[2].key === 'truecaller', 'search address => not_a_listing_page; Truecaller => fetch_blocked with its guide');
}
check(looksLikeSearch(new URL('https://x.test/people-search/')) && looksLikeSearch(new URL('https://x.test/a?fname=z')) && !looksLikeSearch(new URL('https://www.spokeo.com/Zelda-Quillfeather/Texas/Austin/p123')), 'looksLikeSearch: lookups yes, a profile address no');
// any other site the visitor pasted is still read (they chose it), but is not tied to a shortlist broker
{
  const r = await checkListingPages(['https://some-directory.example/profile/listed'], IDS, { fetchImpl, now: fixedNow });
  check(r[0].key === 'other' && r[0].state === 'listed' && r[0].guide === null, 'a site outside the shortlist that the visitor pasted is read; no broker/guide is invented');
}
// redirect to a search address stops; one site failing does not stop the others
{
  const f = async (url) => (String(url).includes('redir') ? respond(302, '', { location: 'https://www.spokeo.com/search?q=x' }) : respond(200, html('<h1>Zelda Quillfeather</h1><p>Austin, TX</p>')));
  const r = await checkListingPages(['https://a.example/redir', 'https://b.example/ok'], IDS, { fetchImpl: f, now: fixedNow });
  check(r[0].state === 'not_checked' && r[1].state === 'listed', 'a redirect into a search address is refused; the other page is still checked');
  const boom = async () => { throw new Error('network down'); };
  const r2 = await checkListingPages(['https://a.example/x'], IDS, { fetchImpl: boom, now: fixedNow });
  check(r2[0].state === 'not_checked' && r2[0].not_checked_reason === 'fetch_blocked', 'a thrown fetch error => not_checked, never a throw, never not_listed');
}
check(brokerForHost('www.whitepages.com.au')?.key === 'whitepages_au' && brokerForHost('whitepages.com')?.key === 'whitepages' && brokerForHost('evil-spokeo.com') === null, 'domain mapping: subdomains match, look-alike domains do not');

// ---- what the visitor typed
check(parseListingRequest({}).none === true && parseListingRequest({ listing: {} }).none === true, 'no listing object / an empty one => nothing');
{
  const ok1 = parseListingRequest({ listing: { full_name: ' Zelda  Quillfeather ', city_region: 'Austin, TX', country: 'us', phone: '+1 (512) 555-0142', urls: ['https://www.spokeo.com/p/1', '', 'https://www.spokeo.com/p/1'] } });
  check(ok1.inputs?.full_name === 'Zelda Quillfeather' && ok1.inputs.country === 'US' && ok1.inputs.phone === '+15125550142' && ok1.inputs.urls.length === 1, 'typed details are trimmed, country upper-cased, phone normalised, duplicate address dropped');
  check(parseListingRequest({ listing: { urls: ['http://x.example/p'] } }).error && parseListingRequest({ listing: { urls: ['https://localhost/p'] } }).error && parseListingRequest({ listing: { urls: ['https://10.0.0.1/p'] } }).error, 'http, localhost and IP addresses are refused');
  check(parseListingRequest({ listing: { urls: ['https://a.example/1', 'https://a.example/2', 'https://a.example/3', 'https://a.example/4'] } }).error, 'more than 3 pages is refused');
  check(parseListingRequest({ listing: { full_name: 'x', extra: 1 } }).error && parseListingRequest({ listing: { phone: '12' } }).error && parseListingRequest({ listing: { country: 'USA' } }).error, 'unknown keys, short phone and a 3-letter country are refused');
}

// ---- guides: all 9 shortlist brokers have an opt-out guide, with verified-format fields
for (const b of BROKER_SITES) {
  const g = guides.find((x) => x.slug === b.guide);
  check(g && g.optOutUrl?.startsWith('https://') && g.steps?.length >= 4 && g.timeNeeded && g.processingTime && g.relistingWarning && g.lastVerified, `guide exists and is complete for ${b.name}`);
}

// ---- the gate, through the real Worker code
const env = { EMAIL_DOMAIN_CHECK: 'false', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HIBP_API_KEY: 'p', HIBP_MIN_INTERVAL_MS: '0', RECIPIENT_ALLOWLIST: '', UNSUBSCRIBE_SECRET: 'test-secret', EMAIL_CONFIRM_GATE_ENABLED: 'true', LISTING_CHECK_ENABLED: 'true', WEB_SCAN_SAVE_ENABLED: 'true' };
const hexagons = [{ id: 'ip', label: 'IP address', value: '203.0.113.9' }];
const base = { email: EMAIL, consentSource: 'scan_page', ip: '1.2.3.4', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' } };
const save = { hexagons, version: '2026-10-12-v1' };
const pageFetch = (F) => async (url, o = {}) => {
  const u = String(url);
  if (u.startsWith('https://listing-fixture.example/')) { F.fixtureCalls.push(u); return respond(200, html('<h1>Zelda Quillfeather</h1><p>Austin, TX 78701</p>')); }
  return F.f(url, o);
};
{
  const F = fake(); F.fixtureCalls = [];
  const f = pageFetch(F);
  const listing = { full_name: 'Zelda Quillfeather', city_region: 'Austin, TX', country: 'US', phone: null, urls: ['https://listing-fixture.example/zelda'] };
  const r = await handleScan(env, null, { ...base, save, listing }, f);
  const scan = F.db.scans[0];
  check(r.listingSaved === true && scan.email_confirm_required === true && !scan.email_confirmed_at, 'new scan is marked as waiting for the click; the typed details are stored');
  check(F.db.web_scan_listing_checks.length === 1 && F.db.web_scan_listing_checks[0].web_scan_id === r.saved.scanNumber, 'details are stored against the saved scan (scan number), so its retention and deletion apply');
  const confirmMail = JSON.parse(F.calls.find((c) => c.url.includes('resend')).body);
  check(/Confirm your email/.test(confirmMail.subject) && /We only check details you’ve confirmed are yours/.test(confirmMail.text) && /Confirm this is my email/.test(confirmMail.html), 'confirmation email is the click-to-confirm, with the honest sentence');

  let job = await runReportJob(env, f);
  check(job.sent === 0 && (job.waiting ?? 0) === 0 && F.db.scans[0].report_status === 'pending' && F.calls.filter((c) => c.url.includes('resend')).length === 1, 'before the click: no report is sent');
  check(F.fixtureCalls.length === 0 && F.db.web_scan_listing_checks[0].results == null, 'before the click: the listing page is NOT fetched and no identifier-based check runs');

  // a wrong / forged key confirms nothing
  const confirmReq = (token) => new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: 'https://myprivacytool.io', Authorization: `Bearer ${token}` } });
  const realFetch = globalThis.fetch; globalThis.fetch = f;
  try {
    let resp = await worker.fetch(confirmReq('not-a-token'), env, { waitUntil: () => {} });
    check(resp.status === 401 && !F.db.scans[0].email_confirmed_at, 'a forged key => 401, nothing confirmed');
    const link = await makeLiveLink(env, scan.id); const token = link.split('#v=')[1];
    check((await readVerifyToken(env, token)) === scan.id, 'the email link key identifies the scan');
    const pend = [];
    resp = await worker.fetch(confirmReq(token), env, { waitUntil: (p) => pend.push(p) });
    await Promise.all(pend);
    check(resp.status === 200 && (await resp.json()).confirmed === true && F.db.scans[0].email_confirmed_at, 'the click confirms the address');
    check(F.fixtureCalls.length === 1 && Array.isArray(F.db.web_scan_listing_checks[0].results) && F.db.web_scan_listing_checks[0].results[0].state === 'listed', 'after the click: the pasted page is read once and the result is stored');
    const stored = JSON.stringify(F.db.web_scan_listing_checks[0].results);
    check(!/Quillfeather|Austin|78701/.test(stored), 'only result fields are stored: no page text, no name, no place in the stored result');

    // a second click changes nothing and does not read the page again
    const pend2 = []; await worker.fetch(confirmReq(token), env, { waitUntil: (p) => pend2.push(p) }); await Promise.all(pend2);
    check(F.fixtureCalls.length === 1, 'a second click does not fetch the page again');
  } finally { globalThis.fetch = realFetch; }

  job = await runReportJob(env, f);
  const reportMail = JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body);
  check(job.sent === 1 && F.db.scans[0].report_status === 'sent', 'after the click: the report is sent');
  check(/LISTINGS YOU SHOWED US/.test(reportMail.text) && /LISTED, a match for the details you gave/.test(reportMail.text) && reportMail.text.includes('https://listing-fixture.example/zelda') && /Listings you showed us/.test(reportMail.html), 'report email has the "Listings you showed us" block with state and the evidence page');
  check(F.fixtureCalls.length === 1, 'the report job reuses the stored result (the page is not read a third time)');
  const ls = await loadListings(F.db ? { select: async (p) => (p.startsWith('web_scan_listing_checks') ? F.db.web_scan_listing_checks.filter((x) => p.includes(x.scan_id)) : []) } : null, scan.id);
  check(ls.items.length === 1 && ls.items[0].state === 'listed' && ls.pending === false, 'loadListings returns the stored results for the screen');
}

// an old scan (created before the gate) is unaffected; an unconfirmed one never fills the queue
{
  const F = fake(); const f = F.f;
  await handleScan({ ...env, EMAIL_CONFIRM_GATE_ENABLED: 'false', LISTING_CHECK_ENABLED: 'false' }, null, base, f);   // existing behaviour
  check(F.db.scans[0].email_confirm_required === undefined, 'gate off: the scan row is not touched');
  const job = await runReportJob(env, f);   // gate now on, scan predates it
  check(job.sent === 1, 'a scan created before the gate (not marked) is still reported without a click');
}
{
  const F = fake(); const f = F.f;
  for (let i = 0; i < 6; i++) { await handleScan(env, null, { ...base, email: `gated${i}@example.test` }, f); }
  const old = { email: 'old@example.test' };
  await handleScan({ ...env, EMAIL_CONFIRM_GATE_ENABLED: 'false' }, null, { ...base, email: old.email }, f);
  const job = await runReportJob(env, f, 1);
  check(job.sent === 1 && F.db.scans.find((s) => s.email_scanned === old.email).report_status === 'sent', 'six unconfirmed scans ahead in line do not block a reportable one (limit 1)');
}
// fail closed: if the scan cannot be marked, the request fails and nothing is sent
{
  const F = fake({ onRequest: async (url, o, res) => (o.method === 'PATCH' && String(o.body).includes('email_confirm_required') ? res(400, { code: '42703' }) : undefined) });
  let failed = false; try { await handleScan(env, null, base, F.f); } catch { failed = true; }
  check(failed && F.calls.filter((c) => c.url.includes('resend')).length === 0, 'gate cannot be applied (column missing) => the request fails closed, no email goes out');
}
// details without the save consent are refused by the route
{
  const F = fake(); const realFetch = globalThis.fetch; globalThis.fetch = F.f;
  try {
    const req = new Request('https://x.test/api/scan', { method: 'POST', headers: { Origin: 'https://myprivacytool.io', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, consent: true, listing: { full_name: 'Zelda Quillfeather' } }) });
    const resp = await worker.fetch(req, env, { waitUntil: () => {} });
    check(resp.status === 400 && F.db.scans.length === 0, 'typed details without the save consent => 400, nothing stored');
    const off = await worker.fetch(new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: 'https://myprivacytool.io', Authorization: 'Bearer x' } }), { ...env, EMAIL_CONFIRM_GATE_ENABLED: 'false' }, { waitUntil: () => {} });
    check(off.status === 404, 'confirm endpoint answers 404 while the gate is off');
  } finally { globalThis.fetch = realFetch; }
}
// copy: gate off leaves the confirmation email exactly as it was
{
  const off = buildConfirmationEmail({ liveLink: 'https://www.myprivacytool.io/scan/live#v=x' });
  check(off.subject === 'Your privacy scan is starting' && !/Confirm this is my email/.test(off.html), 'gate off: confirmation email unchanged');
  const rep = buildReportEmail({ scan: computeScore([], new Set()), breaches: [], breachStatus: 'not_checked', brokers: [], listings: { items: [{ key: 'spokeo', name: 'Spokeo', state: 'not_checked', not_checked_reason: 'fetch_blocked', evidence_url: 'https://www.spokeo.com/p/1', guide: { optOutUrl: 'https://www.spokeo.com/optout' } }] } });
  check(/NOT CHECKED, the site would not let us read that page\. This is not a clear result\./.test(rep.text) && !/NOT LISTED/.test(rep.text), 'report block: a blocked page reads as NOT CHECKED, never NOT LISTED');
}

console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
