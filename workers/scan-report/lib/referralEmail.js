// MPC-7645: referral emails. DRAFT COPY: Chris must approve before REFERRALS_ENABLED goes on. Every line is true today:
// Pro is not on sale yet (src/pages/Pricing.tsx), so the reward is "a free month of Pro, saved on your account for when Pro opens".
import { shell, para, button, tagLinks, SIGN_OFF } from './email.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRAND = '#15803d';
const tagged = (campaign, { subject, text, html }) => ({ subject, text: tagLinks(text, campaign), html: tagLinks(html, campaign, { html: true }) });

export const REWARD_LINE = 'For every friend who gets their first privacy report, you earn one free month of Pro (up to 12). Pro is not on sale yet, so your months are saved on your account and start when it opens.';

// The block inside the scan report email. `manageLink` is the referrer's private link (the secret is in its fragment): it is not tagged or shared.
export function referralBlock({ shareLink, manageLink }) {
  const text = ['INVITE 3 FRIENDS, EARN FREE PRO', REWARD_LINE, `Your invite link (anyone can use it): ${shareLink}`, `Send the invitations from us: ${manageLink}`, ''].join('\n');
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px 0"><tr><td style="border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;font-size:14px;line-height:21px;color:#14532d">
<strong>Invite 3 friends, earn free Pro.</strong> ${esc(REWARD_LINE)}
${button(manageLink, 'Invite friends')}
<span style="font-size:13px;color:#374151">Or share your own link: <a href="${esc(shareLink)}" style="color:${BRAND}">${esc(shareLink)}</a></span></td></tr></table>`;
  return { text, html };
}

// To the friend. Sent once, only because the referrer asked us to, never repeated. No sender name or address is given.
export function buildInviteEmail({ shareLink, unsubscribeLink }) {
  const subject = 'A friend thought you would want to see this';
  const text = [
    'Hi,', '',
    'Someone who uses MyPrivacyTOOL asked us to send you this one email. They gave us only your email address. We used it to send this, and we keep just a scrambled (hashed) copy so we never send it twice.', '',
    'MyPrivacyTOOL shows you what your browser and your email address give away about you, and what to change first. It is free.', '',
    `See it here: ${shareLink}`, '',
    'We will not email you again unless you run a scan yourself.', '',
    'Talk soon,', ...SIGN_OFF, '',
    `Not interested? Unsubscribe and we will never mail this address: ${unsubscribeLink}`,
  ].join('\n');
  const html = shell(subject, 'One email, sent because a friend asked. Free privacy scan.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">${esc(subject)}</h1>
${para('Someone who uses MyPrivacyTOOL asked us to send you this one email. They gave us only your email address. We used it to send this, and we keep just a scrambled (hashed) copy so we never send it twice.')}
${para('MyPrivacyTOOL shows you what your browser and your email address give away about you, and what to change first. It is free.')}
${button(shareLink, 'See what you give away')}
${para('We will not email you again unless you run a scan yourself.')}
${para(`Talk soon,<br><strong>${SIGN_OFF[0]}</strong><br>${SIGN_OFF[1]}`)}`, unsubscribeLink,
    { footer: `Sent once at the request of someone you know. <a href="${esc(unsubscribeLink)}" style="color:#6b7280">Unsubscribe</a> and we will never mail this address. MyPrivacyTOOL &middot; <a href="https://myprivacytool.io/" style="color:#6b7280">myprivacytool.io</a>` });
  return tagged('referral-invite', { subject, text, html });
}

// To the referrer, when a friend's report has been delivered.
export function buildRewardEmail({ months, manageLink, unsubscribeLink }) {
  const subject = 'A friend ran their scan: you earned a free month of Pro';
  const text = [
    'Hi,', '',
    'A friend you invited got their first privacy report. That earns you one free month of Pro.', '',
    `Free Pro months saved on your account: ${months} (the most you can earn is 12). Pro is not on sale yet, so they start when it opens.`, '',
    ...(manageLink ? [`See your invitations: ${manageLink}`, ''] : []),
    ...SIGN_OFF, '', `Unsubscribe from these emails: ${unsubscribeLink}`,
  ].join('\n');
  const html = shell(subject, 'One more free month of Pro, saved on your account.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">You earned a free month of Pro</h1>
${para('A friend you invited got their first privacy report. That earns you one free month of Pro.')}
${para(`Free Pro months saved on your account: <strong>${esc(months)}</strong> (the most you can earn is 12). Pro is not on sale yet, so they start when it opens.`)}
${manageLink ? button(manageLink, 'See your invitations') : ''}
${para(`<br><strong>${SIGN_OFF[0]}</strong><br>${SIGN_OFF[1]}`)}`, unsubscribeLink);
  return tagged('referral-reward', { subject, text, html });
}
