#!/usr/bin/env node
// MPC-9813: automated LIVE check of the email click-to-confirm gate and the "show us your listing" check. No human, no manual inbox.
//
//   SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY UNSUBSCRIBE_SECRET node scripts/f1-live-check/run.mjs
//   optional: F1_SCAN_URL, WAIT_HOLD_MS, WAIT_RESULT_MS, WAIT_REPORT_MS, RUN_ID
//
// DESIGN. Production's POST /api/scan enforces Cloudflare Turnstile and is never bypassed. Like the nightly chain (docs/nightly-chain-mpc-7557.md) the scan goes to a SYNTHETIC
// deployment of the same Worker code that holds Cloudflare's public Turnstile TEST secret: mpt-scan-report-synthetic-f1, which also has the F1 switches ON. It writes to the
// production database; the real production cron then handles the report, through the real provider, to the test mailbox alias. Sent emails are read back from the provider
// (Resend), which is this repo's programmatic mailbox. The "click" is the real POST /api/scan/confirm with a token signed by the synthetic Worker's own test-only signing key.
// The listing page is a static, noindex, synthetic page on the site (public/test-fixtures/listing-synthetic.html). No real person's listing is fetched.
//
// WHAT THIS CAN NOT PROVE (stated in every run's summary): the real Turnstile widget in a real browser, delivery into a real inbox and how a mail client renders it.
// Exit code: 0 every step passed, 1 a step failed, 2 not configured (never reported as a pass).
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { isTestAddress } from '../../shared/test-records.js';
import { fixtureScan } from '../nightly-chain/checks.mjs';
import { makeLiveLink } from '../../workers/scan-report/lib/live.js';
import { buildConfirmationEmail } from '../../workers/scan-report/lib/email.js';
import { f1Body, checkConfirmationEmail, confirmLinkKind, linkHosts, checkStoredResult, checkReportBlock, FIXTURE_URL } from './checks.mjs';

const DEFAULT_SCAN_URL = 'https://mpt-scan-report-synthetic-f1.myprivacytool.workers.dev';
const ORIGIN = 'https://www.myprivacytool.io';
const scrub = (s) => String(s ?? '').replace(/[^\s"'<>]+@[^\s"'<>]+/g, '[email]').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}/gi, '[id]').replace(/[A-Za-z0-9_-]{20,}\.\d{10,15}\.[A-Za-z0-9_-]{20,}/g, '[token]').slice(0, 400);

class Supabase {
  constructor(env, f) { this.base = String(env.SUPABASE_URL).replace(/\/$/, ''); this.key = env.SUPABASE_SERVICE_ROLE_KEY; this.f = f; }
  h(extra = {}) { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }; }
  async select(path) { const r = await this.f(`${this.base}/rest/v1/${path}`, { headers: this.h() }); if (!r.ok) throw new Error(`database read HTTP ${r.status}`); return r.json(); }
  async rpc(fn, args) { const r = await this.f(`${this.base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: this.h(), body: JSON.stringify(args) }); if (!r.ok) throw new Error(`database call ${fn} HTTP ${r.status}`); return r.json(); }
}

async function waitFor(fn, { timeoutMs, everyMs, sleep }) {
  const tries = Math.max(1, Math.ceil(timeoutMs / everyMs));
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; if (i < tries - 1) await sleep(everyMs); }
  return null;
}

export const STEPS = ['db_ready', 'scan_request', 'stored_and_waiting', 'confirmation_email', 'held_before_click', 'forged_click_refused', 'click', 'listing_result', 'live_view', 'report_sent', 'report_block', 'delete_by_scan_number', 'cleanup'];

/** Runs the check. Returns { ok, failedStep, notConfigured, steps, unverified }. Never throws. */
export async function runCheck(env, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = new Date() } = {}) {
  const result = { ok: false, failedStep: null, notConfigured: null, steps: STEPS.map((step) => ({ step, ok: false, skipped: true, ms: 0, detail: '' })), unverified: [] };
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'UNSUBSCRIBE_SECRET'].filter((k) => !env[k]);
  if (missing.length) { result.notConfigured = `missing ${missing.join(', ')}`; return result; }
  const base = (env.F1_SCAN_URL || DEFAULT_SCAN_URL).replace(/\/$/, '');
  const sb = new Supabase(env, fetchImpl);
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const run = String(env.RUN_ID || Math.floor(now.getTime() / 1000)).replace(/[^a-z0-9]/gi, '').slice(0, 20);
  const email = `testingnt69+f1-${day}-${run}@gmail.com`;
  if (!isTestAddress(email)) { result.notConfigured = 'refusing to run: address is not a test address'; return result; }
  const ctx = { scanNumber: null, scanId: null, token: null };
  const resend = async (id) => {
    const r = await fetchImpl(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j && typeof j.html === 'string' && typeof j.text === 'string' ? j : null;
  };
  const post = (path, headers = {}, body) => fetchImpl(`${base}${path}`, { method: 'POST', headers: { Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });

  const steps = {
    async db_ready() {
      for (const path of ['scans?select=email_confirm_required,email_confirmed_at&limit=1', 'web_scan_listing_checks?select=web_scan_id,scan_id,results&limit=1']) {
        const r = await fetchImpl(`${sb.base}/rest/v1/${path}`, { headers: sb.h() });
        if (r.status === 404 || r.status === 400) throw new Error(`the production database lacks ${path.split('?')[0]} (migration 20261107140000 not applied)`);
        if (!r.ok) throw new Error(`database answered ${r.status} for ${path.split('?')[0]}`);
      }
      return 'confirm-gate columns and web_scan_listing_checks present';
    },
    async scan_request() {
      const res = await post('/api/scan', {}, f1Body(email, fixtureScan()));
      const out = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('F1 synthetic Worker not deployed (HTTP 404)');
      if (!res.ok) throw new Error(`POST /api/scan HTTP ${res.status}${out.error ? ': ' + out.error : ''}`);
      if (out.duplicate) throw new Error('answered "duplicate" for a fresh alias');
      if (!out.success || !out.scan_saved || !out.scan_number) throw new Error('answer lacks success / scan_saved / scan_number');
      if (out.confirm_required !== true) throw new Error('answer does not say confirm_required: the gate flag is off on the F1 Worker');
      if (out.listing_saved !== true) throw new Error('answer does not say listing_saved: the listing flag is off or the details were not stored');
      ctx.scanNumber = out.scan_number;
      return 'accepted; scan saved; confirm_required and listing_saved both true';
    },
    async stored_and_waiting() {
      const link = (await sb.select(`web_scan_contacts?web_scan_id=eq.${ctx.scanNumber}&channel=eq.email&select=contact_id`))[0];
      if (!link) throw new Error('saved scan is not linked to a contact');
      ctx.scanId = link.contact_id;
      const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=email_confirm_required,email_confirmed_at,report_status,report_attempts,users(email)`))[0];
      if (!s) throw new Error('no scans row');
      if (!isTestAddress(s.users?.email)) throw new Error('the request is attached to a non-test address; stopping');
      if (s.email_confirm_required !== true) throw new Error('scans.email_confirm_required is not true');
      if (s.email_confirmed_at) throw new Error('scan is already confirmed before any click');
      const l = (await sb.select(`web_scan_listing_checks?scan_id=eq.${ctx.scanId}&select=web_scan_id,listing_urls,results,full_name`))[0];
      if (!l) throw new Error('typed details were not stored');
      if (l.web_scan_id !== ctx.scanNumber) throw new Error('details are not stored against the saved scan (scan number)');
      if (JSON.stringify(l.listing_urls) !== JSON.stringify([FIXTURE_URL])) throw new Error('stored pasted address differs from what was sent');
      if (l.results != null) throw new Error('a listing result exists before the click');
      return 'marked as waiting; details stored against the scan number; no result yet';
    },
    async confirmation_email() {
      const sent = await waitFor(async () => (await sb.select(`scans?id=eq.${ctx.scanId}&select=confirmation_sent_at`))[0]?.confirmation_sent_at, { timeoutMs: Number(env.WAIT_CONFIRM_MS ?? 180000), everyMs: 10000, sleep });
      if (!sent) throw new Error('no confirmation_sent_at: the provider did not accept the first email');
      // Read the sent email back from the provider: list the most recent sends to this alias and take the click-to-confirm one.
      const lr = await fetchImpl('https://api.resend.com/emails?limit=50', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
      const list = lr.ok ? (await lr.json().catch(() => ({}))).data : null;
      const hit = Array.isArray(list) ? list.find((m) => JSON.stringify(m.to || '').toLowerCase().includes(email.toLowerCase()) && /Confirm your email/i.test(m.subject || '')) : null;
      const full = hit ? await resend(hit.id) : null;
      if (!full) { result.unverified.push('confirmation email content (provider list/retrieve unavailable; accepted by the provider, content covered by unit tests only)'); return 'provider accepted the confirmation email; content NOT read back'; }
      const problems = checkConfirmationEmail({ subject: hit.subject, text: full.text, html: full.html });
      if (problems.length) throw new Error(problems.join('; '));
      // The Worker's OWN output, built in-process with the same key and scan: the confirm link it writes is the signed /scan/live#v=<scan>.<expiry>.<signature> link.
      const own = buildConfirmationEmail({ liveLink: await makeLiveLink({ UNSUBSCRIBE_SECRET: env.UNSUBSCRIBE_SECRET }, ctx.scanId), confirmGate: true }).text;
      if (!own.includes(`scan/live#v=${ctx.scanId}.`) || !/We only check details you.ve confirmed are yours/.test(own)) throw new Error('the Worker code does not write the signed confirm link and the honest sentence');
      if (confirmLinkKind(full.text) === 'rewritten') {
        result.unverified.push(`the confirm link in the sent email's plain text is rewritten by the provider (links point at: ${linkHosts(full.text).join(', ')}); the signed link itself is verified from the Worker code and by the real confirm call in step click, not by reading the mail`);
        return 'provider accepted it; read back: click-to-confirm subject, honest sentence, confirm button; link in the text rewritten by the provider (link verified by Worker assertions + the click step)';
      }
      return 'provider accepted it; read back: click-to-confirm subject, honest sentence, confirm button and link';
    },
    async held_before_click() {
      await sleep(Number(env.WAIT_HOLD_MS ?? 6.5 * 60000));   // at least one tick of the production cron (every 5 minutes)
      const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=report_status,report_attempts,report_sent_at,email_confirmed_at,resend_message_id`))[0];
      if (s.report_status !== 'pending' || s.report_sent_at || s.resend_message_id) throw new Error(`the report moved before the click (status ${s.report_status})`);
      if (s.report_attempts !== 0) throw new Error(`the report job claimed the scan before the click (${s.report_attempts} attempt(s))`);
      const l = (await sb.select(`web_scan_listing_checks?scan_id=eq.${ctx.scanId}&select=results`))[0];
      if (l.results != null) throw new Error('the listing page was read before the click');
      return `after ${Number(env.WAIT_HOLD_MS ?? 6.5 * 60000) / 60000} min (at least one production cron tick): still pending, 0 attempts, no report, page not read`;
    },
    async forged_click_refused() {
      const none = await post('/api/scan/confirm');
      const forged = await post('/api/scan/confirm', { Authorization: 'Bearer forged.1.sig' });
      if (none.status !== 401 || forged.status !== 401) throw new Error(`expected 401/401, got ${none.status}/${forged.status}`);
      const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=email_confirmed_at`))[0];
      if (s.email_confirmed_at) throw new Error('a forged click confirmed the scan');
      return 'no key and a forged key both answered 401; scan still unconfirmed';
    },
    async click() {
      ctx.token = (await makeLiveLink({ UNSUBSCRIBE_SECRET: env.UNSUBSCRIBE_SECRET }, ctx.scanId)).split('#v=')[1];
      const res = await post('/api/scan/confirm', { Authorization: `Bearer ${ctx.token}` });
      const out = await res.json().catch(() => ({}));
      if (res.status !== 200 || out.confirmed !== true) throw new Error(`POST /api/scan/confirm HTTP ${res.status}`);
      const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=email_confirmed_at`))[0];
      if (!s.email_confirmed_at) throw new Error('email_confirmed_at not set after the click');
      return 'confirm answered 200; email_confirmed_at set';
    },
    async listing_result() {
      const row = await waitFor(async () => { const l = (await sb.select(`web_scan_listing_checks?scan_id=eq.${ctx.scanId}&select=results`))[0]; return Array.isArray(l?.results) ? l : null; }, { timeoutMs: Number(env.WAIT_RESULT_MS ?? 120000), everyMs: 5000, sleep });
      if (!row) throw new Error('no stored result after the click: the page was not checked');
      const problems = checkStoredResult(row.results);
      if (problems.length) throw new Error(problems.join('; '));
      return 'fixture page read once after the click: listed / exact / high / not a guess; evidence_url is the page; source = free / user_supplied_page; no page text stored';
    },
    async live_view() {
      const res = await fetchImpl(`${base}/api/scan/live`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${ctx.token}` } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`GET /api/scan/live HTTP ${res.status}`);
      if (out.confirmed !== true || out.confirm_required !== true) throw new Error('live view does not report confirm_required + confirmed');
      const item = out.listings?.items?.[0];
      if (!item || item.state !== 'listed' || item.evidence_url !== FIXTURE_URL) throw new Error('live view lacks the Listed result with the evidence link');
      const anon = await fetchImpl(`${base}/api/scan/live`, { headers: { Origin: ORIGIN } });
      if (anon.status !== 401) throw new Error(`live view without a key answered ${anon.status}, expected 401`);
      return 'email-link view returns the Listed result + evidence link; no key = 401';
    },
    async report_sent() {
      const row = await waitFor(async () => {
        const s = (await sb.select(`scans?id=eq.${ctx.scanId}&select=report_status,resend_message_id,report_last_error,report_attempts`))[0];
        if (s?.report_status === 'failed') throw new Error(`report failed after ${s.report_attempts} attempt(s): ${scrub(s.report_last_error)}`);
        return s?.report_status === 'sent' && s.resend_message_id ? s : null;
      }, { timeoutMs: Number(env.WAIT_REPORT_MS ?? 15 * 60000), everyMs: 20000, sleep });
      if (!row) throw new Error('report still not sent after the wait (the production cron runs every 5 minutes)');
      ctx.messageId = row.resend_message_id;
      return 'production cron sent the report after the click';
    },
    async report_block() {
      const full = await resend(ctx.messageId);
      if (!full) throw new Error('could not read the sent report back from the provider');
      const problems = checkReportBlock({ text: full.text, html: full.html });
      if (problems.length) throw new Error(problems.join('; '));
      return 'report read back from the provider: the broker block with the Listed state and the evidence link';
    },
    async delete_by_scan_number() {
      const r = await sb.rpc('mpt_delete_web_scan', { p_scan_number: ctx.scanNumber });
      if (!r?.found) throw new Error('mpt_delete_web_scan found nothing');
      const left = await sb.select(`web_scan_listing_checks?scan_id=eq.${ctx.scanId}&select=id`);
      if (left.length) throw new Error('the typed details and result are still present after deletion by scan number');
      return 'deleted by scan number; the typed details and results went with it';
    },
    async cleanup() {
      if (!isTestAddress(email)) throw new Error('refusing to clean up a non-test address');
      await sb.rpc('mpt_dsar_erase', { p_email: email });
      const users = await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id`);
      if (users.length) throw new Error('test record still present after cleanup');
      return 'test user and scans removed';
    },
  };

  for (const entry of result.steps) {
    if (result.failedStep) continue;
    const t0 = Date.now();
    try { entry.detail = await steps[entry.step](); entry.ok = true; entry.skipped = false; }
    catch (e) { entry.ok = false; entry.skipped = false; entry.detail = scrub(e.message); result.failedStep = entry.step; }
    entry.ms = Date.now() - t0;
  }
  // A half-made test record must never stay behind.
  if (result.failedStep && result.failedStep !== 'cleanup' && ctx.scanId) {
    try { if (isTestAddress(email)) await sb.rpc('mpt_dsar_erase', { p_email: email }); } catch { /* reported by the failed step */ }
  }
  result.ok = !result.failedStep;
  return result;
}

export function summary(r) {
  const lines = ['# F1 live check (MPC-9813)', ''];
  if (r.notConfigured) lines.push(`NOT CONFIGURED: ${r.notConfigured}`);
  for (const s of r.steps) lines.push(`- ${s.skipped ? 'SKIPPED' : s.ok ? 'PASS' : 'FAIL'} ${s.step}${s.detail ? `: ${s.detail}` : ''}`);
  lines.push('', `Result: ${r.notConfigured ? 'NOT CONFIGURED' : r.ok ? 'PASS' : `FAIL at ${r.failedStep}`}`);
  if (r.unverified.length) lines.push('', 'Not verified in this run:', ...r.unverified.map((u) => `- ${u}`));
  lines.push('', 'Never provable by this check: the real Turnstile widget in a real browser; delivery into a real inbox; how a mail client renders the emails.');
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await runCheck(process.env);
  const text = summary(r);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exit(r.notConfigured ? 2 : r.ok ? 0 : 1);
}
