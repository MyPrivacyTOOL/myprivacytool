/**
 * GitHub OAuth 2.0 helpers (authorization code + PKCE S256). Same shape as workers/oauth-poc/google.js.
 * Scope is read:user only (MPC-115 decision D): public profile, public repos and starred repos need no more.
 */
import { b64url, fromB64url } from './encoding.js';

export const AUTH_URL = 'https://github.com/login/oauth/authorize';
export const TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const SCOPES = ['read:user'];

const enc = new TextEncoder();

export function randomString(byteLen = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLen)));
}

export async function pkceChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
}

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** Sign a JSON payload as `payload.sig` (state cookie and session cookie; no server-side storage). */
export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verify(token, secret, nowMs = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return payload.exp && payload.exp < nowMs ? null : payload;
  } catch {
    return null;
  }
}

export async function buildAuthUrl({ clientId, redirectUri, state, verifier }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    allow_signup: 'false',
  }).toString();
  return u.toString();
}

export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri }, fetchFn = fetch) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier,
    }),
  });
  const data = await res.json().catch(() => ({}));
  // GitHub returns 200 with an `error` field on failure. Never echo the body (may hold secrets).
  if (!res.ok || data.error || !data.access_token) throw new Error(`token exchange failed${data.error ? `: ${data.error}` : ''}`);
  return data; // { access_token, scope, token_type, [refresh_token, expires_in] }
}

/** Revoke MPT's OAuth grant for the user at GitHub (DELETE /applications/{client_id}/grant). */
export async function revokeGrant({ accessToken, clientId, clientSecret }, fetchFn = fetch) {
  const res = await fetchFn(`https://api.github.com/applications/${clientId}/grant`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'myprivacytool-github-channel',
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  return res.status === 204 || res.status === 404; // 404 = already revoked
}
