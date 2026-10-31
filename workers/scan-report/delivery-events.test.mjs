// MPC-7556: delivery, bounce and complaint events are stored against the send, a hard bounce or complaint sets THE opt-out, clicks are counted.
// One test per event type, through the real Worker entry point (POST /api/resend-webhook) against the stubbed backend. No network.
// Run: node workers/scan-report/delivery-events.test.mjs
import worker from './index.js';
import { fake } from './test-support/fake-backend.mjs';
import { signReceipt } from './lib/receipts.js';
import { sendEmail } from './lib/email.js';
import { emailTypeFromKey, KEY_TYPES } from './lib/emailSends.js';
import { emailHash, isOptedOut } from './lib/suppression.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const SECRET = 'whsec_' + Buffer.from('delivery-events-test-secret').toString('base64');
const env = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', RESEND_WEBHOOK_SECRET: SECRET, HUBSPOT_TOKEN: 'h', RECIPIENT_ALLOWLIST: '' };
const quiet = async (fn) => { const k = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = k; } };
const nowS = () => Math.floor(Date.now() / 1000);
async function deliver(F, event, { e = env, sign = true, ts = nowS() } = {}) {
  const body = JSON.stringify(event); const id = 'msg_' + Math.random().toString(36).slice(2);
  const headers = { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign ? await signReceipt(SECRET, id, String(ts), body) : 'v1,bad' };
  globalThis.fetch = F.f;
  return quiet(() => worker.fetch(new Request('https://x/api/resend-webhook', { method: 'POST', headers, body }), e, { waitUntil() {} }));
}
const ev = (type, email_id, data = {}) => ({ type, created_at: new Date().toISOString(), data: { email_id, to: ['person@example.com'], ...data } });
const world = async (extra = {}) => {
  const F = fake({ resendIdempotent: true, ...extra }); globalThis.fetch = F.f;
  F.db.users.push({ id: 'u1', email: 'person@example.com', email_opt_out_at: null }); F.db.subscribers.push({ id: 's1', email: 'person@example.com' });
  return F;
};
const send = async (F, key, to = 'person@example.com') => { const r = await quiet(() => sendEmail(env, { to, subject: 's', html: '<p>x</p>', text: 'x', idempotencyKey: key }, F.f)); return r.id; };

// ---- every email type is recorded at send time, by type, with no address
{
  const F = await world();
  const keys = ['confirm-1', 'report-1', 'followup-1-1', 'unsubreq-ab-2026', 'unsubscribed-ab', 'referral-invite-1-ab', 'referral-reward-1', 'hk-spam-day10-1', 'hk-spam-test-1-en-x', 'something-new'];
  const ids = []; for (const k of keys) ids.push(await send(F, k));
  check(F.db.email_sends.length === keys.length && F.db.email_sends.map((s) => s.email_type).join() === 'confirm,report,followup,unsubscribe-request,unsubscribed,referral-invite,referral-reward,hk-spam-day10,hk-spam-test,other', 'send time: every email type is recorded under its own type (unknown keys as "other")');
  check(!JSON.stringify(F.db.email_sends).includes('@') && F.db.email_sends.every((s) => s.is_test === false), 'send time: no address is stored; ordinary sends are not test sends');
  await send(F, 'report-test', 'testingnt69+nightly-20261028@gmail.com');
  check(F.db.email_sends.at(-1).is_test === true, 'send time: a send to the test mailbox is flagged is_test (never counted in KPIs)');
  await send(F, 'report-1');   // the same key returns the same provider id: a second row would break the unique id
  check(F.db.email_sends.filter((s) => s.provider_message_id === ids[1]).length === 1, 'send time: a retried send (same key, same provider id) is recorded once');
  check(KEY_TYPES.every(([p]) => emailTypeFromKey(p + 'x') !== 'other'), 'every key prefix maps to a type');
  const bad = fake({ resendIdempotent: true, onRequest: (u, o, res) => (u.includes('/email_sends') ? res(500, 'boom') : undefined) });
  const r = await quiet(() => sendEmail(env, { to: 'a@example.com', subject: 's', html: '<p>x</p>', text: 'x', idempotencyKey: 'report-9' }, bad.f));
  check(r.sent === true, 'send time: if recording fails (e.g. migration not applied) the email is still sent');
}

// ---- one test per event type
{
  const F = await world(); const id = await send(F, 'followup-9-1'); const row = () => F.db.email_sends.find((s) => s.provider_message_id === id);
  let r = await deliver(F, ev('email.sent', id));
  check(r.status === 200 && row().status === 'sent', 'event email.sent: stored as sent');
  r = await deliver(F, ev('email.delivery_delayed', id));
  check(row().status === 'delivery_delayed', 'event email.delivery_delayed: stored');
  r = await deliver(F, ev('email.delivered', id));
  check(row().status === 'delivered' && F.db.users[0].email_opt_out_at === null, 'event email.delivered: stored; nobody is opted out');
  await deliver(F, ev('email.sent', id));
  check(row().status === 'delivered', 'event order: a late "sent" never moves delivered backwards');
  r = await deliver(F, ev('email.clicked', id, { click: { link: 'https://myprivacytool.io/opt-out?utm_source=email' } })); await deliver(F, ev('email.clicked', id));
  check(row().click_count === 2 && row().first_click_at && row().status === 'delivered', 'event email.clicked: clicks counted, status unchanged');
  check(F.db.users[0].email_opt_out_at === null && F.db.email_suppressions.length === 0, 'delivered / clicked events never opt anyone out');
}
{
  const F = await world(); const id = await send(F, 'followup-9-2');
  const r = await deliver(F, ev('email.bounced', id, { bounce: { type: 'Permanent', subType: 'General' } }));
  const row = F.db.email_sends[0];
  check(r.status === 200 && row.status === 'bounced' && row.bounce_type === 'permanent', 'event email.bounced (Permanent): stored with its type');
  check(F.db.users[0].email_opt_out_at && F.db.email_suppressions.length === 1 && F.db.email_suppressions[0].email_hash === await emailHash('person@example.com') && F.db.email_suppressions[0].source === 'hard_bounce' && F.db.subscribers.length === 0, 'hard bounce sets THE opt-out (users flag, suppression hash, newsletter row)');
  check(await isOptedOut({ select: (p) => F.f(`https://x/rest/v1/${p}`).then((x) => x.json()) }, 'person@example.com'), 'hard bounce: every non-transactional sender now sees the address as opted out');
  check(F.calls.some((c) => c.url.includes('api.hubapi.com')), 'hard bounce: HubSpot is told too (best effort)');
  const again = await deliver(F, ev('email.bounced', id, { bounce: { type: 'Permanent' } }));
  check(again.status === 200 && F.db.email_suppressions.length === 1, 'a retried bounce event changes nothing (idempotent)');
  check(!JSON.stringify(F.db.email_sends).includes('@'), 'the bounced address is never stored on the send');
}
{
  const F = await world(); const id = await send(F, 'followup-9-3');
  await deliver(F, ev('email.bounced', id, { bounce: { type: 'Transient', subType: 'MailboxFull' } }));
  check(F.db.email_sends[0].status === 'bounced' && F.db.email_sends[0].bounce_type === 'transient', 'event email.bounced (Transient): stored as a soft bounce');
  check(F.db.users[0].email_opt_out_at === null && F.db.email_suppressions.length === 0 && F.db.subscribers.length === 1, 'a soft bounce does NOT opt anyone out');
  const G = await world(); const gid = await send(G, 'followup-9-4');
  await deliver(G, ev('email.bounced', gid, { bounce: { type: 'Undetermined' } }));
  check(G.db.email_sends[0].bounce_type === 'undetermined' && G.db.email_suppressions.length === 0, 'event email.bounced (Undetermined): stored, no opt-out');
  const H = await world(); const hid = await send(H, 'followup-9-5');
  await deliver(H, ev('email.bounced', hid));
  check(H.db.email_sends[0].status === 'bounced' && H.db.email_sends[0].bounce_type == null && H.db.email_suppressions.length === 0, 'event email.bounced with no bounce type: stored, no opt-out (we do not guess)');
}
{
  const F = await world(); const id = await send(F, 'followup-9-6');
  await deliver(F, ev('email.delivered', id));
  const r = await deliver(F, ev('email.complained', id));
  check(r.status === 200 && F.db.email_sends[0].status === 'complained', 'event email.complained: stored (beats delivered)');
  check(F.db.users[0].email_opt_out_at && F.db.email_suppressions[0]?.source === 'complaint', 'a complaint sets THE opt-out');
  await deliver(F, ev('email.bounced', id, { bounce: { type: 'Permanent' } }));
  check(F.db.email_sends[0].status === 'complained', 'a bounce after a complaint cannot overwrite it');
}
{
  const F = await world(); const id = await send(F, 'report-9-7');
  const r = await deliver(F, ev('email.failed', id));
  check(r.status === 200 && F.db.email_sends[0].status === 'failed' && F.db.email_suppressions.length === 0, 'event email.failed: stored; a send failure is not a bounce, no opt-out');
  const R = await deliver(F, ev('email.opened', id));
  check((await R.json()).ignored && F.db.email_sends[0].status === 'failed', 'event email.opened: ignored (we use no tracking pixels)');
}

// ---- the report email keeps its own row too (CK-8503), and the webhook stays safe
{
  const F = await world(); const id = await send(F, 'report-9-8');
  F.db.scans.push({ id: 'sc', resend_message_id: id, report_status: 'sent' });
  await deliver(F, ev('email.delivered', id));
  check(F.db.scans[0].delivery_status === 'delivered' && F.db.email_sends[0].status === 'delivered', 'report email: stored on the scan (CK-8503) and on the send (MPC-7556)');
  check((await deliver(F, ev('email.delivered', id), { sign: false })).status === 401, 'a bad signature is refused (401), nothing stored');
  check((await deliver(F, ev('email.delivered', id), { ts: nowS() - 3600 })).status === 401, 'a replayed (old) event is refused');
  check((await deliver(F, ev('email.delivered', id), { e: { ...env, RESEND_WEBHOOK_SECRET: undefined } })).status === 404, 'no webhook secret: the endpoint is off (404)');
  const N = await world({ noEventRpc: true }); const nid = await send(N, 'followup-9-9');
  N.db.scans.push({ id: 'sc2', resend_message_id: nid, report_status: 'sent' });
  const r = await deliver(N, ev('email.delivered', nid));
  check(r.status === 200 && N.db.scans[0].delivery_status === 'delivered', 'migration not applied yet: the event is acknowledged (no endless retries) and the scan row still updates');
  // 2026-10-31: with the CK-8503 receipts function missing in production, every delivered/bounced/complained event answered 500 BEFORE the per-send row and the opt-out, so neither happened.
  const R = await world({ noReceiptRpc: true }); const rid = await send(R, 'followup-9-11');
  const rr = await deliver(R, ev('email.delivered', rid));
  check(rr.status === 500 && R.db.email_sends[0].status === 'delivered', 'CK-8503 migration not applied: the per-send row is still stored, and 500 asks the provider to retry the report row later');
  const R2 = await world({ noReceiptRpc: true }); const rid2 = await send(R2, 'followup-9-12');
  const hb = await deliver(R2, ev('email.bounced', rid2, { bounce: { type: 'Permanent' }, to: ['bounce-check@example.test'] }));
  check(hb.status === 500 && await isOptedOut({ select: (p) => R2.f(`https://x/rest/v1/${p}`).then((x) => x.json()) }, 'bounce-check@example.test'), 'CK-8503 migration not applied: a hard bounce still ends non-transactional email to that address (then 500 so the provider retries)');
  const R3 = await world({ noReceiptRpc: true }); const rid3 = await send(R3, 'followup-9-13');
  check((await deliver(R3, ev('email.clicked', rid3))).status === 200 && R3.db.email_sends[0].click_count >= 1, 'CK-8503 migration not applied: a click does not need the receipts function and is acknowledged (200)');
  const M = await world({ onRequest: (u, o, res) => (u.includes('/rpc/mpt_record_email_event') ? res(500, 'x') : undefined) });
  check((await deliver(M, ev('email.delivered', 'whatever'))).status === 500, 'a real database failure answers 500 so the provider retries');
  const O = await world({ onRequest: (u, o, res) => (u.includes('/email_suppressions') && o.method === 'POST' ? res(500, 'x') : undefined) }); const oid = await send(O, 'followup-9-10');
  check((await deliver(O, ev('email.complained', oid))).status === 500, 'if THE opt-out cannot be written the provider is told to retry (500), so a complaint is never lost');
}

console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
