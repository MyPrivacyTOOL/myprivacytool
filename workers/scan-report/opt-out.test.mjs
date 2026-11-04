// MPC-7555: one opt-out. Opting out through ANY path stops every non-transactional sender, and transactional mail still works.
// Stubbed backend, no network. Run: node workers/scan-report/opt-out.test.mjs
import worker, { handleScan, runReportJob, runFollowUpJob } from './index.js';
import { completeReferral } from './lib/referral.js';
import { fake } from './test-support/fake-backend.mjs';
import { emailHash, isOptedOut, optOutEverywhere, suppressedAmong } from './lib/suppression.js';
import { unsubscribeToken } from './lib/onboarding.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const EMAIL = 'optout+a@example.com';
const env = { EMAIL_DOMAIN_CHECK: 'false', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HIBP_API_KEY: 'p', HIBP_MIN_INTERVAL_MS: '0', UNSUBSCRIBE_SECRET: 's3cret', REFERRALS_ENABLED: 'true', RECIPIENT_ALLOWLIST: EMAIL };
const input = { email: EMAIL, consentSource: 'scan_page', ip: '1.2.3.4', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' } };
const sends = (F) => F.calls.filter((c) => c.url.includes('api.resend.com'));
const sb = (F) => ({ rpc: async (fn, a) => (await F.f(`https://x/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(a) })).json(), select: (p) => F.f(`https://x/rest/v1/${p}`).then((r) => r.json()), patch: async (p, b) => (await F.f(`https://x/rest/v1/${p}`, { method: 'PATCH', body: JSON.stringify(b) })).json(), remove: async (p) => F.f(`https://x/rest/v1/${p}`, { method: 'DELETE' }), insert: async (t, row) => { const r = await F.f(`https://x/rest/v1/${t}`, { method: 'POST', body: JSON.stringify(row) }); if (!r.ok) { const e = new Error('x'); e.status = r.status; throw e; } return (await r.json())[0]; } });
const quiet = async (fn) => { const k = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = k; } };

// Each opt-out PATH leaves the world in a different state. THE opt-out is "users flag OR a suppression row", so each state must stop every sender.
const PATHS = {
  'signed unsubscribe link': async (F, e) => { globalThis.fetch = F.f; const t = await unsubscribeToken('s3cret', e); const w = []; const r = await worker.fetch(new Request(`https://x/api/unsubscribe?e=${encodeURIComponent(e)}&t=${t}`, { method: 'POST', headers: { Accept: 'application/json' } }), env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); return r.status === 200; },
  'HubSpot unsubscribe (suppression row only)': async (F, e) => { F.db.email_suppressions.push({ email_hash: await emailHash(e), source: 'hubspot_optout' }); return true; },
  'users column only (before the database trigger)': async (F, e) => { F.db.users.find((u) => u.email === e).email_opt_out_at = new Date().toISOString(); return true; },
};

for (const [name, optOut] of Object.entries(PATHS)) {
  // ---- follow-up (non-transactional): a sent report 4 days ago, then the person opts out
  let F = fake({ resendIdempotent: true }); globalThis.fetch = F.f;
  await quiet(async () => { await handleScan(env, null, input, F.f); await runReportJob(env, F.f); });
  F.db.scans[0].report_sent_at = new Date(Date.now() - 4 * 864e5).toISOString();
  const before = sends(F).length;
  check(await optOut(F, EMAIL), `${name}: the opt-out is recorded`);
  const afterOptOutSends = sends(F).length;   // the signed link sends the one unsubscribe confirmation
  const o = await quiet(() => runFollowUpJob(env, F.f));
  check(o.sent === 0 && sends(F).length === afterOptOutSends && F.db.scans[0].followup_stage !== 1, `${name}: the day-3 follow-up is NOT sent`);
  check(await isOptedOut(sb(F), EMAIL) && (await suppressedAmong(sb(F), [EMAIL, 'someone.else@example.com'])).size === 1, `${name}: isOptedOut / suppressedAmong see it, and only for that address`);

  // ---- referral reward (non-transactional): the opted-out person is the referrer
  const referrer = F.db.users.find((u) => u.email === EMAIL); referrer.referral_code = 'ABCDEFGH';
  const friend = { id: 'friend', email: 'friend@example.com', email_opt_out_at: null }; F.db.users.push(friend);
  F.db.referrals.push({ id: 'r', referrer_user_id: referrer.id, referee_user_id: friend.id, status: 'signed_up' });
  const n0 = sends(F).length;
  const r = await quiet(() => completeReferral({ ...env, RECIPIENT_ALLOWLIST: '' }, sb(F), friend.id, F.f));
  check(r.completed && sends(F).length === n0, `${name}: the referral reward email is NOT sent (the reward itself is still recorded)`);

  // ---- transactional still works: a NEW request from the same address gets its confirmation and its report
  F.db.scans.forEach((s) => { s.created_at = new Date(Date.now() - 3 * 864e5).toISOString(); });
  const n1 = sends(F).length;
  await quiet(async () => { await handleScan(env, null, input, F.f); await runReportJob(env, F.f); });
  const fresh = F.db.scans.find((s) => s.report_status === 'sent' && s.id !== F.db.scans[0].id);
  check(sends(F).length - n1 === 2 && fresh, `${name}: a request made AFTER the opt-out still gets its confirmation and its report (transactional)`);
}

// ---- one function does the whole opt-out
{
  const F = fake(); const s = sb(F);
  F.db.users.push({ id: 'u', email: 'x@example.com', email_opt_out_at: null }); F.db.subscribers.push({ id: 's', email: 'X@Example.com' });
  const first = await optOutEverywhere(s, 'X@Example.com ', 'unsubscribe');
  check(first === true && F.db.users[0].email_opt_out_at && F.db.subscribers.length === 0 && F.db.email_suppressions.length === 1 && F.db.email_suppressions[0].email_hash === await emailHash('x@example.com'), 'optOutEverywhere: users flag, newsletter row and suppression hash in one call');
  check(await optOutEverywhere(s, 'x@example.com') === false && F.db.email_suppressions.length === 1, 'optOutEverywhere: a repeat records nothing new and says so (so the confirmation email is sent once)');
}

// ---- the unsubscribe page promise is true: the old "reply and we remove you by hand" fallback is gone
{
  const F = fake(); globalThis.fetch = F.f;
  const r = await worker.fetch(new Request('https://x/api/unsubscribe?e=a%40b.co&t=bad', { method: 'POST', headers: { Accept: 'text/html' } }), env, { waitUntil() {} });
  const body = await r.text();
  check(r.status === 400 && /myprivacytool\.io\/unsubscribe/.test(body) && !/Reply to any of our emails/.test(body), 'an invalid link points to the /unsubscribe page (a working path), not to "reply and we remove you by hand"');
}

console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
