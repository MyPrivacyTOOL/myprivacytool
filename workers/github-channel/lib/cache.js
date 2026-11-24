/**
 * 24h PaPIT snapshot cache in Workers KV (MPC-115 decision C). Only the sanitized PaPIT profile is cached,
 * never tokens or raw GitHub responses. KV's expirationTtl does the eviction in production; `cachedAt`
 * is also checked on read so the TTL is enforced (and testable with a mocked clock) independent of KV.
 */
import { profileStatus } from './papit.js';

export const CACHE_TTL_SECONDS = 24 * 60 * 60;
// MPC-10833: an entry also stops being served (a) once the profile's own expires_at has passed and (b) once the consent behind it has
// aged out (`consentUntil`, ms), so a cached copy never outlives either, even inside the 24h window.
const key = (subjectId, channel) => `papit:${channel}:${subjectId}`;

export async function getCached(kv, subjectId, now = Date.now(), channel = 'github') {
  const raw = await kv.get(key(subjectId, channel));
  if (!raw) return null;
  try {
    const { cachedAt, profile, consentUntil } = JSON.parse(raw);
    if (now - cachedAt >= CACHE_TTL_SECONDS * 1000) return null;
    if (consentUntil && now >= consentUntil) return null;
    if (profileStatus(profile, now).status !== 'fresh') return null;
    return profile;
  } catch {
    return null;
  }
}

export function putCached(kv, subjectId, profile, now = Date.now(), channel = 'github', { consentUntil = 0 } = {}) {
  return kv.put(key(subjectId, channel), JSON.stringify({ cachedAt: now, profile, consentUntil }), { expirationTtl: CACHE_TTL_SECONDS });
}

export function deleteCached(kv, subjectId, channel = 'github') {
  return kv.delete(key(subjectId, channel));
}
