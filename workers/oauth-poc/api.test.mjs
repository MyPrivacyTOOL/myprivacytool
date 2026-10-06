// Run: node --test workers/oauth-poc/
// MPC-6971 Phase 5: session, token validation, permission scoping and Supabase link. All network calls are mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './index.js';
import { sign, verify } from './google.js';
import { issueSession, mptScopesFor, SESSION_COOKIE, SESSION_TTL_MS } from './session.js';
import { linkAuthUser } from './supabase.js';

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://www.myprivacytool.io';
const env = {
  GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', STATE_SIGNING_KEY: KEY,
  REDIRECT_URI: 'https://x.test/oauth/google/callback', ALLOWED_ORIGIN: `${ORIGIN},https://myprivacytool.io`,
};
const supaEnv = { ...env, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
const NOW = 1_800_000_000_000;
const now = () => NOW;

const b64 = (s) => JSON.parse(atob(s.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
const cookieValue = (res, name) => {
  const all = res.headers.getSetCookie();
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).split(';')[0] : null;
};

/** Fake Google + Supabase. `over` tweaks individual responses. */
function fakeNet(over = {}) {
  const calls = [];
  const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
  const fn = async (u, init = {}) => {
    u = String(u); calls.push({ url: u, init });
    if (u.endsWith('/token')) return ok({ access_token: 'AT-SECRET' });
    if (u.includes('tokeninfo')) return ok({ scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile', expires_in: '3599', aud: 'cid', ...over.tokeninfo });
    if (u.includes('userinfo')) return ok({ sub: 'g-123', email: 'Ann@Example.com', email_verified: true, ...over.userinfo });
    if (u.endsWith('/revoke')) return ok({});
    if (u.includes('/rest/v1/rpc/mpt_find_auth_user_by_email')) return over.supabase ? over.supabase() : ok('0b1d2c3e-0000-4000-8000-000000000001');
    throw new Error('unexpected ' + u);
  };
  return { fn, calls };
}

async function consent(e, net, mode = 'session') {
  const state = await sign({ state: 's1', verifier: 'v', mode, exp: NOW + 1000 }, KEY);
  const req = new Request('https://x.test/oauth/google/callback?state=s1&code=c', { headers: { Cookie: `mpt_oauth=${state}` } });
  return handle(req, e, { fetchFn: net.fn, now });
}

const withSession = (value, init = {}) =>
  new Request(init.url || 'https://x.test/v1/session', { ...init, headers: { Cookie: `${SESSION_COOKIE}=${value}`, ...(init.headers || {}) } });

// ---- start ----

test('start records the mode in the signed state cookie (default poc, session on request)', async () => {
  for (const [q, mode] of [['', 'poc'], ['?mode=session', 'session'], ['?mode=bogus', 'poc']]) {
    const res = await handle(new Request(`https://x.test/oauth/google/start${q}`), env, { now });
    assert.equal(res.status, 302);
    const payload = b64(cookieValue(res, 'mpt_oauth'));
    assert.equal(payload.mode, mode);
    assert.equal(payload.exp, NOW + 10 * 60 * 1000);
  }
});

// ---- callback in session mode: token validation ----

test('session mode: valid consent sets an MPT session, revokes the Google token, stores no provider token', async () => {
  const net = fakeNet();
  const res = await consent(supaEnv, net);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, session: true });
  assert.ok(net.calls.some((c) => c.url.endsWith('/revoke')), 'google token revoked');

  const cookie = cookieValue(res, SESSION_COOKIE);
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=None/);
  assert.match(header, new RegExp(`Max-Age=${SESSION_TTL_MS / 1000}`));
  const payload = b64(cookie);
  assert.deepEqual(payload.scp, ['identity:read']);
  assert.equal(payload.uid, '0b1d2c3e-0000-4000-8000-000000000001');
  assert.ok(!JSON.stringify(payload).includes('AT-SECRET'), 'no provider token inside the session');
});

test('session mode with SUCCESS_REDIRECT answers 302 and keeps the cookies', async () => {
  const res = await consent({ ...env, SUCCESS_REDIRECT: `${ORIGIN}/?channel=google` }, fakeNet());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `${ORIGIN}/?channel=google`);
  assert.ok(cookieValue(res, SESSION_COOKIE));
});

test('session mode refuses a token issued to another client (aud mismatch) and still revokes', async () => {
  const net = fakeNet({ tokeninfo: { aud: 'someone-else' } });
  const res = await consent(env, net);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'aud_mismatch');
  assert.equal(cookieValue(res, SESSION_COOKIE), null);
  assert.ok(net.calls.some((c) => c.url.endsWith('/revoke')));
});

test('session mode refuses an unverified email', async () => {
  const res = await consent(env, fakeNet({ userinfo: { email_verified: false } }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'email_not_verified');
  assert.equal(cookieValue(res, SESSION_COOKIE), null);
});

test('session mode refuses a token without the email scope', async () => {
  const res = await consent(env, fakeNet({ tokeninfo: { scope: 'openid profile' } }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'insufficient_provider_scope');
});

test('session mode failure redirects with oauth_error when SUCCESS_REDIRECT is set', async () => {
  const res = await consent({ ...env, SUCCESS_REDIRECT: `${ORIGIN}/` }, fakeNet({ userinfo: { email_verified: false } }));
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('Location')).searchParams.get('oauth_error'), 'email_not_verified');
});

test('poc mode still returns the verified probe JSON and sets no session', async () => {
  const res = await consent(env, fakeNet(), 'poc');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.token.aud_matches_client, true);
  assert.equal(body.user.email, 'Ann@Example.com');
  assert.equal(cookieValue(res, SESSION_COOKIE), null);
});

// ---- Supabase link ----

test('supabase link calls the RPC with the service key and email, and is read-only', async () => {
  const net = fakeNet();
  await consent(supaEnv, net);
  const rpc = net.calls.find((c) => c.url.includes('/rpc/mpt_find_auth_user_by_email'));
  assert.equal(rpc.init.method, 'POST');
  assert.deepEqual(JSON.parse(rpc.init.body), { p_email: 'Ann@Example.com' });
  assert.equal(rpc.init.headers.apikey, 'srk');
  assert.equal(net.calls.filter((c) => c.url.includes('supabase.co')).length, 1, 'one call, no writes');
});

test('supabase link states: not_configured, not_found, error; sign-in succeeds in every state', async () => {
  const sessionFor = async (e, net) => b64(cookieValue(await consent(e, net), SESSION_COOKIE));
  assert.deepEqual(
    (({ link, uid }) => ({ link, uid }))(await sessionFor(env, fakeNet())), { link: 'not_configured', uid: null });
  assert.deepEqual(
    (({ link, uid }) => ({ link, uid }))(await sessionFor(supaEnv, fakeNet({ supabase: () => new Response('null', { status: 200 }) }))),
    { link: 'not_found', uid: null });
  assert.deepEqual(
    (({ link, uid }) => ({ link, uid }))(await sessionFor(supaEnv, fakeNet({ supabase: () => new Response('{}', { status: 401 }) }))),
    { link: 'error', uid: null });
});

test('linkAuthUser swallows network errors', async () => {
  const r = await linkAuthUser(supaEnv, 'a@b.c', async () => { throw new Error('boom'); });
  assert.deepEqual(r, { state: 'error', uid: null });
});

// ---- GET /v1/session ----

test('GET /v1/session: valid cookie returns identity, scopes and link; no cookie is 401', async () => {
  const value = await issueSession({ sub: 'g-1', email: 'a@b.c', scopes: ['identity:read'], uid: 'u-1', link: 'linked' }, KEY, NOW);
  const res = await handle(withSession(value), env, { now });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authenticated, true);
  assert.deepEqual(body.user, { sub: 'g-1', email: 'a@b.c', email_verified: true });
  assert.deepEqual(body.scopes, ['identity:read']);
  assert.deepEqual(body.supabase, { link: 'linked', user_id: 'u-1' });
  assert.equal(body.expires_at, new Date(NOW + SESSION_TTL_MS).toISOString());

  const anon = await handle(new Request('https://x.test/v1/session'), env, { now });
  assert.equal(anon.status, 401);
});

test('GET /v1/session rejects tampered, wrong-key, expired, malformed and wrong-type cookies', async () => {
  const good = await issueSession({ sub: 'g-1', email: 'a@b.c', scopes: ['identity:read'] }, KEY, NOW);
  const [body, sig] = good.split('.');
  const forged = await sign({ typ: 'session', aud: 'myprivacytool-oauth', v: 1, sub: 'x', scp: ['grants:read'], exp: NOW + 1000 }, 'other-key');
  const expired = await issueSession({ sub: 'g-1', email: 'a@b.c', scopes: [] }, KEY, NOW - SESSION_TTL_MS - 1);
  const stateCookie = await sign({ state: 's', verifier: 'v', mode: 'session', exp: NOW + 1000 }, KEY);
  const wrongAud = await sign({ typ: 'session', aud: 'other', v: 1, sub: 'x', scp: [], exp: NOW + 1000 }, KEY);
  for (const bad of [`${body}x.${sig}`, `${body}.${sig.slice(0, -2)}AA`, forged, expired, stateCookie, wrongAud, 'garbage', '%%%.%%%', '.']) {
    const res = await handle(withSession(bad), env, { now });
    assert.equal(res.status, 401, `should reject ${bad.slice(0, 20)}`);
  }
});

test('signed-token verify never throws on malformed input', async () => {
  for (const t of [undefined, '', 'a', 'a.b', '!!.!!', 'e30.@@@']) assert.equal(await verify(t, KEY), null);
});

// ---- permission scoping ----

test('mptScopesFor maps Google scopes to MPT scopes only when justified', () => {
  assert.deepEqual(mptScopesFor('openid email profile'), ['identity:read']);
  assert.deepEqual(mptScopesFor('https://www.googleapis.com/auth/userinfo.email'), ['identity:read']);
  assert.deepEqual(mptScopesFor('openid profile'), []);
  assert.deepEqual(mptScopesFor(undefined), []);
});

test('GET /v1/permissions: anonymous sees the catalogue, a session sees what it holds', async () => {
  const anon = await (await handle(new Request('https://x.test/v1/permissions'), env, { now })).json();
  assert.equal(anon.authenticated, false);
  assert.deepEqual(anon.granted, []);
  assert.deepEqual(anon.scopes.map((s) => s.name), ['identity:read', 'grants:read', 'grants:revoke']);
  assert.ok(anon.providers.find((p) => p.id === 'google' && p.account_type === 'consumer' && p.verified && !p.can_list_grants));
  assert.ok(anon.providers.filter((p) => p.id !== 'google' || p.account_type !== 'consumer').every((p) => !p.verified), 'unproven claims stay unverified');

  const value = await issueSession({ sub: 'g', email: 'a@b.c', scopes: ['identity:read'] }, KEY, NOW);
  const mine = await (await handle(withSession(value, { url: 'https://x.test/v1/permissions' }), env, { now })).json();
  assert.equal(mine.authenticated, true);
  assert.deepEqual(mine.granted, ['identity:read']);
  assert.deepEqual(mine.scopes.map((s) => [s.name, s.available, s.granted]),
    [['identity:read', true, true], ['grants:read', false, false], ['grants:revoke', false, false]]);
});

test('GET /v1/grants: 401 without a session, 403 insufficient_scope with one', async () => {
  const anon = await handle(new Request('https://x.test/v1/grants'), env, { now });
  assert.equal(anon.status, 401);

  const value = await issueSession({ sub: 'g', email: 'a@b.c', scopes: ['identity:read'] }, KEY, NOW);
  const res = await handle(withSession(value, { url: 'https://x.test/v1/grants' }), env, { now });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'insufficient_scope');
  assert.equal(body.required, 'grants:read');
  assert.deepEqual(body.granted, ['identity:read']);
  assert.equal(body.guided_audit_url, 'https://myaccount.google.com/connections');
});

// ---- sign out, CORS ----

test('DELETE /v1/session: only from an allowed origin, and it clears the cookie', async () => {
  const bad = await handle(new Request('https://x.test/v1/session', { method: 'DELETE', headers: { Origin: 'https://evil.test' } }), env, { now });
  assert.equal(bad.status, 403);
  const none = await handle(new Request('https://x.test/v1/session', { method: 'DELETE' }), env, { now });
  assert.equal(none.status, 403);

  const ok = await handle(new Request('https://x.test/v1/session', { method: 'DELETE', headers: { Origin: ORIGIN } }), env, { now });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('CORS: allowed origins get credentialed headers, others get none; preflight is 204', async () => {
  const yes = await handle(new Request('https://x.test/v1/permissions', { headers: { Origin: 'https://myprivacytool.io' } }), env, { now });
  assert.equal(yes.headers.get('Access-Control-Allow-Origin'), 'https://myprivacytool.io');
  const no = await handle(new Request('https://x.test/v1/permissions', { headers: { Origin: 'https://evil.test' } }), env, { now });
  assert.equal(no.headers.get('Access-Control-Allow-Origin'), null);
  const pre = await handle(new Request('https://x.test/v1/session', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, { now });
  assert.equal(pre.status, 204);
});

test('unknown routes and methods are 404; /health needs no secrets', async () => {
  assert.equal((await handle(new Request('https://x.test/nope'), env, { now })).status, 404);
  assert.equal((await handle(new Request('https://x.test/v1/session', { method: 'POST' }), env, { now })).status, 404);
  assert.deepEqual(await (await handle(new Request('https://x.test/health'), {}, { now })).json(), { status: 'ok' });
});
