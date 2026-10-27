// CK-8503: the web scan request lifecycle, request -> consent -> durable acceptance -> scan -> report -> provider acceptance, driven through the real
// Worker entry points (POST /api/scan, the cron report job, /api/unsubscribe, GET /api/scan/live) against the stubbed backend in test-support.
// Every assertion reads the rows the Worker actually persisted. Only the outside world (database, Resend, HubSpot, HIBP, DNS) is stubbed.
// Synthetic addresses only (example.com). No network: fetch is replaced by a sandbox that throws on any host that is not a known test stub.
// Run: node workers/scan-report/lifecycle.test.mjs
import worker, { handleScan, runReportJob } from './index.js';
import { fake } from './test-support/fake-backend.mjs';
import { requestLifecycle } from './lib/lifecycle.js';
import { makeLiveLink, makeLiveToken } from './lib/live.js';
import { unsubscribeToken } from './lib/onboarding.js';

let ok = true; const check = (c, m) => { process.stdout.write(`${c ? 'PASS' : 'FAIL'} ${m}\n`); if (!c) ok = false; };
const trace = (m) => process.stdout.write(`TRACE ${m}\n`);

// ---- sandbox: nothing here may reach a real database, queue or provider
const TEST_DB_HOST = 'supabase.test.invalid';
const STUB_HOSTS = ['api.resend.com', 'api.hubapi.com', 'cloudflare-dns.com', 'gravatar.com', 'libravatar.org', 'rdap.org', 'haveibeenpwned.com', TEST_DB_HOST];
const realFetch = globalThis.fetch;
const sandbox = (F) => { globalThis.fetch = async (u, o) => { const h = new URL(String(u)).host; if (!STUB_HOSTS.some((s) => h === s || h.endsWith(`.${s}`))) throw new Error(`NON-TEST HOST ${h}`); return F.f(u, o); }; };
const A = 'lifecycle+a@example.com', B = 'lifecycle+b@example.com';
// MPC-8453: this suite is about the scan lifecycle and its fake DNS answers "no records" for every domain, so the deliverable-domain check is off here.
const env = { EMAIL_DOMAIN_CHECK: 'false', SUPABASE_URL: `https://${TEST_DB_HOST}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key', RESEND_API_KEY: 'test-resend', HIBP_API_KEY: 'test-hibp', HIBP_MIN_INTERVAL_MS: '0', UNSUBSCRIBE_SECRET: 'test-secret', RECIPIENT_ALLOWLIST: `${A},${B}` };
{
  sandbox(fake());
  let blocked = ''; try { await fetch('https://xmdmkumwxpgahmlweuug.supabase.co/rest/v1/scans'); } catch (e) { blocked = String(e); }
  check(/NON-TEST HOST/.test(blocked) && new URL(env.SUPABASE_URL).host === TEST_DB_HOST, 'sandbox: a call to the production database host is refused before it leaves the process; the Worker env points at a .invalid test host');
}

const quiet = async (fn) => { const keep = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = keep; } };
const harness = (opts = {}) => { const F = fake({ resendIdempotent: true, ...opts }); sandbox(F); return F; };
const resends = (F) => F.calls.filter((c) => c.url.includes('api.resend.com'));
const keysOf = (F, prefix) => [...F.provider.keys()].filter((k) => k.startsWith(prefix));
const hdr = { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' };
async function post(F, body, e = env) {
  sandbox(F); const w = [];
  const rs = await worker.fetch(new Request('https://x/api/scan', { method: 'POST', headers: hdr, body: JSON.stringify(body) }), e, { waitUntil: (p) => w.push(p) });
  await Promise.all(w); return { rs, j: await rs.clone().json().catch(() => null) };
}
const request = (F, email = A) => post(F, { email, consent: true, consent_source: 'scan_page' });
const run = (F, e = env) => quiet(() => runReportJob(e, F.f));
const scanOf = (F, email) => F.db.scans.find((s) => s.email_scanned === email);
const lc = (F, email = A) => requestLifecycle(scanOf(F, email));
const staleClaim = (F, email = A) => { scanOf(F, email).report_claimed_at = new Date(Date.now() - 31 * 60 * 1000).toISOString(); };   // past STALE_CLAIM_MS (30 min)
class Killed extends Error { constructor() { super('worker killed'); } }

// ============================================================ 0. the contract itself
{
  const row = (o) => ({ report_status: 'pending', report_attempts: 0, report_last_error: null, resend_message_id: null, ...o });
  const cases = [
    [row({}), 'queued', 'not_sent'], [row({ report_attempts: 1, report_last_error: 'report email not sent: Resend HTTP 500' }), 'recovering', 'not_sent'],
    [row({ report_attempts: 0, report_last_error: 'held: HIBP rate limited, retrying next run' }), 'queued', 'not_sent'], [row({ report_status: 'processing', report_attempts: 1 }), 'running', 'not_sent'],
    [row({ report_status: 'sent', resend_message_id: 'msg_1' }), 'completed', 'provider_accepted'], [row({ report_status: 'failed', report_attempts: 5, report_last_error: 'x' }), 'failed', 'not_sent'],
    [row({ report_status: 'failed', report_last_error: 'cancelled: unsubscribed before the report was sent' }), 'cancelled', 'not_sent'],
  ];
  check(cases.every(([r, s, d]) => { const l = requestLifecycle(r); return l.state === s && l.delivery === d; }), 'contract: every persisted combination maps to one lifecycle state (queued, recovering, running, completed, failed, cancelled)');
  check(cases.every(([r]) => requestLifecycle(r).receipt === 'not_observable') && !cases.some(([r]) => /deliver(ed)?$/.test(requestLifecycle(r).state)), 'contract: no row can ever read as "delivered": the most observable is provider_accepted and the receipt is not_observable (no delivery webhook exists)');
  check(requestLifecycle(row({ report_status: 'sent' })).delivery === 'unknown', 'contract: a "sent" row with no provider message id is "unknown", not provider_accepted');
}

// ============================================================ 1. the synthetic journey, step by step, reading persisted state
{
  const seen = [];
  const F = harness({ onRequest: (url) => { if (url.includes('haveibeenpwned.com')) seen.push(lc(F).state); } });   // what the row says while the scan is actually running
  const { rs, j } = await request(F);
  check(rs.status === 200 && j.success === true && j.duplicate === false && typeof j.live_token === 'string', 'journey 1: POST /api/scan with consent is accepted (200) and returns a live token');
  check(F.db.users.length === 1 && F.db.leads.length === 1 && F.db.scans.length === 1 && F.db.users[0].consent_given_at && F.db.users[0].consent_source === 'scan_page', 'journey 1: acceptance is durable and carries the consent record (user, lead, scan row exist before any email)');
  trace(`request accepted        -> ${JSON.stringify(lc(F))}`);
  check(lc(F).state === 'queued' && lc(F).delivery === 'not_sent', 'journey 1: after acceptance the persisted state is queued / not_sent (a scan is not complete and nothing is delivered)');
  const conf = resends(F).map((c) => ({ k: c.headers['Idempotency-Key'], body: JSON.parse(c.body) }));
  check(conf.length === 1 && conf[0].k === `confirm-${scanOf(F, A).id}` && conf[0].body.to[0] === A && scanOf(F, A).confirmation_sent_at, 'journey 1: exactly one confirmation, idempotency-keyed, to the requester only, and the row records it');
  await run(F);
  trace(`report job ran          -> ${JSON.stringify(lc(F))}`);
  const s = scanOf(F, A);
  check(seen.includes('running'), 'journey 1: while the scan ran the persisted state was running (observed from inside the HIBP call)');
  check(lc(F).state === 'completed' && lc(F).delivery === 'provider_accepted' && lc(F).receipt === 'not_observable' && s.resend_message_id === [...F.provider.values()].at(-1), 'journey 1: after the report job the state is completed / provider_accepted, with the provider message id on the row, and receipt not_observable');
  check(F.db.signals.length > 0 && F.db.signals.every((x) => x.scan_id === s.id) && F.db.hexagon_scores.length === 8 && s.report_sent_at && s.privacy_score === 100 && s.categories_checked.join() === 'email' && s.categories_unchecked.length === 7, 'journey 1: the scan output is persisted for this scan only (signals, 8 hexagon scores); the score is partial: only the email category was checked and the other 7 are listed as unchecked');
  check(resends(F).length === 2 && resends(F).every((c) => JSON.parse(c.body).to[0] === A) && keysOf(F, 'report-').length === 1, 'journey 1: two emails in total (confirmation, report), both to the requester only; the provider holds one report message');
  await run(F);
  check(resends(F).length === 2 && F.provider.size === 2, 'journey 1: replaying the report job sends nothing more');
}

// ============================================================ 2. duplicate request and replay
{
  const F = harness();
  await request(F); const again = await request(F);
  check(again.rs.status === 200 && again.j.duplicate === true && !('live_token' in again.j) && F.db.scans.length === 1 && F.provider.size === 1, 'duplicate: a second request for the same address within 24h creates no second scan, no second email and no live view');
  await run(F); await request(F); await run(F);
  check(F.db.scans.length === 1 && F.provider.size === 2 && keysOf(F, 'report-').length === 1, 'duplicate: a request after the report went out is still the same scan, and there is still one report');
}
{
  // The fake serialises calls, which hides races. Hold every "is there a scan in the last 24h?" read until all three requests have made it, so none can see another's insert.
  let waiting = [], arrived = 0; const N = 3;
  const F = harness({ onRequest: (url, o) => { if ((o.method || 'GET') === 'GET' && /rest\/v1\/scans\?user_id=/.test(url)) { arrived++; if (arrived === N) waiting.forEach((r) => r()); else return new Promise((r) => waiting.push(r)).then(() => undefined); } } });
  await Promise.all([request(F), request(F), request(F)]);
  const confirms = keysOf(F, 'confirm-');
  // KNOWN GAP G5 (not fixed here, see docs/scan-lifecycle-ck-8503.md): the 24h duplicate rule is check-then-insert with no database constraint, so truly simultaneous requests all pass the check.
  // In production a double click is stopped earlier (a Turnstile token is single use, MPC-8430; per-IP limit). The real fix is a database guard = a migration = a production action needing approval.
  process.stdout.write(`KNOWN-GAP G5 three simultaneous requests for one address (read-before-write barrier) -> ${F.db.scans.length} scans, ${confirms.length} confirmations\n`);
  check(F.db.scans.length === N && confirms.length === N, 'duplicate: documents the current behaviour of the unguarded race (3 scans). If this fails the race was fixed: update gap G5 and make it assert 1');
  await run(F);
  check(keysOf(F, 'report-').length === F.db.scans.length, 'duplicate: each scan row still produces exactly one report (no scan is reported twice)');
}

// ============================================================ 3. worker restart
{
  // killed after it claimed the scan, before anything was sent
  let dead = false, armed = true;
  const F = harness({ onRequest: (url) => { if (dead) throw new Killed(); if (armed && url.includes('haveibeenpwned.com')) { armed = false; dead = true; throw new Killed(); } } });
  await request(F); await run(F);
  check(lc(F).state === 'running' && scanOf(F, A).report_attempts === 1 && keysOf(F, 'report-').length === 0, 'restart: a Worker killed mid-scan leaves the row running with one attempt counted and no report sent');
  dead = false; await run(F);
  check(lc(F).state === 'running', 'restart: a claim younger than 30 minutes is not stolen by the next run');
  staleClaim(F); await run(F);
  check(lc(F).state === 'completed' && scanOf(F, A).report_attempts === 2 && keysOf(F, 'report-').length === 1, 'restart: after the 30 minute stale window the next run takes the scan back and completes it, once');
}
{
  // killed after the provider accepted the report, before the Worker wrote that down (the dangerous case)
  let dead = false, killAfterSend = false;
  const F = harness({ onRequest: (url, o) => {
    if (dead) throw new Killed();
    if (killAfterSend && url.includes('rest/v1/scans') && o.method === 'PATCH' && /"report_status":"sent"/.test(o.body || '')) { dead = true; throw new Killed(); }
  } });
  await request(F); killAfterSend = true; await run(F);
  const firstId = F.provider.get(`report-${scanOf(F, A).id}`);
  check(firstId && lc(F).state === 'running' && !scanOf(F, A).resend_message_id, 'restart: killed between provider acceptance and the database write: the provider has the email, the row still says running with no message id (the ambiguity)');
  dead = false; killAfterSend = false; staleClaim(F); await run(F);
  const reportCalls = resends(F).filter((c) => c.headers['Idempotency-Key'].startsWith('report-'));
  check(reportCalls.length === 2 && new Set(reportCalls.map((c) => c.headers['Idempotency-Key'])).size === 1 && keysOf(F, 'report-').length === 1, 'restart: recovery repeats the send with the SAME idempotency key, so the provider holds one report, not two');
  check(lc(F).state === 'completed' && scanOf(F, A).resend_message_id === firstId, 'restart: the row ends completed and records the FIRST provider message id (the retry reconciled to it)');
}

// ============================================================ 4. scan dependency failure
{
  let hibpDown = true;
  const F = harness({ hibp: () => ({ ok: false, status: hibpDown ? 500 : 404, headers: { get: () => null }, text: async () => '', json: async () => ({}) }) });
  await request(F); await run(F);
  const s = scanOf(F, A);
  check(lc(F).state === 'queued' && /^held:/.test(s.report_last_error) && s.report_attempts === 0 && keysOf(F, 'report-').length === 0, 'scan failure: breach lookup down and partial reports off => the scan is held (queued, no attempt burned, no report) rather than sent half-built');
  hibpDown = false; await run(F);
  check(lc(F).state === 'completed' && keysOf(F, 'report-').length === 1, 'scan failure: when the lookup recovers the same scan completes, once');
}

// ============================================================ 5. report-generation failure
{
  let fail = true;
  const F = harness({ onRequest: (url, o, res) => { if (fail && o.method === 'POST' && url.includes('rest/v1/hexagon_scores')) return res(500, 'db down'); } });
  await request(F);
  for (let i = 1; i <= 4; i++) { await run(F); check(lc(F).state === 'recovering' && lc(F).attempts === i && /hexagon_scores/.test(lc(F).error) && keysOf(F, 'report-').length === 0, `generation failure: attempt ${i} fails, is recorded (state recovering, error on the row) and no report is sent`); }
  await run(F);
  check(lc(F).state === 'failed' && lc(F).attempts === 5 && keysOf(F, 'report-').length === 0, 'generation failure: the 5th failure ends in failed with the reason on the row, still no report email');
  const before = F.calls.length; fail = false; const o = await run(F);
  check(o.sent === 0 && F.calls.length === before + 0 || F.calls.slice(before).every((c) => !c.url.includes('api.resend.com')), 'generation failure: a failed scan is not retried silently, even once the fault clears (an operator resets it; see the runbook)');
  check(lc(F).state === 'failed', 'generation failure: it stays failed (terminal) until an operator acts');
}

// ============================================================ 6. delivery failure after a successful scan
{
  let down = true;
  const F = harness({ onRequest: (url, o, res) => { if (down && url.includes('api.resend.com') && o.headers['Idempotency-Key'].startsWith('report-')) return res(500, 'provider down'); } });
  await request(F); await run(F);
  const s = scanOf(F, A);
  check(F.db.signals.length > 0 && s.report_status === 'pending' && lc(F).state === 'recovering' && /report email not sent/.test(s.report_last_error) && !s.report_sent_at, 'delivery failure: the scan output is saved but the state is recovering (not completed): a finished scan with an unsent report is never reported as sent');
  const signalsBefore = F.db.signals.length; down = false; await run(F);
  check(lc(F).state === 'completed' && F.db.signals.length === signalsBefore && F.db.hexagon_scores.length === 8 && keysOf(F, 'report-').length === 1, 'delivery failure: the retry sends the report once and does not double the saved signals or scores');
}

// ============================================================ 7. timeout after the provider accepted (response lost)
{
  let first = true;
  const F = harness({ onRequest: (url, o) => {
    if (first && url.includes('api.resend.com') && o.headers['Idempotency-Key'].startsWith('report-')) { first = false; F.provider.set(o.headers['Idempotency-Key'], 'msg_accepted_before_timeout'); throw new Error('The operation was aborted due to timeout'); }
  } });
  await request(F); await run(F);
  check(lc(F).state === 'recovering' && keysOf(F, 'report-').length === 1, 'timeout: the provider accepted but the Worker saw a timeout: the row says recovering, not sent (we cannot know), while the provider holds the email');
  await run(F);
  check(lc(F).state === 'completed' && scanOf(F, A).resend_message_id === 'msg_accepted_before_timeout' && keysOf(F, 'report-').length === 1, 'timeout: the retry reuses the idempotency key, the provider returns the original message, and the row records it: one email, reconciled');
}

// ============================================================ 8. withdrawn consent
const unsub = async (F, email) => { sandbox(F); return worker.fetch(new Request(`https://x/api/unsubscribe?e=${encodeURIComponent(email)}&t=${await unsubscribeToken(env.UNSUBSCRIBE_SECRET, email)}`, { method: 'POST', headers: { Accept: 'application/json', Origin: 'https://myprivacytool.io' } }), env, { waitUntil: () => {} }); };
{
  const F = harness();
  await request(F); const u = await unsub(F, A); await run(F);
  check(u.status === 200 && lc(F).state === 'cancelled' && keysOf(F, 'report-').length === 0 && /unsubscribed/.test(scanOf(F, A).report_last_error), 'withdrawn consent: unsubscribing before the report => cancelled, nothing sent, the reason is on the row');
}
{
  // unsubscribes WHILE the scan is running (after the queue was read, before the email is built)
  let once = true; let F;
  F = harness({ onRequest: async (url) => { if (once && url.includes('haveibeenpwned.com')) { once = false; await unsub(F, A); } } });
  await request(F); await run(F);
  check(keysOf(F, 'report-').length === 0 && lc(F).state === 'cancelled', 'withdrawn consent: unsubscribing while the scan is running still stops the report (checked again just before sending)');
}

// ============================================================ 9. expired handoff
{
  const F = harness();
  const { j } = await request(F); const id = scanOf(F, A).id;
  const verify = (await makeLiveLink(env, id)).split('#v=')[1];
  const get = (headers, q = '') => { sandbox(F); return worker.fetch(new Request(`https://x/api/scan/live${q}`, { headers: { Origin: 'https://myprivacytool.io', ...headers } }), env, { waitUntil: () => {} }); };
  check((await get({}, `?t=${encodeURIComponent(j.live_token)}`)).status === 200 && (await get({ Authorization: `Bearer ${verify}` })).status === 200, 'handoff: both the stream token and the emailed link token work while fresh');
  const realNow = Date.now; Date.now = () => realNow() + 16 * 60 * 1000;
  const stream = (await get({}, `?t=${encodeURIComponent(j.live_token)}`)).status, link = (await get({ Authorization: `Bearer ${verify}` })).status;
  Date.now = () => realNow() + 8 * 24 * 3600 * 1000;
  const linkLate = (await get({ Authorization: `Bearer ${verify}` })).status;
  Date.now = realNow;
  check(stream === 401 && link === 200 && linkLate === 401, 'handoff: the stream token expires after 15 minutes (401), the emailed link after 7 days (401)');
}

// ============================================================ 10. unsupported or ambiguous target
{
  const F = harness();
  const bad = ['@someone', '+85291234567', 'https://www.instagram.com/someone', 'someone', 'a@b', 'one@example.com, two@example.com', 'a@@example.com', '', '   '];
  const out = []; for (const email of bad) out.push((await post(F, { email, consent: true })).rs.status);
  check(out.every((s) => s === 400) && F.db.users.length === 0 && F.db.scans.length === 0 && resends(F).length === 0, 'unsupported target: social handles, phone numbers, profile URLs and multi-address input are refused (400) before anything is stored or sent');
  const noConsent = await post(F, { email: A }); const falseConsent = await post(F, { email: A, consent: 'true' });
  check(noConsent.rs.status === 400 && falseConsent.rs.status === 400 && F.db.users.length === 0 && resends(F).length === 0, 'consent: missing or non-boolean consent is refused; it is never defaulted');
}

// ============================================================ 11. wrong-user access
{
  const F = harness();
  const a = await request(F, A), b = await request(F, B);
  await run(F);
  const idA = scanOf(F, A).id, idB = scanOf(F, B).id;
  F.db.signals = F.db.signals.filter((x) => !(x.scan_id === idB && x.signal_type === 'email-name'));   // give B one distinctive finding that A must never see
  F.db.signals.push({ scan_id: idB, signal_type: 'email-name', check_status: 'found', details: 'B-PRIVATE-MARKER' });
  const get = (headers, q = '') => { sandbox(F); return worker.fetch(new Request(`https://x/api/scan/live${q}`, { headers: { Origin: 'https://myprivacytool.io', ...headers } }), env, { waitUntil: () => {} }); };
  const tokA = (await makeLiveLink(env, idA)).split('#v=')[1], tokB = (await makeLiveLink(env, idB)).split('#v=')[1];
  const readA = await (await get({ Authorization: `Bearer ${tokA}` })).text(), streamA = await (await get({}, `?t=${encodeURIComponent(a.j.live_token)}`)).text();
  check(!readA.includes('B-PRIVATE-MARKER') && !streamA.includes('B-PRIVATE-MARKER') && !readA.includes(B) && !streamA.includes(B), 'wrong user: A\'s tokens never return B\'s findings');
  check((await (await get({ Authorization: `Bearer ${tokB}` })).text()).includes('B-PRIVATE-MARKER'), 'wrong user: B\'s own emailed link does return B\'s detail (the marker is reachable, so the A result above is a real exclusion)');
  const swapped = `${idB}.${tokA.split('.')[1]}.${tokA.split('.')[2]}`;
  check((await get({ Authorization: `Bearer ${swapped}` })).status === 401 && (await get({}, `?t=${encodeURIComponent(`${idB}.${a.j.live_token.split('.')[1]}.${a.j.live_token.split('.')[2]}`)}`)).status === 401, 'wrong user: putting B\'s scan id on A\'s signature is refused (401)');
  check(!/"details"|"value"/.test(streamA), 'wrong user: the stream token (typed address, no inbox proof) never carries a value or detail');
  const mails = resends(F).map((c) => JSON.parse(c.body));
  check(mails.filter((m) => m.to[0] === A).length === 2 && mails.filter((m) => m.to[0] === B).length === 2 && mails.every((m) => [A, B].includes(m.to[0]) && m.to.length === 1), 'wrong user: each requester receives only their own two emails; no email has a second recipient');
}

// ============================================================ 12. recipient authorisation (the live gate)
{
  const F = harness();
  const gated = { ...env, RECIPIENT_ALLOWLIST: 'someone-else@example.com' };
  await post(F, { email: A, consent: true }, gated); await quiet(() => runReportJob(gated, F.f));
  check(resends(F).length === 0 && lc(F).state === 'queued' && scanOf(F, A).report_attempts === 0, 'recipient gate: with the allowlist on, an unlisted address is accepted and held: nothing sent, no attempt burned (the go-live gate still governs real sends)');
}

globalThis.fetch = realFetch;
process.exit(ok ? 0 : 1);
