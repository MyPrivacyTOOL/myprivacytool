// MPC-7554: follow-up emails driven by what was found for THIS address, for every user (not a cohort), and a way to say "I have fixed this".
// Behind FOLLOWUP_STATE_ENABLED = "true" (needs migration 20261028150000_mpc_7554_followup_state.sql: scans.fixed_at, scans.followup_ended). Off = the earlier calendar behaviour.
//
// STATE per report, computed (nothing guessed):
//   unsubscribed   THE opt-out (users flag OR email_suppressions) is set                                  -> no follow-up, ever
//   fixed          the person pressed "I have fixed this" (scans.fixed_at)                                  -> no more follow-ups; still subscribed to everything else
//   findings       at least one hexagon is FOUND for this address (saved web scan, or an email check)      -> day 3 names the top findings, one next step each
//   nothing_found  no hexagon is FOUND                                                                      -> day 3 is a shorter, different email; no upsell
// Day 7 asks for feedback in both live states. No email in any state sells anything: there is no upsell copy to leave out or put in.
import { shell, para, tagLinks, SIGN_OFF } from './email.js';
import { loadWebScan } from './webScanLoader.js';
import { WEB_HEXAGONS, EMAIL_HEXAGONS, normaliseHexagons, STATUS, changeFor, guideUrl, MAX_VALUE } from './reportHex.js';
import { hmac } from './onboarding.js';

export const followupStateEnabled = (env) => env.FOLLOWUP_STATE_ENABLED === 'true';
export const STATES = ['unsubscribed', 'fixed', 'findings', 'nothing_found'];
export const MAX_FINDINGS = 3;
const SITE = 'https://myprivacytool.io';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// An IP address never appears in an email body (it can be forwarded or screenshotted); the same rule as the report (reportHex.js).
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}|::[0-9a-f:.]+/gi;
const short = (v) => { const a = Array.from(String(v ?? '').replace(IP_RE, '[IP address in your report file]').trim()); return a.slice(0, MAX_VALUE).join('') + (a.length > MAX_VALUE ? '…' : ''); };

/** unsubscribed beats fixed beats findings. `optedOut` = THE opt-out. */
export function reportState({ optedOut, fixedAt, foundCount }) {
  if (optedOut) return 'unsubscribed';
  if (fixedAt) return 'fixed';
  return foundCount > 0 ? 'findings' : 'nothing_found';
}

/**
 * The FOUND hexagons for one report, ranked: risk hexagons before informational ones, email findings before web findings, then registry order.
 * Source of truth is the same data the report used: the saved web scan (re-checked against the registry) and the email checks written to `signals`.
 */
export async function loadFindings(sb, scanId) {
  const out = [];
  const web = await loadWebScan(sb, scanId);
  if (web) for (const h of normaliseHexagons(WEB_HEXAGONS, web.hexagons)) if (h.status === STATUS.FOUND) out.push({ ...h, source: 'web' });
  let rows = [];
  try { rows = (await sb.select(`signals?scan_id=eq.${encodeURIComponent(scanId)}&check_status=eq.found&select=signal_type,details`)) || []; } catch { rows = []; }
  const breaches = rows.filter((r) => String(r.signal_type).startsWith('breach:'));
  if (breaches.length) out.push({ id: 'email-breaches', label: 'Data breaches', category: 'email', kind: 'risk', status: STATUS.FOUND, value: `${breaches.length} known ${breaches.length === 1 ? 'breach' : 'breaches'}: ${breaches.slice(0, 3).map((r) => String(r.signal_type).slice(7)).join(', ')}`, source: 'email' });
  for (const def of EMAIL_HEXAGONS) {
    const r = rows.find((x) => x.signal_type === def.id);
    if (r && def.id !== 'email-breaches') out.push({ ...def, status: STATUS.FOUND, value: r.details || '', source: 'email' });
  }
  const rank = (h) => (h.kind === 'risk' ? 0 : 2) + (h.source === 'email' ? 0 : 1);
  return out.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map((x) => x.h);
}

// ---- the "I have fixed this" link: signed per scan, GET only shows a page (mail scanners open links), POST records it ----------------------------
export const fixedToken = (secret, scanId) => hmac(secret, `fixed:${String(scanId).toLowerCase()}`);
export async function verifyFixed(secret, scanId, token) {
  if (!secret || !scanId || !token) return false;
  const want = await fixedToken(secret, scanId);
  if (want.length !== String(token).length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ String(token).charCodeAt(i);
  return d === 0;
}
export async function fixedUrl(env, scanId) {
  const base = env.PUBLIC_URL || 'https://mpt-scan-report.myprivacytool.workers.dev';
  return `${base}/api/fixed?s=${encodeURIComponent(scanId)}&t=${await fixedToken(env.UNSUBSCRIBE_SECRET, scanId)}`;
}

const page = (status, heading, body, extra = '') => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(heading)} | MyPrivacyTOOL</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827"><div style="max-width:520px;margin:48px auto;padding:0 16px"><div style="background:#fff;border-radius:12px;overflow:hidden">
<div style="background:#15803d;color:#fff;padding:18px 28px;font-size:18px;font-weight:700">MyPrivacyTOOL</div><div style="padding:28px"><h1 style="margin:0 0 12px;font-size:22px;line-height:28px">${esc(heading)}</h1><p style="margin:0 0 16px;font-size:15px;line-height:23px;color:#374151">${body}</p>${extra}
<p style="margin:20px 0 0;font-size:13px;line-height:20px;color:#6b7280">Questions? Write to <a href="mailto:hello@myprivacytool.io" style="color:#6b7280">hello@myprivacytool.io</a>. <a href="${SITE}/" style="color:#6b7280">myprivacytool.io</a></p></div></div></div></body></html>`,
{ status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

/** GET shows a confirm button; POST records scans.fixed_at (and ends the follow-ups for that report). It never touches the opt-out. */
export async function handleFixed(env, request, url, { sb }) {
  if (!followupStateEnabled(env)) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Not found', { status: 404 });
  const scanId = url.searchParams.get('s') || '';
  if (!/^[0-9a-f-]{36}$/i.test(scanId) || !(await verifyFixed(env.UNSUBSCRIBE_SECRET, scanId, url.searchParams.get('t')))) {
    return page(400, 'This link is not valid', 'The link may be incomplete or out of date. You do not need to do anything: you can also unsubscribe from the email at any time.');
  }
  if (request.method === 'GET') {
    return page(200, 'Fixed what was in your report?', 'Confirm and we will stop the follow-up emails about this report. You stay subscribed to nothing else and nothing else changes; if you want no email from us at all, use the unsubscribe link in any of our emails.',
      `<form method="POST" action="/api/fixed?s=${encodeURIComponent(scanId)}&amp;t=${encodeURIComponent(url.searchParams.get('t'))}"><button type="submit" style="background:#15803d;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer">Yes, I have fixed this</button></form>`);
  }
  try {
    await sb.patch(`scans?id=eq.${scanId}`, { fixed_at: new Date().toISOString(), followup_ended: 'fixed', followup_stage: 2 });
    return page(200, 'Thank you', 'We will not send you any more follow-up emails about this report. Nothing else has changed.');
  } catch (e) { console.error('fixed not recorded:', e?.status || 'error'); return page(500, 'Something went wrong', 'Nothing was changed. Please try the link again in a minute.'); }
}

// ---- the emails ------------------------------------------------------------------------------------------------------------------------------
/**
 * DRAFT COPY for Chris to approve. `findings` = ranked FOUND list (any length); only the first MAX_FINDINGS are named, with their one next step each.
 * stage 1 = day 3, stage 2 = day 7. `state` is 'findings' or 'nothing_found'. Every link to our own site is tagged for GA4; the unsubscribe and fixed links are not.
 */
export function buildFollowUpEmailV2({ stage, state, findings = [], notChecked = null, fixedLink, unsubscribeLink, cohortNumber = null }) {
  const top = findings.slice(0, MAX_FINDINGS);
  const more = Math.max(0, findings.length - top.length);
  const campaign = `followup-${stage === 1 ? '3d' : '7d'}`;
  const founding = cohortNumber && cohortNumber <= 100 ? `You are one of our first 100 users, so your feedback shapes what we build next.` : '';
  const fixedLabel = state === 'findings' ? 'I have fixed this' : 'Stop these follow-ups';
  const foot = `You are getting this because you requested a privacy scan. ${fixedLabel} (this stops follow-ups about this report only): ${fixedLink}\nUnsubscribe from all our emails: ${unsubscribeLink}`;
  let subject; let lines; let body;
  if (stage === 1 && state === 'findings') {
    subject = 'What your privacy report found, and what to do about it';
    const items = top.map((h) => ({ title: `${h.label}${h.value ? `: ${short(h.value)}` : ''}`, step: changeFor(h), url: guideUrl(h, { campaign }), urlHtml: guideUrl(h, { html: true, campaign }) }));
    lines = [`A few days ago we sent your privacy report. Here ${top.length === 1 ? 'is the one thing it found' : `are the ${top.length} things it found that matter most`} for you, and what to do about ${top.length === 1 ? 'it' : 'each'}:`, '',
      ...items.flatMap((it, i) => [`  ${i + 1}. ${it.title}`, `     What to do: ${it.step}`, `     Guide: ${it.url}`, '']),
      ...(more ? [`Your report lists ${more} more ${more === 1 ? 'finding' : 'findings'}; the list starts with the ones above.`, ''] : []),
      'Anything marked NOT CHECKED in your report means we could not look, not that it is clear.', ...(founding ? ['', founding] : [])];
    body = `<p>A few days ago we sent your privacy report. Here ${top.length === 1 ? 'is the one thing it found' : `are the ${top.length} things it found that matter most`} for you, and what to do about ${top.length === 1 ? 'it' : 'each'}:</p>
<ol>${items.map((it) => `<li><strong>${esc(it.title)}</strong><br>What to do: ${esc(it.step)} <a href="${it.urlHtml}">Guide</a></li>`).join('')}</ol>
${more ? `<p>Your report lists ${more} more ${more === 1 ? 'finding' : 'findings'}; the list starts with the ones above.</p>` : ''}<p>Anything marked NOT CHECKED in your report means we could not look, not that it is clear.</p>${founding ? `<p>${esc(founding)}</p>` : ''}`;
  } else if (stage === 1) {
    subject = 'Your privacy report: nothing to fix right now';
    lines = ['Your privacy report found nothing that needs fixing: none of the checks we ran turned up a finding for you.', '',
      `That is not the same as "safe". ${notChecked ? `${notChecked} of the hexagons in your report are marked NOT CHECKED, which means we could not look, not that they are clear.` : 'Anything marked NOT CHECKED in your report means we could not look, not that it is clear.'}`, '',
      'There is nothing you need to do. If you ever want a fresh look, you can run the scan again at https://myprivacytool.io/.', ...(founding ? ['', founding] : [])];
    body = `<p>Your privacy report found nothing that needs fixing: none of the checks we ran turned up a finding for you.</p>
<p>That is not the same as &ldquo;safe&rdquo;. ${notChecked ? `${notChecked} of the hexagons in your report are marked NOT CHECKED, which means we could not look, not that they are clear.` : 'Anything marked NOT CHECKED in your report means we could not look, not that it is clear.'}</p>
<p>There is nothing you need to do. If you ever want a fresh look, you can <a href="${SITE}/">run the scan again</a>.</p>${founding ? `<p>${esc(founding)}</p>` : ''}`;
  } else {
    subject = 'Was your privacy report useful?';
    lines = ['It has been a week since your privacy report. We would like to know what to improve.', '',
      state === 'findings' ? 'If you have fixed what it found, press "I have fixed this" below and we will not write again about this report.' : 'Nothing was found, so there is nothing to fix.', '',
      'Reply to this email with one thing that was useful and one thing that was missing. A person reads every reply.', ...(founding ? ['', founding] : [])];
    body = `<p>It has been a week since your privacy report. We would like to know what to improve.</p>
<p>${state === 'findings' ? 'If you have fixed what it found, press &ldquo;I have fixed this&rdquo; below and we will not write again about this report.' : 'Nothing was found, so there is nothing to fix.'}</p>
<p>Reply to this email with one thing that was useful and one thing that was missing. A person reads every reply.</p>${founding ? `<p>${esc(founding)}</p>` : ''}`;
  }
  const text = [...lines, '', ...SIGN_OFF, '', foot].join('\n').replace(/\n{3,}/g, '\n\n');
  const styled = body.replace(/<p>/g, '<p style="margin:0 0 12px 0;font-size:15px;line-height:23px;color:#374151">')
    .replace(/<ol>/g, '<ol style="margin:0 0 12px 0;padding-left:22px;font-size:15px;line-height:23px;color:#374151">').replace(/<li>/g, '<li style="margin-bottom:10px">');
  const html = shell(subject, subject, `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">${esc(subject)}</h1>
${styled}
<p style="margin:0 0 16px 0;font-size:15px;line-height:23px"><a href="${esc(fixedLink)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#15803d;color:#ffffff;text-decoration:none;font-weight:600">${fixedLabel}</a><br><span style="font-size:12px;color:#6b7280">Stops these follow-up emails only. Everything else stays as it is.</span></p>
${para(`<strong>${SIGN_OFF[0]}</strong><br>${SIGN_OFF[1]}`)}`, unsubscribeLink);
  return { subject, text: tagLinks(text, campaign), html: tagLinks(html, campaign, { html: true }) };
}
