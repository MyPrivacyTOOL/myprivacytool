// MPC-7448: HK Spam day-10 email. Stubbed fetch, no network, no secrets. Run: node workers/scan-report/hk-spam.test.mjs
import worker, { runHkSpamJob } from './index.js';
import { buildHkSpamEmail, isHkSpamSlot, HK_SPAM_SCAN_URL } from './lib/hkSpam.js';
import { emailHash } from './lib/suppression.js';
import { unsubscribeToken } from './lib/onboarding.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const SECRET_ENV = { SUPABASE_SERVICE_ROLE_KEY: 'sr', RESEND_API_KEY: 'rk', UNSUBSCRIBE_SECRET: 's3cret', RECIPIENT_ALLOWLIST: '' };
const ON = { ...SECRET_ENV, HK_SPAM_ENABLED: 'true' };
const LIVE = { ...ON, HK_SPAM_EMAILS_LIVE: 'true' };
const TEST = { ...ON, HK_SPAM_TEST_INBOXES: 'qa@example.org, QA2@example.org, not-an-email' };
const SLOT0900 = Date.UTC(2026, 9, 12, 1, 0);   // 09:00 HKT

// Fake Supabase (view + registrations + users + email_suppressions) and Resend.
function fake({ regs = [], users = [], suppressions = [], resendFail = false } = {}) {
  const db = { regs, users, suppressions }; const calls = []; let n = 0;
  const res = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
  const f = async (url, o = {}) => {
    url = String(url); calls.push({ url, method: o.method || 'GET', body: o.body, headers: o.headers });
    if (url.includes('api.resend.com')) return resendFail ? res(500, 'boom for x@y.zz') : res(200, { id: `msg_${++n}` });
    const q = new URLSearchParams(url.split('?')[1] || '');
    if (url.includes('/hk_spam_due_reminders')) return res(200, db.regs.filter((r) => !r.reminder_sent_at && r.due !== false).slice(0, Number(q.get('limit'))).map(({ due, ...r }) => r));
    if (url.includes('/hk_spam_registrations') && o.method === 'PATCH') {
      const id = q.get('id').replace('eq.', ''); const unsentOnly = q.get('reminder_sent_at') === 'is.null';
      const hit = db.regs.filter((r) => r.id === id && (!unsentOnly || !r.reminder_sent_at)); hit.forEach((r) => Object.assign(r, JSON.parse(o.body))); return res(200, hit);
    }
    if (url.includes('/rest/v1/users')) { const list = decodeURIComponent(q.get('email').replace(/^in\./, '')); return res(200, db.users.filter((u) => u.email_opt_out_at && list.includes(`"${u.email}"`)).map((u) => ({ email: u.email }))); }
    if (url.includes('/email_suppressions')) { const list = q.get('email_hash').replace(/^in\./, ''); return res(200, db.suppressions.filter((s) => list.includes(s.email_hash))); }
    if (url.includes('/rest/v1/subscribers') && o.method === 'DELETE') return res(204);   // CK-7721 fix 3: unsubscribe also removes the newsletter row
    return res(404, 'unexpected ' + url.split('?')[0]);
  };
  return { f, db, calls, sends: () => calls.filter((c) => c.url.includes('resend')) };
}
const reg = (id, email, language = 'en', extra = {}) => ({ id, email, language, platform: 'ios', protection_date: '2026-10-23', ...extra });
const log = console.log; const errs = [];
const quiet = async (fn) => { const l = console.log, e = console.error; const out = []; console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => { errs.push(a.join(' ')); out.push(a.join(' ')); }; try { return [await fn(), out]; } finally { console.log = l; console.error = e; } };

// ---- email copy
const fs0 = await import('node:fs'); const { default: generated } = await import('./lib/hkSpamEmail.generated.js');
check(JSON.stringify(generated) === JSON.stringify(JSON.parse(fs0.readFileSync(new URL('../../src/data/hkSpamEmailCopy.json', import.meta.url), 'utf8'))), 'generated email strings module is in sync with src/data/hkSpamEmailCopy.json');
const en = buildHkSpamEmail({ language: 'en', unsubscribeLink: 'https://myprivacytool.io/unsubscribe?e=a&t=b' });
const zh = buildHkSpamEmail({ language: 'yue', unsubscribeLink: 'https://myprivacytool.io/unsubscribe?e=a&t=b' });
check(/<html lang="en">/.test(en.html) && /<html lang="zh-HK">/.test(zh.html) && /charset="utf-8"/.test(zh.html), 'html lang matches the language');
check(/protected/i.test(en.subject) && /spam texts/.test(en.subject) && /pre-recorded/.test(en.text) && /Live calls from a real person/.test(en.text) && /said yes to/i.test(en.text) && /until you unsubscribe/.test(en.text), 'EN: protected from spam SMS + robocalls, says live calls are NOT covered, consent caveat');
check(en.html.includes('Run your free privacy scan') && /受保護/.test(zh.subject) && /短訊/.test(zh.text) && /預錄來電/.test(zh.text) && /真人打來的電話/.test(zh.text) && /並不涵蓋/.test(zh.text) && /私隱/.test(zh.text) && !/隐|短信/.test(zh.text), 'ZH: Traditional Chinese, HK wording (短訊, 預錄來電, 私隱), says live calls are NOT covered');
for (const [name, m] of [['EN', en], ['ZH', zh]]) {
  check((m.html.match(/utm_source=hk_spam&amp;utm_medium=email&amp;utm_campaign=day10/g) || []).length === 1 && m.text.includes(HK_SPAM_SCAN_URL) && (m.html.match(/<a href="https:\/\/myprivacytool\.io\/scan/g) || []).length === 1, `${name}: exactly one call to action, the scan link with the three UTMs`);
  check(m.html.includes('/unsubscribe?e=a&amp;t=b') && m.text.includes('/unsubscribe?e=a&t=b'), `${name}: unsubscribe link in html and text`);
  check(m.html.includes('/HongKongSpam?lang=' + (name === 'EN' ? 'en' : 'zh') + '#hk-optout') && m.text.includes('#hk-optout'), `${name}: link back to the opt-out step on /HongKongSpam in the chosen language`);
  check(!/\+?\d[\d\s-]{7,}/.test(m.text.replace(/utm_[a-z_=0-9]*/g, '')) , `${name}: no phone numbers in the copy`);
}

// ---- kill switch 1: HK_SPAM_ENABLED not exactly 'true' => the job does nothing at all
for (const flag of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
  const F = fake({ regs: [reg('r1', 'a@example.com'), reg('r2', 'b@example.com', 'yue')] });
  const [o, out] = await quiet(() => runHkSpamJob({ ...LIVE, HK_SPAM_TEST_INBOXES: 'qa@example.org', HK_SPAM_ENABLED: flag }, F.f, undefined, SLOT0900));
  check(o.enabled === false && F.calls.length === 0 && out.length === 0 && F.db.regs.every((r) => !r.reminder_sent_at), `HK_SPAM_ENABLED=${JSON.stringify(flag)}: no database call, no email, no claim, even with LIVE on`);
}
{
  const F = fake({ regs: [reg('r1', 'a@example.com')] });
  const [o] = await quiet(() => runHkSpamJob({ ...ON, SUPABASE_SERVICE_ROLE_KEY: undefined }, F.f));
  check(o.skipped && F.calls.length === 0, 'no Supabase key: skipped');
}

// ---- kill switch 2: HK_SPAM_EMAILS_LIVE not exactly 'true' => test mode, test inbox only, registrants never mailed or claimed
for (const flag of [undefined, '', 'false', 'TRUE', '1']) {
  const F = fake({ regs: [reg('r1', 'real1@example.com'), reg('r2', 'real2@example.com', 'yue'), reg('r3', 'real3@example.com')] });
  const [o, out] = await quiet(() => runHkSpamJob({ ...TEST, HK_SPAM_EMAILS_LIVE: flag }, F.f, undefined, SLOT0900));
  const to = F.sends().map((c) => JSON.parse(c.body));
  check(o.test_mode === true && o.live === false && o.due === 3 && o.sent === 0 && o.test_sent === 4 && to.length === 4
    && to.every((m) => ['qa@example.org', 'qa2@example.org'].includes(m.to[0]) && /^\[TEST\]|^【測試】/.test(m.subject))
    && new Set(to.map((m) => m.subject)).size === 2, `EMAILS_LIVE=${JSON.stringify(flag)}: one [TEST] sample per language to each valid test inbox only (4 mails), nobody else`);
  const keys = F.sends().map((c) => c.headers['Idempotency-Key']);
  check(keys.length === 4 && keys.every((k) => typeof k === 'string' && k.startsWith('hk-spam-test-')) && new Set(keys).size === 4,
    `EMAILS_LIVE=${JSON.stringify(flag)}: every test sample has its own Resend idempotency key (never "undefined", so the second language is not rejected with 409)`);
  check(F.db.regs.every((r) => !r.reminder_sent_at) && F.calls.every((c) => c.method === 'GET' || c.url.includes('resend'))
    && F.calls.filter((c) => c.url.includes('hk_spam_due_reminders')).every((c) => !/email/.test(c.url.replace('hk_spam_due_reminders', '')))
    && !out.join().includes('@'), `EMAILS_LIVE=${JSON.stringify(flag)}: no row claimed, no registrant address read, none logged`);
}
{
  const F = fake({ regs: [reg('r1', 'a@example.com')] });
  const [o] = await quiet(() => runHkSpamJob(TEST, F.f, undefined, Date.UTC(2026, 9, 12, 2, 0)));
  check(o.test_sent === 0 && F.sends().length === 0, 'test mode: the 10:00 HKT retry slots do not repeat the samples');
  const G = fake({ regs: [reg('r1', 'a@example.com')] });
  const [o2] = await quiet(() => runHkSpamJob(ON, G.f, undefined, SLOT0900));
  check(o2.test_mode && o2.test_sent === 0 && G.sends().length === 0, 'test mode with no HK_SPAM_TEST_INBOXES: sends nothing');
  const H = fake({ regs: [] });
  const [o3] = await quiet(() => runHkSpamJob(TEST, H.f, undefined, SLOT0900));
  check(o3.test_sent === 0 && H.sends().length === 0, 'test mode with nobody due: no sample');
}

// ---- live: one email per row, in the chosen language, with unsubscribe headers
{
  const F = fake({ regs: [reg('r1', 'Alice@Example.com'), reg('r2', 'bob@example.com', 'yue')] });
  const [o, out] = await quiet(() => runHkSpamJob(LIVE, F.f));
  const s = F.sends(); const m1 = JSON.parse(s[0].body); const m2 = JSON.parse(s[1].body);
  check(o.sent === 2 && o.due === 2 && o.failed === 0 && o.by_language.en === 1 && o.by_language.yue === 1 && s.length === 2, 'live: one email per due row, counted by language');
  check(m1.to[0] === 'alice@example.com' && /protected/i.test(m1.subject) && /受保護/.test(m2.subject), 'live: language follows the registration (en / yue)');
  check(s[0].headers['Idempotency-Key'] === 'hk-spam-day10-r1' && /^<https:\/\/.*\/api\/unsubscribe\?e=alice%40example\.com&t=[0-9a-f]{64}>$/.test(m1.headers['List-Unsubscribe']) && m1.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'live: Resend idempotency key per row + signed List-Unsubscribe one-click header');
  const t = await unsubscribeToken('s3cret', 'alice@example.com');
  check(m1.html.includes(`/unsubscribe?e=alice%40example.com&amp;t=${t}`) && m1.text.includes(`t=${t}`), 'live: body unsubscribe link carries the same signed token as the existing mechanism');
  check(F.db.regs.every((r) => r.reminder_sent_at) && !out.join('\n').includes('@') && !out.join('\n').includes('example'), 'live: rows marked sent; logs hold counts only, no addresses');
  const [o2] = await quiet(() => runHkSpamJob(LIVE, F.f));
  check(o2.due === 0 && o2.sent === 0 && F.sends().length === 2, 'live: a second run the same day sends nothing (at most once)');
}

// ---- at most once under a race: another run claims the row between the view read and our claim
{
  const F = fake({ regs: [reg('r1', 'a@example.com')] });
  const orig = F.f; let raced = false;
  const racing = async (url, o) => { if (!raced && String(url).includes('/rest/v1/users')) { raced = true; F.db.regs[0].reminder_sent_at = new Date().toISOString(); } return orig(url, o); };
  const [o] = await quiet(() => runHkSpamJob(LIVE, racing));
  check(o.sent === 0 && F.sends().length === 0, 'already-claimed row is skipped, no second email');
}

// ---- failure: claim is released so the next run retries; no address in the error log
{
  const F = fake({ regs: [reg('r1', 'a@example.com')], resendFail: true });
  const [o] = await quiet(() => runHkSpamJob(LIVE, F.f));
  check(o.sent === 0 && o.failed === 1 && !F.db.regs[0].reminder_sent_at, 'send failure: not marked sent, claim released for retry');
  check(errs.length > 0 && errs.every((e) => !e.includes('@y.zz') && !e.includes('example.com')), 'send failure: error log has no email address');
  F.f.resendFail; const G = fake({ regs: F.db.regs }); const [o2] = await quiet(() => runHkSpamJob(LIVE, G.f));
  check(o2.sent === 1 && G.sends().length === 1, 'retry on the next run succeeds');
}

// ---- suppression: users.email_opt_out_at and email_suppressions both stop the email
{
  const F = fake({
    regs: [reg('r1', 'optedout@example.com'), reg('r2', 'hashed@example.com'), reg('r3', 'fine@example.com')],
    users: [{ email: 'optedout@example.com', email_opt_out_at: new Date().toISOString() }, { email: 'fine@example.com', email_opt_out_at: null }],
    suppressions: [{ email_hash: await emailHash('Hashed@Example.com') }],
  });
  const [o] = await quiet(() => runHkSpamJob(LIVE, F.f));
  check(o.sent === 1 && o.suppressed === 2 && F.sends().length === 1 && JSON.parse(F.sends()[0].body).to[0] === 'fine@example.com', 'opt-out via users row OR email-hash suppression skips the email');
  check(!F.db.regs[0].reminder_sent_at && !F.db.regs[1].reminder_sent_at, 'suppressed rows are never claimed or sent');
}

// ---- end to end: an HK registrant (no users row) unsubscribes from the email, then is not mailed
{
  const F = fake({ regs: [reg('r1', 'hkonly@example.com')] });
  const supp = []; const orig = F.f;
  const f = async (url, o = {}) => {   // add insert support for email_suppressions to the fake
    if (String(url).includes('/rest/v1/email_suppressions') && o.method === 'POST') { const row = JSON.parse(o.body); if (F.db.suppressions.some((s) => s.email_hash === row.email_hash)) return { ok: false, status: 409, text: async () => 'dup' }; F.db.suppressions.push(row); supp.push(row); return { ok: true, status: 201, text: async () => JSON.stringify([row]) }; }
    if (String(url).includes('/rest/v1/users') && o.method === 'PATCH') return { ok: true, status: 200, text: async () => '[]' };   // no users row: matches nothing
    return orig(url, o);
  };
  const t = await unsubscribeToken('s3cret', 'hkonly@example.com');
  globalThis.fetch = f;
  const r = await worker.fetch(new Request(`https://x/api/unsubscribe?e=hkonly%40example.com&t=${t}`, { method: 'POST' }), { ...LIVE }, {});
  check(r.status === 200 && supp.length === 1 && supp[0].email_hash === await emailHash('hkonly@example.com'), 'unsubscribe by an HK registrant (no users row) records an email-hash suppression');
  const [o] = await quiet(() => runHkSpamJob(LIVE, f));
  check(o.sent === 0 && o.suppressed === 1 && F.sends().filter((c) => JSON.parse(c.body).subject !== 'You are unsubscribed').length === 0, 'and the day-10 email is then not sent (only the plain unsubscribe confirmation went out)');
}

// ---- go-live safety gates
{
  const F = fake({ regs: [reg('r1', 'a@example.com')] });
  const [o] = await quiet(() => runHkSpamJob({ ...LIVE, UNSUBSCRIBE_SECRET: undefined }, F.f));
  check(o.skipped && F.sends().length === 0, 'live but no UNSUBSCRIBE_SECRET: nothing sent (never mail without a working unsubscribe link)');
  const G = fake({ regs: [reg('r1', 'a@example.com'), reg('r2', 'tester@example.com')] });
  const [o2] = await quiet(() => runHkSpamJob({ ...LIVE, RECIPIENT_ALLOWLIST: 'tester@example.com' }, G.f));
  check(o2.sent === 1 && o2.held === 1 && G.sends().length === 1 && !G.db.regs[0].reminder_sent_at, 'RECIPIENT_ALLOWLIST is honoured: others held, not claimed');
  const H = fake({ regs: Array.from({ length: 50 }, (_, i) => reg(`r${i}`, `u${i}@example.com`)) });
  const [o3] = await quiet(() => runHkSpamJob(LIVE, H.f));
  check(o3.sent === 20 && H.calls.length <= 50, 'per-run cap of 20 keeps a run under the 50-subrequest free-plan limit');
}

// ---- scheduling
{
  const ran = []; const ctx = { waitUntil: (p) => ran.push(p) };
  const F = fake({ regs: [reg('r1', 'a@example.com')] }); globalThis.fetch = F.f;
  await quiet(async () => { await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 9, 11, 2, 0) }, ON, ctx); await Promise.all(ran); });
  check(F.calls.length === 1 && F.calls[0].url.includes('hk_spam_due_reminders') && F.sends().length === 0, 'HK slot tick (02:00 UTC) => HK job only (test mode here), nothing mailed to registrants');
  const wrangler = (await import('node:fs')).readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  check(/crons = \["\*\/5 \* \* \* \*"\]/.test(wrangler) && /HK_SPAM_EMAILS_LIVE = "true"/.test(wrangler) && !/HK_SPAM_TEST_INBOXES\s*=/.test(wrangler), 'wrangler.toml: only the 5-minute cron (Workers Free allows 5 crons per account), EMAILS_LIVE committed true (launch, Chris 2026-10-26), no test inbox address in the repo');
  check([[1, 0], [2, 0], [3, 0], [4, 0]].every(([h, m]) => isHkSpamSlot(Date.UTC(2026, 9, 11, h, m))) && ![[0, 0], [5, 0], [2, 5], [1, 5], [13, 0]].some(([h, m]) => isHkSpamSlot(Date.UTC(2026, 9, 11, h, m))), 'HK slots are exactly 01:00-04:00 UTC (09:00 HKT daily run + hourly retries)');
  const ran2 = []; const ctx2 = { waitUntil: (p) => ran2.push(p) };
  const G = fake({ regs: [reg('r1', 'a@example.com')] }); globalThis.fetch = G.f;
  await quiet(async () => { await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 9, 11, 6, 0) }, ON, ctx2); await Promise.allSettled(ran2); });
  check(!G.calls.some((c) => c.url.includes('hk_spam_due_reminders')), 'ordinary tick (06:00 UTC) does not run the HK job');
}
process.exit(ok ? 0 : 1);
