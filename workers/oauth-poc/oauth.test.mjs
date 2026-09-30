// Run: node --test workers/oauth-poc/oauth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthUrl, pkceChallenge, sign, verify, SCOPES } from './google.js';
import { callback } from './index.js';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', STATE_SIGNING_KEY: 'k'.repeat(32), REDIRECT_URI: 'https://x.test/oauth/google/callback' };

test('PKCE challenge matches RFC 7636 example', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('auth URL requests only non-sensitive scopes, S256, online access', async () => {
  const u = new URL(await buildAuthUrl({ clientId: 'cid', redirectUri: env.REDIRECT_URI, state: 's', verifier: 'v' }));
  assert.equal(u.searchParams.get('scope'), SCOPES.join(' '));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'online');
});

test('signed state rejects tampering and expiry', async () => {
  const t = await sign({ a: 1, exp: Date.now() + 1000 }, env.STATE_SIGNING_KEY);
  assert.deepEqual(await verify(t, env.STATE_SIGNING_KEY), { a: 1, exp: JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp });
  assert.equal(await verify(t, 'other-key'), null);
  assert.equal(await verify(await sign({ exp: Date.now() - 1 }, env.STATE_SIGNING_KEY), env.STATE_SIGNING_KEY), null);
});

test('callback rejects state mismatch', async () => {
  const cookie = await sign({ state: 'good', verifier: 'v', exp: Date.now() + 1000 }, env.STATE_SIGNING_KEY);
  const req = new Request('https://x.test/cb?state=bad&code=c', { headers: { Cookie: `mpt_oauth=${cookie}` } });
  const res = await callback(req, new URL(req.url), env, async () => { throw new Error('should not call'); });
  assert.equal(res.status, 400);
});

test('callback exchanges code, probes, and always revokes MPT token', async () => {
  const cookie = await sign({ state: 'good', verifier: 'v', exp: Date.now() + 1000 }, env.STATE_SIGNING_KEY);
  const req = new Request('https://x.test/cb?state=good&code=c', { headers: { Cookie: `mpt_oauth=${cookie}` } });
  const calls = [];
  const fakeFetch = async (u, init) => {
    u = String(u); calls.push(u);
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.endsWith('/token')) return ok({ access_token: 'AT' });
    if (u.includes('tokeninfo')) return ok({ scope: 'openid email profile', expires_in: '3599', aud: 'cid' });
    if (u.includes('userinfo')) return ok({ email: 't@example.com', email_verified: true });
    if (u.endsWith('/revoke')) return new Response('{}', { status: 200 });
    throw new Error('unexpected ' + u);
  };
  const res = await callback(req, new URL(req.url), env, fakeFetch);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.token.aud_matches_client, true);
  assert.ok(calls.some(c => c.endsWith('/revoke')), 'token revoked');
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});
