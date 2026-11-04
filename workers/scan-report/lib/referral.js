// MPC-7645: referral programme ("Invite 3 friends"). Off unless REFERRALS_ENABLED === 'true' (wrangler.toml: "false").
// Design and go-live steps: docs/referral-program-mpc-7645.md. Privacy rules built in:
//  - the referral CODE is public (it is in the share link); sending invites and reading progress need the signed manage TOKEN,
//    which only goes to the referrer in their own report email;
//  - an invited address is never stored readable (SHA-256 only), is checked against opt-outs and suppressions first, is mailed once,
//    and gets no reminder;
//  - answers never say whether an address is already a user or opted out (they only count what was sent).
import { hmac, unsubscribePageUrl, unsubscribeUrl } from './onboarding.js';
import { emailHash, suppressedAmong } from './suppression.js';
import { buildInviteEmail, buildRewardEmail } from './referralEmail.js';
import { sendEmail } from './email.js';
import { readCappedJson } from './webScan.js';
import { abOn, abVariant } from './referralAb.js';

export const referralsEnabled = (env) => env.REFERRALS_ENABLED === 'true';
// Tester mode: while REFERRALS_TEST_RECIPIENTS (a Worker secret, comma separated) lists addresses, referral features apply to those addresses ONLY
// (report block, invite page and invitations, invited friends, reward emails). Everyone else's reports and scans are unchanged. Unset or empty = everyone.
// Clearing the secret is what opens the programme to all users. Same gmail dot/+tag matching as the other allowlists.
export const referralTester = (env, email) => {
  if (!referralsEnabled(env)) return false;
  const list = String(env.REFERRALS_TEST_RECIPIENTS || '').split(',').map((e) => e.trim()).filter(Boolean);
  return list.length === 0 || list.map(mailbox).includes(mailbox(email));
};
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
export const MAX_PER_REQUEST = 3;      // "Invite 3 friends"
export const MAX_INVITES = 10;         // lifetime invite emails per referrer (stops the form being used to mail strangers)
export const MAX_REWARD_MONTHS = 12;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 symbols, no 0/O/1/I: a byte & 31 is unbiased

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b & 31]).join('');
}
export const manageToken = (secret, code) => hmac(secret, `referral:${code}`);
export async function verifyManageToken(secret, code, token) {
  if (!secret || !code || !token) return false;
  const want = await manageToken(secret, code);
  if (want.length !== String(token).length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ String(token).charCodeAt(i);
  return d === 0;
}
// `iv` = the invite_subject variant the friend was mailed under (only while that test runs), so the landing page can count the visit per variant.
export const shareUrl = (env, code, iv) => `${env.SITE_URL || 'https://myprivacytool.io'}/invite?ref=${code}${iv ? `&iv=${iv}` : ''}`;
// The token travels in the URL fragment: it is not sent to the site's server or logged by it, and the page removes it from the address bar.
export async function manageUrl(env, code, v) { return `${env.SITE_URL || 'https://myprivacytool.io'}/invite#c=${code}&t=${await manageToken(env.UNSUBSCRIBE_SECRET, code)}${v ? `&v=${v}` : ''}`; }

// gmail "+tag" and dots are ignored, so a person cannot refer themselves with a second spelling of the same mailbox.
export const mailbox = (e) => { const [l, d] = String(e).trim().toLowerCase().split('@'); return d === 'gmail.com' || d === 'googlemail.com' ? `${l.split('+')[0].replace(/\./g, '')}@gmail.com` : `${l}@${d}`; };

export async function ensureReferralCode(sb, userId) {
  const get = async () => (await sb.select(`users?id=eq.${userId}&select=referral_code&limit=1`))[0]?.referral_code || null;
  const have = await get();
  if (have) return have;
  for (let i = 0; i < 5; i++) {
    try {
      const set = await sb.patch(`users?id=eq.${userId}&referral_code=is.null`, { referral_code: newCode() });
      if (set.length) return set[0].referral_code;
      return await get();            // another run set it first
    } catch (e) { if (e.status !== 409) throw e; }   // 409 = that code is taken, draw another
  }
  return null;
}

// A brand-new user arrived with ?ref=CODE. Returns true when the friend is now linked to the referrer.
export async function attachReferral(sb, { ref, userId, email, isNewUser }) {
  if (!isNewUser || !CODE_RE.test(String(ref || ''))) return false;
  const referrer = (await sb.select(`users?referral_code=eq.${ref}&select=id,email&limit=1`))[0];
  if (!referrer || referrer.id === userId || mailbox(referrer.email) === mailbox(email)) return false;
  const hash = await emailHash(email);
  const now = new Date().toISOString();
  try {
    const invited = await sb.patch(`referrals?referrer_user_id=eq.${referrer.id}&invitee_hash=eq.${hash}&referee_user_id=is.null`, { referee_user_id: userId, status: 'signed_up', signed_up_at: now });
    if (invited.length) return true;
    await sb.insert('referrals', { referrer_user_id: referrer.id, referee_user_id: userId, invitee_hash: hash, source: 'link', status: 'signed_up', signed_up_at: now });
    return true;
  } catch (e) { if (e.status === 409) return false; throw e; }   // 409 = already referred (or this exact address already linked)
}

// Called once the friend's report has been delivered. Credits the referrer and tells them. Never throws (the report is already sent).
export async function completeReferral(env, sb, refereeUserId, fetchImpl = fetch, allowed = () => true) {
  try {
    const row = (await sb.rpc('mpt_complete_referral', { p_referee_user_id: refereeUserId }))?.[0];
    if (!row) return { completed: false };
    if (row.rewarded && env.UNSUBSCRIBE_SECRET) {
      const u = (await sb.select(`users?id=eq.${row.referrer_user_id}&select=email,email_opt_out_at,referral_code&limit=1`))[0];
      if (u && !u.email_opt_out_at && !(await suppressedAmong(sb, [u.email])).has(String(u.email).trim().toLowerCase()) && allowed(env, u.email) && referralTester(env, u.email)) {   // MPC-7555: the reward email is not transactional; it honours THE opt-out
        const mail = buildRewardEmail({ months: row.pro_months_earned, manageLink: u.referral_code ? await manageUrl(env, u.referral_code) : null, unsubscribeLink: await unsubscribePageUrl(env, u.email) });
        const r = await sendEmail(env, { to: u.email, ...mail, idempotencyKey: `referral-reward-${refereeUserId}` }, fetchImpl);
        if (!r.sent) console.error('referral reward email not sent:', r.reason);
      }
    }
    return { completed: true, rewarded: Boolean(row.rewarded) };
  } catch (e) { console.error('referral completion failed:', String(e).replace(/\S+@\S+/g, '[email]')); return { completed: false, error: true }; }
}

async function authorise(env, b, sb) {
  const code = String(b?.code || '');
  if (!CODE_RE.test(code) || !(await verifyManageToken(env.UNSUBSCRIBE_SECRET, code, b?.token))) return null;
  const me = (await sb.select(`users?referral_code=eq.${code}&select=id,email,email_opt_out_at&limit=1`))[0] || null;
  return me && referralTester(env, me.email) ? me : null;   // tester mode: anyone else gets the same answer as a wrong link
}
const gate = async (env, request, origin, json, { allowedOrigins, rateLimited, prefix }) => {
  if (!referralsEnabled(env)) return json({ error: 'Not available' }, 404);
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (await rateLimited(env, request, prefix)) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.UNSUBSCRIBE_SECRET) return json({ error: 'Unavailable' }, 503);
  return null;
};

// POST /api/referral/status {code, token} -> progress for the manage page.
export async function handleReferralStatus(env, request, origin, json, deps) {
  const refused = await gate(env, request, origin, json, { ...deps, prefix: 'referral-status:' });
  if (refused) return refused;
  const read = await readCappedJson(request, 1024);
  if (read.status || !read.body || typeof read.body !== 'object') return json({ error: 'Invalid request' }, 400);
  const me = await authorise(env, read.body, deps.sb);
  if (!me) return json({ error: 'This link is not valid' }, 403);
  const [rows, user] = await Promise.all([
    deps.sb.select(`referrals?referrer_user_id=eq.${me.id}&select=status,invitee_hash`),
    deps.sb.select(`users?id=eq.${me.id}&select=pro_months_earned&limit=1`),
  ]);
  const sent = rows.filter((r) => r.invitee_hash).length;
  return json({ ok: true, code: String(read.body.code), share_url: shareUrl(env, String(read.body.code)),
    signed_up: rows.filter((r) => r.status !== 'invited').length, completed: rows.filter((r) => r.status === 'completed').length,
    months_earned: user[0]?.pro_months_earned ?? 0, invites_sent: sent, invites_left: Math.max(0, MAX_INVITES - sent), max_months: MAX_REWARD_MONTHS });
}

// POST /api/referral/invite {code, token, emails:[up to 3]} -> {ok, sent, skipped}. One plain email each, no reminders.
export async function handleReferralInvite(env, request, origin, json, deps) {
  const { sb, allowed = () => true, fetchImpl = fetch } = deps;
  const refused = await gate(env, request, origin, json, { ...deps, prefix: 'referral-invite:' });
  if (refused) return refused;
  const read = await readCappedJson(request, 2048);
  if (read.status || !read.body || typeof read.body !== 'object') return json({ error: 'Invalid request' }, 400);
  const me = await authorise(env, read.body, sb);
  if (!me) return json({ error: 'This link is not valid' }, 403);
  if (me.email_opt_out_at) return json({ error: 'Unavailable' }, 403);
  const raw = Array.isArray(read.body.emails) ? read.body.emails : [];
  const emails = [...new Set(raw.slice(0, 10).map((e) => String(e || '').trim().toLowerCase().slice(0, 255)).filter((e) => EMAIL_RE.test(e)))];
  if (!emails.length) return json({ error: 'Valid email required' }, 400);
  if (emails.length > MAX_PER_REQUEST) return json({ error: `Invite up to ${MAX_PER_REQUEST} friends at a time` }, 400);
  const used = (await sb.select(`referrals?referrer_user_id=eq.${me.id}&invitee_hash=not.is.null&select=id`)).length;
  if (used >= MAX_INVITES) return json({ error: 'You have used all your invitations' }, 429);
  const room = emails.slice(0, MAX_INVITES - used);

  const blocked = await suppressedAmong(sb, room);
  const known = new Set((await sb.select(`users?email=in.${encodeURIComponent(`(${room.map((e) => `"${e}"`).join(',')})`)}&select=email`)).map((u) => u.email.toLowerCase()));
  const code = String(read.body.code);
  let sent = 0;
  for (const email of room) {
    if (mailbox(email) === mailbox(me.email) || blocked.has(email) || known.has(email) || !allowed(env, email) || !referralTester(env, email)) continue;
    const hash = await emailHash(email);
    const iv = await abVariant(env, 'invite_subject', hash);          // 'control' when the test is off
    const tracked = abOn(env, 'invite_subject');
    try { await sb.insert('referrals', { referrer_user_id: me.id, invitee_hash: hash, source: 'invite_email', ...(tracked ? { invite_variant: iv } : {}) }); }
    catch (e) { if (e.status === 409) continue; throw e; }   // already invited by this person
    const mail = buildInviteEmail({ shareLink: shareUrl(env, code, tracked ? iv : undefined), unsubscribeLink: await unsubscribePageUrl(env, email), variant: iv });
    const r = await sendEmail(env, { to: email, ...mail, idempotencyKey: `referral-invite-${me.id}-${hash}`,
      headers: { 'List-Unsubscribe': `<${await unsubscribeUrl(env, email)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }, fetchImpl);
    if (r.sent) { sent++; await sb.patch(`referrals?referrer_user_id=eq.${me.id}&invitee_hash=eq.${hash}`, { invite_email_sent_at: new Date().toISOString() }).catch(() => {}); }
    else { console.error('referral invite not sent:', r.reason); await sb.remove(`referrals?referrer_user_id=eq.${me.id}&invitee_hash=eq.${hash}&referee_user_id=is.null`).catch(() => {}); }   // free the slot so they can try again
  }
  return json({ ok: true, sent, skipped: emails.length - sent });
}
