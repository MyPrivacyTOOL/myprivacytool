// MPC-9890 (Open Tracker design 4.1, 4.2, 8.4): the free user's personal record is deleted N hours after the report is delivered (N = 7 days, Chris 2026-11-08 13:19 HKT)
// unless the person chose a relationship (Keep, sign-up) or pays. The deadline (scans.delete_after) is set in the database (trigger on the delivered receipt, fallback send time);
// the deletion is public.mpt_purge_free_records. This file holds the parts that need the Worker:
//   * the three honest countdown emails: T-24 h, T-4 h (each with one-click Keep and Sign up and the exact deletion time) and T-0 ("done, deleted");
//   * the signed one-click Keep link (GET shows a confirm page because mail scanners open links; POST keeps);
//   * the job that sends the countdowns, runs the purge every tick, then (from the address list the purge returns, never stored) sends the T-0 mail and deletes the HubSpot contact.
// Countdown emails are inside the retention window, so they do not breach the free-delete rule. After T-0 no further mail is possible: the address is gone.
import { shell, para, button, tagLinks, sendEmail } from './email.js';
import { hmac } from './onboarding.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { rcx } from './recipients.js';
import { suppressedAmong } from './suppression.js';
import { db } from './supabase.js';

const SITE = 'https://myprivacytool.io';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const freeRecordEnabled = (env) => env.FREE_RECORD_DELETION_ENABLED === 'true';

// ---- the signed Keep link -------------------------------------------------------------------------------------------------------------------
export const keepToken = (secret, scanId) => hmac(secret, `keep:${String(scanId).toLowerCase()}`);
async function verifyKeep(secret, scanId, token) {
  if (!secret || !scanId || !token) return false;
  const want = await keepToken(secret, scanId);
  if (want.length !== String(token).length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ String(token).charCodeAt(i);
  return d === 0;
}
export async function keepUrl(env, scanId) {
  const base = env.PUBLIC_URL || 'https://mpt-scan-report.myprivacytool.workers.dev';
  return `${base}/api/keep?s=${encodeURIComponent(scanId)}&t=${await keepToken(env.UNSUBSCRIBE_SECRET, scanId)}`;
}
export const signUpUrl = () => `${SITE}/account`;

const page = (status, heading, body, extra = '') => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827"><div style="max-width:520px;margin:48px auto;padding:0 16px"><div style="background:#fff;border-radius:12px;overflow:hidden">
<div style="background:#15803d;color:#fff;padding:18px 28px;font-size:18px;font-weight:700">MyPrivacyTOOL</div><div style="padding:28px"><h1 style="margin:0 0 12px;font-size:22px;line-height:28px">${esc(heading)}</h1><p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#374151">${esc(body)}</p>${extra}
<p style="margin:20px 0 0;font-size:13px;line-height:20px;color:#6b7280">Questions? Write to <a href="mailto:hello@myprivacytool.io" style="color:#6b7280">hello@myprivacytool.io</a>.</p></div></div></div></body></html>`,
{ status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

/** GET /api/keep?s=&t= shows a confirm button; POST keeps the scan (no deadline, never purged). 404 unless FREE_RECORD_DELETION_ENABLED is "true". */
export async function handleKeep(env, request, url, { sb }) {
  if (!freeRecordEnabled(env)) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Not found', { status: 404 });
  const scanId = url.searchParams.get('s') || '';
  if (!/^[0-9a-f-]{36}$/i.test(scanId) || !(await verifyKeep(env.UNSUBSCRIBE_SECRET, scanId, url.searchParams.get('t')))) {
    return page(400, 'This link is not valid', 'The link may be incomplete or out of date. If your scan was already deleted, it is gone and nothing can be restored.');
  }
  if (request.method === 'GET') {
    return page(200, 'Keep my scan?', 'If you keep it, we do not delete your scan and you can come back to see what changed. No account is needed. If you would rather it went, do nothing: it is deleted at the time in the email.',
      `<form method="POST" action="/api/keep?s=${encodeURIComponent(scanId)}&amp;t=${encodeURIComponent(url.searchParams.get('t'))}"><button type="submit" style="background:#15803d;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">Keep my scan</button></form>`);
  }
  try {
    const out = await sb.rpc('mpt_keep_scan', { p_scans_id: scanId });
    const kept = out === true || out?.kept === true || out?.[0]?.kept === true || out?.mpt_keep_scan?.kept === true;
    return kept ? page(200, 'Your scan is kept', 'We will not delete it, and we will not send the deletion countdown again. You can ask us to delete it any time.')
      : page(200, 'Nothing to keep', 'We could not find that scan. It may already have been deleted, and a deleted scan cannot be restored.');
  } catch (e) { console.error('keep not recorded:', e?.status || 'error'); return page(500, 'Something went wrong', 'Nothing was changed. Please try the link again in a minute.'); }
}

// ---- the emails (DRAFT COPY for Chris, honest tone) -----------------------------------------------------------------------------------------
const WHEN = (iso) => { const d = new Date(iso); return `${d.toISOString().slice(11, 16)} UTC on ${d.toISOString().slice(0, 10)}`; };

export function buildCountdownEmail({ stage, deleteAfter, keepLink, signUpLink, unsubscribeLink }) {
  const when = WHEN(deleteAfter);
  const subject = stage === '24h' ? 'We delete your privacy scan tomorrow' : 'Your privacy scan is deleted in 4 hours';
  const lead = stage === '24h'
    ? `We delete your scan at ${when}, as our policy says. Keep it or sign up if you want it to stay. If you see no value in it, we understand: thanks, and goodbye.`
    : `This is the last reminder: your scan is deleted in 4 hours, at ${when}. Keep it or sign up if you want it to stay. Otherwise there is nothing to do.`;
  const detail = 'If you keep it, no account is needed and you can come back to see what changed. If you sign up, we keep it as part of your account. If you do neither, everything we hold about you from this scan is deleted, and we will not know who you are afterwards.';
  const text = [lead, '', detail, '', `Keep my scan: ${keepLink}`, `Sign up: ${signUpLink}`, '', 'MyPrivacyTOOL', ...(unsubscribeLink ? ['', `Unsubscribe from all our emails: ${unsubscribeLink}`] : [])].join('\n');
  const html = shell(subject, lead, `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">${esc(subject)}</h1>${para(esc(lead))}${para(esc(detail))}${button(keepLink, 'Keep my scan')}${button(signUpLink, 'Sign up')}`, unsubscribeLink);
  return { subject, text: tagLinks(text, `deletion-${stage}`), html: tagLinks(html, `deletion-${stage}`, { html: true }) };
}

export function buildDeletedEmail() {
  const subject = 'Your privacy scan is deleted';
  const lead = 'Done: we deleted your scan and everything we held about you from it. You are welcome to reply, but we will not know who you are, so we cannot look anything up. This is the last email you will get from this scan.';
  const text = [lead, '', 'MyPrivacyTOOL'].join('\n');
  return { subject, text, html: shell(subject, lead, `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">${esc(subject)}</h1>${para(esc(lead))}`, null) };
}

// ---- HubSpot: expired records are deleted there too (GDPR delete = permanent). A contact is never created for a non-signed-up user. --------------
export async function deleteHubSpotContact(env, email, fetchImpl = undefined, rctx = undefined) {
  if (!env.HUBSPOT_TOKEN) return { skipped: 'no HUBSPOT_TOKEN' };
  try {
    const res = await callRecipient('hubspot', { url: 'https://api.hubapi.com/crm/v3/objects/contacts/gdpr-delete', sent: ['email'], init: {
      method: 'POST', headers: { Authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId: email, idProperty: 'email' }),
    } }, rcx(env, fetchImpl, rctx));
    if (res.ok || res.status === 404) return { deleted: res.ok };   // 404 = there was no contact: nothing to delete
    return { failed: `hubspot delete ${res.status}` };
  } catch (e) { return { failed: 'hubspot delete error' }; }
}

// ---- the job ----------------------------------------------------------------------------------------------------------------------------------
/** Every 5-minute tick: (1) claim and send the countdown emails, (2) purge what is due, (3) T-0 mail + HubSpot delete for each deleted address. Counts only in the result and the log. */
export async function runFreeRecordJob(env, fetchImpl = undefined, { allowed = () => true, limit = 20 } = {}) {
  if (!freeRecordEnabled(env) || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'FREE_RECORD_DELETION_ENABLED is not "true"' };
  const sb = db(env, fetchImpl);
  const out = { countdown_sent: 0, countdown_skipped: 0, countdown_failed: 0, purged: 0, deleted_mail_sent: 0, hubspot_deleted: 0, hubspot_failed: 0 };
  const noMail = async (email) => !allowed(env, email) || (await suppressedAmong(sb, [email])).has(String(email).trim().toLowerCase());

  if (env.UNSUBSCRIBE_SECRET) {
    const claimed = (await sb.rpc('mpt_claim_deletion_notices', { p_limit: limit })) || [];
    for (const n of claimed) {
      try {
        if (await noMail(n.email)) { out.countdown_skipped++; continue; }
        const mail = buildCountdownEmail({ stage: n.stage, deleteAfter: n.delete_after, keepLink: await keepUrl(env, n.scans_id), signUpLink: signUpUrl(), unsubscribeLink: null });
        const r = await sendEmail(env, { to: n.email, ...mail, idempotencyKey: `deletion-${n.stage}-${n.scans_id}`, items: ['email'] }, fetchImpl);
        if (!r.sent) { await sb.rpc('mpt_release_deletion_notice', { p_scans_id: n.scans_id, p_stage: n.stage }); throw new Error(`countdown email not sent: ${r.reason}`); }
        out.countdown_sent++;
      } catch (e) { out.countdown_failed++; console.error('deletion countdown failed:', String(e).replace(/\S+@\S+/g, '[email]')); }
    }
  }

  const purge = await sb.rpc('mpt_purge_free_records', { p_dry_run: false, p_overdue: '0 seconds' });
  const res = Array.isArray(purge) ? purge[0]?.mpt_purge_free_records ?? purge[0] : purge?.mpt_purge_free_records ?? purge;
  out.purged = Number(res?.scans || 0);
  for (const email of res?.notify || []) {   // the only moment these addresses exist outside the deleted rows; nothing here is stored or logged
    const hs = await deleteHubSpotContact(env, email, fetchImpl);
    if (hs.deleted) out.hubspot_deleted++; else if (hs.failed) out.hubspot_failed++;
    try {
      if (env.UNSUBSCRIBE_SECRET && !(await noMail(email))) {
        const r = await sendEmail(env, { to: email, ...buildDeletedEmail(), idempotencyKey: `deleted-${await hmac(env.UNSUBSCRIBE_SECRET, `deleted:${email.toLowerCase()}:${res.ran_at}`)}`, items: ['email'] }, fetchImpl);
        if (r.sent) out.deleted_mail_sent++;
      }
    } catch { /* best effort: the deletion has already happened */ }
  }
  console.log(`free-record deletion: ${JSON.stringify(out)}`);   // counts only
  return out;
}
