const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://myprivacytool.io';

// The confirmation may only promise what buildReportEmail delivers. Keep the two in sync.
// DRAFT COPY (free version, no paid breach API): Chris must approve before any real-user send.
export function buildConfirmationEmail() {
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
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
<h2>We received your privacy scan request</h2>
<p>Within <strong>48 hours</strong> we will email you a report that includes:</p>
<ul><li>Step-by-step removal instructions for five people-search sites: Spokeo, Whitepages, BeenVerified, MyLife and Intelius</li>
<li>A link and short guide to check, free, whether your email address appears in known data breaches</li></ul>
<p><strong>What the report does not do yet:</strong> we do not look you up on those sites or in breach databases for you, and we do not give a privacy score until we can check something about you. Where we have not checked, the report says &ldquo;not yet checked&rdquo; rather than guess.</p>
<p>Reply to this email with any questions, or to ask us to delete your data.</p>
<p>The MyPrivacyTOOL team</p>
<hr style="border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#999">MyPrivacyTOOL &middot; myprivacytool.io</p>
</body></html>`;
  return { subject, text, html };
}

export function buildReportEmail({ scan, breaches, breachStatus, brokers }) {
  const s = scan;
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
    'EMAIL BREACHES', ...breachLines, '',
    'PEOPLE-SEARCH SITES', ...brokerLines, '',
    `More removal guides: ${SITE}/opt-out`, 'Reply to this email to ask a question or have your data deleted.',
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111">
<h2>${s.score === null ? 'Your privacy report' : `Your privacy score: ${s.score}/100 <small style="color:#666">(${esc(s.risk_level)} exposure)</small>`}</h2>
<p style="background:#f4f4f5;padding:10px;border-radius:6px">${esc(partialNote)}</p>
<h3>Email breaches</h3>${breachStatus !== 'checked' ? '<p>Not yet checked by us. <a href="https://haveibeenpwned.com">Check your own address free at haveibeenpwned.com</a> (10 seconds). If it appears, change the password on that service and anywhere you reused it, and turn on two-factor sign-in.</p>'
    : breaches.length === 0 ? '<p>Your email address was not found in any breach known to Have I Been Pwned.</p>'
    : `<ul>${breaches.map((b) => `<li><strong>${esc(b.Name)}</strong> (${esc((b.BreachDate || '').slice(0, 7))}): ${esc((b.DataClasses || []).join(', '))}</li>`).join('')}</ul><p>Change the password on any listed service, and anywhere you reused it.</p>`}
<h3>People-search sites</h3><p>We have <strong>not yet checked</strong> these sites for you. Search for yourself and remove your listing:</p>
${brokers.map((b) => `<div style="margin:12px 0"><strong>${esc(b.name)}</strong> &mdash; not yet checked<br>
${b.removal_url ? `<a href="${esc(b.removal_url)}">Official opt-out page</a> &middot; ${esc(b.time_needed || '')} &middot; ${esc(b.processing_time || '')}
${b.steps ? `<ol>${b.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>` : ''}` : `We have not yet written a verified removal guide for ${esc(b.name)}.`}</div>`).join('')}
<p><a href="${SITE}/opt-out">More removal guides</a></p>
<p style="font-size:12px;color:#999">Reply to this email to ask a question or have your data deleted. MyPrivacyTOOL &middot; myprivacytool.io</p>
</body></html>`;
  return { subject, text, html };
}

export async function sendEmail(env, { to, subject, html, text, idempotencyKey }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'MyPrivacyTOOL <hello@myprivacytool.io>', to: [to], reply_to: env.EMAIL_REPLY_TO || undefined, subject, html, text }),
  });
  if (!res.ok) return { sent: false, reason: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 150)}` };
  const j = await res.json().catch(() => ({}));
  return { sent: true, id: j.id || null };
}
