/**
 * MyPrivacyTOOL — Cloudflare Worker: OAuth and permission APIs (MPC-6971, Phase 5)
 *
 * Routes (contract: docs/phase5-oauth-api-contract.md)
 *   GET    /oauth/google/start[?mode=session]  redirect to Google consent (auth code + PKCE + signed state cookie)
 *   GET    /oauth/google/callback              exchange code, validate token, revoke MPT's own token, then
 *                                              return the probe JSON (default) or set an MPT session (mode=session)
 *   GET    /v1/session                         validate the MPT session cookie, return the caller's identity + scopes
 *   DELETE /v1/session                         sign out (clears the cookie)
 *   GET    /v1/permissions                     MPT scope catalogue, the caller's scopes, provider capability table
 *   GET    /v1/grants                          needs scope grants:read: answers 403 insufficient_scope today
 *   GET    /health
 *
 * Design rules (Strategy 2.7 / MPC-6959 risk mitigations):
 *   - Non-sensitive scopes only (openid email profile); online access, no refresh token.
 *   - No provider token is stored. It lives in memory for one request and is revoked before responding.
 *   - PKCE verifier, state and mode travel in a short-lived HMAC-signed HttpOnly cookie.
 *   - The session is MPT's own signed cookie holding MPT scopes, never a provider token.
 *   - Logs carry event names and status codes only.
 */

import {
  buildAuthUrl, exchangeCode, randomString, sign, verify,
  tokenInfo, userInfo, revoke,
} from './google.js';
import {
  SCOPES, SESSION_TTL_MS, issueSession, readSession, readCookie, hasScope, mptScopesFor, sessionCookie,
} from './session.js';
import { permissionsView, PROVIDERS } from './permissions.js';
import { linkAuthUser } from './supabase.js';

const COOKIE = 'mpt_oauth';
const TTL_MS = 10 * 60 * 1000;

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

// ALLOWED_ORIGIN may list several origins, comma-separated (apex + www).
const allowedOrigins = (env) => String(env.ALLOWED_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
const originAllowed = (env, origin) => !!origin && allowedOrigins(env).includes(origin);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!originAllowed(env, origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

export async function handle(request, env, deps = {}) {
  const { fetchFn = fetch, now = () => Date.now() } = deps;
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);
  const { pathname } = url;

  if (request.method === 'OPTIONS' && pathname.startsWith('/v1/')) return new Response(null, { status: 204, headers: cors });
  if (pathname === '/health') return json({ status: 'ok' });
  if (request.method === 'GET') {
    if (pathname === '/oauth/google/start') return start(env, url, now);
    if (pathname === '/oauth/google/callback') return callback(request, url, env, fetchFn, now);
    if (pathname === '/v1/session') return getSession(request, env, cors, now);
    if (pathname === '/v1/permissions') return getPermissions(request, env, cors, now);
    if (pathname === '/v1/grants') return getGrants(request, env, cors, now);
  }
  if (request.method === 'DELETE' && pathname === '/v1/session') return deleteSession(request, env, cors);
  return new Response('Not Found', { status: 404 });
}

export default { fetch: (request, env) => handle(request, env) };

async function start(env, url, now) {
  const state = randomString(16);
  const verifier = randomString(48);
  const mode = url.searchParams.get('mode') === 'session' ? 'session' : 'poc';
  const cookie = await sign({ state, verifier, mode, exp: now() + TTL_MS }, env.STATE_SIGNING_KEY);
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

export async function callback(request, url, env, fetchFn = fetch, now = () => Date.now()) {
  const clear = `${COOKIE}=; Max-Age=0; Path=/oauth/google; HttpOnly; Secure; SameSite=Lax`;
  const error = url.searchParams.get('error');
  if (error) return json({ ok: false, error }, 400, { 'Set-Cookie': clear });

  const saved = await verify(readCookie(request, COOKIE), env.STATE_SIGNING_KEY, now());
  if (!saved || saved.state !== url.searchParams.get('state')) {
    return json({ ok: false, error: 'invalid_state' }, 400, { 'Set-Cookie': clear });
  }
  const code = url.searchParams.get('code');
  if (!code) return json({ ok: false, error: 'missing_code' }, 400, { 'Set-Cookie': clear });

  const sessionMode = saved.mode === 'session';
  let accessToken;
  try {
    const tokens = await exchangeCode({
      code, verifier: saved.verifier, clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.REDIRECT_URI,
    }, fetchFn);
    accessToken = tokens.access_token;

    const [info, profile] = await Promise.all([tokenInfo(accessToken, fetchFn), userInfo(accessToken, fetchFn)]);
    const audMatches = info.aud === env.GOOGLE_CLIENT_ID;

    if (!sessionMode) {
      return json({
        ok: true,
        user: { email: profile.email, verified: profile.email_verified },
        // Describes only MPT's own token: proves the API cannot enumerate other apps' grants.
        token: { scope: info.scope, expires_in: info.expires_in, aud_matches_client: audMatches },
        finding: 'tokeninfo/userinfo describe this token only; no endpoint lists other apps\' grants (MPC-6960 step 3).',
      }, 200, { 'Set-Cookie': clear });
    }

    // Token validation for a real session: the token must be issued to this client, the email must be
    // verified, and the subject id must exist. Anything else is refused before a session is created.
    if (!audMatches) return sessionFailure(env, 'aud_mismatch', 400, clear);
    if (profile.email_verified !== true || !profile.email) return sessionFailure(env, 'email_not_verified', 403, clear);
    if (!profile.sub) return sessionFailure(env, 'missing_subject', 502, clear);
    const scopes = mptScopesFor(info.scope);
    if (!scopes.length) return sessionFailure(env, 'insufficient_provider_scope', 403, clear);

    const link = await linkAuthUser(env, profile.email, fetchFn);
    const value = await issueSession({
      sub: String(profile.sub), email: profile.email, scopes, uid: link.uid, link: link.state,
    }, env.STATE_SIGNING_KEY, now());
    log('session_issued', { link: link.state });

    const headers = new Headers();
    headers.append('Set-Cookie', clear);
    headers.append('Set-Cookie', sessionCookie(value, SESSION_TTL_MS / 1000));
    if (env.SUCCESS_REDIRECT) {
      headers.set('Location', env.SUCCESS_REDIRECT);
      return new Response(null, { status: 302, headers });
    }
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify({ ok: true, session: true }), { status: 200, headers });
  } catch (e) {
    log('oauth_callback_failed', { detail: String(e?.message || 'error').slice(0, 80) });
    return json({ ok: false, error: e.message }, 502, { 'Set-Cookie': clear });
  } finally {
    if (accessToken) await revoke(accessToken, fetchFn).catch(() => {});
  }
}

function sessionFailure(env, error, status, clear) {
  log('session_refused', { error });
  if (env.SUCCESS_REDIRECT) {
    const to = new URL(env.SUCCESS_REDIRECT);
    to.searchParams.set('oauth_error', error);
    return new Response(null, { status: 302, headers: { Location: to.toString(), 'Set-Cookie': clear } });
  }
  return json({ ok: false, error }, status, { 'Set-Cookie': clear });
}

async function getSession(request, env, cors, now) {
  const s = await readSession(request, env.STATE_SIGNING_KEY, now());
  if (!s) return json({ authenticated: false, error: 'unauthenticated' }, 401, cors);
  return json({
    authenticated: true,
    user: { sub: s.sub, email: s.email, email_verified: true },
    scopes: s.scp,
    supabase: { link: s.link, user_id: s.uid },
    expires_at: new Date(s.exp).toISOString(),
  }, 200, cors);
}

async function getPermissions(request, env, cors, now) {
  // Public catalogue; the caller-specific part is filled in only when a valid session is present.
  const s = await readSession(request, env.STATE_SIGNING_KEY, now());
  return json(permissionsView(s, SCOPES), 200, cors);
}

async function getGrants(request, env, cors, now) {
  const s = await readSession(request, env.STATE_SIGNING_KEY, now());
  if (!s) return json({ error: 'unauthenticated' }, 401, cors);
  if (!hasScope(s, 'grants:read')) {
    const google = PROVIDERS.find((p) => p.id === 'google' && p.account_type === 'consumer');
    return json({
      error: 'insufficient_scope', required: 'grants:read', granted: s.scp,
      guided_audit_url: google.guided_audit_url,
    }, 403, cors);
  }
  // No provider adapter can list grants yet (MPC-6960). Reaching here means a scope was granted without an adapter.
  return json({ error: 'not_implemented' }, 501, cors);
}

function deleteSession(request, env, cors) {
  // CSRF: the session cookie is SameSite=None, so state-changing calls must come from an allowed origin.
  if (!originAllowed(env, request.headers.get('Origin'))) return json({ error: 'forbidden_origin' }, 403);
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': sessionCookie('', 0) });
}
