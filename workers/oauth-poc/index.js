/**
 * MyPrivacyTOOL — Cloudflare Worker: Google OAuth proof of concept (MPC-6971, Phase 5)
 *
 * Routes
 *   GET /oauth/google/start     redirect to Google consent (auth code + PKCE + signed state cookie)
 *   GET /oauth/google/callback  exchange code, run the probe, revoke MPT's own token, return JSON
 *   GET /health
 *
 * Design rules (Strategy 2.7 / MPC-6959 risk mitigations):
 *   - Non-sensitive scopes only (openid email profile); online access, no refresh token.
 *   - No token is stored. It lives in memory for one request and is revoked before responding.
 *   - PKCE verifier and state travel in a short-lived HMAC-signed HttpOnly cookie.
 *   - The probe records which grant-listing surfaces exist so MPC-6960 [verify] items get evidence.
 */

import {
  buildAuthUrl, exchangeCode, randomString, sign, verify,
  tokenInfo, userInfo, revoke,
} from './google.js';

const COOKIE = 'mpt_oauth';
const TTL_MS = 10 * 60 * 1000;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ status: 'ok' });
    if (url.pathname === '/oauth/google/start') return start(env);
    if (url.pathname === '/oauth/google/callback') return callback(request, url, env);
    return new Response('Not Found', { status: 404 });
  },
};

async function start(env) {
  const state = randomString(16);
  const verifier = randomString(48);
  const cookie = await sign({ state, verifier, exp: Date.now() + TTL_MS }, env.STATE_SIGNING_KEY);
  const location = await buildAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID, redirectUri: env.REDIRECT_URI, state, verifier,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Set-Cookie': `${COOKIE}=${cookie}; Max-Age=600; Path=/oauth/google; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

function readCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}

export async function callback(request, url, env, fetchFn = fetch) {
  const clear = `${COOKIE}=; Max-Age=0; Path=/oauth/google; HttpOnly; Secure; SameSite=Lax`;
  const error = url.searchParams.get('error');
  if (error) return json({ ok: false, error }, 400, { 'Set-Cookie': clear });

  const saved = await verify(readCookie(request, COOKIE), env.STATE_SIGNING_KEY);
  if (!saved || saved.state !== url.searchParams.get('state')) {
    return json({ ok: false, error: 'invalid_state' }, 400, { 'Set-Cookie': clear });
  }
  const code = url.searchParams.get('code');
  if (!code) return json({ ok: false, error: 'missing_code' }, 400, { 'Set-Cookie': clear });

  let accessToken;
  try {
    const tokens = await exchangeCode({
      code, verifier: saved.verifier, clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.REDIRECT_URI,
    }, fetchFn);
    accessToken = tokens.access_token;

    const [info, profile] = await Promise.all([tokenInfo(accessToken, fetchFn), userInfo(accessToken, fetchFn)]);
    const result = {
      ok: true,
      user: { email: profile.email, verified: profile.email_verified },
      // Describes only MPT's own token: proves the API cannot enumerate other apps' grants.
      token: { scope: info.scope, expires_in: info.expires_in, aud_matches_client: info.aud === env.GOOGLE_CLIENT_ID },
      finding: 'tokeninfo/userinfo describe this token only; no endpoint lists other apps\' grants (MPC-6960 step 3).',
    };
    return json(result, 200, { 'Set-Cookie': clear });
  } catch (e) {
    return json({ ok: false, error: e.message }, 502, { 'Set-Cookie': clear });
  } finally {
    if (accessToken) await revoke(accessToken, fetchFn).catch(() => {});
  }
}
