/**
 * Reddit OAuth 2.0 (MPC-116). Differences from GitHub: no PKCE (Reddit ignores code_verifier), the token
 * endpoint wants HTTP Basic client credentials, `duration=permanent` is what yields a refresh token, access
 * tokens last 1 hour, refresh tokens do NOT rotate, and every request needs a descriptive User-Agent.
 * Scopes are the minimum: identity (who am I), read, history (my own comments and posts).
 */
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { workerRecipientContext } from '../../../shared/recipients/worker-ctx.ts';

// MPC-9885: the injected fetchFn (tests) is handed to the wrapper; undefined falls back to the global fetch there.
const rctx = (fetchFn) => workerRecipientContext(null, { fetchImpl: fetchFn });

export const REDDIT_SCOPES = ['identity', 'read', 'history'];
export const AUTH_URL = 'https://www.reddit.com/api/v1/authorize';
export const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
export const REVOKE_URL = 'https://www.reddit.com/api/v1/revoke_token';
export const DEFAULT_USER_AGENT = 'MyPrivacyTOOL/1.0 (privacy identity tool; https://www.myprivacytool.io)';

const basic = (clientId, clientSecret) => `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

export function buildRedditAuthUrl({ clientId, redirectUri, state }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state,
    redirect_uri: redirectUri,
    duration: 'permanent',
    scope: REDDIT_SCOPES.join(' '),
  }).toString();
  return u.toString();
}

async function tokenRequest(body, { clientId, clientSecret, userAgent }, fetchFn, what) {
  const res = await callRecipient('oauth-providers', { url: TOKEN_URL, sent: [], init: {
    method: 'POST',
    headers: {
      Authorization: basic(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent || DEFAULT_USER_AGENT,
    },
    body: new URLSearchParams(body),
  } }, rctx(fetchFn));
  const data = await res.json().catch(() => ({}));
  // Reddit can answer 200 with an `error` field. Never echo the body (it may contain secrets).
  if (!res.ok || data.error || !data.access_token) throw new Error(`${what} failed${data.error ? `: ${data.error}` : ''}`);
  return data; // { access_token, token_type, expires_in, scope, [refresh_token] }
}

export function exchangeRedditCode({ code, clientId, clientSecret, redirectUri, userAgent }, fetchFn = undefined) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    { clientId, clientSecret, userAgent }, fetchFn, 'token exchange');
}

/** Reddit does not return a new refresh_token here: keep using the stored one. */
export function refreshRedditToken({ refreshToken, clientId, clientSecret, userAgent }, fetchFn = undefined) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken },
    { clientId, clientSecret, userAgent }, fetchFn, 'token refresh');
}

/** Revoke a token at Reddit (revoking a refresh token also invalidates its access tokens). 204 = revoked. */
export async function revokeRedditToken({ token, hint = 'refresh_token', clientId, clientSecret, userAgent }, fetchFn = undefined) {
  const res = await callRecipient('oauth-providers', { url: REVOKE_URL, sent: [], init: {
    method: 'POST',
    headers: {
      Authorization: basic(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent || DEFAULT_USER_AGENT,
    },
    body: new URLSearchParams({ token, token_type_hint: hint }),
  } }, rctx(fetchFn));
  return res.status === 204 || res.status === 200;
}
