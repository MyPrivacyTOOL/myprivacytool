// MPC-7261: first-100 onboarding follow-ups. Copy is DRAFT for Chris to approve; every line is true today
// (same rule as the confirmation email: do not promise anything the report does not deliver).
import { shell, para, tagLinks, SIGN_OFF } from './email.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 24 * 3600 * 1000;
export const FOLLOWUP_DELAYS_MS = [3 * DAY, 7 * DAY];      // stage 1 at +3 days, stage 2 at +7 days after the report
export const COHORT_SIZE = 100;

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
export const unsubscribeToken = (secret, email) => hmac(secret, `unsub:${String(email).toLowerCase()}`);
export async function verifyUnsubscribe(secret, email, token) {
  if (!secret || !email || !token) return false;
  const want = await unsubscribeToken(secret, email);
  if (want.length !== String(token).length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ String(token).charCodeAt(i);   // constant-time compare
  return d === 0;
}
// Link shown in email bodies: the branded unsubscribe page on the main site (same signed token as the Worker link below).
export async function unsubscribePageUrl(env, email) {
  const base = env.SITE_URL || 'https://myprivacytool.io';
  return `${base}/unsubscribe?e=${encodeURIComponent(email)}&t=${await unsubscribeToken(env.UNSUBSCRIBE_SECRET, email)}`;
}
// Worker endpoint used by the List-Unsubscribe one-click header (mail apps POST to it directly).
export async function unsubscribeUrl(env, email) {
  const base = env.PUBLIC_URL || 'https://mpt-scan-report.myprivacytool.workers.dev';
  return `${base}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${await unsubscribeToken(env.UNSUBSCRIBE_SECRET, email)}`;
}

// Which stage (1 or 2) is next and due, or 0. A missed stage is never skipped silently into a burst:
// stage 2 is only sent once stage 1 has gone out.
export function nextFollowUp(scan, now = Date.now()) {
  const stage = scan.followup_stage || 0;
  const delay = FOLLOWUP_DELAYS_MS[stage];
  if (delay === undefined || !scan.report_sent_at) return 0;
  return now - new Date(scan.report_sent_at).getTime() >= delay ? stage + 1 : 0;
}

export function buildFollowUpEmail({ stage, mirror, cohortNumber, unsubscribeLink }) {
  const steps = (mirror?.next_steps || []).slice(0, 3);
  const founding = cohortNumber ? `You are one of our first ${COHORT_SIZE} users, so your feedback shapes what we build next.` : '';
  const foot = `You are getting this because you requested a privacy scan. Unsubscribe: ${unsubscribeLink}`;
  let subject; let lines; let htmlBody;
  if (stage === 1) {
    subject = 'Your next privacy step';
    const stepLines = steps.length ? steps.map((s, i) => `  ${i + 1}. ${s.title}${s.url ? `: ${s.url}` : ''}`) : ['  Your report has the full list of steps.'];
    lines = ['A few days ago we sent your privacy report. Here are the most useful next steps from it:', '', ...stepLines, '',
      'Remember: where the report says "not yet checked", we have not looked, so a missing finding is not a clean result.', founding];
    htmlBody = `<p>A few days ago we sent your privacy report. Here are the most useful next steps from it:</p>
<ol>${steps.length ? steps.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.title)}</a>` : esc(s.title)}</li>`).join('') : '<li>Your report has the full list of steps.</li>'}</ol>
<p>Remember: where the report says &ldquo;not yet checked&rdquo;, we have not looked, so a missing finding is not a clean result.</p>${founding ? `<p>${esc(founding)}</p>` : ''}`;
  } else {
    subject = 'Was your privacy report useful?';
    lines = ['It has been a week since your privacy report. We would like to know what to improve.', '',
      'Reply to this email with one thing that was useful and one thing that was missing. A person reads every reply.', founding];
    htmlBody = `<p>It has been a week since your privacy report. We would like to know what to improve.</p>
<p>Reply to this email with one thing that was useful and one thing that was missing. A person reads every reply.</p>${founding ? `<p>${esc(founding)}</p>` : ''}`;
  }
  const text = [...lines, '', ...SIGN_OFF, '', foot].join('\n').replace(/\n{3,}/g, '\n\n');
  const styled = htmlBody
    .replace(/<p>/g, '<p style="margin:0 0 12px 0;font-size:15px;line-height:23px;color:#374151">')
    .replace(/<ol>/g, '<ol style="margin:0 0 12px 0;padding-left:22px;font-size:15px;line-height:23px;color:#374151">')
    .replace(/<li>/g, '<li style="margin-bottom:6px">');
  const html = shell(subject, subject, `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">${esc(subject)}</h1>
${styled}
${para(`<strong>${SIGN_OFF[0]}</strong><br>${SIGN_OFF[1]}`)}`, unsubscribeLink);
  const campaign = `followup-${stage === 1 ? '3d' : '7d'}`;
  return { subject, text: tagLinks(text, campaign), html: tagLinks(html, campaign, { html: true }) };
}
