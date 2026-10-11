// MPC-7448: day-10 "you are now protected" email for /HongKongSpam registrants (hk_spam_registrations, MPC-7450).
// Runs from its own cron (HK_SPAM_CRON). Sending is OFF unless HK_SPAM_EMAIL_ENABLED === 'true': otherwise it is a dry run that only
// counts what is due. Never stores or logs phone numbers (none exist) or full addresses (logs carry counts and row ids only).
import { shell, para, button, sendEmail } from './email.js';
import { db } from './supabase.js';
import { suppressedAmong } from './suppression.js';
import { unsubscribePageUrl, unsubscribeUrl } from './onboarding.js';

// Hours 01-04 UTC = 09:00-12:59 HKT. The due view is "today in Hong Kong", rows are claimed before sending, so extra runs are
// harmless and just drain what the per-run cap left over (a Worker may make only 50 subrequests on the free plan).
export const HK_SPAM_CRON = '5 1-4 * * *';
const SITE = 'https://myprivacytool.io';
export const HK_SPAM_SCAN_URL = `${SITE}/scan?utm_source=hk_spam_email&utm_medium=email&utm_campaign=day10`;
const CONTACT = 'hello@myprivacytool.io';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const redact = (s) => String(s).replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+/g, '[email]');

// Copy: DRAFT for Chris to approve before go-live. Every claim is true of the DNC registers (see the HK Spam brief):
// SMS and pre-recorded calls are covered, live person-to-person calls are not, and consent given to a sender beats the register.
const COPY = {
  en: {
    lang: 'en',
    subject: 'You are now protected from spam texts and robocalls',
    preheader: 'Your Hong Kong Do-not-call registration is now in effect.',
    title: 'You are now protected',
    intro: 'Your Do-not-call registration, the one you started on our Stop Spam page, is now in effect. From today, businesses may not send you marketing SMS or pre-recorded calls unless you have given them consent.',
    notTitle: 'What this does not cover',
    not: [
      'Live calls from a real person. Hong Kong’s registers do not stop these.',
      'Companies you already gave consent to, such as a bank, a phone company or a shop. To stop those, unsubscribe from each of them directly.',
    ],
    cta: 'Spam also follows your data around. Run a free privacy scan to see how your email address shows up online and what to do about it.',
    button: 'Run my free privacy scan',
    sign: 'The MyPrivacyTOOL team',
    why: 'You are getting this once because you asked for a reminder on our Stop Spam page.',
    unsub: 'Unsubscribe',
    help: `Questions, or want your data deleted? Reply to this email or write to ${CONTACT}. We never sell your data.`,
  },
  yue: {
    lang: 'zh-HK',
    subject: '你現已受保護，免受垃圾短訊及預錄來電騷擾',
    preheader: '你的「拒收訊息」登記由今日起生效。',
    title: '你現已受保護',
    intro: '你透過我們 Stop Spam 頁面登記的「拒收訊息」（Do-not-call）今日起生效。由今日起，商戶不得向你發送促銷短訊或預錄來電，除非你曾向對方表示同意。',
    notTitle: '以下情況不在保護範圍內',
    not: [
      '真人打來的電話：香港的拒收訊息登記冊並不涵蓋真人來電。',
      '你曾經同意接收訊息的公司（例如銀行、電訊商或商店）：你需要直接向對方取消訂閱。',
    ],
    cta: '垃圾訊息往往跟著你的個人資料而來。立即做一次免費私隱掃描，看看你的電郵地址在網上的曝光情況，以及可以怎樣處理。',
    button: '立即免費私隱掃描',
    sign: 'MyPrivacyTOOL 團隊',
    why: '你收到這封電郵（只會發送一次），是因為你在我們的 Stop Spam 頁面要求保護生效提醒。',
    unsub: '取消訂閱',
    help: `如有查詢或想刪除你的資料，請回覆此電郵或電郵至 ${CONTACT}。我們絕不出售你的資料。`,
  },
};

export function buildHkSpamEmail({ language, unsubscribeLink }) {
  const c = COPY[language === 'yue' ? 'yue' : 'en'];
  const text = [
    c.title, '',
    c.intro, '',
    `${c.notTitle}:`, ...c.not.map((n) => `  - ${n}`), '',
    c.cta, `${c.button}: ${HK_SPAM_SCAN_URL}`, '',
    c.sign, '',
    c.why, c.help, `${c.unsub}: ${unsubscribeLink}`,
  ].join('\n');
  const footer = `${esc(c.why)}<br>${esc(c.help).replace(CONTACT, `<a href="mailto:${CONTACT}" style="color:#6b7280">${CONTACT}</a>`)}<br><a href="${esc(unsubscribeLink)}" style="color:#6b7280">${esc(c.unsub)}</a> &middot; MyPrivacyTOOL &middot; <a href="${SITE}/" style="color:#6b7280">myprivacytool.io</a>`;
  const html = shell(c.subject, c.preheader,
    `<h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;color:#111827">${esc(c.title)}</h1>
${para(esc(c.intro))}
<h2 style="margin:22px 0 10px 0;font-size:18px;line-height:24px;color:#111827">${esc(c.notTitle)}</h2>
<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:23px;color:#374151">${c.not.map((n) => `<li style="margin-bottom:6px">${esc(n)}</li>`).join('')}</ul>
${para(esc(c.cta))}
${button(HK_SPAM_SCAN_URL, esc(c.button))}
${para(`<br>${esc(c.sign)}`)}`, unsubscribeLink, { lang: c.lang, footer });
  return { subject: c.subject, text, html };
}

// `allowed(env, email)` is the Worker's RECIPIENT_ALLOWLIST check (passed in to avoid a circular import with index.js).
export async function runHkSpamReminderJob(env, { fetchImpl = fetch, allowed, limit } = {}) {
  if (typeof allowed !== 'function') throw new Error('runHkSpamReminderJob needs the recipient allowlist check');
  const done = (o) => { console.log(JSON.stringify({ event: 'hk_spam_reminder_run', ...o })); return o; };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return done({ skipped: 'no supabase key' });
  const sb = db(env, fetchImpl);
  const live = env.HK_SPAM_EMAIL_ENABLED === 'true';

  if (!live) {   // dry run: how many are due today. Reads ids only, claims nothing, sends nothing.
    const due = await sb.select('hk_spam_due_reminders?select=id&limit=1000');
    return done({ live: false, dry_run: true, due: due.length, sent: 0 });
  }
  if (!env.UNSUBSCRIBE_SECRET) return done({ live: true, skipped: 'UNSUBSCRIBE_SECRET not set: no marketing-style mail without an unsubscribe link' });

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
