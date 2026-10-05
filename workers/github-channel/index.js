/**
 * MyPrivacyTOOL — Cloudflare Worker: GitHub channel integration (MPC-115, Phase 1)
 *
 * Routes
 *   GET    /oauth/github/start       redirect to GitHub consent (auth code + PKCE S256 + signed state cookie)
 *   GET    /oauth/github/callback    verify state, exchange code, store AES-256-GCM encrypted token, set session
 *   GET    /channels/github/profile  sanitized PaPIT v1 JSON (24h KV cache); needs the session cookie
 *   DELETE /channels/github          revoke: delete token row, revoke grant at GitHub, clear cache + session
 *   GET    /health
 *
 * Rules (MPC-115): scope read:user only; tokens encrypted before they reach Supabase; logs carry event
 * names and status codes only (no tokens, no PII, no raw API bodies).
 */
import { buildAuthUrl, exchangeCode, randomString, sign, verify, revokeGrant } from './lib/oauth.js';
import { GitHubAdapter, GitHubAdapterError } from './lib/adapter.js';
import { githubToPapit } from './lib/papit.js';
import { getCached, putCached, deleteCached } from './lib/cache.js';
import { saveToken, loadAccessToken, deleteToken } from './lib/store.js';

const STATE_COOKIE = 'mpt_gh_oauth';
const SESSION_COOKIE = 'mpt_gh_session';
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

function readCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}

const setCookie = (name, value, maxAge, path, sameSite) =>
  `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;

export async function handle(request, env, deps = {}) {
  const { fetchFn = fetch, now = () => Date.now() } = deps;
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/health') return json({ status: 'ok' });
  if (url.pathname === '/oauth/github/start' && request.method === 'GET') return start(env, now);
  if (url.pathname === '/oauth/github/callback' && request.method === 'GET') return callback(request, url, env, fetchFn, now);
  if (url.pathname === '/channels/github/profile' && request.method === 'GET') return profile(request, env, cors, fetchFn, now);
  if (url.pathname === '/channels/github' && request.method === 'DELETE') return revoke(request, env, cors, fetchFn, now);
  return new Response('Not Found', { status: 404 });
}

export default { fetch: (request, env) => handle(request, env) };

async function start(env, now) {
  const state = randomString(16);
  const verifier = randomString(48);
  const cookie = await sign({ state, verifier, exp: now() + STATE_TTL_MS }, env.STATE_SIGNING_KEY);
  const location = await buildAuthUrl({ clientId: env.GITHUB_CLIENT_ID, redirectUri: env.REDIRECT_URI, state, verifier });
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Set-Cookie': setCookie(STATE_COOKIE, cookie, 600, '/oauth/github', 'Lax') },
  });
}

async function callback(request, url, env, fetchFn, now) {
  const clear = setCookie(STATE_COOKIE, '', 0, '/oauth/github', 'Lax');
  const fail = (error, status) => {
    log('oauth_callback_failed', { error, status });
    if (env.SUCCESS_REDIRECT) {
      const to = new URL(env.SUCCESS_REDIRECT);
      to.searchParams.set('channel_error', error);
      return new Response(null, { status: 302, headers: { Location: to.toString(), 'Set-Cookie': clear } });
    }
    return json({ ok: false, error }, status, { 'Set-Cookie': clear });
  };

  if (url.searchParams.get('error')) return fail('access_denied', 400);
  const saved = await verify(readCookie(request, STATE_COOKIE), env.STATE_SIGNING_KEY, now());
  if (!saved || saved.state !== url.searchParams.get('state')) return fail('invalid_state', 400);
  const code = url.searchParams.get('code');
  if (!code) return fail('missing_code', 400);

  let accessToken;
  try {
    const tokens = await exchangeCode({
      code, verifier: saved.verifier, clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri: env.REDIRECT_URI,
    }, fetchFn);
    accessToken = tokens.access_token;

    const adapter = new GitHubAdapter({ token: accessToken, fetchFn });
    const me = await adapter.get('/user'); // only .id is kept
    await saveToken(env, {
      subjectId: me.id, accessToken, refreshToken: tokens.refresh_token, scope: tokens.scope,
    }, fetchFn);

    const session = await sign({ sub: String(me.id), exp: now() + SESSION_TTL_MS }, env.STATE_SIGNING_KEY);
    const headers = new Headers();
    headers.append('Set-Cookie', clear);
    headers.append('Set-Cookie', setCookie(SESSION_COOKIE, session, SESSION_TTL_MS / 1000, '/', 'None'));
    log('oauth_connected', { channel: 'github' });
    if (env.SUCCESS_REDIRECT) {
      headers.set('Location', env.SUCCESS_REDIRECT);
      return new Response(null, { status: 302, headers });
    }
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    // If we hold a token we could not store, revoke it rather than leave an orphaned grant.
    if (accessToken) {
      await revokeGrant({ accessToken, clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }, fetchFn).catch(() => {});
    }
    return fail('connect_failed', 502);
  }
}

async function session(request, env, now) {
  const s = await verify(readCookie(request, SESSION_COOKIE), env.STATE_SIGNING_KEY, now());
  return s?.sub || null;
}

async function profile(request, env, cors, fetchFn, now) {
  const subjectId = await session(request, env, now);
  if (!subjectId) return json({ error: 'unauthenticated' }, 401, cors);

  try {
    const cached = await getCached(env.PROFILE_CACHE, subjectId, now());
    if (cached) return json(cached, 200, { ...cors, 'X-Cache': 'HIT' });

    const token = await loadAccessToken(env, subjectId, fetchFn);
    if (!token) return json({ error: 'not_connected' }, 404, cors);

    const raw = await new GitHubAdapter({ token, fetchFn }).fetchIdentity();
    const papit = await githubToPapit(raw, { now: new Date(now()) });
    await putCached(env.PROFILE_CACHE, subjectId, papit, now());
    return json(papit, 200, { ...cors, 'X-Cache': 'MISS' });
  } catch (e) {
    if (e instanceof GitHubAdapterError && e.status === 401) {
      // Token revoked on GitHub's side: drop our copy so the user is asked to reconnect.
      await deleteToken(env, subjectId, fetchFn).catch(() => {});
      await deleteCached(env.PROFILE_CACHE, subjectId).catch(() => {});
      log('token_invalid', { status: 401 });
      return json({ error: 'reauthorize' }, 401, cors);
    }
    log('profile_failed', { status: e.status || 500 });
    return json({ error: 'upstream_error' }, 502, cors);
  }
}

async function revoke(request, env, cors, fetchFn, now) {
  // CSRF: the session cookie is SameSite=None, so state-changing calls must come from the SPA origin.
  if (request.headers.get('Origin') !== env.ALLOWED_ORIGIN) return json({ error: 'forbidden_origin' }, 403);
  const subjectId = await session(request, env, now);
  if (!subjectId) return json({ error: 'unauthenticated' }, 401, cors);

  let token = null;
  try { token = await loadAccessToken(env, subjectId, fetchFn); } catch { /* still delete below */ }
  // Immediate deletion first (decision E), then best-effort grant revocation at GitHub.
  await deleteToken(env, subjectId, fetchFn);
  await deleteCached(env.PROFILE_CACHE, subjectId);
  let revokedAtGithub = false;
  if (token) {
    revokedAtGithub = await revokeGrant(
      { accessToken: token, clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }, fetchFn,
    ).catch(() => false);
  }
  log('revoked', { revokedAtGithub });
  return json({ ok: true, revoked_at_github: revokedAtGithub }, 200, {
    ...cors, 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0, '/', 'None'),
  });
}
