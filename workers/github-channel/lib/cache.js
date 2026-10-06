/**
 * 24h PaPIT snapshot cache in Workers KV (MPC-115 decision C). Only the sanitized PaPIT profile is cached,
 * never tokens or raw GitHub responses. KV's expirationTtl does the eviction in production; `cachedAt`
 * is also checked on read so the TTL is enforced (and testable with a mocked clock) independent of KV.
 */
export const CACHE_TTL_SECONDS = 24 * 60 * 60;
const key = (subjectId, channel) => `papit:${channel}:${subjectId}`;

export async function getCached(kv, subjectId, now = Date.now(), channel = 'github') {
  const raw = await kv.get(key(subjectId, channel));
  if (!raw) return null;
  try {
    const { cachedAt, profile } = JSON.parse(raw);
    return now - cachedAt < CACHE_TTL_SECONDS * 1000 ? profile : null;
  } catch {
    return null;
  }
}

export function putCached(kv, subjectId, profile, now = Date.now(), channel = 'github') {
  return kv.put(key(subjectId, channel), JSON.stringify({ cachedAt: now, profile }), { expirationTtl: CACHE_TTL_SECONDS });
}

export function deleteCached(kv, subjectId, channel = 'github') {
  return kv.delete(key(subjectId, channel));
}
