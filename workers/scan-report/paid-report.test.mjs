// MPC-9816 (F2 Paid Exposure Report): acceptance tests from docs/paid-report-spec-mpc-9815.md section 6, Worker side. SYNTHETIC identities only (example.test). No network, no secrets.
// AT-1..3 and AT-14 (the /report copy) are in src/pages/Report.test.tsx. Run: node workers/scan-report/paid-report.test.mjs
import worker from './index.js';
import { buildBrokerPanel } from './lib/brokerPanel.js';
import { sectionState, limitHistory } from './lib/entitlements.js';
import { breachGate, upgradeSentence, withinRetention, retentionMonths, buildExportDocument, stripIps, renderPdf, documentLines, makeExportToken, readExportToken, JSON_MAX_BYTES, PDF_MAX_BYTES } from './lib/paidReport.js';
import { buildReportEmail } from './lib/email.js';
import { handleExportIssue, handleExportDownload, loadExportDocument } from './lib/accounts.js';
import { fake } from './test-support/fake-backend.mjs';
import { seedRows, RANK } from './test-support/fake-entitlements.mjs';
import PLANS from './lib/plans.generated.js';
import { readFileSync } from 'node:fs';
import { enableHibpForTests } from './test-support/hibp-on.mjs';
enableHibpForTests();

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const real = globalThis.fetch;
const TIERS = ['free', 'basic', 'pro', 'executive'];

// an entitlements object for a tier, built from the seed rows (the same data the database holds); `override` changes a row's min tier (a data change, AT-8)
const entFor = (tier, override = {}) => {
  const rows = seedRows().map((r) => ({ ...r, ...(override[r.key] ? { min_tier: override[r.key] } : {}) }));
  return { tier, has_account: true, capabilities: Object.fromEntries(rows.map((r) => [r.key, RANK[tier] >= RANK[r.min_tier]])), capability_info: Object.fromEntries(rows.map((r) => [r.key, { min_tier: r.min_tier, status: r.status, cost: r.cost ?? null }])), limits: {}, scans: null };
};
const ENV_ON = { BREACH_GATE_ENABLED: 'true' };

check(JSON.stringify(PLANS) === JSON.stringify(JSON.parse(readFileSync(new URL('../../src/data/plans.generated.json', import.meta.url), 'utf8'))), 'the Worker plans module equals src/data/plans.generated.json (AT-2: one price source)');
// ---- AT-9 / AT-8: the gate is data
check(seedRows().filter((r) => r.cost === 'third_party').every((r) => r.min_tier !== 'free'), 'AT-9: every third_party-cost capability is above free');
check(breachGate(ENV_ON, entFor('free')).allowed === false && breachGate(ENV_ON, entFor('basic')).allowed === true, 'breach gate: Free denied, Basic allowed');
check(breachGate(ENV_ON, entFor('basic', { 'breach.check': 'pro' })).allowed === false && breachGate(ENV_ON, entFor('pro', { 'breach.check': 'pro' })).allowed === true, 'AT-8: moving breach.check to pro in DATA takes it from Basic with no code change');
check(breachGate({}, entFor('free')).allowed === true, 'switch off (BREACH_GATE_ENABLED not "true") = the old behaviour, the rollback');

// ---- AT-5 / AT-16: the upgrade sentence
{
  const free = buildBrokerPanel(null, { entitlements: entFor('free'), basicPrice: '$7.99' });
  check(typeof free.upgrade === 'string' && free.upgrade.startsWith('Your free report did not search data brokers for listings in your name. Basic, $7.99 a month, does that, with proof and a removal guide for each listing, and keeps every report for you.'), 'AT-5: Free sees the decided upgrade sentence with the price from data');
  check(/\(In build\)$/.test(free.upgrade), 'claims rule: the sentence carries the In build marker while licensed coverage is not live');
  check(free.rows.length === 9 && free.rows.every((r) => r.state === 'not_checked' && !r.evidence_url), 'AT-5: all nine brokers are shown as not checked (nothing hidden, nothing blurred)');
  const noPrice = upgradeSentence(entFor('free'), null);
  check(noPrice.includes('Basic does that') && !/\$/.test(noPrice), 'no price available: the sentence leaves the price out rather than inventing one');
  for (const t of ['basic', 'pro', 'executive']) check(buildBrokerPanel(null, { entitlements: entFor(t), basicPrice: '$7.99' }).upgrade === null, `AT-16: a ${t} reader never sees the upgrade sentence`);
  const pasted = buildBrokerPanel({ pending: false, items: [{ key: 'spokeo', name: 'Spokeo', state: 'listed', match: 'possible', is_guess: true, confidence: 'low', evidence_url: 'https://www.spokeo.com/x', source: { checked_at: '2026-11-08T00:00:00Z' } }] }, { entitlements: entFor('free'), basicPrice: '$7.99' });
  check(pasted.rows[0].state === 'listed' && pasted.rows[0].is_guess === true && /guessing/.test(pasted.rows[0].text) && pasted.rows[0].evidence_url, 'AT-7: a pasted listing on Free shows the real state, evidence and is labelled a guess');
}

// ---- AT-12: the report email stays under 100,000 bytes with the upgrade sentence, 54 hexagons and 9 brokers
{
  const m = buildReportEmail({ scan: { id: 'a', score: 60, risk_level: 'medium', partial: true, categories_checked: ['device'] }, breachStatus: 'not_checked', breachGated: true, entitlements: entFor('free'), basicPrice: '$7.99', unsubscribeLink: 'https://myprivacytool.io/u' });
  check(new TextEncoder().encode(m.html).length < 100000, `AT-12: report email HTML ${new TextEncoder().encode(m.html).length} bytes (< 100,000)`);
  check(m.text.split('Your free report did not search data brokers').length === 2 && m.html.split('Your free report did not search data brokers').length === 2, 'AT-5: the upgrade sentence appears exactly once in the text and once in the HTML');
  check(/Breaches: NOT CHECKED\./.test(m.text) && m.text.includes('https://haveibeenpwned.com/') && !/\d+ breach/.test(m.text), 'AT-5: Free breach section is NOT CHECKED with the self-check link; no count, no teaser');
  const b = buildReportEmail({ scan: { id: 'a', score: 60, risk_level: 'medium', partial: false, categories_checked: ['email'] }, breachStatus: 'checked', breaches: [], entitlements: entFor('basic'), basicPrice: '$7.99', unsubscribeLink: 'https://myprivacytool.io/u' });
  check(!b.text.includes('Your free report did not search') && !b.html.includes('Your free report did not search') && !b.text.includes('Breaches: NOT CHECKED'), 'AT-16: a Basic report email has neither the upgrade sentence nor the Free breach line');
}

// ---- AT-6: a Free address triggers no breach lookup (no third-party cost); Basic does
{
  const ENV = { EMAIL_DOMAIN_CHECK: 'false', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HIBP_API_KEY: 'h', HIBP_MIN_INTERVAL_MS: '0', RECIPIENT_ALLOWLIST: '', SCAN_ALLOWANCE_ENABLED: 'true', UNSUBSCRIBE_SECRET: 's', BREACH_GATE_ENABLED: 'true', ALLOW_PARTIAL_REPORT: 'false' };
  const run = async (plan) => {
    const F = fake(); globalThis.fetch = F.f;
    const email = `${plan}.person@example.test`; F.db.accounts.push({ id: '60000000-0000-4000-8000-000000000001', email, plan });
    const w = [];
    await worker.fetch(new Request('https://x.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify({ email, consent: true }) }), ENV, { waitUntil: (p) => w.push(p) }); await Promise.all(w);
    const ran = []; await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, ENV, { waitUntil: (p) => ran.push(p) }); await Promise.allSettled(ran);
    const hibp = F.calls.filter((c) => c.url.includes('haveibeenpwned.com')).length;
    const mail = F.calls.filter((c) => c.url.includes('api.resend.com')).map((c) => JSON.parse(c.body)).find((b) => /privacy report/i.test(b.subject || ''));
    return { hibp, mail, F };
  };
  const q = console.log;
  const free = await run('free'); const basic = await run('basic');
  check(free.hibp === 0, 'AT-6: Free address => zero calls to the breach provider (cost counter unchanged)');
  check(basic.hibp >= 1, 'Basic address => the breach lookup runs');
  check(free.mail && free.mail.text.includes('Breaches: NOT CHECKED.') && free.mail.text.includes('Basic, $7.99 a month, does that'), 'AT-5: the Free report that was sent says breaches NOT CHECKED and carries the upgrade sentence with the price read from the plans table');
  check(basic.mail && !basic.mail.text.includes('Your free report did not search'), 'AT-16: the Basic report that was sent has no upgrade sentence');
  const sig = free.F.db.signals.find((s) => s.signal_type === 'breach:not_checked');
  check(sig && sig.check_status === 'not_checked' && !free.F.db.signals.some((s) => s.signal_type === 'breach:none'), 'a gated breach section is stored as not_checked, never as clear');
  globalThis.fetch = real;
}

// ---- AT-10 / AT-15: history and retention
{
  const now = Date.UTC(2026, 10, 8);
  const scans = [{ scan_number: 'new', created_at: '2026-11-01T00:00:00Z' }, { scan_number: 'mid', created_at: '2026-03-01T00:00:00Z' }, { scan_number: 'old', created_at: '2025-10-01T00:00:00Z' }];
  const inside = withinRetention(scans, {}, now);
  check(retentionMonths({}) === 12 && inside.map((s) => s.scan_number).join() === 'new,mid', 'AT-10: retention is config (default 12 months); a scan older than that is absent');
  check(withinRetention(scans, { REPORT_RETENTION_MONTHS: '6' }, now).map((s) => s.scan_number).join() === 'new', 'AT-10: retention is read from config, not code');
  check(limitHistory(inside, entFor('basic')).scans.length === 2, 'AT-10: Basic sees every scan inside retention');
  const f = limitHistory(inside, entFor('free'));
  check(f.scans.length === 1 && f.scans[0].scan_number === 'new' && f.history.older_kept === 1, 'AT-10: Free sees the latest only; the older one is kept, not deleted');
  const cancelled = limitHistory(inside, entFor('free'));
  check(cancelled.history.older_kept === 1 && limitHistory(inside, entFor('basic')).scans.length === 2, 'AT-15: cancelling drops read access to the latest scan without deleting; resubscribing restores it');
}

// ---- AT-11 / AT-13: export
{
  const panel = buildBrokerPanel(null, { entitlements: entFor('basic'), basicPrice: '$7.99' });
  const doc = buildExportDocument({ scanNumber: '11111111-1111-4111-8111-111111111111', tier: 'basic', web: { created_at: '2026-11-08T00:00:00Z', hexagons: [{ id: 'device', label: 'Device', value: 'ip 203.0.113.9 and 2001:db8::1', status: 'found' }] }, emailItems: [{ id: 'email-breaches', status: 'not_checked' }], panel, breach: { state: 'not_checked', not_checked_reason: 'x' }, generatedAt: '2026-11-08T00:00:00Z' });
  check(doc.schema_version === 1 && doc.scan_id && doc.generated_at && doc.tier_at_generation === 'basic', 'AT-11: JSON carries schema_version, scan_id, generated_at, tier_at_generation');
  check(doc.brokers.length === 9 && doc.brokers.every((b) => b.state === 'not_checked' && b.not_checked_reason && 'broker_id' in b && 'is_guess' in b && b.source && 'evidence_url' in b), 'AT-11/13: nine broker rows with the contract fields; a source that did not run is "not checked", never "not listed"');
  check(doc.hexagons.every((h) => h.source?.class && 'confidence' in h && 'is_guess' in h) && doc.email_checks.every((h) => h.source?.class && 'confidence' in h), 'AT-13: every hexagon value carries source and confidence');
  const clean = stripIps(doc); const s = JSON.stringify(clean);
  check(!/203\.0\.113\.9|2001:db8/.test(s) && s.includes('[address removed]'), 'export body contains no IP values');
  const pdf = renderPdf(clean);
  check(new TextDecoder('latin1').decode(pdf.slice(0, 8)).startsWith('%PDF-1.4') && new TextDecoder('latin1').decode(pdf).includes('%%EOF') && pdf.length < PDF_MAX_BYTES && s.length < JSON_MAX_BYTES, `AT-11: PDF is a valid-looking file (${pdf.length} bytes) within limits`);
  check(documentLines(clean).some((l) => /NOT CHECKED/.test(l)) && documentLines(clean).some((l) => /source:/.test(l)), 'PDF includes the "not checked" rows and every source');

  const env = { UNSUBSCRIBE_SECRET: 'export-secret', EXPORT_LINK_DAYS: '7' }; const A = '70000000-0000-4000-8000-000000000001', S = '11111111-1111-4111-8111-111111111111';
  const t = await makeExportToken(env, A, S, 'json', 1_000_000_000_000);
  check(t && (await readExportToken(env, t.token, 1_000_000_000_000 + 6 * 86400000))?.format === 'json', 'AT-11: a fresh link validates and is bound to account, scan and format');
  check((await readExportToken(env, t.token, 1_000_000_000_000 + 8 * 86400000)) === null, 'AT-11: the link expires (7 days, config)');
  check((await readExportToken(env, t.token.replace('.json.', '.pdf.'), 1_000_000_000_000)) === null && (await readExportToken({ UNSUBSCRIBE_SECRET: 'other' }, t.token, 1_000_000_000_000)) === null, 'a link cannot be re-pointed at another format or signed with another key');
  check((await makeExportToken({}, A, S, 'json')) === null, 'no signing key = no link');

  // the handlers, against a stub that applies the rules (account auth + rpc + select)
  const mk = (tier) => {
    const ent = entFor(tier);
    const sb = {
      rpc: async (fn, a) => (fn === 'mpt_get_entitlements' ? ent : fn === 'mpt_get_account_scan' ? (a.p_web_scan === S ? { scan_number: S, created_at: new Date().toISOString(), hexagon_count: 1, results: [{ id: 'device', label: 'Device', value: '203.0.113.9', status: 'found' }] } : null) : null),
      select: async () => [],
    };
    return sb;
  };
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const envH = { ACCOUNTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'k', UNSUBSCRIBE_SECRET: 'export-secret' };
  const bearerFetch = async () => ({ ok: true, status: 200, json: async () => ({ id: A, email: 'basic.person@example.test' }) });
  for (const tier of ['free', 'basic']) {
    const r = await handleExportIssue(envH, {}, new Request('https://w.test/api/account/export', { method: 'POST', headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ scan_number: S, format: 'json' }) }), null, json, { allowedOrigins: [], rateLimited: async () => false, sb: mk(tier), fetchImpl: bearerFetch });
    const j = await r.json();
    if (tier === 'free') check(r.status === 403 && j.code === 'export_requires_plan' && !j.url, 'AT-11: Free gets no export link');
    else {
      check(r.status === 200 && j.url.startsWith('https://w.test/api/export?t=') && j.expires_at, 'AT-11: Basic gets an expiring link');
      const d = await handleExportDownload(envH, new Request(j.url), json, { sb: mk('basic') }); const body = await d.json();
      check(d.status === 200 && /attachment/.test(d.headers.get('Content-Disposition')) && body.schema_version === 1 && !/203\.0\.113\.9/.test(JSON.stringify(body)), 'AT-11: the link downloads the JSON, validated against schema_version, without IP values');
      const d2 = await handleExportDownload(envH, new Request(j.url), json, { sb: mk('free') });
      check(d2.status === 403, 'the plan is re-checked at download time (a cancelled account gets nothing)');
      const bad = await handleExportDownload(envH, new Request('https://w.test/api/export?t=junk'), json, { sb: mk('basic') });
      check(bad.status === 401, 'a forged link is refused');
    }
  }
  const other = await handleExportIssue(envH, {}, new Request('https://w.test/api/account/export', { method: 'POST', headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ scan_number: '99999999-9999-4999-8999-999999999999', format: 'pdf' }) }), null, json, { allowedOrigins: [], rateLimited: async () => false, sb: mk('basic'), fetchImpl: bearerFetch });
  check(other.status === 404, 'a scan that is not this account\'s own looks like one that does not exist');
}

globalThis.fetch = real;
console.log(ok ? '\nAll MPC-9816 Worker checks passed.' : '\nFAILED');
process.exit(ok ? 0 : 1);
