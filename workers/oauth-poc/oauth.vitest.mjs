// @vitest-environment node
// MPC-7300: Vitest unit tests for the oauth-poc Worker (Google calls mocked). Does not change the implementation.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { callback } from './index.js';
import * as g from './google.js';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', STATE_SIGNING_KEY: 'k'.repeat(32), REDIRECT_URI: 'https://x.test/oauth/google/callback' };
const res = (b, status = 200) => new Response(JSON.stringify(b), { status });
const cookieFor = async (payload) => `mpt_oauth=${await g.sign(payload, env.STATE_SIGNING_KEY)}`;
const cb = async (qs, cookie, fetchFn) => {
  const req = new Request(`https://x.test/cb?${qs}`, cookie ? { headers: { Cookie: cookie } } : {});
  return callback(req, new URL(req.url), env, fetchFn);
};
afterEach(() => vi.unstubAllGlobals());

describe('google.js helpers', () => {
  it('b64url is URL-safe and unpadded', () => {
    expect(g.b64url(new Uint8Array([251, 255, 254]))).toBe('-__-');
  });
  it('randomString returns distinct URL-safe values of the right entropy', () => {
    const a = g.randomString(16), b = g.randomString(16);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(g.randomString()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('verify rejects malformed, empty and tampered tokens', async () => {
    expect(await g.verify('', 'k')).toBeNull();
    expect(await g.verify(undefined, 'k')).toBeNull();
    expect(await g.verify('onlybody', 'k')).toBeNull();
    const t = await g.sign({ a: 1 }, 'k');
    const [body, sig] = t.split('.');
    expect(await g.verify(`${body}x.${sig}`, 'k')).toBeNull();
    expect(await g.verify(t, 'k')).toEqual({ a: 1 }); // payload without exp never expires
  });
  it('buildAuthUrl never requests offline access or extra scopes', async () => {
    const u = new URL(await g.buildAuthUrl({ clientId: 'c', redirectUri: 'https://r', state: 's', verifier: 'v' }));
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('access_type')).toBe('online');
    expect(u.searchParams.get('include_granted_scopes')).toBe('false');
    expect(u.searchParams.get('state')).toBe('s');
  });
  it('exchangeCode posts the PKCE verifier and throws on failure', async () => {
    const f = vi.fn(async () => res({ access_token: 'AT' }));
    expect(await g.exchangeCode({ code: 'c', verifier: 'v', clientId: 'i', clientSecret: 's', redirectUri: 'r' }, f)).toEqual({ access_token: 'AT' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(g.TOKEN_URL);
    expect(init.body.get('code_verifier')).toBe('v');
    expect(init.body.get('grant_type')).toBe('authorization_code');
    await expect(g.exchangeCode({}, async () => res({}, 400))).rejects.toThrow('token exchange failed: 400');
  });
  it('tokenInfo / userInfo throw on non-2xx and revoke reports the status', async () => {
    await expect(g.tokenInfo('t', async () => res({}, 401))).rejects.toThrow('tokeninfo failed: 401');
    await expect(g.userInfo('t', async () => res({}, 403))).rejects.toThrow('userinfo failed: 403');
    expect(await g.revoke('t', async () => res({}, 200))).toBe(true);
    expect(await g.revoke('t', async () => res({}, 400))).toBe(false);
    const f = vi.fn(async () => res({ sub: 1 }));
    await g.userInfo('tok', f);
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    await g.tokenInfo('a b', f);
    expect(f.mock.calls[1][0]).toContain('access_token=a%20b');
  });
});

describe('Worker routes', () => {
  it('serves /health and 404s unknown paths', async () => {
    const h = await worker.fetch(new Request('https://x.test/health'), env);
    expect(await h.json()).toEqual({ status: 'ok' });
    expect(h.headers.get('Cache-Control')).toBe('no-store');
    expect((await worker.fetch(new Request('https://x.test/nope'), env)).status).toBe(404);
  });
  it('/oauth/google/start redirects to Google with a signed, HttpOnly state cookie', async () => {
    const r = await worker.fetch(new Request('https://x.test/oauth/google/start'), env);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get('Location'));
    expect(loc.origin + loc.pathname).toBe(g.AUTH_URL);
    expect(loc.searchParams.get('client_id')).toBe('cid');
    const sc = r.headers.get('Set-Cookie');
    expect(sc).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const saved = await g.verify(sc.match(/mpt_oauth=([^;]+)/)[1], env.STATE_SIGNING_KEY);
    expect(saved.state).toBe(loc.searchParams.get('state'));
    expect(await g.pkceChallenge(saved.verifier)).toBe(loc.searchParams.get('code_challenge'));
  });
  it('/oauth/google/callback is routed to the handler', async () => {
    const r = await worker.fetch(new Request('https://x.test/oauth/google/callback?error=access_denied'), env);
    expect(r.status).toBe(400);
  });
});

describe('callback', () => {
  const good = () => cookieFor({ state: 'good', verifier: 'v', exp: Date.now() + 1000 });
  it('reports Google-side errors and clears the cookie', async () => {
    const r = await cb('error=access_denied');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: 'access_denied' });
    expect(r.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
  });
  it('rejects a missing, expired or forged state cookie', async () => {
    expect((await cb('state=a&code=c')).status).toBe(400);
    const expired = await cookieFor({ state: 'a', verifier: 'v', exp: Date.now() - 1 });
    expect((await cb('state=a&code=c', expired)).status).toBe(400);
  });
  it('rejects a missing code', async () => {
    const r = await cb('state=good', await good());
    expect(await r.json()).toEqual({ ok: false, error: 'missing_code' });
  });
  it('returns 502 when the token exchange fails and never tries to revoke', async () => {
    const f = vi.fn(async () => res({}, 400));
    const r = await cb('state=good&code=c', await good(), f);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/token exchange failed/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('revokes the token even when the probe fails, and swallows revoke errors', async () => {
    const urls = [];
    const f = async (u) => {
      urls.push(String(u));
      if (String(u).endsWith('/token')) return res({ access_token: 'AT' });
      if (String(u).includes('tokeninfo')) return res({}, 500);
      if (String(u).includes('userinfo')) return res({ email: 'a@b.co' });
      throw new Error('revoke network down');
    };
    const r = await cb('state=good&code=c', await good(), f);
    expect(r.status).toBe(502);
    expect(urls.some((u) => u.endsWith('/revoke'))).toBe(true);
  });
  it('never returns the access token in the response body', async () => {
    const f = async (u) => {
      u = String(u);
      if (u.endsWith('/token')) return res({ access_token: 'SECRET-AT' });
      if (u.includes('tokeninfo')) return res({ scope: 'openid', expires_in: '3', aud: 'other' });
      if (u.includes('userinfo')) return res({ email: 'a@b.co', email_verified: true });
      return res({});
    };
    const text = await (await cb('state=good&code=c', await good(), f)).text();
    expect(text).not.toContain('SECRET-AT');
    expect(JSON.parse(text).token.aud_matches_client).toBe(false);
  });
  it('defaults to the global fetch', async () => {
    vi.stubGlobal('fetch', async () => res({}, 400));
    const r = await cb('state=good&code=c', await good());
    expect(r.status).toBe(502);
  });
});
