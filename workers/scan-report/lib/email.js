import { WEB_HEXAGONS, EMAIL_HEXAGONS, normaliseHexagons, emailItems, tally, tallyLine, hexGroups, hexText, buildReportJson } from './reportHex.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://myprivacytool.io';
// Sign-off for the scan, report and follow-up emails: Alice, the AI guide, not an anonymous team.
export const SIGN_OFF = ['Alice', 'Your Dedicated MyPrivacyTOOL AI'];

// MPC-7406 follow-up: shared HTML shell for the transactional emails. Table layout with inline styles only (mail apps strip <style>
// and scripts), 600px max width, system fonts, light/dark safe colours. The plain-text parts are unchanged.

// Campaign tags on links back to our own site, so GA4 can attribute visits to the email that drove them (only for visitors who accept
// cookies; no tracking pixel, no third-party redirect). Skips unsubscribe links, images and anything already tagged. Plain text and HTML.
const OWN_URL = /https:\/\/(?:www\.)?myprivacytool\.io[^\s"'<>)]*/g;
const SKIP_TAG = /\/(?:api\/)?unsubscribe|\/invite#|\/email\/|\.(?:png|jpe?g|gif|svg)(?:[?#]|$)|[?&]utm_/;
export const tagLinks = (str, campaign, { html = false } = {}) => String(str).replace(OWN_URL, (m) => {
  const trail = (m.match(/[.,;:!]+$/) || [''])[0];
  const url = trail ? m.slice(0, -trail.length) : m;
  if (SKIP_TAG.test(url)) return m;
  const [base, hash] = url.split('#');
  const sep = base.includes('?') ? (html ? '&amp;' : '&') : '?';
  return `${base}${sep}utm_source=email${html ? '&amp;' : '&'}utm_medium=email${html ? '&amp;' : '&'}utm_campaign=${campaign}${hash ? `#${hash}` : ''}${trail}`;
});
const tagged = (campaign, { subject, text, html }) => ({ subject, text: tagLinks(text, campaign), html: tagLinks(html, campaign, { html: true }) });
const BRAND = '#15803d';
const CONTACT = 'hello@myprivacytool.io';
export const shell = (title, preheader, inner, unsubscribeLink, { lang = 'en', footer } = {}) => `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px">MyPrivacyTOOL</td></tr>
<tr><td style="padding:28px 28px 8px 28px">${inner}</td></tr>
<tr><td style="padding:20px 28px 28px 28px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#6b7280">${footer ?? `Questions, or want your data deleted? Reply to this email or write to <a href="mailto:${CONTACT}" style="color:#6b7280">${CONTACT}</a>. We never sell your data.<br>${unsubscribeLink ? `<a href="${esc(unsubscribeLink)}" style="color:#6b7280">Unsubscribe</a> from further emails &middot; ` : ''}MyPrivacyTOOL &middot; <a href="${SITE}/" style="color:#6b7280">myprivacytool.io</a>`}</td></tr>
</table></td></tr></table></body></html>`;
// Hexagons: the site draws one each time a bit of data is found out. Email clients strip SVG, so these use the Unicode
// hexagon glyphs: filled = found, outline = nothing found out yet. Same green as the site brand.
const HEX_ON = '\u2B22', HEX_OFF = '\u2B21';
// Hexagon tiles are PNGs hosted next to the Alice artwork (public/email/hex/, built by scripts/hexagon-tiles.html) because mail clients
// strip SVG. Plain-text versions keep the Unicode glyphs above.
const hexSrc = (key, found) => `${SITE}/email/hex/${key}-${found ? 'found' : 'empty'}.png`;
const hexTile = ({ key, label, found = false, href, caption }) => {
  const img = `<img src="${hexSrc(key, found)}" width="150" alt="${esc(label)} hexagon${found ? ' (filled in)' : ''}" style="display:block;width:100%;max-width:150px;height:auto;border:0;margin:0 auto">`;
  return `<td width="33%" align="center" valign="top" style="padding:0 3px 10px 3px">${href ? `<a href="${esc(href)}" style="text-decoration:none">${img}</a>` : img}${caption ? `<div style="margin-top:2px;font-size:12px;line-height:16px;font-weight:600;color:${BRAND}">${caption}</div>` : ''}</td>`;
};
// Staggered honeycomb like the site: rows of 3, 2, 3. Each row is its own table (mixed column counts break table layout), the middle
// row is two thirds wide and centred, and rows 2 and 3 pull up a little so the hexagons nest (clients that ignore negative margins just show a small gap).
const honeycomb = (tiles) => {
  const row = (cells, width, nest) => `<table role="presentation" width="${width}" align="center" cellpadding="0" cellspacing="0" style="width:${width};margin:${nest ? '-22px' : '0'} auto 0 auto"><tr>${cells.join('')}</tr></table>`;
  const cell = (t, w) => t.replace('<td width="33%"', `<td width="${w}"`);
  return `<div style="margin:6px 0 14px 0">${row(tiles.slice(0, 3).map((t) => cell(t, '33%')), '100%', false)}${row(tiles.slice(3, 5).map((t) => cell(t, '50%')), '67%', true)}${row(tiles.slice(5, 8).map((t) => cell(t, '33%')), '100%', true)}</div>`;
};
// Alice, MyPrivacyTOOL's AI guide (artwork from the YouTube stills). Hosted from the site's public/email folder.
// Three looping animations cut from the Alice clips (public/email/alice/*.gif, ~500 KB each, 220px). Mail apps cannot play video, and
// those that do not animate GIFs (some Outlook versions) show the first frame, so each loop starts on its best pose.
const ALICE_POSES = {
  wave: { file: 'alice-wave.gif', alt: 'Alice, MyPrivacyTOOL\u2019s AI guide, drawing back the curtain on green code and waving hello' },
  peek: { file: 'alice-peek.gif', alt: 'Alice, MyPrivacyTOOL\u2019s AI guide, peeking behind the curtain at the green code' },
  twirl: { file: 'alice-twirl.gif', alt: 'Alice, MyPrivacyTOOL\u2019s AI guide, twirling and turning to face you' },
};
const ALICE_TAGLINE = 'Alice looks behind the digital curtain, then shows you what to change.';
const aliceHero = (titleHtml, pose = 'wave') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px 0"><tr>
<td valign="middle" style="padding-right:14px"><h1 style="margin:0 0 8px 0;font-size:26px;line-height:31px;color:#111827">${titleHtml}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px 0"><tr><td width="64" height="4" style="background:${BRAND};font-size:0;line-height:0">&nbsp;</td></tr></table>
<div style="font-size:15px;line-height:22px;color:#374151">${esc(ALICE_TAGLINE)}</div>
<div style="margin-top:8px;font-size:12px;line-height:16px;font-weight:700;color:#111827">With Alice, MyPrivacyTOOL&rsquo;s AI guide</div></td>
<td width="140" valign="middle" align="right"><img src="${SITE}/email/alice/${ALICE_POSES[pose].file}" width="140" height="140" alt="${esc(ALICE_POSES[pose].alt)}" style="display:block;width:140px;height:auto;border:0"></td></tr></table>
`;
const h2 = (t) => `<h2 style="margin:28px 0 10px 0;font-size:18px;line-height:24px;color:#111827">${t}</h2>`;
export const para = (t) => `<p style="margin:0 0 12px 0;font-size:15px;line-height:23px;color:#374151">${t}</p>`;
export const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px 0"><tr><td style="background:${BRAND};border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${label}</a></td></tr></table>`;

// DRAFT COPY: Chris must approve before any real-user send.
// MPC-7469 (B5): the first email promises exactly what the rebuilt report (MPC-7468) delivers, and nothing else: (1) the user's
// web scan findings replayed, (2) what their email address reveals. No username, phone number or address search is promised until
// one exists. Two hexagons, one per report part, replace the old 8 score categories (brokers, social, LinkedIn and so on), which
// the report never checks. Timing: the report job runs every 5 minutes, so "usually within a few minutes" (README).
const CONFIRMATION_PARTS = [
  { key: 'device', label: 'Your browser findings' },
  { key: 'email', label: 'What your email address reveals' },
];
export function buildConfirmationEmail({ unsubscribeLink, liveLink, scanNumber } = {}) {
  const subject = 'Your privacy scan is starting';
  // MPC-7471-F3: the same number, wording and deletion guidance as the report (MPC-7488), only when a scan was really saved with this request.
  const scanNumberLine = scanNumber ? `Your scan number: ${scanNumber}. Quote this number if you want this scan deleted.` : '';
  const text = [
    ALICE_TAGLINE,
    '',
    'Hi,',
    '',
    'I’m Alice, MyPrivacyTOOL’s AI guide. From now on I’m your personal point of contact for your privacy concerns.',
    '',
    'You asked us to look at your privacy exposure, so we’re starting right now.',
    '',
    'MyPrivacyTOOL is a growing suite of AI tools for the places you communicate. We’re starting with two things: your browser and your email address. More channels will follow over time.',
    '',
    'My job is to show you what you look like from the outside: what’s exposed, what it means for you, and what to change first.',
    '',
    ...(liveLink ? ['Watch it live: open your results page and I’ll show each result as I find it. Only you can open this link, because it came to your inbox:', liveLink, ''] : []),
    ...(scanNumberLine ? [scanNumberLine, ''] : []),
    'Here’s what happens next.',
    '',
    'Your report usually arrives within a few minutes. If a check has to be retried, it can take a little longer. It has two parts:',
    '',
    '  1. Your browser findings, replayed. The hexagons that lit up when you ran the web scan on our site, this time with what each one actually found.',
    '  2. What your email address reveals. New hexagons about the one new thing you gave us: your email address.',
    '',
    'Every hexagon shows its honest status: found (with the real value), checked and clear, or not checked. I won’t present a guess as a fact about you. If we have no web scan from you, the report says so and still shows what your email address reveals.',
    '',
    'This email is now our open channel. You can reply anytime with a question, or simply reply with the name of either hexagon below, and we’ll continue the conversation right here. A real person on our team can step in whenever you ask.',
    '',
    'Your report, in two hexagons:',
    ...CONFIRMATION_PARTS.map((p) => `  ${HEX_OFF} ${p.label}`),
    '',
    'Talk soon,',
    ...SIGN_OFF,
    '',
    `${CONTACT}  We never sell your data.`,
    ...(unsubscribeLink ? [`Unsubscribe from further emails: ${unsubscribeLink}`] : []),
  ].join('\n');
  const tiles = CONFIRMATION_PARTS.map((p) => hexTile({ key: p.key, label: p.label, caption: esc(p.label), href: `mailto:${CONTACT}?subject=${encodeURIComponent(`Hexagon: ${p.label}`)}&body=${encodeURIComponent(`Hi, tell me more about: ${p.label}`)}` }).replace('<td width="33%"', '<td width="50%"'));
  const html = shell(subject, 'Your report is on its way: your browser findings, plus what your email address reveals.',
    `${aliceHero('Your privacy scan is starting', 'wave')}
${para('Hi,')}
${para('I&rsquo;m Alice, MyPrivacyTOOL&rsquo;s AI guide. From now on I&rsquo;m your personal point of contact for your privacy concerns.')}
${para('You asked us to look at your privacy exposure, so we&rsquo;re starting right now.')}
${para('MyPrivacyTOOL is a growing suite of AI tools for the places you communicate. We&rsquo;re starting with two things: your browser and your email address. More channels will follow over time.')}
${para('My job is to show you what you look like from the outside: what&rsquo;s exposed, what it means for you, and what to change first.')}
${liveLink ? para('<strong>Watch it live.</strong> Open your results page and I&rsquo;ll show each result as I find it. Only you can open this link, because it came to your inbox.') + button(liveLink, 'Watch my results live') : ''}
${scanNumberLine ? para(esc(scanNumberLine)) : ''}
${h2('Here&rsquo;s what happens next.')}
${para('Your report usually arrives within a few minutes. If a check has to be retried, it can take a little longer. It has two parts:')}
<ol style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:23px;color:#374151">
<li style="margin-bottom:6px"><strong>Your browser findings, replayed.</strong> The hexagons that lit up when you ran the web scan on our site, this time with what each one actually found.</li>
<li><strong>What your email address reveals.</strong> New hexagons about the one new thing you gave us: your email address.</li></ol>
${para('Every hexagon shows its honest status: found (with the real value), checked and clear, or not checked. I won&rsquo;t present a guess as a fact about you. If we have no web scan from you, the report says so and still shows what your email address reveals.')}
${para('This email is now our open channel. You can reply anytime with a question, or simply click either hexagon below, and we&rsquo;ll continue the conversation right here. A real person on our team can step in whenever you ask.')}
${para('<strong>Your report, in two hexagons.</strong>')}
<table role="presentation" width="67%" align="center" cellpadding="0" cellspacing="0" style="width:67%;margin:6px auto 14px auto"><tr>${tiles.join('')}</tr></table>
${para(`Talk soon,<br><strong>${SIGN_OFF[0]}</strong><br>${SIGN_OFF[1]}`)}`, unsubscribeLink);
  return tagged('scan-confirmation', { subject, text, html });
}

// Sent when someone asks for an unsubscribe link on the website (so only the address owner can opt out).
export function buildUnsubscribeRequestEmail({ link }) {
  const subject = 'Confirm that you want to unsubscribe';
  const text = [
    'You asked to unsubscribe from MyPrivacyTOOL emails.',
    '',
    `Confirm here: ${link}`,
    '',
    'If you did not ask for this, ignore this email and nothing changes.',
    '',
    'The MyPrivacyTOOL team',
  ].join('\n');
  const html = shell(subject, 'Confirm to stop MyPrivacyTOOL emails.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">Confirm that you want to unsubscribe</h1>
${para('You asked to unsubscribe from MyPrivacyTOOL emails. Confirm below and we will send you no more follow-up or marketing emails.')}
${button(link, 'Yes, unsubscribe me')}
${para('<br>If you did not ask for this, ignore this email and nothing changes.')}`);
  return tagged('unsubscribe-confirm', { subject, text, html });
}

// MPC-7491: the plain "you are unsubscribed" notice. Transactional only: no images, buttons, links, UTM tags, unsubscribe footer or other
// channels (a call to action right after an unsubscribe can count as marketing). Sent once, after the opt-out is recorded.
export function buildUnsubscribedEmail() {
  const subject = 'You are unsubscribed';
  const text = [
    'You are unsubscribed.',
    '',
    'We will send no more scan report or follow-up emails, and we have removed you from our newsletter list.',
    '',
    'To have your data deleted, write to privacy@myprivacytool.io.',
    '',
    'The MyPrivacyTOOL team',
  ].join('\n');
  const html = shell(subject, 'You will get no more scan report or follow-up emails.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">You are unsubscribed</h1>
${para('We will send no more scan report or follow-up emails, and we have removed you from our newsletter list.')}
${para('To have your data deleted, write to privacy@myprivacytool.io.')}`, null, { footer: 'MyPrivacyTOOL' });
  return { subject, text, html };
}

export const BRIDGE = 'You saw what your browser gives away. Now look at what one email address gives away.';
const MAX_BREACH_ROWS = 10;
// US people-search removal guides stay out of the main body unless a finding makes them relevant: a name in the address, or a breach that
// exposed names, phone numbers or physical addresses.
const brokersRelevant = (emailHexes, breaches) => emailHexes.some((h) => h.id === 'email-name' && h.status === 'found')
  || breaches.some((b) => (b.DataClasses || []).some((c) => /^(names|phone numbers|physical addresses)$/i.test(String(c))));

export function buildReportEmail({ scan, breaches = [], breachStatus, brokers = [], webScan = null, emailChecks = [], unsubscribeLink, referral = null, liveLink = null }) {
  const s = scan;
  const web = webScan ? normaliseHexagons(WEB_HEXAGONS, webScan.hexagons) : [];
  const emailHexes = normaliseHexagons(EMAIL_HEXAGONS, emailItems({ breachStatus, breaches, extra: emailChecks }));
  const wt = tally(web); const et = tally(emailHexes);
  const report = buildReportJson({ scanId: s.id, webScan, web, emailHexes, score: s.score === null ? null : { value: s.score, risk_level: s.risk_level, partial: s.partial } });
  const noteScore = s.score === null
    ? 'No privacy score yet: we only score what we actually checked, and we will not invent a number.'
    : `Partial score, based only on the checks that ran (${s.categories_checked.join(', ') || 'none'}). Everything marked NOT CHECKED below is not in it.`;
  const showBrokers = brokersRelevant(emailHexes, breaches);
  const breachRows = breachStatus === 'checked' ? breaches.slice(0, MAX_BREACH_ROWS) : [];
  const breachMore = breachStatus === 'checked' ? Math.max(0, breaches.length - MAX_BREACH_ROWS) : 0;
  const part1Intro = webScan
    ? `This is your own web scan, replayed. Every hexagon is something your browser told us when you ran it: ${tallyLine(wt, 'hexagons')}. Estimates are marked as estimates. A NOT CHECKED hexagon means we could not tell, not that you are safe.`
    : 'We have no saved web scan for this request, so there is nothing to replay here. That happens if you asked for a report without running the web scan first, or your browser was set not to let us keep the result. Run the scan at https://myprivacytool.io/ and request your report again to see every hexagon your browser gives away. Nothing below is guessed in its place.';
  // MPC-7488: the visitor's scan number, so they can quote it to have the saved scan deleted. Only when a saved scan is in this report.
  const scanNumberLine = webScan?.id ? `Your scan number: ${webScan.id}. Quote this number if you want this scan deleted.` : '';
  const subject = s.score === null ? 'Your MyPrivacyTOOL privacy report' : `Your MyPrivacyTOOL privacy report: ${s.score}/100${s.partial ? ' (partial)' : ''}`;
  const brokerLines = brokers.map((b) => (!b.removal_url && !b.steps ? `${b.name}\n  We have not yet written a verified removal guide for ${b.name}.`
    : `${b.name}  (${b.time_needed || 'a few minutes'}; ${b.processing_time || 'timing varies'})\n  Official opt-out page: ${b.removal_url}\n${b.steps ? b.steps.map((st, i) => `   ${i + 1}. ${st}`).join('\n') : ''}`));
  const text = [
    s.score === null ? 'Your privacy report' : `Your privacy score: ${s.score}/100 (${s.risk_level} exposure)`, ALICE_TAGLINE, '', noteScore, '',
    'PART 1: YOUR WEB SCAN, REPLAYED', part1Intro, ...(scanNumberLine ? [scanNumberLine] : []), ...(webScan ? hexText(web) : []), '',
    BRIDGE, '',
    'PART 2: YOUR EMAIL ADDRESS', `${tallyLine(et, 'hexagons')}.`, ...hexText(emailHexes),
    ...breachRows.map((b) => `  - ${b.Name} (${(b.BreachDate || '').slice(0, 7) || 'date unknown'}): exposed ${(b.DataClasses || []).join(', ')}`), ...(breachMore ? [`  ...and ${breachMore} more (all of them are in the attached JSON file)`] : []), '',
    'The full scan data, including technical detail that did not fit here, is attached as a JSON file you can open, search and analyse.', '',
    ...(showBrokers ? ['PEOPLE-SEARCH SITES', 'A finding above makes these relevant. We have not searched these sites for you, so we cannot say whether you are listed. Search for yourself, then use the official page to remove each listing.', '', ...brokerLines.flatMap((l) => [l, ''])]
      : [`US people-search removal guides (we have not searched these sites for you): ${SITE}/opt-out`, '']),
    `More removal guides: ${SITE}/opt-out`, '',
    'This email is our open channel. Reply anytime with a question and we will continue the conversation right here, or reply to ask us to delete your data.',
    ...(liveLink ? ['', `Keep an eye on your results: open this page and new findings appear as we find them. Only you can open it, because it came to your inbox: ${liveLink}`] : []),
    ...(referral ? ['', referral.text] : []),
    ...(unsubscribeLink ? ['', 'Fixed what is in this report? Then you do not need to hear from us again.', `Unsubscribe and we will send you no more follow-up or marketing emails: ${unsubscribeLink}`] : []),
  ].join('\n');
  const headline = s.score === null ? 'Your privacy report' : `Your privacy score: ${s.score}/100`;
  const box = (t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;font-size:14px;line-height:21px;color:#14532d">${t}</td></tr></table>`;
  const brokerCards = brokers.map((b) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0"><tr><td style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px">
<div style="font-size:15px;font-weight:700;color:#111827">${esc(b.name)}</div>
${b.removal_url ? `<div style="margin:6px 0 4px 0;font-size:13px;color:#6b7280">${esc(b.time_needed || '')}${b.time_needed && b.processing_time ? ' &middot; ' : ''}${esc(b.processing_time || '')}</div>
${b.steps ? `<ol style="margin:8px 0 10px 0;padding-left:20px;font-size:14px;line-height:21px;color:#374151">${b.steps.map((st) => `<li style="margin-bottom:4px">${esc(st)}</li>`).join('')}</ol>` : ''}${button(b.removal_url, 'Open the official opt-out page')}`
    : `<div style="margin-top:6px;font-size:14px;color:#6b7280">We have not yet written a verified removal guide for ${esc(b.name)}.</div>`}
</td></tr></table>`).join('');
  const html = shell(subject, s.score === null ? 'No score yet: we only show what we actually checked.' : `Your score: ${s.score}/100`,
    `${aliceHero(`${headline}${s.score === null ? '' : ` <span style="font-size:14px;font-weight:500;color:#6b7280">(${esc(s.risk_level)} exposure)</span>`}`, 'peek')}
${box(esc(noteScore))}
${h2('Part 1: your web scan, replayed')}${para(esc(part1Intro))}${scanNumberLine ? para(esc(scanNumberLine)) : ''}${webScan ? hexGroups(web) : ''}
<div style="margin:26px 0 0 0;padding:14px 16px;border-left:4px solid ${BRAND};background:#f9fafb;font-size:16px;line-height:24px;font-weight:600;color:#111827">${esc(BRIDGE)}</div>
${h2('Part 2: your email address')}${para(esc(`${tallyLine(et, 'hexagons')}.`))}${hexGroups(emailHexes)}
${breachRows.length ? `<ul style="margin:10px 0 12px 0;padding-left:20px;font-size:13px;line-height:19px;color:#374151">${breachRows.map((b) => `<li><strong>${esc(b.Name)}</strong> (${esc((b.BreachDate || '').slice(0, 7) || 'date unknown')}): exposed ${esc((b.DataClasses || []).join(', '))}</li>`).join('')}${breachMore ? `<li>&hellip;and ${breachMore} more (all of them are in the attached file)</li>` : ''}</ul>` : ''}
${para('<strong>The full data is attached.</strong> The JSON file holds every hexagon with its full value and the technical detail that did not fit here, so you can open it, search it and analyse it yourself.')}
${showBrokers ? `${h2('People-search sites')}${para('A finding above makes these relevant. We have <strong>not searched</strong> these sites for you, so we cannot say whether you are listed. Search for yourself, then use the official page to remove each listing.')}${brokerCards}`
    : para(`US people-search removal guides: <a href="${SITE}/opt-out" style="color:${BRAND}">see them on the site</a>. We have not searched these sites for you.`)}
${para(`<a href="${SITE}/opt-out" style="color:${BRAND}">More removal guides</a>`)}
${para('This email is our open channel. Reply anytime with a question and we will continue the conversation right here, or reply to ask us to delete your data.')}
${liveLink ? para('<strong>Keep an eye on your results.</strong> Open your results page and new findings appear as we find them. Only you can open it, because it came to your inbox.') + button(liveLink, 'Watch my results live') : ''}
${referral ? referral.html : ''}
${unsubscribeLink ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px 0"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;font-size:14px;line-height:21px;color:#14532d"><strong>Fixed what is in this report?</strong> Then you do not need to hear from us again. <a href="${esc(unsubscribeLink)}" style="color:${BRAND};font-weight:600">Unsubscribe</a> and we will send you no more follow-up or marketing emails.</td></tr></table>` : ''}`, unsubscribeLink);
  return { ...tagged('scan-report', { subject, text, html }), report };
}

export async function sendEmail(env, { to, subject, html, text, idempotencyKey, headers, attachments }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'MyPrivacyTOOL <hello@myprivacytool.io>', to: [to], reply_to: env.EMAIL_REPLY_TO || undefined, subject, html, text, headers: headers || undefined, attachments: attachments || undefined }),
  });
  if (!res.ok) return { sent: false, reason: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 150)}` };
  const j = await res.json().catch(() => ({}));
  return { sent: true, id: j.id || null };
}
