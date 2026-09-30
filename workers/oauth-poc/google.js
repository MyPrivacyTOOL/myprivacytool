/**
 * MPC-6971 — Google OAuth 2.0 helpers (authorization code + PKCE).
 * Pure functions over fetch/WebCrypto so they run in Workers and Node 20+.
 */

export const AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
export const USERINFO_URL  = 'https://openidconnect.googleapis.com/v1/userinfo';

// Non-sensitive scopes only: no Google verification review or CASA needed.
export const SCOPES = ['openid', 'email', 'profile'];

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(byteLen = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLen)));
}

export async function pkceChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Sign a JSON payload as `payload.sig` so state survives without server storage. */
export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verify(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(body));
  if (!ok) return null;
  const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
  const payload = JSON.parse(json);
  return payload.exp && payload.exp < Date.now() ? null : payload;
}

export async function buildAuthUrl({ clientId, redirectUri, state, verifier }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    access_type: 'online',          // no refresh token: nothing long-lived to protect
    include_granted_scopes: 'false',
    prompt: 'consent',
  }).toString();
  return u.toString();
}

export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri }, fetchFn = fetch) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return res.json();
}

/** Describes THIS token only (client, scopes, expiry). Not a list of other apps' grants. */
export async function tokenInfo(accessToken, fetchFn = fetch) {
  const res = await fetchFn(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw new Error(`tokeninfo failed: ${res.status}`);
  return res.json();
}

export async function userInfo(accessToken, fetchFn = fetch) {
  const res = await fetchFn(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json();
}

/** Revokes a token MPT itself holds. Google offers no call to revoke other apps' tokens. */
export async function revoke(token, fetchFn = fetch) {
  const res = await fetchFn(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return res.ok;
}
