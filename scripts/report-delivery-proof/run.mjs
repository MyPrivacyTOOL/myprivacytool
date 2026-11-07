#!/usr/bin/env node
// MPC-9833: timed end-to-end proof of what a visitor receives and when, on the DEPLOYED system, with a synthetic identity (testingnt69+proof-* alias) only.
//
//   SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY UNSUBSCRIBE_SECRET node scripts/report-delivery-proof/run.mjs
//   optional: PROOF_SCAN_URL, CLICK_DELAY_MS (default 60000: a human is not instant), WAIT_REPORT_MS, RUN_ID
//
// Reuses the MPC-9813 pattern: the scan goes to the F1 synthetic Worker (Cloudflare public Turnstile TEST secret, confirm gate ON like production, no cron, no HubSpot,
// test-mailbox allowlist), the production cron sends the report, the "click" is POST /api/scan/confirm with a token signed by the synthetic Worker's throwaway key.
// All times are SERVER timestamps read from the database (scans.created_at / confirmation_sent_at / email_confirmed_at / report_sent_at / delivery_status_at), not runner clocks.
// LIMIT: no real inbox is read. "Provider accepted" and the provider's `delivered` webhook are the receipt evidence; inbox placement and rendering are not provable here.
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { isTestAddress } from '../../shared/test-records.js';
import { fixtureScan } from '../nightly-chain/checks.mjs';
import { makeLiveLink } from '../../workers/scan-report/lib/live.js';

const BASE_DEFAULT = 'https://mpt-scan-report-synthetic-f1.myprivacytool.workers.dev';
const ORIGIN = 'https://www.myprivacytool.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 100) / 10 : null);
const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /minute|hour|within|arrive|ready|month|delete|keep|kept|click|confirm/i.test(s)).slice(0, 25);

export async function run(env, fetchImpl = fetch) {
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'UNSUBSCRIBE_SECRET'].filter((k) => !env[k]);
  if (need.length) return { notConfigured: `missing ${need.join(', ')}` };
  const base = (env.PROOF_SCAN_URL || BASE_DEFAULT).replace(/\/$/, '');
  const sbBase = String(env.SUPABASE_URL).replace(/\/$/, '');
  const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const sel = async (p) => { const r = await fetchImpl(`${sbBase}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`db read ${r.status} ${p.split('?')[0]}`); return r.json(); };
  const rpc = async (fn, a) => { const r = await fetchImpl(`${sbBase}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(a) }); if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`); return r.json(); };
  const now = new Date();
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const email = `testingnt69+proof-${day}-${String(env.RUN_ID || Math.floor(now / 1000)).replace(/[^a-z0-9]/gi, '').slice(0, 20)}@gmail.com`;
  if (!isTestAddress(email)) return { notConfigured: 'not a test address' };
  const out = { hkt_start: new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', ' HKT'), steps: {} };
  const resendFind = async (re) => {
    const lr = await fetchImpl('https://api.resend.com/emails?limit=50', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    const hit = lr.ok ? ((await lr.json().catch(() => ({}))).data || []).find((m) => JSON.stringify(m.to || '').toLowerCase().includes(email.toLowerCase()) && re.test(m.subject || '')) : null;
    if (!hit) return null;
    const r = await fetchImpl(`https://api.resend.com/emails/${hit.id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    return r.ok ? { subject: hit.subject, ...(await r.json()) } : null;
  };
  let scanId = null, scanNumber = null;
  try {
    const body = { email, consent: true, consent_source: 'synthetic_proof', scan: fixtureScan(), save_consent: true, save_consent_version: '2026-10-12-v1', started_ms: 1000, utm_source: 'synthetic', utm_medium: 'delivery-proof', utm_campaign: 'mpc-9833', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' };
    const res = await fetchImpl(`${base}/api/scan`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success || !j.scan_number) throw new Error(`POST /api/scan HTTP ${res.status}`);
    scanNumber = j.scan_number; out.confirm_required = j.confirm_required === true;
    scanId = (await sel(`web_scan_contacts?web_scan_id=eq.${scanNumber}&channel=eq.email&select=contact_id`))[0]?.contact_id;
    if (!scanId) throw new Error('scan not linked');
    const row = async () => (await sel(`scans?id=eq.${scanId}&select=created_at,confirmation_sent_at,email_confirmed_at,report_status,report_sent_at,delivery_status,delivery_status_at,resend_message_id,report_attempts,users(email)`))[0];
    if (!isTestAddress((await row()).users?.email)) throw new Error('attached to a non-test address; stopping');
    for (let i = 0; i < 18 && !(await row()).confirmation_sent_at; i++) await sleep(5000);
    const confMail = await resendFind(/confirm/i);
    out.confirmation_email = confMail ? { subject: confMail.subject, promise_sentences: sentences(confMail.text) } : 'NOT READ BACK from provider';
    await sleep(Number(env.CLICK_DELAY_MS ?? 60000));
    const token = (await makeLiveLink({ UNSUBSCRIBE_SECRET: env.UNSUBSCRIBE_SECRET }, scanId)).split('#v=')[1];
    const cr = await fetchImpl(`${base}/api/scan/confirm`, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } });
    if (cr.status !== 200) throw new Error(`confirm HTTP ${cr.status}`);
    const deadline = Date.now() + Number(env.WAIT_REPORT_MS ?? 20 * 60000);
    let r = await row();
    while (!(r.report_status === 'sent' && r.report_sent_at) && Date.now() < deadline) { if (r.report_status === 'failed') break; await sleep(10000); r = await row(); }
    if (r.report_status !== 'sent') throw new Error(`report not sent (status ${r.report_status})`);
    await sleep(8000); r = await row();
    const hkt = (t) => (t ? new Date(new Date(t).getTime() + 8 * 3600000).toISOString().slice(11, 19) + ' HKT' : null);
    out.times = { submit: hkt(r.created_at), confirmation_sent: hkt(r.confirmation_sent_at), clicked: hkt(r.email_confirmed_at), report_sent: hkt(r.report_sent_at), report_delivered_event: hkt(r.delivery_status_at) };
    out.seconds = { submit_to_confirmation_email: secs(r.created_at, r.confirmation_sent_at), click_to_report_sent: secs(r.email_confirmed_at, r.report_sent_at), submit_to_report_sent: secs(r.created_at, r.report_sent_at), report_sent_to_delivered_event: secs(r.report_sent_at, r.delivery_status_at) };
    out.delivery_status = r.delivery_status; out.report_attempts = r.report_attempts;
    const rep = await resendFind(/report|privacy/i);
    const text = rep?.text || '';
    out.report = rep ? {
      subject: rep.subject, html_bytes: (rep.html || '').length, promise_sentences: sentences(text),
      has_part1_web_scan: /Part 1/i.test(text), has_part2_email: /Part 2/i.test(text),
      has_listings_block: /Listings you showed us/i.test(text), score_line: (text.match(/.{0,40}\b(score|0-100)\b.{0,60}/i) || [''])[0].replace(/\s+/g, ' '),
      found_clear_notchecked: { FOUND: (text.match(/\bFOUND\b/g) || []).length, CLEAR: (text.match(/CHECKED AND CLEAR/gi) || []).length, NOT_CHECKED: (text.match(/NOT CHECKED/gi) || []).length },
      retention_sentences: sentences(text).filter((s) => /month|delete|kept|keep/i.test(s)),
    } : 'NOT READ BACK from provider';
    const ws = (await sel(`web_scans?id=eq.${scanNumber}&select=*`))[0] || {};
    out.retention = { web_scan_columns_with_time: Object.fromEntries(Object.entries(ws).filter(([k]) => /expire|created|retain/i.test(k))), policy: (await sel('web_scan_retention?select=months,unlinked_days'))[0] };
    const del = await rpc('mpt_delete_web_scan', { p_scan_number: scanNumber });
    out.delete_by_scan_number = { found: del?.found === true, still_present: (await sel(`web_scans?id=eq.${scanNumber}&select=id`)).length > 0 };
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e.message).replace(/\S+@\S+/g, '[email]').slice(0, 300); }
  finally { try { if (isTestAddress(email)) await rpc('mpt_dsar_erase', { p_email: email }); out.cleanup = 'test user removed'; } catch { out.cleanup = 'CLEANUP FAILED'; } }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await run(process.env);
  const t = '```json\n' + JSON.stringify(r, null, 2) + '\n```';
  console.log(t);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + '\n');
  process.exit(r.notConfigured ? 2 : r.ok ? 0 : 1);
}
