/**
 * MPC-6971 — MPT session and permission scoping for the OAuth Worker.
 *
 * After a Google consent in `mode=session` the Worker revokes Google's token and keeps only MPT's own
 * short-lived, HMAC-signed session cookie. The session carries MPT permission scopes (not Google's), so
 * every API route can check what the caller may do without holding any provider token.
 */
import { sign, verify } from './google.js';

export const SESSION_COOKIE = 'mpt_oauth_session';
export const SESSION_TTL_MS = 60 * 60 * 1000; // 1h: sessions are stateless, so keep them short
export const AUDIENCE = 'myprivacytool-oauth';

/**
 * MPT permission scopes. `held` = a user can hold it today; `false` = defined so the contract is stable,
 * but needs a provider capability MPT does not have (MPC-6960: no consumer Google API lists other apps' grants).
 */
export const SCOPES = {
  'identity:read': { held: true, description: 'Read the signed-in user\'s own verified email and provider subject id.' },
  'grants:read': { held: false, description: 'List the third-party app grants on the user\'s account.' },
  'grants:revoke': { held: false, description: 'Revoke a third-party app grant on the user\'s account.' },
};

const EMAIL_SCOPES = ['email', 'https://www.googleapis.com/auth/userinfo.email'];

/** Map the scopes Google reports for the token (tokeninfo.scope) to the MPT scopes it justifies. */
export function mptScopesFor(googleScope) {
  const have = new Set(String(googleScope || '').split(/\s+/).filter(Boolean));
  const out = [];
  if (EMAIL_SCOPES.some((s) => have.has(s))) out.push('identity:read');
  return out;
}

export function readCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}

/** @returns {Promise<string>} signed cookie value */
export function issueSession({ sub, email, scopes, uid = null, link = 'not_configured' }, key, nowMs = Date.now()) {
  return sign({
    typ: 'session', aud: AUDIENCE, v: 1,
    sub, email, scp: scopes, uid, link,
    iat: nowMs, exp: nowMs + SESSION_TTL_MS,
  }, key);
}

/** Returns the session payload, or null for a missing, forged, expired or wrong-type cookie. */
export async function readSession(request, key, nowMs = Date.now()) {
  const p = await verify(readCookie(request, SESSION_COOKIE), key, nowMs);
  if (!p || p.typ !== 'session' || p.aud !== AUDIENCE || p.v !== 1 || !p.sub || !Array.isArray(p.scp)) return null;
  return p;
}

export const hasScope = (session, scope) => session.scp.includes(scope);

export const sessionCookie = (value, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=None`;
