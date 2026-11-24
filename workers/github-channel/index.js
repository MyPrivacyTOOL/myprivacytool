/**
 * MyPrivacyTOOL — Cloudflare Worker: GitHub channel integration (MPC-115, Phase 1)
 *
 * Routes
 *   GET    /oauth/github/start       redirect to GitHub consent (auth code + PKCE S256 + signed state cookie)
 *   GET    /oauth/github/remove      MPC-10825: same sign-in, but the callback REMOVES the stored connection (no session needed)
 *   GET    /oauth/github/callback    verify state, exchange code, store AES-256-GCM encrypted token, set session
 *                                    (when the state cookie says intent=remove: delete the stored row instead, never store or sign in)
 *   GET    /channels/github/profile  sanitized PaPIT v1 JSON (24h KV cache); needs the session cookie
 *   DELETE /channels/github          revoke: delete token row, revoke grant at GitHub, clear cache + session
 *   GET    /health
 *
 * Rules (MPC-115): scope read:user only; tokens encrypted before they reach Supabase; logs carry event
 * names and status codes only (no tokens, no PII, no raw API bodies).
 */
import { buildAuthUrl, exchangeCode, randomString, sign, verify, revokeGrant, refreshAccessToken } from './lib/oauth.js';
import { GitHubAdapter, GitHubAdapterError } from './lib/adapter.js';
import { bridgeGithub } from './lib/bridge.js';
import { getCached, putCached, deleteCached } from './lib/cache.js';
import { saveToken, loadTokens, loadAccessToken, deleteToken } from './lib/store.js';
import { log, originAllowed, corsHeaders, json, readCookie, setCookie } from './lib/http.js';
import { handleReddit } from './lib/reddit-routes.js';

const STATE_COOKIE = 'mpt_gh_oauth';
const SESSION_COOKIE = 'mpt_gh_session';
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function handle(request, env, deps = {}) {
  const { fetchFn = undefined, now = () => Date.now() } = deps;
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/health') return json({ status: 'ok' });
  // Reddit channel (MPC-116): same Worker, same token table, provider = 'reddit'.
  if (url.pathname.startsWith('/oauth/reddit/') || url.pathname.startsWith('/channels/reddit')) {
    return handleReddit(request, url, env, { cors, fetchFn, now, limiter: deps.limiter });
  }
  if (url.pathname === '/oauth/github/start' && request.method === 'GET') return start(env, now);
  if (url.pathname === '/oauth/github/remove' && request.method === 'GET') return start(env, now, 'remove');
  if (url.pathname === '/oauth/github/callback' && request.method === 'GET') return callback(request, url, env, fetchFn, now);
  if (url.pathname === '/channels/github/profile' && request.method === 'GET') return profile(request, env, cors, fetchFn, now);
  if (url.pathname === '/channels/github' && request.method === 'DELETE') return revoke(request, env, cors, fetchFn, now);
  return new Response('Not Found', { status: 404 });
}

export default { fetch: (request, env) => handle(request, env) };

async function start(env, now, intent) {
  const state = randomString(16);
  const verifier = randomString(48);
  // The intent travels in the HMAC-signed cookie, never in the URL, so it cannot be flipped by editing a link.
  const cookie = await sign({ state, verifier, exp: now() + STATE_TTL_MS, ...(intent ? { intent } : {}) }, env.STATE_SIGNING_KEY);
  const location = await buildAuthUrl({ clientId: env.GITHUB_CLIENT_ID, redirectUri: env.REDIRECT_URI, state, verifier });
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Set-Cookie': setCookie(STATE_COOKIE, cookie, 600, '/oauth/github', 'Lax') },
  });
}

async function callback(request, url, env, fetchFn, now) {
  const clear = setCookie(STATE_COOKIE, '', 0, '/oauth/github', 'Lax');
  // `stage` names which step failed (exchange | github_user | store). `detail` is the sanitized error message:
  // adapter, exchange, Supabase and crypto errors carry only a status or a generic reason, never a token or body.
  const fail = (error, status, stage, detail) => {
    log('oauth_callback_failed', { error, status, stage, detail });
    if (env.SUCCESS_REDIRECT) {
      const to = new URL(env.SUCCESS_REDIRECT);
      to.searchParams.set('channel_error', error);
      if (stage) to.searchParams.set('stage', stage);
      return new Response(null, { status: 302, headers: { Location: to.toString(), 'Set-Cookie': clear } });
    }
    return json({ ok: false, error, stage }, status, { 'Set-Cookie': clear });
  };

  const saved = await verify(readCookie(request, STATE_COOKIE), env.STATE_SIGNING_KEY, now());
  const removing = saved?.intent === 'remove';
  if (url.searchParams.get('error')) return fail(removing ? 'remove_access_denied' : 'access_denied', 400);
  if (!saved || saved.state !== url.searchParams.get('state')) return fail('invalid_state', 400);
  const code = url.searchParams.get('code');
  if (!code) return fail('missing_code', 400);
  if (removing) return removeStored({ code, saved, env, fetchFn, fail, clear });

  let accessToken;
  let stage = 'exchange';
  try {
    const tokens = await exchangeCode({
      code, verifier: saved.verifier, clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri: env.REDIRECT_URI,
    }, fetchFn);
    accessToken = tokens.access_token;

    stage = 'github_user';
    const adapter = new GitHubAdapter({ token: accessToken, fetchFn });
    const me = await adapter.get('/user'); // only .id is kept
    stage = 'store';
    await saveToken(env, {
      subjectId: me.id, accessToken, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresIn: tokens.expires_in,
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
    return fail('connect_failed', 502, stage, String(e?.message || 'error').slice(0, 120));
  }
}

/**
 * MPC-10825: remove a stored connection without a live session. The person proves they own the account by signing in
 * with GitHub again (the sign-in is the proof; nothing else is accepted). We then delete that account's row and cache,
 * and revoke the grant at GitHub. The fresh token from this sign-in is never stored and no session is issued.
 * Revoking the grant (DELETE /applications/{client_id}/grant) invalidates every token of this app for the user, so it
 * also ends the stored token and the one we just received, even if the stored one has expired or cannot be decrypted.
 */
async function removeStored({ code, saved, env, fetchFn, fail, clear }) {
  let accessToken;
  let subjectId;
  let deleted = false;
  let stage = 'exchange';
  try {
    const tokens = await exchangeCode({
      code, verifier: saved.verifier, clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri: env.REDIRECT_URI,
    }, fetchFn);
    accessToken = tokens.access_token;
    stage = 'github_user';
    subjectId = String((await new GitHubAdapter({ token: accessToken, fetchFn }).get('/user')).id); // only .id is used
    stage = 'delete';
    await deleteToken(env, subjectId, fetchFn);
    await deleteCached(env.PROFILE_CACHE, subjectId);
    deleted = true;
  } catch (e) {
    log('remove_failed', { stage, detail: String(e?.message || 'error').slice(0, 80) });
  }
  let revokedAtGithub = false;
  if (accessToken) {
    revokedAtGithub = await revokeGrant(
      { accessToken, clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }, fetchFn,
    ).catch(() => false);
  }
  if (!deleted) return fail('remove_failed', 502, stage);
  log('removed_without_session', { channel: 'github', revokedAtGithub });
  const headers = new Headers();
  headers.append('Set-Cookie', clear);
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0, '/', 'None'));
  if (env.SUCCESS_REDIRECT) {
    const to = new URL(env.SUCCESS_REDIRECT);
    to.searchParams.set('channel_removed', 'github');
    to.searchParams.set('revoked', revokedAtGithub ? '1' : '0');
    headers.set('Location', to.toString());
    return new Response(null, { status: 302, headers });
  }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ ok: true, removed: true, revoked_at_github: revokedAtGithub }), { status: 200, headers });
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

    const tokens = await loadTokens(env, subjectId, fetchFn);
    if (!tokens) return json({ error: 'not_connected' }, 404, cors);

    let raw;
    try {
      raw = await new GitHubAdapter({ token: tokens.accessToken, fetchFn }).fetchIdentity();
    } catch (e) {
      // Expiring user tokens last ~8h. On 401, trade the refresh token for a new pair (once), save it, retry.
      if (!(e instanceof GitHubAdapterError && e.status === 401) || !tokens.refreshToken) throw e;
      let fresh;
      try {
        fresh = await refreshAccessToken({
          refreshToken: tokens.refreshToken, clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET,
        }, fetchFn);
      } catch (re) {
        log('token_refresh_failed', { detail: String(re.message).slice(0, 80) });
        throw e; // falls through to the reauthorize handling below
      }
      await saveToken(env, {
        subjectId, accessToken: fresh.access_token, refreshToken: fresh.refresh_token,
        scope: fresh.scope, expiresIn: fresh.expires_in,
      }, fetchFn);
      log('token_refreshed');
      raw = await new GitHubAdapter({ token: fresh.access_token, fetchFn }).fetchIdentity();
    }
    const { papit, sanitization_receipt: sanitizationReceipt } = await bridgeGithub(raw, { now: new Date(now()) });
    await putCached(env.PROFILE_CACHE, subjectId, papit, now());
    return json(papit, 200, { ...cors, 'X-Cache': 'MISS', 'X-PaPIT-Sanitization-Receipt': sanitizationReceipt });
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
  if (!originAllowed(env, request.headers.get('Origin'))) return json({ error: 'forbidden_origin' }, 403);
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
