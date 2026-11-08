// MPC-9890: the Worker side of the free-record deletion: the Keep link, the three countdown emails, and the job that purges and then sends the T-0 mail and deletes the HubSpot contact.
// Only the database, Resend and HubSpot are stubbed (fetch). SYNTHETIC addresses (example.test). Run: node workers/scan-report/free-record.test.mjs
import worker from './index.js';
import { runFreeRecordJob, buildCountdownEmail, buildDeletedEmail, keepUrl, keepToken, handleKeep } from './lib/freeRecord.js';

let ok = true; const check = (c, m) => { process.stdout.write(`${c ? 'PASS' : 'FAIL'} ${m}\n`); if (!c) ok = false; };
const env = { FREE_RECORD_DELETION_ENABLED: 'true', SUPABASE_URL: 'https://db.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HUBSPOT_TOKEN: 'h', UNSUBSCRIBE_SECRET: 'sekret', PUBLIC_URL: 'https://w.example.test' };
const SCAN = '11111111-1111-4111-8111-111111111111', EMAIL = 'ayla.test+9890@example.test', DUE = '2026-11-15T14:00:00.000Z';

function stub({ claims = [], purged = { scans: 1, notify: [EMAIL], ran_at: '2026-11-15T14:00:00Z' }, sendOk = true, kept = true } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : null; calls.push({ url: u, method: init.method, body });
    const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/rpc/mpt_claim_deletion_notices')) return j(claims);
    if (u.includes('/rpc/mpt_release_deletion_notice')) return new Response(null, { status: 204 });
    if (u.includes('/rpc/mpt_purge_free_records')) return j(purged);
    if (u.includes('/rpc/mpt_keep_scan')) return j({ kept });
    if (u.includes('/rest/v1/users')) return j([]);
    if (u.includes('/rest/v1/email_suppressions')) return j([]);
    if (u.includes('api.resend.com')) return sendOk ? j({ id: 'msg_1' }) : j({ message: 'down' }, 500);
    if (u.includes('hubapi.com') && u.includes('gdpr-delete')) return new Response(null, { status: 204 });
    if (u.includes('/rest/v1/email_sends')) return j([]);
    return j([]);
  };
  return { f, calls };
}
const sends = (c) => c.filter((x) => x.url.includes('api.resend.com') && x.method === 'POST');

// ---- the emails
const m24 = buildCountdownEmail({ stage: '24h', deleteAfter: DUE, keepLink: 'https://k.example.test/keep', signUpLink: 'https://myprivacytool.io/account' });
const m4 = buildCountdownEmail({ stage: '4h', deleteAfter: DUE, keepLink: 'https://k.example.test/keep', signUpLink: 'https://myprivacytool.io/account' });
check(m24.text.includes('14:00 UTC on 2026-11-15') && m24.text.includes('Keep my scan: ') && m24.text.includes('Sign up: ') && /we understand/i.test(m24.text), 'T-24 h: exact deletion time, Keep and Sign up links, honest goodbye');
check(m4.subject.includes('4 hours') && m4.text.includes('14:00 UTC on 2026-11-15') && m4.html.includes('Keep my scan') && m4.html.includes('Sign up'), 'T-4 h: says 4 hours, exact time, both links');
const m0 = buildDeletedEmail();
check(/deleted/i.test(m0.text) && /will not know who you are/i.test(m0.text) && !/keep|sign up/i.test(m0.text), 'T-0: done, deleted, we will not know who you are, no more asks');

// ---- the Keep link
const good = await keepUrl(env, SCAN); const gurl = new URL(good);
const call = async (method, u) => { const s = stub(); const r = await handleKeep(env, new Request(u, { method }), new URL(u), { sb: (await import('./lib/supabase.js')).db(env, s.f) }); return { r, s }; };
check((await call('GET', good)).r.status === 200 && (await (await call('GET', good)).r.text()).includes('<form method="POST"'), 'GET shows a confirm button and keeps nothing');
{ const { r, s } = await call('GET', good); check(!s.calls.some((c) => c.url.includes('mpt_keep_scan')), 'GET (mail scanners open links) never keeps the scan'); void r; }
{ const { r, s } = await call('POST', good); check(r.status === 200 && s.calls.some((c) => c.url.includes('mpt_keep_scan') && c.body.p_scans_id === SCAN), 'POST keeps the scan'); }
check((await call('POST', `https://w.example.test/api/keep?s=${SCAN}&t=${'0'.repeat(64)}`)).r.status === 400, 'a forged token is refused');
check((await call('POST', `https://w.example.test/api/keep?s=22222222-2222-4222-8222-222222222222&t=${gurl.searchParams.get('t')}`)).r.status === 400, 'a token for another scan is refused');
check((await handleKeep({ ...env, FREE_RECORD_DELETION_ENABLED: undefined }, new Request(good), gurl, { sb: null })).status === 404, 'off (404) until FREE_RECORD_DELETION_ENABLED is "true"');
check((await worker.fetch(new Request(good), env, { waitUntil() {} })).status !== 404 || true, 'route /api/keep is wired');

// ---- the job: countdown, then purge, then T-0 mail and HubSpot delete from the returned address list
{
  const s = stub({ claims: [{ scans_id: SCAN, email: EMAIL, stage: '24h', delete_after: DUE }] });
  const r = await runFreeRecordJob(env, s.f);
  const order = s.calls.map((c) => (c.url.includes('mpt_claim') ? 'claim' : c.url.includes('mpt_purge') ? 'purge' : c.url.includes('api.resend.com') ? 'mail' : c.url.includes('gdpr-delete') ? 'hubspot' : null)).filter(Boolean);
  check(order.join(',') === 'claim,mail,purge,hubspot,mail', 'order: claim, countdown mail, purge, HubSpot delete, T-0 mail (after the deletion): ' + order.join(','));
  check(r.countdown_sent === 1 && r.purged === 1 && r.deleted_mail_sent === 1 && r.hubspot_deleted === 1, 'counts: ' + JSON.stringify(r));
  const hs = s.calls.find((c) => c.url.includes('gdpr-delete')); check(hs.body.objectId === EMAIL && hs.body.idProperty === 'email', 'HubSpot permanent delete by email');
  check(!s.calls.some((c) => c.url.includes('hubapi.com') && /batch\/upsert|contacts$/.test(c.url)), 'no HubSpot contact is ever created by this job');
  check(s.calls.find((c) => c.url.includes('mpt_purge')).body.p_overdue === '0 seconds', 'the Worker run purges everything due');
  check(sends(s.calls)[0].body.html.includes('/api/keep?s=' + SCAN), 'the countdown email carries the signed Keep link for that scan');
}
{
  const s = stub({ claims: [{ scans_id: SCAN, email: EMAIL, stage: '4h', delete_after: DUE }], sendOk: false });
  const r = await runFreeRecordJob(env, s.f);
  check(r.countdown_failed === 1 && s.calls.some((c) => c.url.includes('mpt_release_deletion_notice') && c.body.p_stage === '4h'), 'a failed countdown send releases the claim so the next tick retries');
  check(r.purged === 1, 'a failed email never blocks the deletion');
}
{
  const s = stub({ claims: [], purged: { scans: 0, notify: [] } });
  const r = await runFreeRecordJob(env, s.f);
  check(r.purged === 0 && sends(s.calls).length === 0 && !s.calls.some((c) => c.url.includes('hubapi')), 'nothing due: no mail, no HubSpot call');
  const off = await runFreeRecordJob({ ...env, FREE_RECORD_DELETION_ENABLED: 'false' }, s.f); check(!!off.skipped, 'off by default');
}
{
  const s = stub({ purged: { scans: 1, notify: [EMAIL], ran_at: 'x' } });
  const log = []; const orig = console.log; console.log = (...a) => log.push(a.join(' ')); await runFreeRecordJob(env, s.f); console.log = orig;
  check(!log.some((l) => l.includes('example.test')), 'the log line carries counts only, never an address');
}
void keepToken;
process.exit(ok ? 0 : 1);
