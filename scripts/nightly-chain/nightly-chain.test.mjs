// MPC-7557: tests for the nightly chain runner against an in-memory fake of the synthetic Worker, Supabase, Resend and the site. No network.
// Run: node scripts/nightly-chain/nightly-chain.test.mjs
import { createHash } from 'node:crypto';
import { runChain, metricsRow, hkDay } from './run.mjs';
import { fixtureScan, checkReport, scanRequestBody, resolveLinks, linksToResolve } from './checks.mjs';
import { isTestAddress, testAddress, excludeTestFilter, onlyTestFilter } from '../../shared/test-records.js';
import { buildReportEmail } from '../../workers/scan-report/lib/email.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const NOW = new Date('2026-10-28T16:00:00Z');
const ENV = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k', SYNTHETIC_SCAN_URL: 'https://synth.invalid', PROD_SCAN_URL: 'https://prod.invalid', RESEND_API_KEY: 'r', UNSUBSCRIBE_SECRET: 'secret', WAIT_REPORT_MS: '60000', WAIT_CONFIRM_MS: '60000', WAIT_EVENT_MS: '60000' };
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });

// ------------------------------------------------------------ fake world
function world(opts = {}) {
  const db = { webScans: {}, links: [], scans: {}, users: {}, suppressions: new Set(), erased: [], deleted: [], posts: [], gets: [] };
  let polls = 0;
  const html = {};
  const f = async (url, init = {}) => {
    url = String(url); const method = init.method || 'GET';
    db.gets.push(`${method} ${url.replace(/[?#].*/, '')}`);
    if (url.startsWith('https://synth.invalid/api/scan')) {
      if (opts.synthMissing) return json({}, 404);
      const b = JSON.parse(init.body); db.posts.push(b);
      if (b['cf-turnstile-response'] !== 'XXXX.DUMMY.TOKEN.XXXX' || b.consent !== true || b.save_consent !== true) return json({ error: 'bad' }, 400);
      const sid = `00000000-0000-4000-8000-${String(Object.keys(db.scans).length + 1).padStart(12, '0')}`;
      const wid = `11111111-1111-4111-8111-${String(Object.keys(db.webScans).length + 1).padStart(12, '0')}`;
      db.users[b.email] = { email: b.email, email_opt_out_at: null };
      db.scans[sid] = { id: sid, source: 'web_scan', report_status: 'pending', email: b.email, confirmation_sent_at: null, report_sent_at: null, resend_message_id: null };
      db.webScans[wid] = { id: wid, hexagon_count: b.scan.length, results_bytes: 100, results: opts.mutateSaved ? opts.mutateSaved(b.scan) : b.scan, created_at: NOW.toISOString() };
      if (!opts.noLink) db.links.push({ web_scan_id: wid, channel: 'email', contact_id: sid, save_consent_at: opts.noConsent ? null : NOW.toISOString(), save_consent_version: opts.noConsent ? null : '2026-10-12-v1' });
      return json({ success: true, duplicate: false, scan_saved: true, scan_number: wid });
    }
    if (url.startsWith('https://db.invalid/rest/v1/')) {
      const path = url.slice('https://db.invalid/rest/v1/'.length);
      if (method === 'POST' && path.startsWith('rpc/mpt_delete_web_scan')) { const n = JSON.parse(init.body).p_scan_number; const found = Boolean(db.webScans[n]); delete db.webScans[n]; db.deleted.push(n); return json({ found }); }
      if (method === 'POST' && path.startsWith('rpc/mpt_dsar_erase')) { const e = JSON.parse(init.body).p_email; db.erased.push(e); delete db.users[e]; for (const [k, v] of Object.entries(db.scans)) if (v.email === e) delete db.scans[k]; return json({}); }
      if (method === 'POST' && path === 'mpt_raw_metrics') { db.metrics = JSON.parse(init.body); return json({}, 201); }
      if (method === 'DELETE' && path.startsWith('email_suppressions')) { db.suppressions.delete(path.split('eq.')[1]); return json({}, 204); }
      if (path.startsWith('web_scans?id=eq.')) { const r = db.webScans[path.match(/eq\.([^&]+)/)[1]]; return json(r ? [r] : []); }
      if (path.startsWith('web_scan_contacts?')) return json(db.links.filter((l) => l.web_scan_id === path.match(/eq\.([^&]+)/)[1]));
      if (path.startsWith('scans?id=eq.')) {
        const s = db.scans[path.match(/eq\.([^&]+)/)[1]]; if (!s) return json([]);
        polls++;
        if (!opts.neverConfirm && polls >= 2) s.confirmation_sent_at = NOW.toISOString();
        if (!opts.neverSend && polls >= 4) { s.report_status = opts.failReport ? 'failed' : 'sent'; s.report_sent_at = NOW.toISOString(); s.resend_message_id = 'msg_1'; s.report_last_error = opts.failReport ? 'boom for someone@example.com' : null; s.report_attempts = 5; }
        return json([{ ...s, users: { email: opts.realAddress ? 'real.person@example.com' : s.email } }]);
      }
      if (path.startsWith('email_sends?provider_message_id=eq.')) {   // MPC-7556: the row the Resend webhook updates
        if (opts.noEvent) return json([{ status: 'sent' }]);
        return json([{ status: opts.eventStatus ?? 'delivered' }]);
      }
      if (path.startsWith('users?email=eq.')) { const e = decodeURIComponent(path.match(/eq\.([^&]+)/)[1]); return json(db.users[e] ? [db.users[e]] : []); }
      if (path.startsWith('email_suppressions?email_hash=eq.')) { const h = path.match(/eq\.([^&]+)/)[1]; return json(db.suppressions.has(h) ? [{ email_hash: h }] : []); }
    }
    if (url.startsWith('https://api.resend.com/emails/msg_1')) {
      const w = Object.values(db.webScans)[0]; if (!w) return json({}, 404);
      const built = buildReportEmail({ scan: { id: 's', score: null, risk_level: null, partial: true, categories_checked: [] }, breaches: [], breachStatus: 'not_checked', brokers: [], webScan: { id: w.id, hexagons: w.results }, unsubscribeLink: 'https://myprivacytool.io/unsubscribe?e=x&t=y' });
      html.h = opts.sentHtml ? opts.sentHtml(built.html) : built.html;
      return json({ html: html.h, text: opts.sentText ? opts.sentText(built.text) : built.text });
    }
    if (url.startsWith('https://synth.invalid/api/unsubscribe')) {
      const e = decodeURIComponent(url.match(/e=([^&]+)/)[1]); if (db.users[e]) db.users[e].email_opt_out_at = NOW.toISOString();
      db.suppressions.add(createHash('sha256').update(e).digest('hex')); return json({ ok: true });
    }
    if (url.startsWith('https://myprivacytool.io/') || url.startsWith('https://www.myprivacytool.io/')) return json({}, opts.deadLink && url.includes(opts.deadLink) ? 404 : 200);
    if (url.startsWith('https://')) return json({}, 200);   // other pages the report links to (guides, HIBP)
    return json({}, 500);
  };
  return { f, db };
}
const run = (env, w, extra = {}) => runChain({ ...ENV, ...env }, { fetchImpl: w.f, sleep: async () => {}, now: NOW, ...extra });
const failedAt = (r) => r.failedStep;

// ------------------------------------------------------------ test records
check(isTestAddress('testingnt69@gmail.com') && isTestAddress('TestingNT69+nightly-20261028@gmail.com'), 'test addresses: the mailbox and its plus-aliases');
check(!isTestAddress('testingnt69@example.com') && !isTestAddress('xtestingnt69+a@gmail.com') && !isTestAddress('testingnt69+a@gmail.com.evil.io') && !isTestAddress('someone@gmail.com') && !isTestAddress(null), 'test addresses: nothing else matches');
check(testAddress('nightly', '20261028') === 'testingnt69+nightly-20261028@gmail.com' && isTestAddress(testAddress('weekly', '20261028')), 'run aliases are test addresses');
check(excludeTestFilter('email').includes('not.ilike.') && !excludeTestFilter('email').includes('+') && onlyTestFilter('email').includes('ilike.testingnt69'), 'KPI filters are percent-encoded PostgREST filters');
check(hkDay(NOW) === '20261029', 'run day is the Hong Kong date (16:00 UTC is already the next day)');

// ------------------------------------------------------------ nightly, all green
{
  const w = world(); const r = await run({}, w);
  check(r.ok && r.steps.every((s) => s.ok), 'nightly: all nine steps pass');
  check(r.steps.map((s) => s.step).join() === 'scan_request,saved_scan,linked_contact_consent,report_request,first_email_accepted,report_sent,report_checks,links_resolve,delivery_event_seen', 'nightly: steps run in the required order');
  const b = w.db.posts[0];
  check(isTestAddress(b.email) && b['cf-turnstile-response'] === 'XXXX.DUMMY.TOKEN.XXXX' && b.consent === true && b.save_consent === true && b.scan.length === fixtureScan().length, 'nightly: request is a consented test-alias scan carrying the Turnstile TEST token');
  check(w.db.gets.every((g) => !g.startsWith('POST https://prod.invalid/api/scan')), 'nightly: nothing is ever POSTed to the production /api/scan');
  check(r.facts.report_source === 'provider' && r.facts.html_bytes < 100000 && r.facts.links_checked >= 2, 'nightly: report read back from the provider, under 100 KB, links fetched');
  const row = metricsRow(r, NOW);
  check(row.status === 'ok' && row.source === 'nightly_chain' && !/@/.test(JSON.stringify(row)), 'metrics row: ok, counts only, no email address');
}

// ------------------------------------------------------------ nightly, one broken link each
const broken = [
  ['synthetic Worker not deployed', { synthMissing: true }, 'scan_request'],
  ['no contact link', { noLink: true }, 'linked_contact_consent'],
  ['no consent record on the link', { noConsent: true }, 'linked_contact_consent'],
  ['first email never accepted', { neverConfirm: true }, 'first_email_accepted'],
  ['report never sent', { neverSend: true }, 'report_sent'],
  ['report failed', { failReport: true }, 'report_sent'],
  ['request attached to a real address', { realAddress: true }, 'report_request'],
  ['saved scan shows a finding the scan never sent', { mutateSaved: (s) => [...s, { id: 'device', label: 'Device Type', value: 'Desktop', status: 'found' }] }, 'report_checks'],
  ['sent report over 100 KB', { sentHtml: (h) => h.replace('</body>', `<!-- ${'x'.repeat(100000)} --></body>`) }, 'report_checks'],
  ['plain text drifts from the HTML', { sentText: (t) => t.replace(/NOT CHECKED/g, 'unknown') }, 'report_checks'],
  ['sent report has unsupported markup', { sentHtml: (h) => h.replace('</body>', '<script>1</script></body>') }, 'report_checks'],
  ['a report link returns 404', { deadLink: '/opt-out' }, 'links_resolve'],
  ['no delivery event ever stored for the test report (webhook not delivering)', { noEvent: true }, 'delivery_event_seen'],
  ['the test report bounced', { eventStatus: 'bounced' }, 'delivery_event_seen'],
];
for (const [name, opts, step] of broken) {
  const w = world(opts); const r = await run({}, w);
  const idx = r.steps.findIndex((s) => s.step === step);
  check(!r.ok && failedAt(r) === step, `fails at "${step}": ${name}`);
  check(r.steps.slice(idx + 1).every((s) => s.skipped && !s.ok), `  later steps are SKIPPED, never passed (${name})`);
  const row = metricsRow(r, NOW);
  check(row.status === 'error' && row.error.includes(step) && !/@/.test(JSON.stringify(row)), `  metrics row is an error naming the step, no email address (${name})`);
}

// ------------------------------------------------------------ configuration
{
  const w = world(); const r = await run({ SUPABASE_SERVICE_ROLE_KEY: '' }, w);
  check(!r.ok && r.notConfigured && w.db.posts.length === 0, 'not configured: nothing is sent, and the state is "not configured", not a pass');
  check(metricsRow(r, NOW).status === 'error' && /not configured/.test(metricsRow(r, NOW).error), 'not configured: the metrics row is an error');
  const wk = world(); const rw = await run({ MODE: 'weekly', UNSUBSCRIBE_SECRET: '' }, wk);
  check(rw.notConfigured && /UNSUBSCRIBE_SECRET/.test(rw.notConfigured) && wk.db.posts.length === 0, 'weekly without UNSUBSCRIBE_SECRET: not configured, nothing created');
}

// ------------------------------------------------------------ weekly
{
  const w = world(); const r = await run({ MODE: 'weekly' }, w);
  check(r.ok && r.steps.map((s) => s.step).join() === 'unsubscribe,suppression_recorded,delete_by_scan_number,cleanup', 'weekly: unsubscribe, suppression, delete by scan number, cleanup all pass in order');
  check(w.db.deleted.length === 1 && w.db.erased.every((e) => isTestAddress(e)) && w.db.erased.length === 9, 'weekly: scan deleted by number; only test addresses erased (today plus eight older nightly aliases)');
  check(w.db.suppressions.size === 0 && Object.keys(w.db.users).length === 0, 'weekly: nothing left behind (suppression and user removed)');
  check(w.db.gets.some((g) => g.startsWith('POST https://synth.invalid/api/unsubscribe')) && !w.db.gets.some((g) => g.includes('prod.invalid')), 'weekly: unsubscribe goes to the synthetic Worker (test-only secret); nothing at all is sent to production');
}
{
  const w = world(); const orig = w.f;
  const r = await run({ MODE: 'weekly' }, { f: async (u, i) => (String(u).includes('rpc/mpt_delete_web_scan') ? json({ found: false }) : orig(u, i)), db: w.db });
  check(!r.ok && failedAt(r) === 'delete_by_scan_number', 'weekly: deletion that finds nothing fails the run');
  check(r.steps.find((s) => s.step === 'cleanup').ok === true && w.db.suppressions.size === 0, 'weekly: cleanup still runs after a failed step, so no test record is left behind');
}

// ------------------------------------------------------------ pure checks
{
  const fx = fixtureScan(); const hx = (over) => ({ id: 'x', status: 'not_checked', ...over });
  const good = buildReportEmail({ scan: { id: 's', score: null, risk_level: null, partial: true, categories_checked: [] }, webScan: { id: '11111111-1111-4111-8111-111111111111', hexagons: fx }, emailChecks: [] });
  const ok = checkReport({ html: good.html, text: good.text, json: JSON.parse(JSON.stringify(good.report)) }, { scanNumber: '11111111-1111-4111-8111-111111111111', fixture: fx });
  check(ok.length === 0, `report check: a real two-part report passes (${ok.join('; ')})`);
  check(checkReport({ html: good.html, text: good.text, json: null }, { scanNumber: '11111111-1111-4111-8111-111111111111', fixture: fx }).some((p) => /JSON/.test(p)), 'report check: missing JSON attachment fails');
  const bad = JSON.parse(JSON.stringify(good.report)); bad.web_scan.hexagons[0].status = 'maybe';
  check(checkReport({ html: good.html, text: good.text, json: bad }, { scanNumber: '11111111-1111-4111-8111-111111111111', fixture: fx }).some((p) => /status "maybe"/.test(p)), 'report check: an invented status fails (honest statuses)');
  check(checkReport({ html: good.html, text: good.text, json: JSON.parse(JSON.stringify(good.report)) }, { scanNumber: '22222222-2222-4222-8222-222222222222', fixture: fx }).length > 0, 'report check: wrong scan number fails');
  check(scanRequestBody('a@b.co', fx).scan.every((h) => ['found', 'clear', 'not_checked'].includes(h.status)), 'fixture carries the site\'s own capture statuses');
  const links = linksToResolve(good.html);
  check(links.length > 0 && links.every((l) => /^https:/.test(l) && !/unsubscribe\?/.test(l) && !l.includes('&amp;')), 'links to resolve: https only, unsubscribe link never fetched, entities decoded');
  check((await resolveLinks(['https://a.invalid/x'], async () => { throw new Error('down'); })).length === 1 && (await resolveLinks(['https://a.invalid/x'], async () => json({}, 410))).length === 1 && (await resolveLinks(['https://a.invalid/x'], async () => json({}, 200))).length === 0, 'resolveLinks: network error and 410 are failures, 200 passes');
}

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
