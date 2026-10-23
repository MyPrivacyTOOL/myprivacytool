import { runEmailHexagons, emailHexagonSignalRows } from './lib/emailHexagons.js';
import { db } from './lib/supabase.js';
import { checkBreaches } from './lib/hibp.js';
import { pushScanActivity, pushEmailOptOut } from './lib/hubspot.js';
import { checkBrokers } from './lib/brokers.js';
import { computeScore, breachRisk, CATEGORIES } from './lib/score.js';
import { buildConfirmationEmail, buildReportEmail, buildUnsubscribedEmail, buildUnsubscribeRequestEmail, sendEmail } from './lib/email.js';
import { runHkSpamReminderJob, isHkSpamSlot } from './lib/hkSpam.js';
import { addSuppression, emailHash } from './lib/suppression.js';
import { buildMirrorReport } from './lib/mirror.js';
import { turnstileBlocks } from './lib/turnstile.js';
import { loadWebScan } from './lib/webScanLoader.js';
import { reportAttachment } from './lib/reportHex.js';
import { MAX_WEB_SCAN_BYTES, parseSaveRequest, readCappedJson, recordEvent, saveWebScanForContact, validateStep, webScanEnabled } from './lib/webScan.js';
import { handleRecognise, handleRecogniseDelete } from './lib/recognise.js';
import { attachReferral, completeReferral, ensureReferralCode, handleReferralInvite, handleReferralStatus, manageUrl, referralsEnabled, referralTester, shareUrl } from './lib/referral.js';
import { referralBlock } from './lib/referralEmail.js';
import { abOn, abVariant } from './lib/referralAb.js';
import { buildFollowUpEmail, FOLLOWUP_DELAYS_MS, nextFollowUp, unsubscribePageUrl, unsubscribeUrl, verifyUnsubscribe } from './lib/onboarding.js';

const ALLOWED_ORIGINS = ['https://myprivacytool.io', 'https://www.myprivacytool.io'];
const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MS = 30 * 60 * 1000;   // MPC-7406: a scan 'processing' longer than this was abandoned (Worker timeout/crash) and goes back to pending
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clip = (v, n) => String(v ?? '').slice(0, n);
// Per-IP limit (wrangler.toml [[unsafe.bindings]] type "ratelimit"); fails open if the binding is absent or errors.
async function rateLimited(env, request, prefix = '') {
  if (!env.RATE_LIMITER) return false;
  try { return !(await env.RATE_LIMITER.limit({ key: prefix + (request.headers.get('CF-Connecting-IP') || 'unknown') })).success; } catch { return false; }
}

// gmail "+tag" and dots are ignored when matching the allowlist.
const norm = (e) => { const [l, d] = String(e).toLowerCase().split('@'); return d === 'gmail.com' ? `${l.split('+')[0].replace(/\./g, '')}@${d}` : `${l}@${d}`; };
export function recipientAllowed(env, email) {
  const list = String(env.RECIPIENT_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 0 || list.map(norm).includes(norm(email));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/api/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) return handleUnsubscribe(env, url, request.method === 'POST', request, cors);
    if (request.method === 'POST' && url.pathname === '/api/unsubscribe-request') return handleUnsubscribeRequest(env, request, cors, json);
    if (request.method === 'POST' && url.pathname === '/api/web-scan/step') return handleWebScanStep(env, request, origin, json);
    // MPC-7494: the open mirror. Off unless RECOGNITION_ENABLED is "true". Read-only apart from the visitor's own delete button.
    if (request.method === 'POST' && url.pathname === '/api/recognise') return handleRecognise(env, request, origin, json, { allowedOrigins: ALLOWED_ORIGINS, rateLimited, sb: db(env) });
    if (request.method === 'POST' && url.pathname === '/api/recognise/delete') return handleRecogniseDelete(env, request, origin, json, { allowedOrigins: ALLOWED_ORIGINS, rateLimited, sb: db(env) });
    // MPC-7645: referral programme. Both answer 404 unless REFERRALS_ENABLED is "true". Authorised by the signed manage link in the referrer's report email.
    if (request.method === 'POST' && url.pathname === '/api/referral/status') return handleReferralStatus(env, request, origin, json, { allowedOrigins: ALLOWED_ORIGINS, rateLimited, sb: db(env) });
    if (request.method === 'POST' && url.pathname === '/api/referral/invite') return handleReferralInvite(env, request, origin, json, { allowedOrigins: ALLOWED_ORIGINS, rateLimited, sb: db(env), allowed: recipientAllowed });
    if (request.method !== 'POST' || url.pathname !== '/api/scan') return new Response('Not found', { status: 404 });
    // MPC-7350: refuse other browser origins, oversized bodies and bursts from one IP. No Origin header = non-browser caller, still allowed.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
    if (await rateLimited(env, request)) return json({ error: 'Too many requests' }, 429);
    try {
      // MPC-7470: a request may carry the visitor's scan (only with the save tick box), so the body cap is larger while saving is on.
      const read = await readCappedJson(request, webScanEnabled(env) ? MAX_WEB_SCAN_BYTES + 8 * 1024 : 8 * 1024);
      if (read.status) return json({ error: read.status === 413 ? 'Payload too large' : 'Invalid request' }, read.status);
      const b = read.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'Invalid request' }, 400);
      const email = clip(b.email, 255).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: 'Valid email required' }, 400);
      if (b.consent !== true) return json({ error: 'Consent required' }, 400);   // never default to consent
      // MPC-8430: bot check before anything is stored or sent (no-op until TURNSTILE_SECRET_KEY is set; blocks only when TURNSTILE_ENFORCE = "true").
      if (await turnstileBlocks(env, request, b['cf-turnstile-response'], origin)) return json({ error: 'Verification failed' }, 403);
      // MPC-7470 (D12): saving the scan needs its own consent (save_consent === true), given at this contact step. Checked before anything is stored or sent.
      // Switch off: the save fields are ignored, the email request is handled as before.
      const save = webScanEnabled(env) ? parseSaveRequest(b) : { none: true };
      if (save.error) return json({ error: save.error }, 400);
      const result = await handleScan(env, ctx, {
        email,
        consentSource: clip(b.consent_source || 'scan_page', 64).replace(/[^a-z0-9_-]/gi, '') || 'scan_page',
        ip: request.headers.get('CF-Connecting-IP') || null,
        ref: clip(b.ref, 16).toUpperCase(),   // MPC-7645: referral code from the share link, ignored unless REFERRALS_ENABLED
        utm: { source: clip(b.utm_source, 100), medium: clip(b.utm_medium, 100), campaign: clip(b.utm_campaign, 100), content: clip(b.utm_content, 100), referrer: clip(b.referrer, 500) },
      });
      // MPC-7470: save the scan and link it to this contact, with the consent record. Not for a repeat request within 24h (no new report,
      // so a second copy of the visitor's technical details would serve no purpose). A failure to save never changes the answer to the email request.
      const saved = save.hexagons && !result.duplicate && result.scanId
        ? await saveWebScanForContact(env, db(env), { hexagons: save.hexagons, contactId: result.scanId, version: save.version, recogniseVersion: save.recogniseVersion, startedMs: save.startedMs, previousScanNumber: save.previousScanNumber })
        : { saved: false };
      return json({ success: true, duplicate: result.duplicate, scan_saved: saved.saved, ...(saved.saved ? { scan_number: saved.scanNumber } : {}) });
    } catch (e) {
      console.error('scan submit failed:', String(e));
      return json({ error: 'Could not record your scan request' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // MPC-7448: the HK Spam day-10 email shares the 5-minute trigger (the free plan allows only 5 crons per account). On its four daily
    // slots (01:05 to 04:05 UTC) that tick runs only the HK job, to keep within the 50-subrequest limit; the report and follow-up jobs
    // run on every other tick, so a report waits at most 5 minutes longer.
    if (isHkSpamSlot(event?.scheduledTime ?? Date.now())) ctx.waitUntil(runHkSpamJob(env, fetch, undefined, event?.scheduledTime ?? Date.now()).catch((e) => console.error('hk spam job failed:', String(e).replace(/\S+@\S+/g, '[email]'))));
    else ctx.waitUntil(runReportJob(env).catch((e) => console.error('report job crashed:', String(e).replace(/\S+@\S+/g, '[email]'))).then(() => runFollowUpJob(env)));
  },
};

// MPC-7493: POST /api/web-scan/step {scan_number, step, seconds?} -> {recorded}. A funnel step for a scan that was saved (results viewed,
// contact step opened, seconds on the results screen). An unknown scan number records nothing. Off with the same switch as saving the scan.
// MPC-7470 (D12): a scan exists only after the contact step, so a browser only ever has a scan number to report against after saving.
async function handleWebScanStep(env, request, origin, json) {
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!webScanEnabled(env)) return json({ recorded: false });
  if (await rateLimited(env, request, 'web-scan-step:')) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  const read = await readCappedJson(request, 512);
  if (read.status) return json({ error: read.status === 413 ? 'Payload too large' : 'Invalid request' }, read.status);
  const v = validateStep(read.body);
  if (v.error) return json({ error: v.error }, 400);
  return json({ recorded: await recordEvent(db(env), v.scanNumber, v.step, { seconds: v.seconds }) });
}

// MPC-7448: HK Spam day-10 email. Off unless HK_SPAM_ENABLED === 'true'; test inbox only unless HK_SPAM_EMAILS_LIVE === 'true'. See docs/hk-spam-day10-email-mpc-7448.md.
export const runHkSpamJob = (env, fetchImpl = fetch, limit, when) => runHkSpamReminderJob(env, { fetchImpl, allowed: recipientAllowed, limit, when });

// ------------------------------------------------------------------ submit path
export async function handleScan(env, ctx, { email, consentSource, ip, utm, ref }, fetchImpl = fetch) {
  const sb = db(env, fetchImpl);
  const now = new Date();
  const retainUntil = new Date(now.getTime() + 3 * 365 * 24 * 3600 * 1000).toISOString();
  const consent = { consent_given_at: now.toISOString(), consent_source: consentSource, ip_address: ip, retain_until: retainUntil };

  let user = (await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`))[0];
  let isNewUser = false;
  if (!user) {
    try { user = await sb.insert('users', { email, ...consent }); isNewUser = true; }
    catch (e) { if (e.status !== 409) throw e; user = (await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`))[0]; }
  } else {
    await sb.patch(`users?id=eq.${user.id}`, { ...consent, updated_at: now.toISOString() });
  }
  try {
    await sb.insert('leads', { email, user_id: user.id, utm_source: utm.source || null, utm_medium: utm.medium || null, utm_campaign: utm.campaign || null, utm_content: utm.content || null, utm_referrer: utm.referrer || null, ...consent });
  } catch (e) { if (e.status !== 409) console.error('lead insert failed', String(e)); }   // 409 = already a lead (dedupe)

  // MPC-7645: a brand-new user who arrived through a friend's link is linked to that friend. Only new users count, so nobody can be referred after the fact.
  if (ref && isNewUser && referralTester(env, email)) await attachReferral(sb, { ref, userId: user.id, email, isNewUser }).catch((e) => console.error('referral attach failed:', String(e).replace(/\S+@\S+/g, '[email]')));

  // One report per address per 24h: stops the form being used to mail-bomb someone.
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const recent = await sb.select(`scans?user_id=eq.${user.id}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
  if (recent.length) return { duplicate: true, scanId: recent[0].id };

  const scan = await sb.insert('scans', { user_id: user.id, email_scanned: email, source: 'web_scan' });
  const side = [syncHubSpot(env, email, consentSource, now, fetchImpl), confirm(env, sb, scan.id, email, fetchImpl)];
  const all = Promise.all(side.map((p) => p.catch((e) => console.error('side effect failed', String(e)))));
  if (ctx?.waitUntil) ctx.waitUntil(all); else await all;
  return { duplicate: false, scanId: scan.id };
}

async function syncHubSpot(env, email, consentSource, now, fetchImpl) {
  if (!env.HUBSPOT_TOKEN) return;
  const props = { email, lead_source_platform: env.HUBSPOT_LEAD_SOURCE || 'web_scan', consent_source: consentSource, consent_given_at: now.toISOString().slice(0, 10) };
  const res = await fetchImpl('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
    method: 'POST', headers: { Authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: [{ idProperty: 'email', id: email, properties: props }] }),
  });
  if (!res.ok) console.error('HubSpot upsert failed', res.status, (await res.text()).slice(0, 200));
}

// Sends the confirmation exactly once per scan (Resend Idempotency-Key + confirmation_sent_at).
// Signed one-click unsubscribe link for the Worker's own /api/unsubscribe; null when UNSUBSCRIBE_SECRET is not set.
// page = branded page on the main site (email bodies); oneClick = Worker endpoint for the List-Unsubscribe header.
const unsubLinks = async (env, email) => (env.UNSUBSCRIBE_SECRET ? { page: await unsubscribePageUrl(env, email), oneClick: await unsubscribeUrl(env, email) } : null);
const unsubHeaders = (links) => (links ? { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined);

async function confirm(env, sb, scanId, email, fetchImpl) {
  if (!recipientAllowed(env, email)) return console.warn('confirmation held: recipient not in allowlist');
  const links = await unsubLinks(env, email);
  const m = buildConfirmationEmail({ unsubscribeLink: links?.page });
  const r = await sendEmail(env, { to: email, ...m, idempotencyKey: `confirm-${scanId}`, headers: unsubHeaders(links) }, fetchImpl);
  if (r.sent) await sb.patch(`scans?id=eq.${scanId}`, { confirmation_sent_at: new Date().toISOString() });
  else console.error('confirmation not sent:', r.reason);
}

// ------------------------------------------------------------------ report job
// MPC-7406: scans held by RECIPIENT_ALLOWLIST stay pending and untouched, so they must never take up the per-run limit.
// Reads the pending queue oldest-first in pages and keeps the first `limit` allowed scans; with no allowlist that is just the first `limit` rows.
const REPORT_PAGE = 1000;
// Someone who unsubscribed after requesting this scan gets no report: the unsubscribe page promises no more scan report emails.
// (A scan requested after they unsubscribed is a fresh request and still gets its report; follow-ups stay off for them.)
const unsubscribedSince = (job) => { const t = job.users?.email_opt_out_at; return Boolean(t) && Date.parse(t) > Date.parse(job.created_at); };
async function nextReportJobs(env, sb, limit) {
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const gated = Boolean(String(env.RECIPIENT_ALLOWLIST || '').trim());
  const size = gated ? REPORT_PAGE : limit;
  const queue = []; const cancelled = []; let held = 0;
  for (let offset = 0; ; offset += size) {
    const page = await sb.select(
      `scans?select=id,user_id,email_scanned,confirmation_sent_at,report_status,report_attempts,report_due_at,created_at,users(email_opt_out_at)` +
      `&or=(report_status.eq.pending,and(report_status.eq.processing,report_claimed_at.lt.${encodeURIComponent(stale)}))` +
      `&report_attempts=lt.${MAX_ATTEMPTS}&order=created_at.asc,id.asc&limit=${size}&offset=${offset}`);
    for (const job of page) {
      if (!recipientAllowed(env, job.email_scanned)) { held++; continue; }
      if (unsubscribedSince(job)) { cancelled.push(job.id); continue; }
      if (queue.push(job) >= limit) return { queue, held, cancelled };
    }
    if (page.length < size) return { queue, held, cancelled };
  }
}

// MPC-7406: a Worker killed mid-scan never reaches its catch block, leaving the row 'processing' forever. Put such rows
// back to 'pending' (retry) or, once attempts are used up, to 'failed' with the reason, so none is stuck silently.
// Uses the same atomic claim filter (status + claimed_at) as the claim, so a live run's row is never touched.
async function resetStaleClaims(sb) {
  const stale = encodeURIComponent(new Date(Date.now() - STALE_CLAIM_MS).toISOString());
  const base = `scans?report_status=eq.processing&report_claimed_at=lt.${stale}`;
  const exhausted = await sb.patch(`${base}&report_attempts=gte.${MAX_ATTEMPTS}`, { report_status: 'failed', report_last_error: 'stale: stuck in processing past the retry limit' });
  const retried = await sb.patch(`${base}&report_attempts=lt.${MAX_ATTEMPTS}`, { report_status: 'pending', report_last_error: 'stale: processing timed out, reset for retry' });
  if (exhausted.length || retried.length) console.warn(`scan queue: reset ${retried.length} stale scan(s) to pending, failed ${exhausted.length} past the retry limit`);
}

export async function runReportJob(env, fetchImpl = fetch, limit = 5) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('scan queue: SUPABASE_SERVICE_ROLE_KEY is not set, nothing can be processed'); return { skipped: 'no supabase key' }; }
  const sb = db(env, fetchImpl);
  await resetStaleClaims(sb).catch((e) => console.error('scan queue: stale reset failed:', String(e)));
  const { queue, held, cancelled } = await nextReportJobs(env, sb, limit);
  const out = { sent: 0, held, failed: 0, cancelled: cancelled.length };
  console.log(`scan queue: ${queue.length} to process, ${held} held by allowlist, ${cancelled.length} cancelled`);
  if (!env.HIBP_API_KEY) console.error(`HIBP_API_KEY is not set: breach checks skipped (${env.ALLOW_PARTIAL_REPORT === 'true' ? 'reports go out with breaches "not yet checked"' : 'reports are held'})`);
  for (const id of cancelled) {   // take them out of the queue for good: nothing is sent and the reason is on the row
    await sb.patch(`scans?id=eq.${id}`, { report_status: 'failed', report_last_error: 'cancelled: unsubscribed before the report was sent' }).catch((e) => console.error(`could not cancel scan ${id}:`, String(e)));
  }
  for (const job of queue) {
    try {
      if (!job.confirmation_sent_at) await confirm(env, sb, job.id, job.email_scanned, fetchImpl);     // catch up a missed confirmation
      const claimed = await sb.patch(`scans?id=eq.${job.id}&report_status=eq.${job.report_status}`, { report_status: 'processing', report_claimed_at: new Date().toISOString(), report_attempts: job.report_attempts + 1 });
      if (!claimed.length) { console.log(`scan ${job.id}: already claimed by another run, skipping`); continue; }   // another run took it
      console.log(`scan ${job.id}: processing (attempt ${job.report_attempts + 1}/${MAX_ATTEMPTS})`);
      const r = await processScan(env, sb, job, fetchImpl);
      if (r.held) { console.warn(`scan ${job.id}: held, back to pending (${r.held})`); await sb.patch(`scans?id=eq.${job.id}`, { report_status: 'pending', report_attempts: job.report_attempts, report_last_error: r.held }); out.held++; }
      else { out.sent++; console.log(`scan ${job.id}: sent`); }
    } catch (e) {
      out.failed++;
      const attempts = job.report_attempts + 1;
      console.error(`report failed for scan ${job.id} (attempt ${attempts}):`, String(e));
      await sb.patch(`scans?id=eq.${job.id}`, { report_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', report_last_error: String(e).slice(0, 300) }).catch((e2) => console.error(`scan ${job.id}: could not record failure (row may stay processing until the stale reset):`, String(e2)));
    }
  }
  const overdue = queue.filter((j) => new Date(j.report_due_at) < new Date()).length;
  if (overdue) console.error(`ALERT: ${overdue} report(s) past their 48h deadline`);
  return out;
}

async function processScan(env, sb, job, fetchImpl) {
  const email = job.email_scanned;
  const hibp = await checkBreaches(email, env, fetchImpl);
  if (hibp.status === 'rate_limited') return { held: 'held: HIBP rate limited, retrying next run' };   // queue and retry later; never report it as "not checked"
  if (hibp.status !== 'checked' && env.ALLOW_PARTIAL_REPORT !== 'true') return { held: `held: ${hibp.reason}` };   // ALLOW_PARTIAL_REPORT=false holds reports until HIBP works
  const brokers = await checkBrokers(email, env);
  const emailHex = await runEmailHexagons(email, env, fetchImpl).catch((e) => { console.error('email hexagons failed:', String(e)); return []; });   // MPC-7467: never throws, bounded by a timeout, never blocks the report

  const breaches = hibp.status === 'checked' ? hibp.breaches : [];
  const checked = new Set(hibp.status === 'checked' ? ['email'] : []);
  const signals = breaches.map((b) => ({ category: 'email', risk: breachRisk(b), ageDays: 0 }));
  const result = computeScore(signals, checked);

  const rows = [
    ...breaches.map((b) => ({ scan_id: job.id, category: 'email', signal_type: `breach:${clip(b.Name, 80)}`, severity: breachRisk(b) >= 8 ? 'high' : 'medium', data_source: 'Have I Been Pwned', check_status: 'found', details: clip(`${b.BreachDate || ''} exposed: ${(b.DataClasses || []).join(', ')}`, 500), removal_status: 'manual_only' })),
    ...(hibp.status === 'checked' && breaches.length === 0 ? [{ scan_id: job.id, category: 'email', signal_type: 'breach:none', severity: 'low', data_source: 'Have I Been Pwned', check_status: 'clear' }] : []),
    ...(hibp.status !== 'checked' ? [{ scan_id: job.id, category: 'email', signal_type: 'breach:not_checked', severity: 'low', data_source: 'Have I Been Pwned', check_status: 'not_checked', details: clip(hibp.reason, 200) }] : []),
    ...emailHexagonSignalRows(job.id, emailHex),
    ...brokers.map((b) => ({ scan_id: job.id, category: 'broker', signal_type: `${b.key}_profile`, severity: 'high', data_source: b.name, check_status: 'not_checked', details: clip(b.reason, 300), removal_status: 'manual_only', removal_url: b.removal_url, removal_instructions: b.steps ? b.steps.join('\n') : null })),
  ];
  // PostgREST bulk insert rejects rows with different key sets (PGRST102), so give every signal row the same columns.
  const SIGNAL_DEFAULTS = { details: null, removal_status: 'not_started', removal_url: null, removal_instructions: null };
  // MPC-7616: a retry (report email failed, Worker killed after these writes) must not collide with the rows of the earlier attempt:
  // hexagon_scores has unique (scan_id, category), so the second insert 409'd, every retry failed the same way and the report was never sent.
  // Clear this scan's earlier output first so each attempt writes a complete, single set (signals has no unique key and would double up).
  await sb.remove(`signals?scan_id=eq.${job.id}`);
  await sb.remove(`hexagon_scores?scan_id=eq.${job.id}`);
  const inserted = await sb.insertMany('signals', rows.map((r) => ({ ...SIGNAL_DEFAULTS, ...r })));
  await sb.insertMany('hexagon_scores', result.hexagons.map((h) => ({ scan_id: job.id, category: h.category, score: h.score, signals_count: h.signals_count, risk_multiplier: h.risk_multiplier, color: h.color, checked: h.checked })));
  // Removal tasks only track brokers confirmed present; "not yet checked" brokers get none.

  const mirror = buildMirrorReport({ scan: result, breaches, breachStatus: hibp.status, brokers });
  const links = await unsubLinks(env, email);
  const webScan = await loadWebScan(sb, job.id);      // null when the visitor never ran/saved a web scan: Part 1 then says so honestly
  const referral = await referralFor(env, sb, job.user_id, email);
  const mail = buildReportEmail({ scan: { ...result, id: job.id }, breaches, breachStatus: hibp.status, brokers, webScan, referral, emailChecks: emailHex.map((h) => ({ id: h.id, status: h.status, value: h.value, detail: { source: h.source, reason: h.reason || null } })), unsubscribeLink: links?.page });
  const sent = await sendEmail(env, { to: email, subject: mail.subject, html: mail.html, text: mail.text, attachments: [reportAttachment(mail.report)], idempotencyKey: `report-${job.id}`, headers: unsubHeaders(links) }, fetchImpl);
  if (!sent.sent) throw new Error(`report email not sent: ${sent.reason}`);
  await sb.patch(`scans?id=eq.${job.id}`, {
    privacy_score: result.score, risk_level: result.risk_level, signals_found: result.signals_found,
    categories_checked: result.categories_checked, categories_unchecked: result.categories_unchecked,
    mirror_report: mirror, data_freshness: new Date().toISOString(), report_status: 'sent', report_sent_at: new Date().toISOString(), resend_message_id: sent.id, report_last_error: null,
  });
  await claimCohort(env, sb, job.user_id);
  if (referralsEnabled(env)) await completeReferral(env, sb, job.user_id, fetchImpl, recipientAllowed);   // MPC-7645: this report finishing is what earns the friend who invited them a month of Pro
  const hs = await pushScanActivity(env, { email, scanId: job.id, score: result.score, riskLevel: result.risk_level, signalsFound: result.signals_found, breachStatus: hibp.status, breachCount: breaches.length }, fetchImpl);
  if (hs.failed) console.error('HubSpot activity push failed:', hs.failed);
  return { sent: true, signals: inserted.length };
}

// MPC-7645: the "Invite 3 friends" block in the report. Needs UNSUBSCRIBE_SECRET (it signs the private invite link). Never lets the programme break the report.
async function referralFor(env, sb, userId, email) {
  if (!referralTester(env, email) || !env.UNSUBSCRIBE_SECRET) return null;
  try {
    const code = await ensureReferralCode(sb, userId);
    if (!code) return null;
    // A/B test report_block: the variant is stored the first time so the same person always sees the same wording; `v` in the private link lets the page count the visit.
    const tracked = abOn(env, 'report_block');
    const variant = await abVariant(env, 'report_block', code);
    if (tracked) await sb.patch(`users?id=eq.${userId}&referral_block_variant=is.null`, { referral_block_variant: variant }).catch((e) => console.error('referral variant not saved', String(e)));
    return referralBlock({ shareLink: shareUrl(env, code), manageLink: await manageUrl(env, code, tracked ? variant : undefined), variant });
  } catch (e) { console.error('referral block failed', String(e)); return null; }
}

// MPC-7261: the first 100 real users get a cohort number when their report is delivered. While RECIPIENT_ALLOWLIST is
// set only test inboxes are mailed, so they must not use up real slots. Never lets onboarding break the report.
async function claimCohort(env, sb, userId) {
  if (String(env.RECIPIENT_ALLOWLIST || '').trim()) return null;
  try { return await sb.rpc('claim_onboarding_cohort', { p_user_id: userId }); }
  catch (e) { console.error('cohort claim failed', String(e)); return null; }
}

// ------------------------------------------------------------------ follow-up emails (MPC-7261)
// Day 3 "next step" and day 7 "feedback" emails after the report. Off unless UNSUBSCRIBE_SECRET is set, so we never send
// marketing-style mail without a working unsubscribe link. Stage is claimed before sending (at most once per stage).
export async function runFollowUpJob(env, fetchImpl = fetch, limit = 20) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.UNSUBSCRIBE_SECRET) return { skipped: 'follow-ups need SUPABASE_SERVICE_ROLE_KEY and UNSUBSCRIBE_SECRET' };
  const sb = db(env, fetchImpl);
  const testMode = Boolean(String(env.RECIPIENT_ALLOWLIST || '').trim());
  const cutoff = new Date(Date.now() - FOLLOWUP_DELAYS_MS[0]).toISOString();
  const queue = await sb.select(`scans?select=id,user_id,email_scanned,report_sent_at,followup_stage,mirror_report&report_status=eq.sent&followup_stage=lt.2&report_sent_at=lt.${encodeURIComponent(cutoff)}&order=report_sent_at.asc&limit=${limit}`);
  const out = { sent: 0, skipped: 0, failed: 0 };
  for (const job of queue) {
    try {
      const stage = nextFollowUp(job);
      if (!stage || !recipientAllowed(env, job.email_scanned)) { out.skipped++; continue; }
      const user = (await sb.select(`users?id=eq.${job.user_id}&select=id,cohort_number,email_opt_out_at&limit=1`))[0];
      // Cohort members only; in allowlist test mode the test inboxes stand in for the cohort.
      if (!user || user.email_opt_out_at || (!user.cohort_number && !testMode)) { out.skipped++; continue; }
      const claimed = await sb.patch(`scans?id=eq.${job.id}&followup_stage=eq.${job.followup_stage ?? 0}`, { followup_stage: stage, followup_last_sent_at: new Date().toISOString() });
      if (!claimed.length) continue;
      const links = await unsubLinks(env, job.email_scanned);
      const mail = buildFollowUpEmail({ stage, mirror: job.mirror_report, cohortNumber: user.cohort_number, unsubscribeLink: links.page });
      const r = await sendEmail(env, { to: job.email_scanned, ...mail, idempotencyKey: `followup-${job.id}-${stage}`, headers: unsubHeaders(links) }, fetchImpl);
      if (!r.sent) {                                   // release the stage so the next run retries (Resend key keeps it single-send)
        await sb.patch(`scans?id=eq.${job.id}`, { followup_stage: job.followup_stage ?? 0 });
        throw new Error(`follow-up email not sent: ${r.reason}`);
      }
      out.sent++;
    } catch (e) { out.failed++; console.error(`follow-up failed for scan ${job.id}:`, String(e)); }
  }
  return out;
}

// GET only shows a confirmation page: mail scanners and link previewers open links automatically, so a GET must never opt anyone out.
// The opt-out itself is a POST (the page's button, or a mail app's one-click List-Unsubscribe-Post).
async function handleUnsubscribe(env, url, confirmed, request, cors) {
  const wantsJson = String(request.headers.get('Accept') || '').includes('application/json');   // the website page calls this with fetch()
  const view = (status, heading, body, extra = '') => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${heading} | MyPrivacyTOOL</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:520px;margin:48px auto;padding:0 16px"><div style="background:#fff;border-radius:12px;overflow:hidden">
<div style="background:#15803d;color:#fff;padding:18px 28px;font-size:18px;font-weight:700">MyPrivacyTOOL</div>
<div style="padding:28px"><h1 style="margin:0 0 12px;font-size:22px;line-height:28px">${heading}</h1><p style="margin:0 0 16px;font-size:15px;line-height:23px;color:#374151">${body}</p>${extra}
<p style="margin:20px 0 0;font-size:13px;line-height:20px;color:#6b7280">Questions, or want your data deleted? Write to <a href="mailto:hello@myprivacytool.io" style="color:#6b7280">hello@myprivacytool.io</a>. <a href="https://myprivacytool.io/" style="color:#6b7280">myprivacytool.io</a></p></div></div></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  const reply = (status, heading, body, extra) => (wantsJson
    ? new Response(JSON.stringify({ ok: status === 200 }), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    : view(status, heading, body, extra));
  const email = (url.searchParams.get('e') || '').trim().toLowerCase();
  if (!(await verifyUnsubscribe(env.UNSUBSCRIBE_SECRET, email, url.searchParams.get('t')))) {
    return reply(400, 'This link is not valid', 'The unsubscribe link may be incomplete or out of date. Reply to any of our emails and we will remove you by hand.');
  }
  if (!confirmed) {
    const action = `/api/unsubscribe?e=${encodeURIComponent(email)}&amp;t=${encodeURIComponent(url.searchParams.get('t'))}`;
    return reply(200, 'Unsubscribe from MyPrivacyTOOL emails?', 'Fixed what was in your report? Then you do not need to hear from us again. Confirm and we will send you no more follow-up or marketing emails.',
      `<form method="POST" action="${action}"><button type="submit" style="background:#15803d;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer">Yes, unsubscribe me</button></form>`);
  }
  try {
    const sb = db(env);
    await sb.patch(`users?email=eq.${encodeURIComponent(email)}`, { email_opt_out_at: new Date().toISOString() });
    // CK-7721 fix 3: also delete the address from the newsletter list (public.subscribers), so the stored email goes too, not just the mail.
    // Case-insensitive, with LIKE wildcards escaped; an address containing * (a PostgREST wildcard) is matched exactly instead. Done BEFORE the
    // suppression row so a failure leaves nothing half-done: the person can simply retry the link.
    await sb.remove(`subscribers?email=${/\*/.test(email) ? 'eq.' : 'ilike.'}${encodeURIComponent(/\*/.test(email) ? email : email.replace(/[\\%_]/g, '\\$&'))}`);
    const firstTime = await addSuppression(sb, email, 'unsubscribe');   // MPC-7448: also covers people with no users row (HK Spam registrants) and the newsletter list
    const hs = await pushEmailOptOut(env, { email });   // best effort: HubSpot must not mail them either; a failure never blocks the unsubscribe
    if (hs.failed) console.error('HubSpot opt-out failed:', hs.failed);
    // MPC-7491: one plain confirmation email, only the first time (a repeat click sends nothing). Never blocks or fails the unsubscribe.
    if (firstTime && recipientAllowed(env, email)) {
      try {
        const r = await sendEmail(env, { to: email, ...buildUnsubscribedEmail(), idempotencyKey: `unsubscribed-${await emailHash(email)}` });
        if (!r.sent) console.error('unsubscribe confirmation email not sent:', r.reason);
      } catch (e) { console.error('unsubscribe confirmation email failed', String(e).replace(/\S+@\S+/g, '[email]')); }
    }
    return reply(200, 'You are unsubscribed', 'We will not send you any more follow-up or marketing emails, and we have removed you from our newsletter list.');
  } catch (e) { console.error('unsubscribe failed', String(e)); return reply(500, 'Something went wrong', 'Reply to any of our emails and we will remove you by hand.'); }
}

// POST /api/unsubscribe-request {email}: the website's "unsubscribe me" form. Emails a signed confirmation link to that address only,
// and answers the same way whether or not the address is on our list, so the form cannot be used to look people up.
async function handleUnsubscribeRequest(env, request, cors, json) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (Number(request.headers.get('content-length') || 0) > 2 * 1024) return json({ error: 'Payload too large' }, 413);
  if (await rateLimited(env, request)) return json({ error: 'Too many requests' }, 429);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const email = clip(b && typeof b === 'object' ? b.email : '', 255).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Valid email required' }, 400);
  if (!env.UNSUBSCRIBE_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  try {
    const sb = db(env);
    const user = (await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id,email_opt_out_at&limit=1`))[0];
    // MPC-7789: newsletter-only subscribers (public.subscribers) and HK Spam registrants have no users row; the footer form must reach them too.
    // Same ilike escaping as the removal in handleUnsubscribe (an address containing * is matched exactly).
    const star = /\*/.test(email);
    const subscriber = user ? null : (await sb.select(`subscribers?email=${star ? 'eq.' : 'ilike.'}${encodeURIComponent(star ? email : email.replace(/[\\%_]/g, '\\$&'))}&select=id&limit=1`))[0];
    const hash = await emailHash(email);
    const suppressed = Boolean(user?.email_opt_out_at) || (await sb.select(`email_suppressions?email_hash=eq.${hash}&select=email_hash&limit=1`)).length > 0;
    if ((user || subscriber) && !suppressed && recipientAllowed(env, email)) {
      const mail = buildUnsubscribeRequestEmail({ link: await unsubscribePageUrl(env, email) });
      const r = await sendEmail(env, { to: email, ...mail, idempotencyKey: `unsubreq-${hash.slice(0, 16)}-${new Date().toISOString().slice(0, 13)}` });
      if (!r.sent) console.error('unsubscribe request email not sent:', r.reason);
    }
  } catch (e) { console.error('unsubscribe request failed', String(e)); }
  return json({ ok: true });
}
