// MPC-7645: referral programme. Stubbed fetch, no network. Run: node workers/scan-report/referral.test.mjs
import worker, { handleScan } from './index.js';
import { referralTester, attachReferral, completeReferral, ensureReferralCode, handleReferralInvite, handleReferralStatus, mailbox, manageToken, manageUrl, newCode, referralsEnabled, shareUrl, verifyManageToken, CODE_RE, MAX_INVITES } from './lib/referral.js';
import { referralBlock, buildInviteEmail } from './lib/referralEmail.js';
import { abOn, abVariant, isVariant, AB_TESTS } from './lib/referralAb.js';
import { buildReportEmail, tagLinks } from './lib/email.js';
import { computeScore } from './lib/score.js';
import { emailHash } from './lib/suppression.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const ON = { SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', UNSUBSCRIBE_SECRET: 's3cret', REFERRALS_ENABLED: 'true' };
const ORIGIN = 'https://myprivacytool.io';
const ALLOWED = [ORIGIN, 'https://www.myprivacytool.io'];

// A tiny in-memory PostgREST + Resend: only the filters the referral code uses (eq, is.null, not.is.null, in.(...)).
function fake({ resendFail = false } = {}) {
  const db = { users: [], referrals: [], email_suppressions: [], leads: [], scans: [] }; const calls = []; let n = 0;
  const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
  const match = (row, q) => { for (const [k, v] of q) { if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    if (v.startsWith('eq.')) { if (String(row[k]) !== v.slice(3)) return false; }
    else if (v === 'is.null') { if (row[k] != null) return false; }
    else if (v === 'not.is.null') { if (row[k] == null) return false; }
    else if (v.startsWith('in.(')) { const list = [...v.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map((m) => m[1] ?? m[2]); if (!list.includes(String(row[k]))) return false; }
    else if (/^(gte|lt)\./.test(v)) continue; } return true; };
  const f = async (url, o = {}) => {
    url = String(url); const method = o.method || 'GET'; calls.push({ url, method, body: o.body, headers: o.headers });
    if (url.includes('api.resend.com')) return resendFail ? res(500, 'x') : res(200, { id: `msg_${++n}` });
    if (url.includes('api.hubapi.com')) return res(200, {});
    if (url.includes('/rpc/mpt_complete_referral')) {          // same rules as the SQL function
      const id = JSON.parse(o.body).p_referee_user_id; const r = db.referrals.find((x) => x.referee_user_id === id && x.status === 'signed_up'); if (!r) return res(200, []);
      r.status = 'completed'; r.completed_at = 'now'; const u = db.users.find((x) => x.id === r.referrer_user_id);
      if (u.pro_months_earned < 12) { u.pro_months_earned++; r.rewarded_at = 'now'; return res(200, [{ referrer_user_id: u.id, rewarded: true, pro_months_earned: u.pro_months_earned }]); }
      return res(200, [{ referrer_user_id: u.id, rewarded: false, pro_months_earned: u.pro_months_earned }]);
    }
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/); const t = m[1]; const q = new URLSearchParams(m[2] || '');
    if (method === 'POST') {
      const row = { id: `id${++n}`, created_at: new Date().toISOString(), pro_months_earned: 0, ...JSON.parse(o.body) };
      if (t === 'users' && db.users.some((u) => u.email === row.email)) return res(409, 'dup');
      if (t === 'users' && row.referral_code && db.users.some((u) => u.referral_code === row.referral_code)) return res(409, 'dup');
      if (t === 'referrals') {
        if (row.referee_user_id && db.referrals.some((r) => r.referee_user_id === row.referee_user_id)) return res(409, 'dup');
        if (row.invitee_hash && db.referrals.some((r) => r.referrer_user_id === row.referrer_user_id && r.invitee_hash === row.invitee_hash)) return res(409, 'dup');
        Object.assign(row, { status: 'invited', source: 'link', referee_user_id: null, ...JSON.parse(o.body) });
      }
      if (t === 'email_suppressions' && db.email_suppressions.some((u) => u.email_hash === row.email_hash)) return res(409, 'dup');
      db[t].push(row); return res(201, [row]);
    }
    const hit = db[t].filter((r) => match(r, q));
    if (method === 'PATCH') { const body = JSON.parse(o.body);
      if (t === 'users' && body.referral_code && db.users.some((u) => u.referral_code === body.referral_code)) return res(409, 'dup');
      hit.forEach((r) => Object.assign(r, body)); return res(200, hit); }
    if (method === 'DELETE') { db[t] = db[t].filter((r) => !hit.includes(r)); return res(204); }
    return res(200, hit);
  };
  return { f, db, calls, sends: () => calls.filter((c) => c.url.includes('resend')).map((c) => ({ ...JSON.parse(c.body), key: c.headers['Idempotency-Key'] })) };
}
const dbOf = (F) => ({ select: (p) => F.f(`https://x/rest/v1/${p}`).then((r) => r.json()), insert: async (t, row) => { const r = await F.f(`https://x/rest/v1/${t}`, { method: 'POST', body: JSON.stringify(row) }); if (!r.ok) { const e = new Error('x'); e.status = r.status; throw e; } return (await r.json())[0]; },
  patch: (p, b) => F.f(`https://x/rest/v1/${p}`, { method: 'PATCH', body: JSON.stringify(b) }).then(async (r) => { if (!r.ok) { const e = new Error('x'); e.status = r.status; throw e; } return r.json(); }),
  remove: (p) => F.f(`https://x/rest/v1/${p}`, { method: 'DELETE' }), rpc: (fn, a) => F.f(`https://x/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(a) }).then((r) => r.json()) });
const user = (F, email, extra = {}) => { const u = { id: `u${F.db.users.length + 1}`, email, email_opt_out_at: null, pro_months_earned: 0, referral_code: null, ...extra }; F.db.users.push(u); return u; };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const noLimit = async () => false;
const req = (path, body, origin = ORIGIN, headers = {}) => new Request(`https://x${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const deps = (F, extra = {}) => ({ allowedOrigins: ALLOWED, rateLimited: noLimit, sb: dbOf(F), fetchImpl: F.f, ...extra });
const read = async (r) => ({ status: r.status, ...(await r.json()) });

// ---- codes, tokens, links
{
  const codes = new Set(Array.from({ length: 500 }, newCode));
  check([...codes].every((c) => CODE_RE.test(c)) && codes.size === 500, 'codes: 8 characters from an alphabet without 0/O/1/I, no repeats in 500 draws');
  const code = 'ABCDEFGH'; const tok = await manageToken('s3cret', code);
  check(await verifyManageToken('s3cret', code, tok) && !(await verifyManageToken('s3cret', 'ABCDEFGJ', tok)) && !(await verifyManageToken('other', code, tok)) && !(await verifyManageToken('', code, tok)) && !(await verifyManageToken('s3cret', code, tok.slice(1))), 'manage token: bound to the code and the secret; rejects tampering, another code, no secret');
  check(!tok.includes(code) && tok !== await manageToken('s3cret', 'ABCDEFGJ'), 'manage token is not the code (knowing the public code is not enough to send invites)');
  check(shareUrl({}, code) === 'https://myprivacytool.io/invite?ref=ABCDEFGH' && (await manageUrl({ UNSUBSCRIBE_SECRET: 's3cret' }, code)) === `https://myprivacytool.io/invite#c=${code}&t=${tok}`, 'links: share link carries the code; the private link keeps the token in the fragment (never sent to a server)');
  check(mailbox('A.B+x@Gmail.com') === 'ab@gmail.com' && mailbox('ab@googlemail.com') === 'ab@gmail.com' && mailbox('A.b@corp.com') === 'a.b@corp.com', 'mailbox: gmail dots/+tags/googlemail collapse, other domains left alone');
  check(referralsEnabled({ REFERRALS_ENABLED: 'true' }) && ['', 'false', 'TRUE', '1', undefined].every((v) => !referralsEnabled({ REFERRALS_ENABLED: v })), 'switch: only exactly "true" turns it on');
}

// ---- ensureReferralCode
{
  const F = fake(); const u = user(F, 'a@example.com'); const sb = dbOf(F);
  const c1 = await ensureReferralCode(sb, u.id); const c2 = await ensureReferralCode(sb, u.id);
  check(CODE_RE.test(c1) && c1 === c2 && F.db.users[0].referral_code === c1, 'ensureReferralCode: created once, then reused');
}

// ---- attachReferral
{
  const F = fake(); const sb = dbOf(F); const ref = user(F, 'ref.erer@gmail.com', { referral_code: 'ABCDEFGH' });
  const a = user(F, 'friend@example.com');
  check(await attachReferral(sb, { ref: 'ABCDEFGH', userId: a.id, email: a.email, isNewUser: true }) && F.db.referrals.length === 1 && F.db.referrals[0].status === 'signed_up' && F.db.referrals[0].referrer_user_id === ref.id && F.db.referrals[0].source === 'link', 'attach: a new user arriving with a valid code is linked (signed_up)');
  check(JSON.stringify(F.db.referrals).indexOf('friend@example.com') === -1 && F.db.referrals[0].invitee_hash === await emailHash('friend@example.com'), 'attach: only the hash of the friend\'s address is stored');
  check(!(await attachReferral(sb, { ref: 'ABCDEFGH', userId: a.id, email: a.email, isNewUser: true })) && F.db.referrals.length === 1, 'attach: a person is referred once (second attempt refused)');
  const b = user(F, 'old@example.com');
  check(!(await attachReferral(sb, { ref: 'ABCDEFGH', userId: b.id, email: b.email, isNewUser: false })), 'attach: an existing user cannot be referred after the fact');
  const s = user(F, 'referer@gmail.com');
  check(!(await attachReferral(sb, { ref: 'ABCDEFGH', userId: s.id, email: 'refer.er+me@gmail.com', isNewUser: true })) && !(await attachReferral(sb, { ref: 'ABCDEFGH', userId: ref.id, email: ref.email, isNewUser: true })), 'attach: self-referral refused, including a second spelling of the same gmail mailbox');
  check(!(await attachReferral(sb, { ref: 'ZZZZZZZZ', userId: b.id, email: 'n@example.com', isNewUser: true })) && !(await attachReferral(sb, { ref: 'bad', userId: b.id, email: 'n@example.com', isNewUser: true })) && !(await attachReferral(sb, { ref: undefined, userId: b.id, email: 'n@example.com', isNewUser: true })), 'attach: unknown or malformed code does nothing');
}

// ---- invite endpoint
const mk = async (F, extra = {}) => { const u = user(F, 'me@example.com', { referral_code: 'ABCDEFGH', ...extra }); return { u, token: await manageToken('s3cret', 'ABCDEFGH') }; };
{
  const F = fake(); const { token } = await mk(F);
  const body = (emails, t = token) => ({ code: 'ABCDEFGH', token: t, emails });
  check((await handleReferralInvite({ ...ON, REFERRALS_ENABLED: 'false' }, req('/x', body(['a@b.co'])), ORIGIN, json, deps(F))).status === 404 && F.calls.length === 0, 'invite: switch off => 404, no database call, no email');
  check((await handleReferralInvite(ON, req('/x', body(['a@b.co'])), 'https://evil.example', json, deps(F))).status === 403, 'invite: foreign Origin => 403');
  check((await handleReferralInvite(ON, req('/x', body(['a@b.co'])), ORIGIN, json, deps(F, { rateLimited: async () => true }))).status === 429, 'invite: rate limited => 429');
  check((await handleReferralInvite({ ...ON, UNSUBSCRIBE_SECRET: undefined }, req('/x', body(['a@b.co'])), ORIGIN, json, deps(F))).status === 503, 'invite: no signing secret => 503 (nothing can be sent without a working unsubscribe link)');
  check((await handleReferralInvite(ON, req('/x', body(['a@b.co'], 'deadbeef')), ORIGIN, json, deps(F))).status === 403 && (await handleReferralInvite(ON, req('/x', { code: 'ABCDEFGH', emails: ['a@b.co'] }), ORIGIN, json, deps(F))).status === 403 && F.sends().length === 0, 'invite: public code without the manage token => 403, nothing sent');
  check((await handleReferralInvite(ON, req('/x', '{bad'), ORIGIN, json, deps(F))).status === 400 && (await handleReferralInvite(ON, req('/x', body(['not-an-email'])), ORIGIN, json, deps(F))).status === 400 && (await handleReferralInvite(ON, req('/x', body(['a@b.co', 'b@b.co', 'c@b.co', 'd@b.co'])), ORIGIN, json, deps(F))).status === 400, 'invite: bad JSON, no valid address, or more than 3 at once => 400');
  const r = await read(await handleReferralInvite(ON, req('/x', body(['Friend@Example.com', 'friend@example.com', 'me@example.com', 'a@example.com', 'b@example.com'])), ORIGIN, json, deps(F)));
  // 4 distinct addresses after dedupe/case folding is over the limit of 3, so ask for a valid set:
  check(r.status === 400, 'invite: the 3-at-a-time limit counts distinct addresses');
  const r2 = await read(await handleReferralInvite(ON, req('/x', body(['Friend@Example.com', 'friend@example.com', 'me@example.com'])), ORIGIN, json, deps(F)));
  check(r2.status === 200 && r2.sent === 1 && r2.skipped === 1 && F.sends().length === 1 && F.sends()[0].to[0] === 'friend@example.com', 'invite: case/duplicates folded, your own address skipped, one email sent');
}
{
  const F = fake(); const { u, token } = await mk(F); const body = (emails) => ({ code: 'ABCDEFGH', token, emails });
  F.db.users.push({ id: 'uX', email: 'member@example.com', email_opt_out_at: null });
  F.db.users.push({ id: 'uY', email: 'out@example.com', email_opt_out_at: '2026-01-01' });
  F.db.email_suppressions.push({ email_hash: await emailHash('stop@example.com') });
  const r = await read(await handleReferralInvite(ON, req('/x', body(['member@example.com', 'stop@example.com', 'out@example.com'])), ORIGIN, json, deps(F)));
  check(r.status === 200 && r.sent === 0 && r.skipped === 3 && F.sends().length === 0 && F.db.referrals.length === 0, 'invite: existing members, opted-out users and suppressed addresses are never mailed and leave no row');
  const ok1 = await read(await handleReferralInvite(ON, req('/x', body(['Friend@Example.com'])), ORIGIN, json, deps(F)));
  const mail = F.sends()[0]; const call = F.calls.find((c) => c.url.includes('resend'));
  check(ok1.sent === 1 && F.db.referrals.length === 1 && F.db.referrals[0].invitee_hash === await emailHash('friend@example.com') && F.db.referrals[0].invite_email_sent_at && F.db.referrals[0].source === 'invite_email', 'invite: one row per friend with the hash and send time');
  check(!JSON.stringify(F.db.referrals).includes('friend@') && !JSON.stringify(F.db.referrals).includes('example.com'), 'invite: no readable invitee address anywhere in the stored rows');
  check(mail.key === `referral-invite-${u.id}-${await emailHash('friend@example.com')}` && /List-Unsubscribe/.test(JSON.stringify(mail.headers)) && mail.html.includes('/unsubscribe?e=friend%40example.com') && mail.text.includes('/invite?ref=ABCDEFGH') && !mail.text.includes('me@example.com') && !mail.html.includes('me@example.com'), 'invite email: idempotency key, one-click unsubscribe, the share link, never the referrer\'s address');
  check(/only (?:send|email)|never send it twice|will not email you again/i.test(mail.text) && !/reminder|last chance|don't miss|free month|Pro/i.test(mail.text), 'invite email: says it is a one-off, no reminders, no reward pitch to the friend');
  void call;
  const dup = await read(await handleReferralInvite(ON, req('/x', body(['friend@example.com'])), ORIGIN, json, deps(F)));
  check(dup.sent === 0 && F.sends().length === 1 && F.db.referrals.length === 1, 'invite: the same friend is never invited twice by the same person');
}
{
  const F = fake({ resendFail: true }); const { token } = await mk(F);
  const r = await read(await handleReferralInvite(ON, req('/x', { code: 'ABCDEFGH', token, emails: ['f@example.com'] }), ORIGIN, json, deps(F)));
  check(r.status === 200 && r.sent === 0 && F.db.referrals.length === 0, 'invite: a failed send leaves no row, so it does not use up an invitation');
}
{
  const F = fake(); const { token } = await mk(F); const sb = dbOf(F);
  for (let i = 0; i < MAX_INVITES - 1; i++) F.db.referrals.push({ id: `r${i}`, referrer_user_id: 'u1', invitee_hash: `h${i}`, status: 'invited' });
  const body = (emails) => ({ code: 'ABCDEFGH', token, emails });
  const last = await read(await handleReferralInvite(ON, req('/x', body(['a@example.com', 'b@example.com'])), ORIGIN, json, deps(F)));
  check(last.sent === 1 && F.sends().length === 1, `invite: lifetime cap of ${MAX_INVITES} trims the request to what is left`);
  check((await handleReferralInvite(ON, req('/x', body(['c@example.com'])), ORIGIN, json, deps(F))).status === 429 && F.sends().length === 1, 'invite: past the cap => 429, nothing sent');
  void sb;
}
{
  const F = fake(); const { token } = await mk(F, { email_opt_out_at: '2026-02-01' });
  check((await handleReferralInvite(ON, req('/x', { code: 'ABCDEFGH', token, emails: ['f@example.com'] }), ORIGIN, json, deps(F))).status === 403 && F.sends().length === 0, 'invite: someone who unsubscribed cannot send invitations from us');
  const G = fake(); const t2 = (await mk(G)).token;
  const held = await read(await handleReferralInvite({ ...ON, RECIPIENT_ALLOWLIST: 'qa@example.org' }, req('/x', { code: 'ABCDEFGH', token: t2, emails: ['f@example.com'] }), ORIGIN, json, deps(G, { allowed: (env, e) => String(env.RECIPIENT_ALLOWLIST).split(',').includes(e) })));
  check(held.sent === 0 && G.sends().length === 0 && G.db.referrals.length === 0, 'invite: a recipient outside the test allowlist is held (no email, no row)');
}

// ---- status endpoint
{
  const F = fake(); const { u, token } = await mk(F, { pro_months_earned: 2 });
  F.db.referrals.push({ id: 'a', referrer_user_id: u.id, invitee_hash: 'x'.repeat(64), status: 'completed' }, { id: 'b', referrer_user_id: u.id, invitee_hash: 'y'.repeat(64), status: 'invited' }, { id: 'c', referrer_user_id: u.id, invitee_hash: null, status: 'signed_up' }, { id: 'd', referrer_user_id: 'other', invitee_hash: 'z'.repeat(64), status: 'completed' });
  const s = await read(await handleReferralStatus(ON, req('/x', { code: 'ABCDEFGH', token }), ORIGIN, json, deps(F)));
  check(s.status === 200 && s.completed === 1 && s.signed_up === 2 && s.invites_sent === 2 && s.invites_left === MAX_INVITES - 2 && s.months_earned === 2 && s.share_url.endsWith('/invite?ref=ABCDEFGH') && s.max_months === 12, 'status: counts only this referrer\'s friends (completed, signed up, invitations used and left, months earned)');
  check(!JSON.stringify(s).includes('@') && !JSON.stringify(s).includes('xxxx'), 'status: no addresses or hashes in the answer');
  check((await handleReferralStatus(ON, req('/x', { code: 'ABCDEFGH', token: 'nope' }), ORIGIN, json, deps(F))).status === 403 && (await handleReferralStatus({ ...ON, REFERRALS_ENABLED: undefined }, req('/x', { code: 'ABCDEFGH', token }), ORIGIN, json, deps(F))).status === 404, 'status: wrong token => 403; switch off => 404');
}

// ---- invited friend later signs up through the link: the invited row is upgraded, not duplicated
{
  const F = fake(); const sb = dbOf(F); const ref = user(F, 'ref@example.com', { referral_code: 'ABCDEFGH' });
  F.db.referrals.push({ id: 'inv', referrer_user_id: ref.id, invitee_hash: await emailHash('pal@example.com'), referee_user_id: null, status: 'invited', source: 'invite_email' });
  const pal = user(F, 'pal@example.com');
  check(await attachReferral(sb, { ref: 'ABCDEFGH', userId: pal.id, email: pal.email, isNewUser: true }) && F.db.referrals.length === 1 && F.db.referrals[0].status === 'signed_up' && F.db.referrals[0].referee_user_id === pal.id && F.db.referrals[0].source === 'invite_email', 'invited friend signs up: the invitation row becomes signed_up (one row)');
}

// ---- completion and reward
{
  const F = fake(); const sb = dbOf(F); const ref = user(F, 'ref@example.com', { referral_code: 'ABCDEFGH' }); const fr = user(F, 'friend@example.com');
  F.db.referrals.push({ id: 'r', referrer_user_id: ref.id, referee_user_id: fr.id, status: 'signed_up' });
  const o = await completeReferral(ON, sb, fr.id, F.f);
  const mails = F.sends();
  check(o.completed && o.rewarded && ref.pro_months_earned === 1 && F.db.referrals[0].status === 'completed' && mails.length === 1 && mails[0].to[0] === 'ref@example.com' && /free month of Pro/i.test(mails[0].text) && mails[0].key === `referral-reward-${fr.id}`, 'complete: the friend\'s report credits the referrer one month and tells them (once)');
  check(!mails[0].text.includes('friend@') && !mails[0].html.includes('friend@') && /not on sale yet/i.test(mails[0].text), 'reward email: never names the friend; says Pro is not on sale yet');
  const again = await completeReferral(ON, sb, fr.id, F.f);
  check(!again.completed && ref.pro_months_earned === 1 && F.sends().length === 1, 'complete: a second call changes nothing and sends nothing (at most one reward per friend)');
  check(!(await completeReferral(ON, sb, 'nobody', F.f)).completed, 'complete: a user nobody referred is a no-op');
}
{
  const F = fake(); const sb = dbOf(F); const ref = user(F, 'ref@example.com', { referral_code: 'ABCDEFGH', pro_months_earned: 12 }); const fr = user(F, 'f@example.com');
  F.db.referrals.push({ id: 'r', referrer_user_id: ref.id, referee_user_id: fr.id, status: 'signed_up' });
  const o = await completeReferral(ON, sb, fr.id, F.f);
  check(o.completed && !o.rewarded && ref.pro_months_earned === 12 && F.sends().length === 0 && !F.db.referrals[0].rewarded_at, 'complete: past the 12-month cap the referral counts as completed but earns nothing and sends nothing');
  const G = fake(); const ref2 = user(G, 'out@example.com', { referral_code: 'ABCDEFGH', email_opt_out_at: '2026-01-01' }); const fr2 = user(G, 'f@example.com');
  G.db.referrals.push({ id: 'r', referrer_user_id: ref2.id, referee_user_id: fr2.id, status: 'signed_up' });
  const o2 = await completeReferral(ON, dbOf(G), fr2.id, G.f);
  check(o2.rewarded && ref2.pro_months_earned === 1 && G.sends().length === 0, 'complete: an unsubscribed referrer still earns the month but gets no email');
  const H = fake({ resendFail: true }); const ref3 = user(H, 'r@example.com', { referral_code: 'ABCDEFGH' }); const fr3 = user(H, 'f@example.com');
  H.db.referrals.push({ id: 'r', referrer_user_id: ref3.id, referee_user_id: fr3.id, status: 'signed_up' });
  check((await completeReferral(ON, dbOf(H), fr3.id, H.f)).completed && ref3.pro_months_earned === 1, 'complete: a failed notification email never undoes the reward');
  const bad = { select: async () => { throw new Error('db down for x@y.com'); }, rpc: async () => { throw new Error('db down for x@y.com'); } };
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  const o3 = await completeReferral(ON, bad, 'u', F.f); console.error = orig;
  check(o3.error && !o3.completed && !logs.join().includes('x@y.com'), 'complete: a database error is swallowed (the report is already sent) and the address is not logged');
}

// ---- report email block
{
  const link = await manageUrl(ON, 'ABCDEFGH');
  const block = referralBlock({ shareLink: shareUrl(ON, 'ABCDEFGH'), manageLink: link });
  const scan = { ...computeScore([], new Set(['email'])), id: 's1' };
  const withIt = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', brokers: [], referral: block });
  const without = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', brokers: [] });
  check(withIt.text.includes('INVITE 3 FRIENDS') && withIt.html.includes('Invite 3 friends') && withIt.text.includes(link) && withIt.html.includes('/invite#c=ABCDEFGH&amp;t=') && /not on sale yet/.test(withIt.text), 'report email: the block carries the share link and the private link, and says Pro is not on sale yet');
  check(!/invite/i.test(without.text) && !/invite/i.test(without.html) && withIt.html.length < 100 * 1024, 'report email: no block when referrals are off; HTML stays under 100 KB');
  check(!/\/invite#[^"'\s]*utm_/.test(withIt.html + withIt.text) && tagLinks(`see ${link}`, 'c') === `see ${link}` && withIt.html.includes('/invite?ref=ABCDEFGH&amp;utm_source=email'), 'report email: the private link is never UTM-tagged, the public share link is');
}

// ---- wiring through the HTTP layer and handleScan
{
  const F = fake(); const ref = user(F, 'ref@example.com', { referral_code: 'ABCDEFGH' });
  globalThis.fetch = F.f; const w = [];
  const rs = await worker.fetch(req('/api/scan', { email: 'new.friend@example.com', consent: true, ref: 'abcdefgh' }), { ...ON, SUPABASE_URL: 'https://x' }, { waitUntil: (p) => w.push(p) }); await Promise.all(w);
  check(rs.status === 200 && F.db.referrals.length === 1 && F.db.referrals[0].referrer_user_id === ref.id && F.db.referrals[0].status === 'signed_up', 'POST /api/scan with ref (any case): a new friend is linked to the referrer');
  const G = fake(); user(G, 'ref@example.com', { referral_code: 'ABCDEFGH' }); globalThis.fetch = G.f;
  await worker.fetch(req('/api/scan', { email: 'new.friend@example.com', consent: true, ref: 'ABCDEFGH' }), { ...ON, REFERRALS_ENABLED: 'false' }, { waitUntil: (p) => w.push(p) }); await Promise.all(w);
  check(G.db.referrals.length === 0 && G.db.users.length === 2, 'POST /api/scan with the switch off: ref is ignored, the scan request works as before');
  const H = fake(); const r2 = user(H, 'ref@example.com', { referral_code: 'ABCDEFGH' }); user(H, 'old@example.com');
  await handleScan(ON, null, { email: 'old@example.com', consentSource: 'scan_page', ip: null, utm: { source: '', medium: '', campaign: '', content: '', referrer: '' }, ref: 'ABCDEFGH' }, H.f);
  check(H.db.referrals.length === 0 && r2.pro_months_earned === 0, 'handleScan: an existing user using someone\'s link earns nobody anything');
  const tok = await manageToken('s3cret', 'ABCDEFGH'); globalThis.fetch = F.f;
  const inv = await worker.fetch(req('/api/referral/invite', { code: 'ABCDEFGH', token: tok, emails: ['pal@example.com'] }), ON, {});
  const st = await worker.fetch(req('/api/referral/status', { code: 'ABCDEFGH', token: tok }), ON, {});
  check(inv.status === 200 && st.status === 200 && (await worker.fetch(req('/api/referral/status', { code: 'ABCDEFGH', token: tok }), { ...ON, REFERRALS_ENABLED: 'false' }, {})).status === 404, 'worker routes /api/referral/invite and /api/referral/status (404 when off)');
}

// ---- A/B tests across the funnel (MPC-7645): off = control and nothing recorded; on = stable split, stored, tagged on the links
{
  const OFF = ON; const AB = { ...ON, REFERRAL_AB_INVITE_SUBJECT: 'true', REFERRAL_AB_REPORT_BLOCK: 'true' };
  check(['', 'false', 'TRUE', '1', undefined].every((v) => !abOn({ REFERRAL_AB_INVITE_SUBJECT: v }, 'invite_subject')) && abOn(AB, 'report_block'), 'A/B: each test is on only when its switch is exactly "true"');
  check((await abVariant(OFF, 'invite_subject', 'seed')) === 'control' && (await abVariant(OFF, 'report_block', 'seed')) === 'control', 'A/B off: always the control');
  const seen = { report_block: new Set(), invite_subject: new Set() };
  for (let i = 0; i < 200; i++) for (const id of Object.keys(seen)) seen[id].add(await abVariant(AB, id, `s${i}`));
  check(Object.entries(seen).every(([id, set]) => set.size === AB_TESTS[id].variants.length && [...set].every((v) => isVariant(id, v))) && (await abVariant(AB, 'invite_subject', 'same')) === (await abVariant(AB, 'invite_subject', 'same')), 'A/B on: both variants are handed out, the same seed always gets the same one');
  check(!isVariant('report_block', 'evil') && isVariant('invite_subject', 'specific_subject'), 'A/B: only known variants are accepted');

  const ctl = buildInviteEmail({ shareLink: 'https://myprivacytool.io/invite?ref=ABCDEFGH', unsubscribeLink: 'https://x/u' });
  const alt = buildInviteEmail({ shareLink: 'https://myprivacytool.io/invite?ref=ABCDEFGH', unsubscribeLink: 'https://x/u', variant: 'specific_subject' });
  check(ctl.subject !== alt.subject && ctl.html.split(ctl.subject).join('') === alt.html.split(alt.subject).join('') && ctl.text === alt.text, 'invite email: only the subject line differs between variants');
  const bc = referralBlock({ shareLink: 'https://myprivacytool.io/invite?ref=ABCDEFGH', manageLink: 'https://myprivacytool.io/invite#c=ABCDEFGH&t=x' });
  const bf = referralBlock({ shareLink: 'https://myprivacytool.io/invite?ref=ABCDEFGH', manageLink: 'https://myprivacytool.io/invite#c=ABCDEFGH&t=x', variant: 'friend_first' });
  check(bc.text.includes('INVITE 3 FRIENDS') && bf.text.includes('KNOW SOMEONE') && [bc, bf].every((b) => b.text.includes('not on sale yet') && b.html.includes('not on sale yet') && b.text.includes('#c=ABCDEFGH')), 'report block: both variants carry the same honest reward line and the private link');
  check(referralBlock({ shareLink: 'x', manageLink: 'y', variant: 'nope' }).text.includes('INVITE 3 FRIENDS'), 'report block: an unknown variant falls back to the control');

  // invitations record and tag the variant only while the test is on
  const F = fake(); const { u, token } = await mk(F);
  await handleReferralInvite(AB, req('/x', { code: 'ABCDEFGH', token, emails: ['a@example.com', 'b@example.com', 'c@example.com'] }), ORIGIN, json, deps(F));
  const mails = F.sends();
  check(mails.length === 3 && F.db.referrals.length === 3 && F.db.referrals.every((r) => isVariant('invite_subject', r.invite_variant)), 'A/B on: every invitation row records its variant');
  check(mails.every((m, i) => { const row = F.db.referrals.find((r) => r.invitee_hash === m.key.slice(`referral-invite-${u.id}-`.length)); return m.subject === buildInviteEmail({ shareLink: 'x', unsubscribeLink: 'y', variant: row.invite_variant }).subject && m.text.includes(`&iv=${row.invite_variant}`); }), 'A/B on: the subject matches the recorded variant and the link carries it (iv=)');
  const G = fake(); const g = await mk(G);
  await handleReferralInvite(OFF, req('/x', { code: 'ABCDEFGH', token: g.token, emails: ['a@example.com'] }), ORIGIN, json, deps(G));
  check(G.db.referrals.length === 1 && !('invite_variant' in G.db.referrals[0]) && !G.sends()[0].text.includes('iv=') && G.sends()[0].subject === ctl.subject, 'A/B off: control subject, no variant stored, no iv on the link');
}

// ---- tester mode: REFERRALS_TEST_RECIPIENTS limits every referral feature to the listed addresses
{
  const T = { ...ON, REFERRALS_TEST_RECIPIENTS: ' Tester.One+x@gmail.com , b@example.org ' };
  check(referralTester(T, 'testerone@gmail.com') && referralTester(T, 'B@Example.org') && !referralTester(T, 'real@person.com') && !referralTester({ ...T, REFERRALS_ENABLED: 'false' }, 'b@example.org'), 'tester mode: listed addresses only (gmail dots/+tags ignored, case ignored); off means off for everyone');
  check(referralTester(ON, 'anyone@example.com') && referralTester({ ...ON, REFERRALS_TEST_RECIPIENTS: '  ,' }, 'anyone@example.com'), 'tester list unset or blank: everyone (clearing the secret opens the programme)');

  // a non-tester referrer cannot use the endpoints, even with a valid token (same answer as a wrong link)
  const F = fake(); user(F, 'real@person.com', { referral_code: 'ABCDEFGH' }); const tok = await manageToken('s3cret', 'ABCDEFGH');
  check((await handleReferralInvite(T, req('/x', { code: 'ABCDEFGH', token: tok, emails: ['b@example.org'] }), ORIGIN, json, deps(F))).status === 403 && F.sends().length === 0
    && (await handleReferralStatus(T, req('/x', { code: 'ABCDEFGH', token: tok }), ORIGIN, json, deps(F))).status === 403, 'tester mode: a referrer who is not listed gets 403 on invite and status, nothing sent');

  // a tester may only invite other testers
  const G = fake(); user(G, 'b@example.org', { referral_code: 'ABCDEFGH' });
  const r = await read(await handleReferralInvite(T, req('/x', { code: 'ABCDEFGH', token: tok, emails: ['stranger@example.com', 'tester.one@gmail.com'] }), ORIGIN, json, deps(G)));
  check(r.status === 200 && r.sent === 1 && G.sends().length === 1 && G.sends()[0].to[0] === 'tester.one@gmail.com' && G.db.referrals.length === 1, 'tester mode: invitations to anyone not listed are skipped (no email, no row)');

  // reward email only to a listed referrer
  const H = fake(); const out = user(H, 'real@person.com', { referral_code: 'ABCDEFGH' }); const fr = user(H, 'b@example.org');
  H.db.referrals.push({ id: 'r', referrer_user_id: out.id, referee_user_id: fr.id, status: 'signed_up' });
  const o = await completeReferral(T, dbOf(H), fr.id, H.f);
  check(o.completed && out.pro_months_earned === 1 && H.sends().length === 0, 'tester mode: an unlisted referrer is credited but never emailed');

  // attach and report block through the HTTP layer
  const W = fake(); user(W, 'b@example.org', { referral_code: 'ABCDEFGH' }); globalThis.fetch = W.f; const w = [];
  await worker.fetch(req('/api/scan', { email: 'stranger@example.com', consent: true, ref: 'ABCDEFGH' }), T, { waitUntil: (p) => w.push(p) }); await Promise.all(w);
  check(W.db.referrals.length === 0, 'tester mode: an unlisted visitor arriving with a code is not linked');
  await worker.fetch(req('/api/scan', { email: 'tester.one@gmail.com', consent: true, ref: 'ABCDEFGH' }), T, { waitUntil: (p) => w.push(p) }); await Promise.all(w);
  check(W.db.referrals.length === 1 && W.db.referrals[0].status === 'signed_up', 'tester mode: a listed visitor arriving with a code is linked');
}

console.log(ok ? '\nreferral tests: all passed' : '\nreferral tests: FAILURES');
process.exit(ok ? 0 : 1);
