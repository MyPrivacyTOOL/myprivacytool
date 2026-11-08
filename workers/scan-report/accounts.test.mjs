// MPC-9817: accounts and sign-in through the real Worker routes. No network, no secrets, SYNTHETIC identities only (example.test).
// The stub below plays Supabase Auth (generate_link, verify, user, token, logout, admin delete), PostgREST rpc and Resend, applying the same rules as
// migration 20261108120000 (the SQL itself is proved in supabase/tests/mpc-9817-accounts.test.sql). The synthetic-mailbox path against the live system is
// scripts/accounts-live-check/run.mjs. Run: node workers/scan-report/accounts.test.mjs
import worker from './index.js';
import { buildSignInEmail, can } from './lib/accounts.js';
import { SAVE_CONSENT_VERSIONS, ACCOUNT_CONSENT_VERSIONS } from './lib/webScan.js';
import { makeLiveLink, readVerifyToken } from './lib/live.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
import { stub, ORIGIN, ME, OTHER, SCAN_ME, SCAN_OTHER, SCAN_NONE, SCANS_ID_ME } from './test-support/fake-accounts.mjs';

const env = { ACCOUNTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'r', RECIPIENT_ALLOWLIST: '', UNSUBSCRIBE_SECRET: 'test-secret', EMAIL_CONFIRM_GATE_ENABLED: 'true' };
const post = (path, body, headers = {}) => new Request(`https://x.test${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const run = async (S, req, e = env) => { const pend = []; const r = await worker.fetch(req, e, { waitUntil: (p) => pend.push(p) }); await Promise.all(pend); return r; };
const real = globalThis.fetch;

// ---- switch off => 404 on every route, nothing called
{
  const S = stub(); globalThis.fetch = S.f;
  try {
    for (const p of ['signin', 'verify', 'me', 'scan', 'link-scan', 'delete', 'refresh', 'signout', 'can']) {
      const r = await run(S, post(`/api/account/${p}`, { email: ME }), { ...env, ACCOUNTS_ENABLED: 'false' });
      if (r.status !== 404) check(false, `${p}: 404 while ACCOUNTS_ENABLED is off (got ${r.status})`);
    }
    check(S.st.calls.length === 0, 'switch off: all nine routes answer 404 and nothing is called');
  } finally { globalThis.fetch = real; }
}

// ---- the full flow: sign in by email link, no password
{
  const S = stub(); globalThis.fetch = S.f;
  try {
    let r = await run(S, post('/api/account/signin', { email: 'not-an-email' })); check(r.status === 400, 'sign-in: invalid email => 400');
    r = await run(S, post('/api/account/signin', { email: ME, scan_number: 'nope' })); check(r.status === 400, 'sign-in: bad scan number => 400');
    r = await run(S, new Request('https://x.test/api/account/signin', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ME }) })); check(r.status === 403, 'sign-in: other origin refused');
    r = await run(S, post('/api/account/signin', { email: ME, scan_number: SCAN_ME }));
    check(r.status === 200 && (await r.json()).sent === true, 'sign-in: answers {sent:true}');
    const mail = S.st.emails[0];
    check(S.st.emails.length === 1 && mail.to[0] === ME && mail.subject === 'Your MyPrivacyTOOL sign-in link', 'sign-in: one email, to that address only, plain subject');
    const link = (mail.text.match(/https:\/\/myprivacytool\.io\/account\/verify#t=[A-Za-z0-9_-]+&n=[0-9a-f-]+/) || [])[0];
    check(Boolean(link) && !/\?/.test(link), 'sign-in: the link is /account/verify with the token in the fragment (never in the query string, so it is not logged), plus the scan number');
    check(/no password/i.test(mail.text) && /ignore this email/i.test(mail.text), 'sign-in: says there is no password and what to do if you did not ask');
    const tok = link.match(/#t=([^&]+)/)[1];

    // a mail scanner / wrong token
    r = await run(S, post('/api/account/verify', { token_hash: 'short' })); check(r.status === 401, 'verify: malformed token => 401');
    r = await run(S, post('/api/account/verify', { token_hash: 'zzzzzzzzzzzzzzzzzzzzzzzz' })); check(r.status === 401, 'verify: unknown token => 401');
    r = await run(S, post('/api/account/verify', { token_hash: tok, scan_number: SCAN_ME }));
    const v = await r.json();
    check(r.status === 200 && v.session?.access_token && v.session?.refresh_token && v.account?.email === ME && v.account?.plan === 'free', 'verify: session + a FREE account for the verified email');
    check(v.scan_attached === true && S.st.scanExpiry.get(SCANS_ID_ME) === null, 'verify: the current scan is attached and leaves the 7-day deletion path');
    const acct = S.st.accounts[0];
    check(acct.consent_version === '2026-11-08-v1' && !Object.keys(acct).some((k) => /ip/i.test(k.replace(/plan|description/gi, ''))), 'verify: consent version carried from the scan; the account record has no IP field');
    check(S.st.calls.filter((c) => c.url.includes('/auth/v1/verify')).every((c) => !('x-forwarded-for' in (c.headers || {})) && !('X-Forwarded-For' in (c.headers || {}))), 'verify: no forwarded visitor IP is passed to Supabase Auth');
    r = await run(S, post('/api/account/verify', { token_hash: tok })); check(r.status === 401, 'verify: the link works once');

    const at = v.session.access_token;
    r = await run(S, new Request('https://x.test/api/account/me', { method: 'GET', headers: { Origin: ORIGIN, ...bearer(at) } }));
    const me = await r.json();
    check(r.status === 200 && me.account.email === ME && me.account.plan === 'free' && me.scans.length === 1 && me.scans[0].scan_number === SCAN_ME, '/me: email, plan (free) and the attached scan');
    r = await run(S, new Request('https://x.test/api/account/me', { method: 'GET', headers: { Origin: ORIGIN } })); check(r.status === 401, '/me: no bearer => 401');
    r = await run(S, new Request('https://x.test/api/account/me', { method: 'GET', headers: { Origin: ORIGIN, ...bearer('bogus') } })); check(r.status === 401, '/me: bad bearer => 401');

    r = await run(S, post('/api/account/scan', { scan_number: SCAN_ME }, bearer(at))); const op = await r.json();
    check(r.status === 200 && op.scan.scan_number === SCAN_ME && Array.isArray(op.scan.results), 'open: the account can open its own saved scan');
    r = await run(S, post('/api/account/scan', { scan_number: SCAN_OTHER }, bearer(at))); const r2b = await run(S, post('/api/account/scan', { scan_number: SCAN_NONE }, bearer(at)));
    check(r.status === 404 && r2b.status === 404, 'open: another person\'s scan number is a 404, exactly like one that does not exist');
    r = await run(S, post('/api/account/scan', { scan_number: SCAN_ME })); check(r.status === 401, 'open: not signed in => 401');

    // claim by scan number + confirmed email
    r = await run(S, post('/api/account/link-scan', { scan_number: SCAN_OTHER }, bearer(at))); const lo = await r.json();
    const r2 = await run(S, post('/api/account/link-scan', { scan_number: SCAN_NONE }, bearer(at))); const ln = await r2.json();
    check(lo.linked === false && JSON.stringify(lo) === JSON.stringify(ln), 'claim: someone else\'s scan number answers exactly like one that does not exist');
    r = await run(S, post('/api/account/link-scan', { scan_number: 'x' }, bearer(at))); check(r.status === 400, 'claim: malformed number => 400');
    r = await run(S, post('/api/account/link-scan', { scan_number: SCAN_ME }, bearer(at))); check((await r.json()).already === true, 'claim: your own scan again is a no-op');

    // can(): Free values only
    r = await run(S, post('/api/account/can', { key: 'report.score' }, bearer(at))); check((await r.json()).allowed === true, 'can: a free capability is allowed');
    r = await run(S, post('/api/account/can', { key: 'report.export_pdf' }, bearer(at))); const cp = await r.json(); check(cp.allowed === false && cp.reason === 'unknown_capability', 'can: a paid capability is not wired (MPC-9818): denied');
    check((await can({ rpc: async () => { throw new Error('must not call'); } }, 'x', 'Not A Key!')).allowed === false, 'can: a malformed key is denied without a database call');

    // refresh + signout
    r = await run(S, post('/api/account/refresh', { refresh_token: v.session.refresh_token })); check(r.status === 200 && (await r.json()).session.access_token === 'at_new', 'refresh: new session');
    r = await run(S, post('/api/account/refresh', { refresh_token: 'nope' })); check(r.status === 401, 'refresh: bad token => 401');

    // delete really deletes
    r = await run(S, post('/api/account/delete', {}, bearer(at))); check(r.status === 400, 'delete: needs the explicit confirmation word');
    r = await run(S, post('/api/account/delete', { confirm: 'delete' })); check(r.status === 401, 'delete: needs to be signed in');
    r = await run(S, post('/api/account/delete', { confirm: 'delete' }, bearer(at))); const d = await r.json();
    check(r.status === 200 && d.deleted && d.account_deleted && d.scans_deleted === 1 && d.sign_in_removed, 'delete: account, scans and sign-in identity removed');
    check(S.st.accounts.length === 0 && S.st.links.length === 0 && !S.st.webScans.has(SCAN_ME) && !S.st.contacts.some((c) => c.web_scan_id === SCAN_ME) && S.st.authUsers.every((u) => u.email !== ME), 'delete: nothing of that person is left (scan deleted, not just unlinked)');
    check(S.st.webScans.has(SCAN_OTHER), 'delete: another person\'s scan is untouched');
  } finally { globalThis.fetch = real; }
}

// ---- the one-step tick: the click-to-confirm signs the person in
{
  const S = stub(); globalThis.fetch = S.f;
  try {
    check(SAVE_CONSENT_VERSIONS.includes('2026-11-08-v1') && SAVE_CONSENT_VERSIONS.includes('2026-10-12-v1') && ACCOUNT_CONSENT_VERSIONS.join() === '2026-11-08-v1', 'new wording version accepted, old one still accepted, only the new one asks for an account');
    const key = (await makeLiveLink(env, SCANS_ID_ME)).split('#v=')[1];
    check(await readVerifyToken(env, key) === SCANS_ID_ME, 'harness: the confirm key round-trips');
    let r = await run(S, new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: ORIGIN, ...bearer(key) } }));
    const j = await r.json();
    check(r.status === 200 && j.confirmed === true && /^[A-Za-z0-9_-]{16,}$/.test(j.account?.token_hash) && j.account.scan_number === SCAN_ME, 'confirm with the account tick: returns a one-time sign-in token for that scan');
    r = await run(S, post('/api/account/verify', { token_hash: j.account.token_hash, scan_number: j.account.scan_number, via: 'confirm' }));
    const v = await r.json(); check(r.status === 200 && v.account.email === ME && v.scan_attached === true, 'confirm token signs in: account created for the confirmed email, scan attached');
    S.st.contacts[0].account_requested_at = null;
    r = await run(S, new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: ORIGIN, ...bearer(key) } }));
    check(!('account' in (await r.json())), 'confirm WITHOUT the account tick: no account, no token (plain confirm as before)');
    const r3 = await run(S, new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: ORIGIN, ...bearer(key) } }), { ...env, ACCOUNTS_ENABLED: 'false' });
    check(!('account' in (await r3.json())), 'accounts switch off: confirm never returns a token');
  } finally { globalThis.fetch = real; }
}

// ---- the email itself
{
  const m = buildSignInEmail({ link: 'https://myprivacytool.io/account/verify#t=abcdefghijklmnop' });
  check(!/utm_|unsubscribe/i.test(m.html + m.text) && m.html.includes('/account/verify#t=abcdefghijklmnop'), 'email: transactional (no tracking tags, no marketing footer), link kept intact');
  check(!/password reset|your password/i.test(m.text) || /no password/i.test(m.text), 'email: never asks for or offers a password');
}

// ---- an address outside the allowlist gets nothing (and the answer is unchanged)
{
  const S = stub(); globalThis.fetch = S.f;
  try {
    const r = await run(S, post('/api/account/signin', { email: OTHER }), { ...env, RECIPIENT_ALLOWLIST: 'someone.else@example.test' });
    check(r.status === 200 && (await r.json()).sent === true && S.st.emails.length === 0 && !S.st.calls.some((c) => c.url.includes('generate_link')), 'allowlist: held recipient => same answer, no link made, no email');
  } finally { globalThis.fetch = real; }
}

console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
