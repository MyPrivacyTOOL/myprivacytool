#!/usr/bin/env node
// MPC-7557: nightly (and weekly) end-to-end test of the scan -> saved scan -> contact -> report request -> first email -> report chain.
//
//   MODE=nightly|weekly  SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY  node scripts/nightly-chain/run.mjs
//   optional: SYNTHETIC_SCAN_URL, PROD_SCAN_URL, RESEND_API_KEY (read the sent report back), UNSUBSCRIBE_SECRET (weekly unsubscribe), WAIT_REPORT_MS, DRY_RUN=1
//
// DESIGN (docs/nightly-chain-mpc-7557.md): production's POST /api/scan enforces Cloudflare Turnstile and must never be bypassed. So the scan request goes to a
// SEPARATE deployment of the same Worker code (mpt-scan-report-synthetic) that holds Cloudflare's public TEST secret, has no cron, and may email only the test
// mailbox. It writes to the SAME production database; the real production cron then picks the scan up and sends the real report through the real provider.
// Only the Turnstile widget is substituted; every other link of the chain is the production one.
//
// Writes one counts-only row to mpt_raw_metrics (source nightly_chain), which the existing daily collector turns into the usual Slack alert, naming the step.
// Exit code: 0 all steps passed, 1 a step failed, 2 not configured (a distinct state: never reported as a pass).
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { testAddress, isTestAddress } from '../../shared/test-records.js';
import { fixtureScan, scanRequestBody, checkReport, linksToResolve, resolveLinks, STEPS, WEEKLY_STEPS } from './checks.mjs';
import { buildReportEmail } from '../../workers/scan-report/lib/email.js';
import { unsubscribeToken } from '../../workers/scan-report/lib/onboarding.js';

export const DEFAULTS = {
  SYNTHETIC_SCAN_URL: 'https://mpt-scan-report-synthetic.myprivacytool.workers.dev',
  PROD_SCAN_URL: 'https://mpt-scan-report.myprivacytool.workers.dev',
};
const ORIGIN = 'https://www.myprivacytool.io';
const scrub = (s) => String(s ?? '').replace(/[^\s"'<>]+@[^\s"'<>]+/g, '[email]').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}/gi, '[id]').slice(0, 300);
export const hkDay = (d = new Date()) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');

class Supabase {
  constructor(env, fetchImpl) { this.base = String(env.SUPABASE_URL).replace(/\/$/, ''); this.key = env.SUPABASE_SERVICE_ROLE_KEY; this.f = fetchImpl; }
  h(extra = {}) { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }; }
  async select(path) { const r = await this.f(`${this.base}/rest/v1/${path}`, { headers: this.h() }); if (!r.ok) throw new Error(`database read HTTP ${r.status}`); return r.json(); }
  async rpc(fn, args) { const r = await this.f(`${this.base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: this.h(), body: JSON.stringify(args) }); if (!r.ok) throw new Error(`database call ${fn} HTTP ${r.status}`); return r.json(); }
  async insert(table, row) { const r = await this.f(`${this.base}/rest/v1/${table}`, { method: 'POST', headers: this.h({ Prefer: 'return=minimal' }), body: JSON.stringify(row) }); if (!r.ok) throw new Error(`database write ${table} HTTP ${r.status}`); }
  async remove(path) { const r = await this.f(`${this.base}/rest/v1/${path}`, { method: 'DELETE', headers: this.h({ Prefer: 'return=minimal' }) }); if (!r.ok) throw new Error(`database delete HTTP ${r.status}`); }
}

// Polls a fixed number of times (timeout / interval) rather than reading the clock, so a test with an injected sleep terminates and a real run takes the same time.
async function waitFor(fn, { timeoutMs, everyMs, sleep }) {
  const tries = Math.max(1, Math.ceil(timeoutMs / everyMs));
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    if (i < tries - 1) await sleep(everyMs);
  }
  return null;
}

/** Runs the chain. Returns { ok, failedStep, notConfigured, steps:[{step,ok,skipped,ms,detail}], facts }. Never throws. Pure apart from the injected fetch / sleep. */
export async function runChain(env, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = new Date() } = {}) {
  const mode = env.MODE === 'weekly' ? 'weekly' : 'nightly';
  const order = mode === 'weekly' ? WEEKLY_STEPS : STEPS;
  const result = { mode, day: hkDay(now), ok: false, failedStep: null, notConfigured: null, steps: order.map((step) => ({ step, ok: false, skipped: true, ms: 0, detail: '' })), facts: {} };
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (mode === 'weekly' && !env.UNSUBSCRIBE_SECRET) missing.push('UNSUBSCRIBE_SECRET');
  if (missing.length) { result.notConfigured = `missing ${missing.join(', ')}`; return result; }
  const synth = (env.SYNTHETIC_SCAN_URL || DEFAULTS.SYNTHETIC_SCAN_URL).replace(/\/$/, '');
  const prod = (env.PROD_SCAN_URL || DEFAULTS.PROD_SCAN_URL).replace(/\/$/, '');
  const sb = new Supabase(env, fetchImpl);
  const email = testAddress(mode, /^\d{1,9}$/.test(env.MANUAL_RUN_NUMBER ?? '') ? `${result.day}m${env.MANUAL_RUN_NUMBER}` : result.day);
  if (!isTestAddress(email)) { result.notConfigured = 'refusing to run: address is not a test address'; return result; }   // belt and braces: nothing below may ever touch a real person
  const fixture = fixtureScan();
  const ctx = { email, scanNumber: null, scanId: null };

  const steps = {
    // ---- nightly
    async scan_request() {
      const res = await fetchImpl(`${synth}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(scanRequestBody(email, fixture)) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('synthetic Worker not deployed (HTTP 404)');
      if (!res.ok) throw new Error(`POST /api/scan HTTP ${res.status}${out.error ? ': ' + out.error : ''}`);
      if (out.duplicate) throw new Error('scan answered "duplicate": a request for today\'s test address already exists (rerun tomorrow, or run it manually, which uses its own alias)');
      if (!out.success || !out.scan_saved || !out.scan_number) throw new Error('answer lacks success / scan_saved / scan_number');
      ctx.scanNumber = out.scan_number;
      return 'accepted, scan saved, scan number returned';
    },
    async saved_scan() {
      const row = (await sb.select(`web_scans?id=eq.${ctx.scanNumber}&select=id,hexagon_count,results_bytes`))[0];
      if (!row) throw new Error('no web_scans row for the returned scan number');
      if (row.hexagon_count !== fixture.length) throw new Error(`saved ${row.hexagon_count} hexagons, sent ${fixture.length}`);
      return `saved, ${row.hexagon_count} hexagons`;
    },
    async linked_contact_consent() {
      const link = (await sb.select(`web_scan_contacts?web_scan_id=eq.${ctx.scanNumber}&channel=eq.email&select=contact_id,save_consent_at,save_consent_version`))[0];
      if (!link) throw new Error('saved scan is not linked to a contact');
      if (!link.save_consent_at || !link.save_consent_version) throw new Error('link has no consent record (save_consent_at / save_consent_version)');
      ctx.scanId = link.contact_id;
      return 'linked, consent record present';
    },
    async report_request() {
      const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=id,report_status,source,users(email)`))[0];
      if (!s) throw new Error('no scans row for the linked contact');
      if (!isTestAddress(s.users?.email)) throw new Error('the request is attached to a non-test address; stopping');
      if (s.source !== 'web_scan') throw new Error(`request source is ${s.source}`);
      return `request exists, status ${s.report_status}`;
    },
    async first_email_accepted() {
      const row = await waitFor(async () => (await sb.select(`scans?id=eq.${ctx.scanId}&select=confirmation_sent_at`))[0]?.confirmation_sent_at, { timeoutMs: Number(env.WAIT_CONFIRM_MS ?? 180000), everyMs: 10000, sleep });
      if (!row) throw new Error('no confirmation_sent_at after the wait: the provider did not accept the first email');
      return 'provider accepted the first email';
    },
    async report_sent() {
      const row = await waitFor(async () => {
        const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=report_status,report_sent_at,resend_message_id,report_last_error,report_attempts`))[0];
        if (s?.report_status === 'failed') throw new Error(`report failed after ${s.report_attempts} attempt(s): ${scrub(s.report_last_error)}`);
        return s?.report_status === 'sent' && s.resend_message_id ? s : null;
      }, { timeoutMs: Number(env.WAIT_REPORT_MS ?? 15 * 60000), everyMs: 20000, sleep });
      if (!row) throw new Error('report still not sent after the wait (the production cron runs every 5 minutes)');
      ctx.messageId = row.resend_message_id;
      return 'report sent, provider id recorded';
    },
    async report_checks() {
      // The sent bytes: Resend "retrieve email" gives html + text. NOT verified live that it also returns attachments, so the JSON attachment is rebuilt from the saved scan
      // with the Worker's own builder and compared to the sent HTML (status counts must agree).
      let html, text, source = 'rebuilt';
      if (env.RESEND_API_KEY) {
        const r = await fetchImpl(`https://api.resend.com/emails/${ctx.messageId}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
        if (r.ok) { const j = await r.json().catch(() => ({})); if (typeof j.html === 'string' && typeof j.text === 'string') { html = j.html; text = j.text; source = 'provider'; } }
      }
      const saved = (await sb.select(`web_scans?id=eq.${ctx.scanNumber}&select=id,created_at,results`))[0];
      const built = buildReportEmail({ scan: { id: ctx.scanId, score: null, risk_level: null, partial: true, categories_checked: [] }, breaches: [], breachStatus: 'not_checked', brokers: [], webScan: { id: saved.id, created_at: saved.created_at, hexagons: saved.results }, emailChecks: [] });
      if (!html) { html = built.html; text = built.text; }
      const problems = checkReport({ html, text, json: JSON.parse(JSON.stringify(built.report)) }, { scanNumber: ctx.scanNumber, fixture });
      if (source === 'provider') {
        const found = (s) => (s.match(/>\s*FOUND\s*</g) || []).length + (s.match(/FOUND\s*·\s*ESTIMATE/g) || []).length;
        const [sentN, builtN] = [found(html), found(built.html)];
        // The sent report also carries the email-breach part, which the rebuilt copy (no breach data) cannot reproduce, so it may legitimately show MORE FOUND tags. Every web hexagon is already checked by id and value in checkReport; fewer than rebuilt means something the scan found went missing.
        if (sentN < builtN) problems.push(`sent report shows fewer FOUND hexagons than the rebuilt one (sent ${sentN}, rebuilt ${builtN}; fixture ${fixture.filter((f) => f.status === 'found').length})`);
      }
      result.facts.report_source = source; result.facts.html_bytes = new TextEncoder().encode(html).length; ctx.html = html;
      if (problems.length) throw new Error(problems.slice(0, 5).join('; '));
      return `checked (${source} copy): two parts, statuses, scan number, JSON, ${result.facts.html_bytes} bytes`;
    },
    async links_resolve() {
      const urls = linksToResolve(ctx.html);
      const bad = await resolveLinks(urls, fetchImpl);
      result.facts.links_checked = urls.length;
      if (bad.length) throw new Error(`${bad.length} of ${urls.length} links do not resolve: ${bad.slice(0, 3).join('; ')}`);
      return `${urls.length} links resolve`;
    },
    // ---- weekly: unsubscribe, deletion by scan number, cleanup (test alias only)
    async unsubscribe() {
      const first = await steps.scan_request();   // the weekly alias needs a scan to unsubscribe from and delete
      await steps.saved_scan(); await steps.linked_contact_consent();
      const t = await unsubscribeToken(env.UNSUBSCRIBE_SECRET, email);
      // MPC-8748: signed against the SYNTHETIC Worker, whose UNSUBSCRIBE_SECRET is the GitHub secret SCAN_REPORT_UNSUBSCRIBE_SECRET (a test-only value; the deploy workflow
      // copies it to the synthetic Worker only). Production's own secret is never needed or touched. Same handler code, same shared database, test alias only.
      const res = await fetchImpl(`${synth}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${t}`, { method: 'POST', headers: { Accept: 'application/json', Origin: ORIGIN } });
      if (!res.ok) throw new Error(`POST /api/unsubscribe HTTP ${res.status}`);
      return `${first}; unsubscribe answered ${res.status}`;
    },
    async suppression_recorded() {
      const hash = [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const u = (await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=email_opt_out_at`))[0];
      const s = await sb.select(`email_suppressions?email_hash=eq.${hash}&select=email_hash`);
      if (!u?.email_opt_out_at) throw new Error('users.email_opt_out_at not set');
      if (!s.length) throw new Error('no email_suppressions row');
      ctx.hash = hash;
      return 'opt-out and suppression recorded';
    },
    async delete_by_scan_number() {
      const r = await sb.rpc('mpt_delete_web_scan', { p_scan_number: ctx.scanNumber });
      if (!r?.found) throw new Error('mpt_delete_web_scan found nothing');
      const left = await sb.select(`web_scans?id=eq.${ctx.scanNumber}&select=id`);
      if (left.length) throw new Error('saved scan still present after deletion');
      return 'saved scan deleted by scan number';
    },
    async cleanup() {
      if (!isTestAddress(email)) throw new Error('refusing to clean up a non-test address');
      await sb.rpc('mpt_dsar_erase', { p_email: email });
      // Nightly aliases from the last 3 to 10 days are erased too (the nightly run never deletes its own record, so the weekly run keeps the table tidy). Test addresses only.
      for (let back = 3; back <= 10; back++) {
        const old = testAddress('nightly', hkDay(new Date(now.getTime() - back * 86400000)));
        if (isTestAddress(old)) await sb.rpc('mpt_dsar_erase', { p_email: old });
      }
      await sb.remove(`email_suppressions?email_hash=eq.${ctx.hash}`);
      const users = await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id`);
      const sup = await sb.select(`email_suppressions?email_hash=eq.${ctx.hash}&select=email_hash`);
      if (users.length || sup.length) throw new Error('test record still present after cleanup');
      return 'test record, scans and suppression removed';
    },
  };

  let stop = false;
  for (const entry of result.steps) {
    if (stop) continue;
    const t0 = Date.now();
    try { entry.detail = await steps[entry.step](); entry.ok = true; entry.skipped = false; }
    catch (e) { entry.ok = false; entry.skipped = false; entry.detail = scrub(e.message); result.failedStep = entry.step; stop = true; }
    entry.ms = Date.now() - t0;
  }
  // The weekly cleanup must run even when an earlier weekly step failed, or a half-made test record would stay behind.
  if (mode === 'weekly' && result.failedStep && result.failedStep !== 'cleanup' && ctx.scanNumber) {
    const entry = result.steps.find((s) => s.step === 'cleanup'); const t0 = Date.now();
    try { entry.detail = await steps.cleanup(); entry.ok = true; entry.skipped = false; }
    catch (e) { entry.detail = scrub(e.message); entry.skipped = false; }
    entry.ms = Date.now() - t0;
  }
  result.ok = !result.failedStep;
  return result;
}

/** The counts-only row for mpt_raw_metrics. The table rejects any payload containing an email address, so nothing identifying goes in. */
export function metricsRow(r, now = new Date()) {
  const failed = r.steps.find((s) => !s.ok && !s.skipped);
  return {
    source: 'nightly_chain', report: r.mode === 'weekly' ? 'weekly' : 'nightly', captured_at: now.toISOString(),
    payload: { mode: r.mode, day: r.day, ok: r.ok, not_configured: r.notConfigured || null, failed_step: r.failedStep, steps_passed: r.steps.filter((s) => s.ok).length, steps_total: r.steps.length, steps: r.steps.map((s) => ({ step: s.step, ok: s.ok, skipped: s.skipped, ms: s.ms })), ...r.facts },
    collector_version: 'nightly-chain-1', status: r.ok ? 'ok' : 'error', error: r.ok ? null : scrub(r.notConfigured ? `not configured: ${r.notConfigured}` : `step ${r.failedStep} failed: ${failed?.detail || ''}`),
  };
}

export async function main(env = process.env, fetchImpl = fetch) {
  const r = await runChain(env, { fetchImpl });
  for (const s of r.steps) console.log(`${s.skipped ? 'SKIP' : s.ok ? 'PASS' : 'FAIL'} ${s.step}${s.detail ? ' - ' + s.detail : ''}`);
  if (r.notConfigured) console.log(`NOT CONFIGURED: ${r.notConfigured}`);
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.DRY_RUN !== '1') {
    try { await new Supabase(env, fetchImpl).insert('mpt_raw_metrics', metricsRow(r)); console.log('result row written to mpt_raw_metrics'); }
    catch (e) { console.log(`WARNING: result row NOT written (${scrub(e.message)}); the missed-run alert will fire`); }
  }
  return r.notConfigured ? 2 : r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
