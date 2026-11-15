// MPC-9824 (F6): business teams through the real Worker routes. No network, no secrets, SYNTHETIC identities only (example.test).
// The stub plays Supabase Auth, PostgREST rpc (mpt_business_*, same rules as the migration; SQL proof in supabase/tests/mpc-9824-business-teams.test.sql) and Resend.
// The F1 listing check reads pages the employee pasted; a stub plays those pages. Run: node workers/scan-report/business.test.mjs
import worker from './index.js';
import { buildInviteEmail } from './lib/business.js';
import { stub, ORIGIN, ME } from './test-support/fake-accounts.mjs';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const E1 = 'ada.test+9824@example.test', E2 = 'bo.test+9824@example.test', E3 = 'cy.test+9824@example.test';
const env = { ACCOUNTS_ENABLED: 'true', BUSINESS_TEAMS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'r', RECIPIENT_ALLOWLIST: '', UNSUBSCRIBE_SECRET: 'test-secret' };
const post = (path, body, headers = {}) => new Request(`https://x.test${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const run = async (req, e = env) => { const pend = []; const r = await worker.fetch(req, e, { waitUntil: (p) => pend.push(p) }); await Promise.all(pend); return r; };
const real = globalThis.fetch;
const page = (body) => ({ ok: true, status: 200, headers: { get: (k) => ({ 'content-type': 'text/html' })[k.toLowerCase()] ?? null }, body: null, text: async () => `<!doctype html><html><head><title>Profile</title></head><body>${body}${' filler text about public records and people. '.repeat(10)}</body></html>` });

// the stub: auth/rpc/resend from fake-accounts, plus synthetic listing pages
function world() {
  const S = stub();
  const pages = [];
  globalThis.fetch = async (url, o) => {
    const u = String(url);
    if (u.startsWith('https://www.spokeo.com/profile/')) { pages.push(u); return u.endsWith('/ada') ? page('<h1>Ada Quillfeather</h1><p>Austin, TX</p>') : u.endsWith('/bo') ? page('<h1>Bo Quillfeather</h1><p>Austin, TX</p>') : page('<h1>Another Person</h1>'); }
    return S.f(url, o);
  };
  return { S, pages };
}
async function adminToken(S, email = ME) {
  await run(post('/api/account/signin', { email }));
  const mail = S.st.emails.at(-1); const tok = mail.text.match(/#t=([A-Za-z0-9_-]+)/)[1];
  const r = await run(post('/api/account/verify', { token_hash: tok })); return (await r.json()).session.access_token;
}
const tokenFrom = (mail) => mail.text.match(/\/business\/join#t=([A-Za-z0-9_-]+)/)[1];

// ---- switches: either one off => 404 on every route, nothing called
{
  const { S } = world();
  try {
    for (const off of [{ BUSINESS_TEAMS_ENABLED: 'false' }, { ACCOUNTS_ENABLED: 'false' }, { BUSINESS_TEAMS_ENABLED: undefined }]) {
      for (const p of ['team', 'invite', 'summary', 'remove-member', 'delete-team', 'join/view', 'join/authorise', 'join/decline', 'join/revoke', 'join/share']) {
        const r = await run(post(`/api/business/${p}`, {}), { ...env, ...off }); if (r.status !== 404) check(false, `${p}: 404 while a switch is off (got ${r.status})`);
      }
    }
    check(S.st.calls.length === 0, 'switches: all ten routes answer 404 with either switch off and nothing is called');
  } finally { globalThis.fetch = real; }
}

// ---- the LIVE test: admin invites 3, two authorise, the admin sees a summary for those two only
{
  const { S, pages } = world();
  try {
    let r = await run(post('/api/business/team', { company: 'Quillfeather Ltd' })); check(r.status === 401, 'team: no session => 401');
    const at = await adminToken(S);
    r = await run(post('/api/business/team', { company: 'Quillfeather Ltd' }, { Origin: 'https://evil.test', ...bearer(at) })); check(r.status === 403, 'team: other origin refused');
    r = await run(post('/api/business/team', { company: '  ' }, bearer(at))); check(r.status === 400, 'team: empty company => 400');
    r = await run(post('/api/business/team', { company: 'Quillfeather Ltd' }, bearer(at)));
    const t = await r.json(); check(r.status === 200 && /^[0-9a-f-]{36}$/.test(t.team_id) && /^BIZ-/.test(t.request_ref), 'team: created, with the one queue reference');
    check(S.st.biz.requests.length === 1 && S.st.biz.requests[0].source === 'admin_invite', 'team: exactly one admin_invite row in the 48-hour queue');

    r = await run(post('/api/business/invite', { team_id: t.team_id, emails: ['not-an-email'] }, bearer(at))); check(r.status === 400, 'invite: invalid address => 400');
    r = await run(post('/api/business/invite', { team_id: crypto.randomUUID(), emails: [E1] }, bearer(at))); check(r.status === 404, 'invite: someone else\'s / unknown team => 404');
    r = await run(post('/api/business/invite', { team_id: t.team_id, emails: [E1, E2, E3.toUpperCase(), E1] }, bearer(at)));
    const inv = await r.json(); check(r.status === 200 && inv.invited === 3 && inv.sent === 3 && inv.skipped === 0, 'invite: 3 distinct addresses (duplicate collapsed, case folded) invited and emailed');
    const mails = S.st.emails.filter((m) => /team check|asked you to check/.test(m.subject)); check(mails.length === 3, 'invite: one email per person');
    const tokens = Object.fromEntries(mails.map((m) => [m.to[0], tokenFrom(m)]));
    check(Object.keys(tokens).sort().join() === [E1, E2, E3].sort().join() && new Set(Object.values(tokens)).size === 3, 'invite: each person gets their own secret token, to their own address only');
    check(!JSON.stringify(S.st.biz.members).includes(tokens[E1]), 'invite: only the hash of a token is stored');
    check(mails.every((m) => /nothing will be unless you choose/i.test(m.text) && m.subject.includes('Quillfeather Ltd')), 'invite: email says nothing is checked unless the person chooses');

    // nothing read yet: viewing changes nothing
    r = await run(post('/api/business/join/view', { token: tokens[E1] })); let v = await r.json();
    check(r.status === 200 && v.status === 'invited' && v.results.length === 0 && pages.length === 0, 'view: opening the link reads nothing and changes nothing');
    r = await run(post('/api/business/join/view', { token: 'x'.repeat(40) })); check(r.status === 404, 'view: unknown token => 404');
    r = await run(post('/api/business/join/view', { token: 'short' })); check(r.status === 404, 'view: malformed token => 404');

    // before anyone authorises: summary counts zero results
    r = await run(post('/api/business/summary', {}, bearer(at))); let s = (await r.json()).summary;
    check(s.counts.invited_total === 3 && s.counts.awaiting === 3 && s.aggregate.people_included === 0 && s.aggregate.pages_checked === 0, 'summary before: 3 invited, 0 included, 0 pages');

    // Ada authorises with one listed page and shares; Bo authorises one listed page, does not share; Cy never answers
    r = await run(post('/api/business/join/authorise', { token: tokens[E1] })); check(r.status === 400, 'authorise: without consent:true => 400');
    r = await run(post('/api/business/join/authorise', { token: tokens[E1], consent: true, listing: { full_name: 'Ada Quillfeather', city_region: 'Austin, TX', urls: ['https://www.spokeo.com/profile/ada'] }, share_detail: true }));
    let a = await r.json(); check(r.status === 200 && a.status === 'authorised' && a.results.length === 1 && a.results[0].state === 'listed', 'authorise (Ada): checked her own page, listed');
    r = await run(post('/api/business/join/authorise', { token: tokens[E2], consent: true, listing: { full_name: 'Bo Quillfeather', city_region: 'Austin, TX', urls: ['https://www.spokeo.com/profile/bo', 'https://www.spokeo.com/profile/nobody'] } }));
    let bo = await r.json(); check(r.status === 200 && bo.results.length === 2, 'authorise (Bo): two pages checked');
    check(pages.length === 3, 'authorise: only the pages the two people pasted were read, nothing for the third person');
    check(S.st.biz.requests.filter((q) => q.source === 'employee_consent').length === 2 && S.st.biz.requests.length === 3, 'authorise: one employee_consent queue row per consent (2), plus the 1 admin row');

    r = await run(post('/api/business/summary', {}, bearer(at))); const body = await r.json(); s = body.summary;
    check(s.counts.invited_total === 3 && s.counts.authorised === 2 && s.counts.awaiting === 1, 'summary: 3 invited, 2 authorised, 1 awaiting');
    check(s.aggregate.people_included === 2 && s.aggregate.pages_checked === 3 && s.aggregate.listed === 2 && s.aggregate.not_listed === 1 && s.aggregate.people_with_a_listing === 2, 'summary: aggregate covers exactly the two authorised people (3 pages, 2 listed, 1 not listed)');
    const row = (e) => s.members.find((m) => m.email === e);
    check(row(E1).detail?.length === 1 && row(E1).shared === true, 'summary: Ada shared, so her detail is shown');
    check(row(E2).detail === null && row(E2).shared === false && row(E2).status === 'authorised', 'summary: Bo did not share, so the admin sees no detail');
    check(row(E3).status === 'invited' && row(E3).detail === null, 'summary: the third person has no data at all');
    check(s.members.every((m) => typeof m.member_id === 'string'), 'summary: every row carries a member_id (the bug MPC-9824 item 0 fixed)');
    check(!JSON.stringify(S.st.biz.members).includes('Quillfeather') && !JSON.stringify(S.st.biz.members).includes('Austin'), 'privacy: the typed name and city are not stored anywhere');

    // admin remove, using the id from the summary
    r = await run(post('/api/business/remove-member', { team_id: t.team_id, member_id: row(E3).member_id }, bearer(at))); check(r.status === 200, 'remove: the admin removes the third person by the id from the summary');
    r = await run(post('/api/business/remove-member', { team_id: t.team_id, member_id: row(E3).member_id }, bearer(at))); check(r.status === 404, 'remove: removing again => 404');
    r = await run(post('/api/business/remove-member', { team_id: t.team_id, member_id: 'nope' }, bearer(at))); check(r.status === 400, 'remove: bad id => 400');

    // another admin cannot see or touch this team
    const other = await adminToken(S, 'other.test+9824@example.test');
    r = await run(post('/api/business/summary', { team_id: t.team_id }, bearer(other))); check(r.status === 404, 'summary: another admin cannot read this team');
    r = await run(post('/api/business/invite', { team_id: t.team_id, emails: ['zz.test@example.test'] }, bearer(other))); check(r.status === 404, 'invite: another admin cannot invite into this team');
    r = await run(post('/api/business/delete-team', { team_id: t.team_id, confirm: 'delete' }, bearer(other))); check(r.status === 404, 'delete: another admin cannot delete this team');

    // employee controls: sharing toggle, revoke deletes the results
    r = await run(post('/api/business/join/share', { token: tokens[E2], share_detail: true })); check(r.status === 200, 'share: Bo shares after the fact');
    r = await run(post('/api/business/summary', { team_id: t.team_id }, bearer(at))); s = (await r.json()).summary; check(s.members.find((m) => m.email === E2).detail?.length === 2, 'share: the admin now sees Bo\'s detail');
    r = await run(post('/api/business/join/revoke', { token: tokens[E2] })); check(r.status === 200, 'revoke: Bo withdraws');
    r = await run(post('/api/business/summary', { team_id: t.team_id }, bearer(at))); s = (await r.json()).summary;
    check(s.members.find((m) => m.email === E2).status === 'revoked' && s.members.find((m) => m.email === E2).detail === null && s.aggregate.people_included === 1 && s.aggregate.pages_checked === 1, 'revoke: results deleted, Bo no longer counted');
    check(S.st.biz.members.find((m) => m.email === E2).results === null, 'revoke: nothing left in the store for Bo');
    r = await run(post('/api/business/join/authorise', { token: tokens[E2], consent: true })); check(r.status === 409, 'revoke: the old link cannot re-authorise');
    r = await run(post('/api/business/invite', { team_id: t.team_id, emails: [E2] }, bearer(at))); check((await r.json()).invited === 1, 'revoke: the admin can invite Bo again with a fresh token');

    // delete team removes every row
    r = await run(post('/api/business/delete-team', { team_id: t.team_id }, bearer(at))); check(r.status === 400, 'delete: needs confirm:"delete"');
    r = await run(post('/api/business/delete-team', { team_id: t.team_id, confirm: 'delete' }, bearer(at))); const d = await r.json();
    check(r.status === 200 && d.deleted === true && S.st.biz.members.length === 0 && S.st.biz.teams.length === 0, 'delete: the team and every member row are gone');
    check(!S.st.calls.some((c) => c.headers && (c.headers['x-forwarded-for'] || c.headers['X-Forwarded-For'])), 'privacy: no visitor IP is passed on');
  } finally { globalThis.fetch = real; }
}

// ---- declined, expired, allow-list, pure email
{
  const { S } = world();
  try {
    const at = await adminToken(S);
    const t = await (await run(post('/api/business/team', { company: 'Declined Ltd' }, bearer(at)))).json();
    await run(post('/api/business/invite', { team_id: t.team_id, emails: [E1] }, bearer(at)));
    const tok = tokenFrom(S.st.emails.at(-1));
    let r = await run(post('/api/business/join/decline', { token: tok })); check(r.status === 200, 'decline: ok');
    const m = S.st.biz.members[0]; check(m.status === 'declined' && m.results === null, 'decline: nothing held');
    m.status = 'invited'; m.token_expires_at = Date.now() - 1000;
    r = await run(post('/api/business/join/view', { token: tok })); check(r.status === 404, 'expired: an expired invitation is not valid');
    r = await run(post('/api/business/join/authorise', { token: tok, consent: true })); check(r.status === 404, 'expired: cannot authorise on an expired invitation');
    const before = S.st.emails.length;
    r = await run(post('/api/business/invite', { team_id: t.team_id, emails: [E3] }, bearer(at)), { ...env, RECIPIENT_ALLOWLIST: 'someone.else@example.test' });
    check((await r.json()).sent === 0 && S.st.emails.length === before, 'allow-list: a non-allowed address is not emailed');
    const e = buildInviteEmail({ company: 'A<b>&Co', adminEmail: 'x@example.test', link: 'https://myprivacytool.io/business/join#t=abc' });
    check(!/<b>/.test(e.html) && e.subject.includes('asked you') && /Authorise/.test(e.text), 'email: company name is escaped in the html');
  } finally { globalThis.fetch = real; }
}
if (!ok) { console.error('business.test.mjs FAILED'); process.exit(1); }
console.log('business.test.mjs: all passed');
