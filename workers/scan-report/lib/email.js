const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://myprivacytool.io';

// MPC-7406 follow-up: shared HTML shell for the transactional emails. Table layout with inline styles only (mail apps strip <style>
// and scripts), 600px max width, system fonts, light/dark safe colours. The plain-text parts are unchanged.
const BRAND = '#15803d';
const CONTACT = 'hello@myprivacytool.io';
const shell = (title, preheader, inner, unsubscribeLink) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px">MyPrivacyTOOL</td></tr>
<tr><td style="padding:28px 28px 8px 28px">${inner}</td></tr>
<tr><td style="padding:20px 28px 28px 28px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#6b7280">Questions, or want your data deleted? Reply to this email or write to <a href="mailto:${CONTACT}" style="color:#6b7280">${CONTACT}</a>. We never sell your data.<br>${unsubscribeLink ? `<a href="${esc(unsubscribeLink)}" style="color:#6b7280">Unsubscribe</a> from further emails &middot; ` : ''}MyPrivacyTOOL &middot; <a href="${SITE}/" style="color:#6b7280">myprivacytool.io</a></td></tr>
</table></td></tr></table></body></html>`;
const h2 = (t) => `<h2 style="margin:28px 0 10px 0;font-size:18px;line-height:24px;color:#111827">${t}</h2>`;
const para = (t) => `<p style="margin:0 0 12px 0;font-size:15px;line-height:23px;color:#374151">${t}</p>`;
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px 0"><tr><td style="background:${BRAND};border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${label}</a></td></tr></table>`;

// The confirmation may only promise what buildReportEmail delivers. Keep the two in sync.
// DRAFT COPY (free version, no paid breach API): Chris must approve before any real-user send.
export function buildConfirmationEmail({ unsubscribeLink } = {}) {
  const subject = 'We received your privacy scan request';
  const text = [
    'Thanks for requesting a privacy scan from MyPrivacyTOOL.',
    '',
    'Within 48 hours we will email you a report that includes:',
    '  - Step-by-step removal instructions for five people-search sites: Spokeo, Whitepages, BeenVerified, MyLife and Intelius',
    '  - A link and short guide to check, free, whether your email address appears in known data breaches',
    '',
    'What the report does not do yet: we do not look you up on those sites or in breach databases for you,',
    'and we do not give a privacy score until we can check something about you. Where we have not checked,',
    'the report says "not yet checked" rather than guess.',
    '',
    'You can reply to this email with any questions, or ask us to delete your data at any time.',
    '',
    'The MyPrivacyTOOL team',
    ...(unsubscribeLink ? ['', `Unsubscribe from further emails: ${unsubscribeLink}`] : []),
  ].join('\n');
  const html = shell(subject, 'We will email your report within 48 hours.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">We received your privacy scan request</h1>
${para('Within <strong>48 hours</strong> we will email you a report that includes:')}
<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:23px;color:#374151">
<li style="margin-bottom:6px">Step-by-step removal instructions for five people-search sites: Spokeo, Whitepages, BeenVerified, MyLife and Intelius</li>
<li>A link and short guide to check, free, whether your email address appears in known data breaches</li></ul>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;font-size:14px;line-height:21px;color:#374151"><strong>What the report does not do yet:</strong> we do not look you up on those sites or in breach databases for you, and we do not give a privacy score until we can check something about you. Where we have not checked, the report says &ldquo;not yet checked&rdquo; rather than guess.</td></tr></table>
${para('<br>Reply to this email with any questions, or to ask us to delete your data.')}
${para('The MyPrivacyTOOL team')}`, unsubscribeLink);
  return { subject, text, html };
}

export function buildReportEmail({ scan, breaches, breachStatus, brokers, mirror, unsubscribeLink }) {
  const s = scan;
  const mirrorLines = mirror ? mirror.hexagons.map((h) => `- ${h.label}: ${h.status === 'checked' ? `checked, ${h.score}/100` : 'not yet checked'}`) : [];
  const partialNote = s.score === null
    ? 'No privacy score yet: we have not been able to check anything about you automatically, so we will not invent a number.'
    : s.partial
    ? `Partial score: based on ${s.categories_checked.length} of 8 categories (${s.categories_checked.join(', ') || 'none'}). Not yet checked: ${s.hexagons.filter((h) => !h.checked).map((h) => h.label).join('; ')}.`
    : 'Score covers all 8 categories.';
  const breachLines = breachStatus !== 'checked'
    ? ['Breach check: not yet checked by us. Check your own address free at https://haveibeenpwned.com (10 seconds). If it appears, change the password on that service and anywhere you reused it, and turn on two-factor sign-in.']
    : breaches.length === 0
      ? ['Good news: your email address was not found in any breach known to Have I Been Pwned.']
      : breaches.map((b) => `- ${b.Name} (${(b.BreachDate || '').slice(0, 7) || 'date unknown'}): exposed ${(b.DataClasses || []).join(', ')}`);
  const brokerLines = brokers.map((b) => {
    const head = `${b.name}: not yet checked. ${b.reason}.`;
    if (!b.removal_url && !b.steps) return `${head}\n  We have not yet written a verified removal guide for ${b.name}.`;
    return `${head}\n  Remove yourself: ${b.removal_url} (${b.time_needed || 'a few minutes'}; ${b.processing_time || 'timing varies'})\n` +
      (b.steps ? b.steps.map((st, i) => `   ${i + 1}. ${st}`).join('\n') : '');
  });
  const subject = s.score === null ? 'Your MyPrivacyTOOL privacy report' : `Your MyPrivacyTOOL privacy report: ${s.score}/100${s.partial ? ' (partial)' : ''}`;
  const text = [
    s.score === null ? 'Your privacy report' : `Your privacy score: ${s.score}/100 (${s.risk_level} exposure)`, partialNote, '',
    ...(mirror ? ['YOUR MIRROR (what we could and could not see)', ...mirrorLines, ''] : []),
    'EMAIL BREACHES', ...breachLines, '',
    'PEOPLE-SEARCH SITES', ...brokerLines, '',
    `More removal guides: ${SITE}/opt-out`, 'Reply to this email to ask a question or have your data deleted.',
    ...(unsubscribeLink ? ['', 'Fixed what is in this report? Then you do not need to hear from us again.', `Unsubscribe and we will send you no more follow-up or marketing emails: ${unsubscribeLink}`] : []),
  ].join('\n');
  const status = (h) => h.status === 'checked'
    ? `<span style="color:#15803d;font-weight:600">${h.score}/100</span>`
    : '<span style="color:#6b7280">Not yet checked</span>';
  const mirrorCells = mirror ? mirror.hexagons.map((h) => `<td width="50%" valign="top" style="padding:0 6px 12px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;font-size:13px;line-height:19px"><div style="color:#111827;font-weight:600">${esc(h.label)}</div><div>${status(h)}</div></td></tr></table></td>`) : [];
  const mirrorRows = [];
  for (let k = 0; k < mirrorCells.length; k += 2) mirrorRows.push(`<tr>${mirrorCells[k]}${mirrorCells[k + 1] || '<td width="50%"></td>'}</tr>`);
  const headline = s.score === null ? 'Your privacy report' : `Your privacy score: ${s.score}/100`;
  const brokerCards = brokers.map((b) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0"><tr><td style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px">
<div style="font-size:15px;font-weight:700;color:#111827">${esc(b.name)} <span style="margin-left:6px;background:#f3f4f6;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;color:#6b7280">Not yet checked</span></div>
${b.removal_url ? `<div style="margin:6px 0 4px 0;font-size:13px;color:#6b7280">${esc(b.time_needed || '')}${b.time_needed && b.processing_time ? ' &middot; ' : ''}${esc(b.processing_time || '')}</div>
${b.steps ? `<ol style="margin:8px 0 10px 0;padding-left:20px;font-size:14px;line-height:21px;color:#374151">${b.steps.map((st) => `<li style="margin-bottom:4px">${esc(st)}</li>`).join('')}</ol>` : ''}${button(b.removal_url, 'Open the official opt-out page')}`
    : `<div style="margin-top:6px;font-size:14px;color:#6b7280">We have not yet written a verified removal guide for ${esc(b.name)}.</div>`}
</td></tr></table>`).join('');
  const html = shell(subject, s.score === null ? 'No score yet: we only show what we actually checked.' : `Your score: ${s.score}/100`,
    `<h1 style="margin:0 0 14px 0;font-size:24px;line-height:30px;color:#111827">${headline}${s.score === null ? '' : ` <span style="font-size:14px;font-weight:500;color:#6b7280">(${esc(s.risk_level)} exposure)</span>`}</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;font-size:14px;line-height:21px;color:#14532d">${esc(partialNote)}</td></tr></table>
${mirror ? `${h2('Your mirror <span style="font-size:13px;font-weight:500;color:#6b7280">what we could and could not see</span>')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;width:calc(100% + 12px)">${mirrorRows.join('')}</table>` : ''}
${h2('Email breaches')}${breachStatus !== 'checked' ? `${para('Not yet checked by us. Check your own address free (about 10 seconds). If it appears, change the password on that service and anywhere you reused it, and turn on two-factor sign-in.')}${button('https://haveibeenpwned.com', 'Check on haveibeenpwned.com')}`
    : breaches.length === 0 ? para('Good news: your email address was not found in any breach known to Have I Been Pwned.')
    : `<ul style="margin:0 0 12px 0;padding-left:20px;font-size:14px;line-height:21px;color:#374151">${breaches.map((b) => `<li style="margin-bottom:4px"><strong>${esc(b.Name)}</strong> (${esc((b.BreachDate || '').slice(0, 7) || 'date unknown')}): exposed ${esc((b.DataClasses || []).join(', '))}</li>`).join('')}</ul>${para('Change the password on any listed service, and anywhere you reused it.')}`}
${h2('People-search sites')}${para('We have <strong>not yet checked</strong> these sites for you. Search for yourself and remove your listing:')}
${brokerCards}
${para(`<a href="${SITE}/opt-out" style="color:${BRAND}">More removal guides</a>`)}
${unsubscribeLink ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px 0"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;font-size:14px;line-height:21px;color:#14532d"><strong>Fixed what is in this report?</strong> Then you do not need to hear from us again. <a href="${esc(unsubscribeLink)}" style="color:${BRAND};font-weight:600">Unsubscribe</a> and we will send you no more follow-up or marketing emails.</td></tr></table>` : ''}`, unsubscribeLink);
  return { subject, text, html };
}

export async function sendEmail(env, { to, subject, html, text, idempotencyKey, headers }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'MyPrivacyTOOL <hello@myprivacytool.io>', to: [to], reply_to: env.EMAIL_REPLY_TO || undefined, subject, html, text, headers: headers || undefined }),
  });
  if (!res.ok) return { sent: false, reason: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 150)}` };
  const j = await res.json().catch(() => ({}));
  return { sent: true, id: j.id || null };
}
