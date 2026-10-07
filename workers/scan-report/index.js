import { db } from './lib/supabase.js';
import { checkBreaches } from './lib/hibp.js';
import { checkBrokers } from './lib/brokers.js';
import { computeScore, breachRisk, CATEGORIES } from './lib/score.js';
import { buildConfirmationEmail, buildReportEmail, sendEmail } from './lib/email.js';

const ALLOWED_ORIGINS = ['https://myprivacytool.io', 'https://www.myprivacytool.io'];
const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clip = (v, n) => String(v ?? '').slice(0, n);
// Per-IP limit (wrangler.toml [[unsafe.bindings]] type "ratelimit"); fails open if the binding is absent or errors.
async function rateLimited(env, request) {
  if (!env.RATE_LIMITER) return false;
  try { return !(await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success; } catch { return false; }
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
    if (request.method !== 'POST' || url.pathname !== '/api/scan') return new Response('Not found', { status: 404 });
    // MPC-7350: refuse other browser origins, oversized bodies and bursts from one IP. No Origin header = non-browser caller, still allowed.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 8 * 1024) return json({ error: 'Payload too large' }, 413);
    if (await rateLimited(env, request)) return json({ error: 'Too many requests' }, 429);
    try {
      let b;
      try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'Invalid request' }, 400);
      const email = clip(b.email, 255).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: 'Valid email required' }, 400);
      if (b.consent !== true) return json({ error: 'Consent required' }, 400);   // never default to consent
      const result = await handleScan(env, ctx, {
        email,
        consentSource: clip(b.consent_source || 'scan_page', 64).replace(/[^a-z0-9_-]/gi, '') || 'scan_page',
        ip: request.headers.get('CF-Connecting-IP') || null,
        utm: { source: clip(b.utm_source, 100), medium: clip(b.utm_medium, 100), campaign: clip(b.utm_campaign, 100), content: clip(b.utm_content, 100), referrer: clip(b.referrer, 500) },
      });
      return json({ success: true, duplicate: result.duplicate });
    } catch (e) {
      console.error('scan submit failed:', String(e));
      return json({ error: 'Could not record your scan request' }, 500);
    }
  },

  async scheduled(_event, env, ctx) { ctx.waitUntil(runReportJob(env)); },
};

// ------------------------------------------------------------------ submit path
export async function handleScan(env, ctx, { email, consentSource, ip, utm }, fetchImpl = fetch) {
  const sb = db(env, fetchImpl);
  const now = new Date();
  const retainUntil = new Date(now.getTime() + 3 * 365 * 24 * 3600 * 1000).toISOString();
  const consent = { consent_given_at: now.toISOString(), consent_source: consentSource, ip_address: ip, retain_until: retainUntil };

  let user = (await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`))[0];
  if (!user) {
    try { user = await sb.insert('users', { email, ...consent }); }
    catch (e) { if (e.status !== 409) throw e; user = (await sb.select(`users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`))[0]; }
  } else {
    await sb.patch(`users?id=eq.${user.id}`, { ...consent, updated_at: now.toISOString() });
  }
  try {
    await sb.insert('leads', { email, user_id: user.id, utm_source: utm.source || null, utm_medium: utm.medium || null, utm_campaign: utm.campaign || null, utm_content: utm.content || null, utm_referrer: utm.referrer || null, ...consent });
  } catch (e) { if (e.status !== 409) console.error('lead insert failed', String(e)); }   // 409 = already a lead (dedupe)

  // One report per address per 24h: stops the form being used to mail-bomb someone.
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const recent = await sb.select(`scans?user_id=eq.${user.id}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
  if (recent.length) return { duplicate: true };

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
async function confirm(env, sb, scanId, email, fetchImpl) {
  if (!recipientAllowed(env, email)) return console.warn('confirmation held: recipient not in allowlist');
  const m = buildConfirmationEmail();
  const r = await sendEmail(env, { to: email, ...m, idempotencyKey: `confirm-${scanId}` }, fetchImpl);
  if (r.sent) await sb.patch(`scans?id=eq.${scanId}`, { confirmation_sent_at: new Date().toISOString() });
  else console.error('confirmation not sent:', r.reason);
}

// ------------------------------------------------------------------ report job
export async function runReportJob(env, fetchImpl = fetch, limit = 5) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'no supabase key' };
  const sb = db(env, fetchImpl);
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const queue = await sb.select(
    `scans?select=id,user_id,email_scanned,confirmation_sent_at,report_status,report_attempts,report_due_at` +
    `&or=(report_status.eq.pending,and(report_status.eq.processing,report_claimed_at.lt.${encodeURIComponent(stale)}))` +
    `&report_attempts=lt.${MAX_ATTEMPTS}&order=created_at.asc&limit=${limit}`);
  const out = { sent: 0, held: 0, failed: 0 };
  for (const job of queue) {
    try {
      if (!recipientAllowed(env, job.email_scanned)) { out.held++; continue; }
      if (!job.confirmation_sent_at) await confirm(env, sb, job.id, job.email_scanned, fetchImpl);     // catch up a missed confirmation
      const claimed = await sb.patch(`scans?id=eq.${job.id}&report_status=eq.${job.report_status}`, { report_status: 'processing', report_claimed_at: new Date().toISOString(), report_attempts: job.report_attempts + 1 });
      if (!claimed.length) continue;                                                                    // another run took it
      const r = await processScan(env, sb, job, fetchImpl);
      if (r.held) { await sb.patch(`scans?id=eq.${job.id}`, { report_status: 'pending', report_attempts: job.report_attempts, report_last_error: r.held }); out.held++; }
      else out.sent++;
    } catch (e) {
      out.failed++;
      const attempts = job.report_attempts + 1;
      console.error(`report failed for scan ${job.id} (attempt ${attempts}):`, String(e));
      await sb.patch(`scans?id=eq.${job.id}`, { report_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', report_last_error: String(e).slice(0, 300) }).catch(() => {});
    }
  }
  const overdue = queue.filter((j) => new Date(j.report_due_at) < new Date()).length;
  if (overdue) console.error(`ALERT: ${overdue} report(s) past their 48h deadline`);
  return out;
}

async function processScan(env, sb, job, fetchImpl) {
  const email = job.email_scanned;
  const hibp = await checkBreaches(email, env, fetchImpl);
  if (hibp.status !== 'checked' && env.ALLOW_PARTIAL_REPORT !== 'true') return { held: `held: ${hibp.reason}` };   // ALLOW_PARTIAL_REPORT=false holds reports until HIBP works
  const brokers = await checkBrokers(email, env);

  const breaches = hibp.status === 'checked' ? hibp.breaches : [];
  const checked = new Set(hibp.status === 'checked' ? ['email'] : []);
  const signals = breaches.map((b) => ({ category: 'email', risk: breachRisk(b), ageDays: 0 }));
  const result = computeScore(signals, checked);

  const rows = [
    ...breaches.map((b) => ({ scan_id: job.id, category: 'email', signal_type: `breach:${clip(b.Name, 80)}`, severity: breachRisk(b) >= 8 ? 'high' : 'medium', data_source: 'Have I Been Pwned', check_status: 'found', details: clip(`${b.BreachDate || ''} exposed: ${(b.DataClasses || []).join(', ')}`, 500), removal_status: 'manual_only' })),
    ...(hibp.status === 'checked' && breaches.length === 0 ? [{ scan_id: job.id, category: 'email', signal_type: 'breach:none', severity: 'low', data_source: 'Have I Been Pwned', check_status: 'clear' }] : []),
    ...(hibp.status !== 'checked' ? [{ scan_id: job.id, category: 'email', signal_type: 'breach:not_checked', severity: 'low', data_source: 'Have I Been Pwned', check_status: 'not_checked', details: clip(hibp.reason, 200) }] : []),
    ...brokers.map((b) => ({ scan_id: job.id, category: 'broker', signal_type: `${b.key}_profile`, severity: 'high', data_source: b.name, check_status: 'not_checked', details: clip(b.reason, 300), removal_status: 'manual_only', removal_url: b.removal_url, removal_instructions: b.steps ? b.steps.join('\n') : null })),
  ];
  const inserted = await sb.insertMany('signals', rows);
  await sb.insertMany('hexagon_scores', result.hexagons.map((h) => ({ scan_id: job.id, category: h.category, score: h.score, signals_count: h.signals_count, risk_multiplier: h.risk_multiplier, color: h.color, checked: h.checked })));
  // Removal tasks only track brokers confirmed present; "not yet checked" brokers get none.

  const mail = buildReportEmail({ scan: result, breaches, breachStatus: hibp.status, brokers });
  const sent = await sendEmail(env, { to: email, ...mail, idempotencyKey: `report-${job.id}` }, fetchImpl);
  if (!sent.sent) throw new Error(`report email not sent: ${sent.reason}`);
  await sb.patch(`scans?id=eq.${job.id}`, {
    privacy_score: result.score, risk_level: result.risk_level, signals_found: result.signals_found,
    categories_checked: result.categories_checked, categories_unchecked: result.categories_unchecked,
    data_freshness: new Date().toISOString(), report_status: 'sent', report_sent_at: new Date().toISOString(), resend_message_id: sent.id, report_last_error: null,
  });
  return { sent: true, signals: inserted.length };
}
