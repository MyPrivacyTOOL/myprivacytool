/**
 * Reddit channel routes (MPC-116), served by the same Worker as the GitHub channel:
 *   GET    /oauth/reddit/start       redirect to Reddit consent (scopes identity read history, duration=permanent)
 *   GET    /oauth/reddit/remove      MPC-10825: same sign-in, but the callback REMOVES the stored connection (no session needed)
 *   GET    /oauth/reddit/callback    verify state, exchange code, store AES-256-GCM encrypted tokens (provider='reddit')
 *                                    (when the state cookie says intent=remove: delete the stored row instead, never store or sign in)
 *   GET    /channels/reddit/behavior sanitized PaPIT v1 behavioral JSON (24h KV cache); needs the session cookie
 *   DELETE /channels/reddit          revoke: delete token row, revoke at Reddit, clear cache + session
 *
 * Enabled only when REDDIT_CLIENT_ID, REDDIT_REDIRECT_URI (vars) and REDDIT_CLIENT_SECRET (secret) are set;
 * otherwise these routes answer 503 and the GitHub channel is unaffected. Logs carry event names and status
 * codes only: never tokens, usernames, or any Reddit content.
 */
import { log, originAllowed, json, readCookie, setCookie } from './http.js';
import { randomString, sign, verify } from './oauth.js';
import {
  buildRedditAuthUrl, exchangeRedditCode, refreshRedditToken, revokeRedditToken, DEFAULT_USER_AGENT,
} from './reddit-oauth.js';
import { RedditAdapter, RedditAdapterError } from './reddit.js';
import { bridgeReddit } from './bridge.js';
import { getCached, putCached, deleteCached } from './cache.js';
import { saveToken, loadTokens, deleteToken } from './store.js';
import { consentExpired, consentUntilMs } from './papit.js';

const PROVIDER = 'reddit';
const STATE_COOKIE = 'mpt_rd_oauth';
const SESSION_COOKIE = 'mpt_rd_session';
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const redditConfigured = (env) => !!(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_REDIRECT_URI);
const userAgent = (env) => env.REDDIT_USER_AGENT || DEFAULT_USER_AGENT;
const creds = (env) => ({ clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET, userAgent: userAgent(env) });

export async function handleReddit(request, url, env, { cors = {}, fetchFn = undefined, now = () => Date.now(), limiter } = {}) {
  const { pathname } = url;
  const known = (pathname === '/oauth/reddit/start' && request.method === 'GET')
    || (pathname === '/oauth/reddit/remove' && request.method === 'GET')
    || (pathname === '/oauth/reddit/callback' && request.method === 'GET')
    || (pathname === '/channels/reddit/behavior' && request.method === 'GET')
    || (pathname === '/channels/reddit' && request.method === 'DELETE');
  if (!known) return new Response('Not Found', { status: 404 });
  if (!redditConfigured(env)) return json({ error: 'reddit_not_configured' }, 503, cors);

  if (pathname === '/oauth/reddit/start') return start(env, now);
  if (pathname === '/oauth/reddit/remove') return start(env, now, 'remove');
  if (pathname === '/oauth/reddit/callback') return callback(request, url, env, fetchFn, now, limiter);
  if (pathname === '/channels/reddit/behavior') return behavior(request, env, cors, fetchFn, now, limiter);
  return revoke(request, env, cors, fetchFn, now);
}

async function start(env, now, intent) {
  const state = randomString(16);
  // The intent travels in the HMAC-signed cookie, never in the URL, so it cannot be flipped by editing a link.
  const cookie = await sign({ state, exp: now() + STATE_TTL_MS, ...(intent ? { intent } : {}) }, env.STATE_SIGNING_KEY);
  const location = buildRedditAuthUrl({ clientId: env.REDDIT_CLIENT_ID, redirectUri: env.REDDIT_REDIRECT_URI, state });
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Set-Cookie': setCookie(STATE_COOKIE, cookie, 600, '/oauth/reddit', 'Lax') },
  });
}

async function callback(request, url, env, fetchFn, now, limiter) {
  const clear = setCookie(STATE_COOKIE, '', 0, '/oauth/reddit', 'Lax');
  const fail = (error, status, stage, detail) => {
    log('reddit_oauth_callback_failed', { error, status, stage, detail });
    if (env.REDDIT_SUCCESS_REDIRECT) {
      const to = new URL(env.REDDIT_SUCCESS_REDIRECT);
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
  if (removing) return removeStored({ code, env, fetchFn, limiter, fail, clear });

  let accessToken;
  let refreshToken;
  let stage = 'exchange';
  try {
    const tokens = await exchangeRedditCode({ code, redirectUri: env.REDDIT_REDIRECT_URI, ...creds(env) }, fetchFn);
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;

    stage = 'reddit_user';
    const adapter = new RedditAdapter({ token: accessToken, userAgent: userAgent(env), fetchFn, limiter });
    const me = await adapter.get('/api/v1/me'); // only .id is kept
    stage = 'store';
    await saveToken(env, {
      provider: PROVIDER, subjectId: me.id, accessToken, refreshToken, scope: tokens.scope, expiresIn: tokens.expires_in,
      consentedAt: new Date(now()).toISOString(), // MPC-10833: the 90 days start at this consent
    }, fetchFn);

    const session = await sign({ sub: String(me.id), exp: now() + SESSION_TTL_MS }, env.STATE_SIGNING_KEY);
    const headers = new Headers();
    headers.append('Set-Cookie', clear);
    headers.append('Set-Cookie', setCookie(SESSION_COOKIE, session, SESSION_TTL_MS / 1000, '/', 'None'));
    log('reddit_connected');
    if (env.REDDIT_SUCCESS_REDIRECT) {
      headers.set('Location', env.REDDIT_SUCCESS_REDIRECT);
      return new Response(null, { status: 302, headers });
    }
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    // A token we could not store must not stay valid at Reddit.
    const orphan = refreshToken || accessToken;
    if (orphan) {
      await revokeRedditToken({ token: orphan, hint: refreshToken ? 'refresh_token' : 'access_token', ...creds(env) }, fetchFn).catch(() => {});
    }
    return fail('connect_failed', 502, stage, String(e?.message || 'error').slice(0, 120));
  }
}

/**
 * MPC-10825: remove a stored Reddit connection without a live session. Signing in with Reddit again is the proof of
 * ownership. Reddit revokes per token (not per grant), so we revoke BOTH the stored refresh token (the long-lived one we
 * hold) and the fresh one this sign-in just issued. The fresh tokens are never stored and no session is issued.
 */
async function removeStored({ code, env, fetchFn, limiter, fail, clear }) {
  let fresh;
  let subjectId;
  let stored = null;
  let deleted = false;
  let stage = 'exchange';
  try {
    fresh = await exchangeRedditCode({ code, redirectUri: env.REDDIT_REDIRECT_URI, ...creds(env) }, fetchFn);
    stage = 'reddit_user';
    const me = await new RedditAdapter({ token: fresh.access_token, userAgent: userAgent(env), fetchFn, limiter }).get('/api/v1/me');
    subjectId = String(me.id); // only .id is used
    stage = 'delete';
    try { stored = await loadTokens(env, subjectId, fetchFn, PROVIDER); } catch { /* still delete below */ }
    await deleteToken(env, subjectId, fetchFn, PROVIDER);
    await deleteCached(env.PROFILE_CACHE, subjectId, PROVIDER);
    deleted = true;
  } catch (e) {
    log('reddit_remove_failed', { stage, detail: String(e?.message || 'error').slice(0, 80) });
  }
  const revoke = (token, hint) => revokeRedditToken({ token, hint, ...creds(env) }, fetchFn).catch(() => false);
  let revokedAtReddit = false;
  if (deleted && stored) revokedAtReddit = await revoke(stored.refreshToken || stored.accessToken, stored.refreshToken ? 'refresh_token' : 'access_token');
  if (fresh) {
    const freshRevoked = await revoke(fresh.refresh_token || fresh.access_token, fresh.refresh_token ? 'refresh_token' : 'access_token');
    if (!stored) revokedAtReddit = freshRevoked; // nothing stored: the sign-in's own token is all there was to revoke
  }
  if (!deleted) return fail('remove_failed', 502, stage);
  log('reddit_removed_without_session', { revokedAtReddit });
  const headers = new Headers();
  headers.append('Set-Cookie', clear);
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0, '/', 'None'));
  if (env.REDDIT_SUCCESS_REDIRECT) {
    const to = new URL(env.REDDIT_SUCCESS_REDIRECT);
    to.searchParams.set('channel_removed', 'reddit');
    to.searchParams.set('revoked', revokedAtReddit ? '1' : '0');
    headers.set('Location', to.toString());
    return new Response(null, { status: 302, headers });
  }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ ok: true, removed: true, revoked_at_reddit: revokedAtReddit }), { status: 200, headers });
}

async function sessionSubject(request, env, now) {
  const s = await verify(readCookie(request, SESSION_COOKIE), env.STATE_SIGNING_KEY, now());
  return s?.sub || null;
}

async function behavior(request, env, cors, fetchFn, now, limiter) {
  const subjectId = await sessionSubject(request, env, now);
  if (!subjectId) return json({ error: 'unauthenticated' }, 401, cors);

  try {
    const cached = await getCached(env.PROFILE_CACHE, subjectId, now(), PROVIDER);
    if (cached) return json(cached, 200, { ...cors, 'X-Cache': 'HIT' });

    const tokens = await loadTokens(env, subjectId, fetchFn, PROVIDER);
    if (!tokens) return json({ error: 'not_connected' }, 404, cors);
    // MPC-10833: same 90-day rule as the GitHub channel; the stored token is kept until the person disconnects or connects again.
    if (consentExpired(tokens.consentedAt, now())) {
      await deleteCached(env.PROFILE_CACHE, subjectId, PROVIDER).catch(() => {});
      log('reddit_reconsent_required');
      return json({ error: 'reconsent_required' }, 401, cors);
    }

    let raw;
    try {
      raw = await new RedditAdapter({ token: tokens.accessToken, userAgent: userAgent(env), fetchFn, limiter }).fetchActivity();
    } catch (e) {
      // Reddit access tokens last 1 hour. On 401, trade the (non-rotating) refresh token for a new access token and retry once.
      if (!(e instanceof RedditAdapterError && e.status === 401) || !tokens.refreshToken) throw e;
      let fresh;
      try {
        fresh = await refreshRedditToken({ refreshToken: tokens.refreshToken, ...creds(env) }, fetchFn);
      } catch (re) {
        log('reddit_token_refresh_failed', { detail: String(re.message).slice(0, 80) });
        throw e;
      }
      await saveToken(env, {
        provider: PROVIDER, subjectId, accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token || tokens.refreshToken, // Reddit keeps the same refresh token
        scope: fresh.scope, expiresIn: fresh.expires_in,
      }, fetchFn);
      log('reddit_token_refreshed');
      raw = await new RedditAdapter({ token: fresh.access_token, userAgent: userAgent(env), fetchFn, limiter }).fetchActivity();
    }
    const { papit, sanitization_receipt: sanitizationReceipt } = await bridgeReddit(raw, { now: new Date(now()) });
    await putCached(env.PROFILE_CACHE, subjectId, papit, now(), PROVIDER, { consentUntil: consentUntilMs(tokens.consentedAt) });
    return json(papit, 200, { ...cors, 'X-Cache': 'MISS', 'X-PaPIT-Sanitization-Receipt': sanitizationReceipt });
  } catch (e) {
    if (e instanceof RedditAdapterError && e.status === 401) {
      await deleteToken(env, subjectId, fetchFn, PROVIDER).catch(() => {});
      await deleteCached(env.PROFILE_CACHE, subjectId, PROVIDER).catch(() => {});
      log('reddit_token_invalid', { status: 401 });
      return json({ error: 'reauthorize' }, 401, cors);
    }
    log('reddit_behavior_failed', { status: e.status || 500 });
    return json({ error: 'upstream_error' }, 502, cors);
  }
}

async function revoke(request, env, cors, fetchFn, now) {
  // CSRF: the session cookie is SameSite=None, so state-changing calls must come from the SPA origin.
  if (!originAllowed(env, request.headers.get('Origin'))) return json({ error: 'forbidden_origin' }, 403);
  const subjectId = await sessionSubject(request, env, now);
  if (!subjectId) return json({ error: 'unauthenticated' }, 401, cors);

  let tokens = null;
  try { tokens = await loadTokens(env, subjectId, fetchFn, PROVIDER); } catch { /* still delete below */ }
  // Immediate deletion first, then best-effort revocation at Reddit.
  await deleteToken(env, subjectId, fetchFn, PROVIDER);
  await deleteCached(env.PROFILE_CACHE, subjectId, PROVIDER);
  let revokedAtReddit = false;
  if (tokens) {
    const token = tokens.refreshToken || tokens.accessToken;
    revokedAtReddit = await revokeRedditToken(
      { token, hint: tokens.refreshToken ? 'refresh_token' : 'access_token', ...creds(env) }, fetchFn,
    ).catch(() => false);
  }
  log('reddit_revoked', { revokedAtReddit });
  return json({ ok: true, revoked_at_reddit: revokedAtReddit }, 200, {
    ...cors, 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0, '/', 'None'),
  });
}
