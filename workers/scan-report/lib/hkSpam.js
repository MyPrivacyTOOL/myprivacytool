// MPC-7448: day-10 "you are now protected" email for /HongKongSpam registrants (hk_spam_registrations, MPC-7450).
// Two kill switches (anything but the exact string 'true' is off): HK_SPAM_ENABLED (off = the job does nothing) and HK_SPAM_EMAILS_LIVE
// (off = test mode: only sample emails to HK_SPAM_TEST_INBOXES, no registrant is mailed, no row is marked sent).
// Never stores or logs phone numbers (none exist) or full addresses (logs carry counts and row ids only).
import { shell, para, button, sendEmail } from './email.js';
import { db } from './supabase.js';
import { suppressedAmong } from './suppression.js';
import { unsubscribePageUrl, unsubscribeUrl } from './onboarding.js';
import EMAIL_COPY from './hkSpamEmail.generated.js';   // src/data/hkSpamEmailCopy.json, via scripts/sync-hk-email-copy.mjs

// 01:00 UTC = 09:00 Hong Kong time is the daily run; 02:00-04:00 UTC are hourly retries. The due view is "today in Hong Kong" and rows are
// claimed before sending, so extra runs are harmless and just drain what the per-run cap left over (a Worker may make only 50 subrequests on
// the free plan). The Workers Free plan allows 5 cron triggers per account, so this job has no cron of its own: it runs on the existing
// 5-minute trigger when that tick falls at minute 00 of hours 01-04 UTC.
export const isHkSpamSlot = (when) => { const d = new Date(when); return d.getUTCHours() >= 1 && d.getUTCHours() <= 4 && d.getUTCMinutes() === 0; };
const isFirstSlot = (when) => new Date(when).getUTCHours() === 1;
const SITE = 'https://myprivacytool.io';
export const HK_SPAM_SCAN_URL = `${SITE}/scan?utm_source=hk_spam&utm_medium=email&utm_campaign=day10`;
const optOutUrl = (lang) => `${SITE}/HongKongSpam?lang=${lang === 'yue' ? 'zh' : 'en'}#hk-optout`;   // the consent clean-up section of the page
const CONTACT = 'hello@myprivacytool.io';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const redact = (s) => String(s).replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+/g, '[email]');

// Copy: DRAFT for Chris to approve before go-live (and the MPC-7542 Chinese review). Every claim is true of the DNC registers (see the HK Spam
// brief): SMS and pre-recorded calls are covered, live person-to-person calls are not, and consent given to a sender beats the register.
const COPY = EMAIL_COPY;

export function buildHkSpamEmail({ language, unsubscribeLink, test = false }) {
  const key = language === 'yue' ? 'yue' : 'en';
  const c = { ...COPY[key], help: COPY[key].help.replace('{contact}', CONTACT) };
  const subject = (test ? c.testPrefix : '') + c.subject;
  const optOut = optOutUrl(key);
  const text = [
    c.title, '',
    c.intro, '',
    `${c.notTitle}:`, ...c.not.map((n) => `  - ${n}`), '',
    `${c.optOutLead} ${optOut}`, '',
    c.cta, `${c.button}: ${HK_SPAM_SCAN_URL}`, '',
    c.sign, '',
    c.why, c.help, `${c.unsub}: ${unsubscribeLink}`,
  ].join('\n');
  const footer = `${esc(c.why)}<br>${esc(c.help).replace(CONTACT, `<a href="mailto:${CONTACT}" style="color:#6b7280">${CONTACT}</a>`)}<br><a href="${esc(unsubscribeLink)}" style="color:#6b7280">${esc(c.unsub)}</a> &middot; MyPrivacyTOOL &middot; <a href="${SITE}/" style="color:#6b7280">myprivacytool.io</a>`;
  const html = shell(subject, c.preheader,
    `<h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;color:#111827">${esc(c.title)}</h1>
${para(esc(c.intro))}
<h2 style="margin:22px 0 10px 0;font-size:18px;line-height:24px;color:#111827">${esc(c.notTitle)}</h2>
<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:23px;color:#374151">${c.not.map((n) => `<li style="margin-bottom:6px">${esc(n)}</li>`).join('')}</ul>
${para(`${esc(c.optOutLead)} <a href="${esc(optOut)}" style="color:#2563eb">${esc(c.optOutLink)}</a>`)}
${para(esc(c.cta))}
${button(HK_SPAM_SCAN_URL, esc(c.button))}
${para(`<br>${esc(c.sign)}`)}`, unsubscribeLink, { lang: c.lang, footer });
  return { subject, text, html };
}

const flagOn = (v) => v === 'true';
const testInboxes = (env) => [...new Set(String(env.HK_SPAM_TEST_INBOXES ?? '').split(',').map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];

// `allowed(env, email)` is the Worker's RECIPIENT_ALLOWLIST check (passed in to avoid a circular import with index.js).
export async function runHkSpamReminderJob(env, { fetchImpl = fetch, allowed, limit, when = Date.now() } = {}) {
  if (typeof allowed !== 'function') throw new Error('runHkSpamReminderJob needs the recipient allowlist check');
  const done = (o) => { console.log(JSON.stringify({ event: 'hk_spam_reminder_run', ...o })); return o; };
  if (!flagOn(env.HK_SPAM_ENABLED)) return { enabled: false };           // kill switch 1: nothing happens, not even a log line or a database read
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return done({ skipped: 'no supabase key' });
  const sb = db(env, fetchImpl);

  if (!flagOn(env.HK_SPAM_EMAILS_LIVE)) return runTestMode(env, sb, fetchImpl, when, done);   // kill switch 2: test inbox only
  if (!env.UNSUBSCRIBE_SECRET) return done({ live: true, skipped: 'UNSUBSCRIBE_SECRET not set: no marketing-style mail without an unsubscribe link' });
  return runLive(env, sb, fetchImpl, { allowed, limit, done });
}

// Test mode: reads only id + language of today's due rows (never an address), claims nothing, and sends one sample per language that has
// someone due to each test inbox, subject-prefixed "[TEST]". Runs only on the first (09:00 HKT) slot so retries do not repeat the samples.
async function runTestMode(env, sb, fetchImpl, when, done) {
  const due = await sb.select('hk_spam_due_reminders?select=id,language&limit=1000');
  const out = { live: false, test_mode: true, due: due.length, sent: 0, test_sent: 0, failed: 0 };
  const inboxes = testInboxes(env);
  if (!inboxes.length || !due.length || !isFirstSlot(when) || !env.UNSUBSCRIBE_SECRET) return done({ ...out, test_inboxes: inboxes.length });
  const langs = [...new Set(due.map((r) => (r.language === 'yue' ? 'yue' : 'en')))];
  for (const to of inboxes) for (const language of langs) {
    try {
      const links = { page: await unsubscribePageUrl(env, to), oneClick: await unsubscribeUrl(env, to) };
      const r = await sendEmail(env, { to, ...buildHkSpamEmail({ language, unsubscribeLink: links.page, test: true }),
        headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }, fetchImpl);
      if (!r.sent) throw new Error(`email not sent: ${r.reason}`);
      out.test_sent++;
    } catch (e) { out.failed++; console.error('hk spam test email failed:', redact(e)); }
  }
  return done({ ...out, test_inboxes: inboxes.length });
}

async function runLive(env, sb, fetchImpl, { allowed, limit, done }) {
  const cap = Math.min(Math.max(Number.parseInt(limit ?? env.HK_SPAM_BATCH ?? 20, 10) || 20, 1), 20);   // 2 subrequests per row + 3 fixed, under the free-plan 50
  const rows = await sb.select(`hk_spam_due_reminders?select=id,email,language,platform,protection_date&order=id.asc&limit=${cap}`);
  const out = { live: true, due: rows.length, sent: 0, suppressed: 0, held: 0, failed: 0, by_language: { en: 0, yue: 0 } };
  if (!rows.length) return done(out);

  const suppressed = await suppressedAmong(sb, rows.map((r) => r.email));
  for (const row of rows) {
    const email = String(row.email).trim().toLowerCase();
    if (!allowed(env, email)) { out.held++; continue; }                 // test mode: not claimed, stays due
    if (suppressed.has(email)) { out.suppressed++; continue; }          // opted out (users.email_opt_out_at or email_suppressions)
    let claimedRow = false; let mailed = false;
    try {
      const claimed = await sb.patch(`hk_spam_registrations?id=eq.${encodeURIComponent(row.id)}&reminder_sent_at=is.null`, { reminder_sent_at: new Date().toISOString() });
      if (!claimed.length) continue;                                     // another run took it: at most once
      claimedRow = true;
      const links = { page: await unsubscribePageUrl(env, email), oneClick: await unsubscribeUrl(env, email) };
      const mail = buildHkSpamEmail({ language: row.language, unsubscribeLink: links.page });
      const r = await sendEmail(env, {
        to: email, ...mail, idempotencyKey: `hk-spam-day10-${row.id}`,
        headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }, fetchImpl);
      if (!r.sent) throw new Error(`email not sent: ${r.reason}`);
      mailed = true;
      out.sent++; out.by_language[row.language === 'yue' ? 'yue' : 'en']++;
    } catch (e) {
      out.failed++;
      // Nothing went out: release the claim so a later run retries (the Resend idempotency key keeps a retry single-send).
      if (claimedRow && !mailed) await sb.patch(`hk_spam_registrations?id=eq.${encodeURIComponent(row.id)}`, { reminder_sent_at: null }).catch(() => {});
      console.error(`hk spam reminder failed for registration ${row.id}:`, redact(e));
    }
  }
  return done(out);
}
