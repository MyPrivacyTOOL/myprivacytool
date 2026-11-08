// MPC-9825: queue for the staffed Business "results within 48 hours" service. No new secrets: reuses SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL),
// SLACK_BOT_TOKEN and SLACK_CHANNEL_ID that this Worker already holds. Table: public.mpt_business_requests (supabase/migrations/20261108070000_*).
import { dueAt, formatHKT, makeRef, buildDigest, hoursLeft, delayEmail, DELAY_NOTICE_AT_HOURS, OPEN_STATUSES } from '../../shared/business/sla.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const SIZES = ['1-10', '11-50', '51-200', '200+'];
const DEFAULT_SUPABASE_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';
const DEDUPE_MINUTES = 10;
const clip = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);

const table = (env) => `${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/mpt_business_requests`;
const sbHeaders = (env, extra = {}) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...extra });

async function slack(env, text, fetchImpl) {
  if (!env.SLACK_BOT_TOKEN) return false;
  try {
    const r = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID || 'C0AR4TB6Y77', text, unfurl_links: false, unfurl_media: false }),
    });
    return r.ok;
  } catch (_) { return false; }
}

// Validates a /business form body and writes the queue row. Returns { status, body }. A request that cannot be queued is NOT acknowledged:
// the page then shows an error instead of promising a 48-hour clock that nothing is running.
export async function createBusinessRequest(env, input, now = new Date(), fetchImpl = fetch, randomBytes = () => crypto.getRandomValues(new Uint8Array(8))) {
  const email = clip(input.email, 254).trim();
  const company = clip(input.company, 200).trim();
  const name = clip(input.name, 100).trim();
  const size = SIZES.includes(input.size) ? input.size : null;
  const consented = input.consent === true || input.consent === 'true' || input.consent === 'on';
  if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'Email required' } };
  if (!company) return { status: 400, body: { error: 'Company required' } };
  if (!consented) return { status: 400, body: { error: 'Consent required' } };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('business-request: Supabase not configured'); return { status: 503, body: { error: 'Queue unavailable' } }; }
  const source = String(input.consent_source || 'business_page').replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'business_page';
  try {
    // A double click or a retry inside DEDUPE_MINUTES returns the existing row instead of a second clock.
    const since = new Date(now.getTime() - DEDUPE_MINUTES * 60000).toISOString();
    const q = `${table(env)}?contact_email=eq.${encodeURIComponent(email)}&company=eq.${encodeURIComponent(company)}&created_at=gte.${encodeURIComponent(since)}&select=ref,due_at&limit=1`;
    const ex = await fetchImpl(q, { headers: sbHeaders(env) });
    if (ex.ok) { const rows = await ex.json(); if (Array.isArray(rows) && rows.length) return { status: 200, body: { success: true, ref: rows[0].ref, due_at: rows[0].due_at, duplicate: true } }; }

    const row = { ref: makeRef(randomBytes()), contact_name: name || null, contact_email: email, company, team_size: size, consent_source: source, created_at: now.toISOString(), due_at: dueAt(now).toISOString() };
    const ins = await fetchImpl(table(env), { method: 'POST', headers: sbHeaders(env, { Prefer: 'return=representation' }), body: JSON.stringify(row) });
    if (!ins.ok) {
      console.error('business-request insert failed:', ins.status, (await ins.text()).slice(0, 200));
      await slack(env, ':rotating_light: *MPT Business request NOT queued*: the queue write failed (HTTP ' + ins.status + '). A visitor saw an error and was not promised a 48-hour clock. Check Worker logs for "business-request insert failed".', fetchImpl);
      return { status: 502, body: { error: 'Queue write failed' } };
    }
    // CK-7721: Slack carries a ref, team size and times only. No name, email or company.
    await slack(env, `:inbox_tray: *New MPT Business request* ${row.ref}\nTeam size: ${size || '?'} | received ${formatHKT(now)} | due ${formatHKT(row.due_at)}\nReview and approve before it goes out. Runbook: Notion "MPT > Business — 48-hour Results Runbook (v1)".`, fetchImpl);
    return { status: 200, body: { success: true, ref: row.ref, due_at: row.due_at } };
  } catch (e) {
    console.error('business-request error:', String(e).slice(0, 200));
    return { status: 500, body: { error: 'Internal error' } };
  }
}

// Every cron tick: any open request past due_at that has not been flagged yet becomes Late and Chris is alerted once (late_notified_at is set in the
// same write, so moving a Late row back to "In review" does not re-alert; the digest still shows it OVERDUE from due_at).
export async function markLate(env, now = new Date(), fetchImpl = fetch) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { late: 0, skipped: 'supabase not configured' };
  try {
    const r = await fetchImpl(`${table(env)}?status=in.(New,In%20review,Approved)&late_notified_at=is.null&due_at=lt.${encodeURIComponent(now.toISOString())}&select=ref`, {
      method: 'PATCH', headers: sbHeaders(env, { Prefer: 'return=representation' }), body: JSON.stringify({ status: 'Late', late_notified_at: now.toISOString() }),
    });
    if (!r.ok) { console.error('business-request markLate failed:', r.status); return { late: 0, failed: r.status }; }
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      await slack(env, `:rotating_light: *MPT Business request LATE*: ${rows.map((x) => x.ref).join(', ')} passed the 48-hour deadline. Send the honest delay email now (runbook step 7), then the results.`, fetchImpl);
      return { late: rows.length };
    }
    return { late: 0 };
  } catch (e) { console.error('business-request markLate error:', String(e).slice(0, 200)); return { late: 0, failed: 'exception' }; }
}

// T+36h and still New / In review (nobody has approved it): tell the requester honestly instead of staying silent. Claim first (set delay_notice_sent_at in the
// same write that selects the rows), then send, so a tick that overlaps another cannot send twice; a failed send is alerted in Slack for a manual email.
export async function sendDelayNotices(env, now = new Date(), fetchImpl = fetch) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { sent: 0, skipped: 'supabase not configured' };
  try {
    const cutoff = new Date(now.getTime() - DELAY_NOTICE_AT_HOURS * 3600 * 1000).toISOString();
    const r = await fetchImpl(`${table(env)}?status=in.(New,In%20review)&delay_notice_sent_at=is.null&created_at=lt.${encodeURIComponent(cutoff)}&select=ref,contact_name,contact_email,due_at`, {
      method: 'PATCH', headers: sbHeaders(env, { Prefer: 'return=representation' }), body: JSON.stringify({ delay_notice_sent_at: now.toISOString() }),
    });
    if (!r.ok) { console.error('business-request delay claim failed:', r.status); return { sent: 0, failed: r.status }; }
    const rows = await r.json();
    let sent = 0; const failed = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      let ok = false;
      if (env.RESEND_API_KEY) {
        try {
          const m = delayEmail(row);
          const e = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'MyPrivacyTOOL <hello@myprivacytool.io>', to: [row.contact_email], reply_to: 'hello@myprivacytool.io', subject: m.subject, text: m.text }) });
          ok = e.ok;
        } catch (_) { ok = false; }
      }
      if (ok) sent++; else failed.push(row.ref);
    }
    if (failed.length) await slack(env, `:rotating_light: *MPT Business delay email NOT sent* for ${failed.join(', ')}. Send the honest delay email by hand now (runbook step 7).`, fetchImpl);
    return { sent, failed: failed.length };
  } catch (e) { console.error('business-request delay notice error:', String(e).slice(0, 200)); return { sent: 0, failed: 'exception' }; }
}

// Daily digest (08:00 HKT = 00:00 UTC tick). Posts even when the queue is empty, so a silent day is distinguishable from a dead digest.
export async function postDigest(env, now = new Date(), fetchImpl = fetch) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { posted: false, skipped: 'supabase not configured' };
  try {
    const r = await fetchImpl(`${table(env)}?status=in.(${OPEN_STATUSES.map(encodeURIComponent).join(',')})&select=ref,status,team_size,due_at&order=due_at.asc&limit=100`, { headers: sbHeaders(env) });
    if (!r.ok) { console.error('business-request digest query failed:', r.status); await slack(env, ':rotating_light: *MPT Business digest FAILED*: could not read the queue (HTTP ' + r.status + ').', fetchImpl); return { posted: false, failed: r.status }; }
    const rows = await r.json();
    const d = buildDigest(Array.isArray(rows) ? rows : [], now);
    return { posted: await slack(env, d.text, fetchImpl), open: d.open, late: d.late, dueSoon: d.dueSoon };
  } catch (e) { console.error('business-request digest error:', String(e).slice(0, 200)); return { posted: false, failed: 'exception' }; }
}
export { hoursLeft };
