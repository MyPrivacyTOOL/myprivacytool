/**
 * MPC-10833: how long a PaPIT profile stays valid, and how long a stored connection lasts without the person agreeing again.
 * Both numbers are enforced in code, not only declared:
 *   - a profile carries privacy_boundaries.expires_at (generated_at + PAPIT_VALIDITY_DAYS) and is refused once that has passed;
 *   - a stored token is refused and deleted TOKEN_CONSENT_DAYS after the person last agreed (the OAuth callback), and the
 *     migration's purge function deletes the rows that are never used again.
 */
export const PAPIT_VALIDITY_DAYS = 30;
export const TOKEN_CONSENT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO expiry for a profile generated at `generatedAt` (a Date or ms). */
export const expiryFor = (generatedAt) => new Date(new Date(generatedAt).getTime() + PAPIT_VALIDITY_DAYS * DAY_MS).toISOString();

/**
 * ms timestamp after which `profile` must be refused. Uses privacy_boundaries.expires_at; a profile made before that field
 * existed falls back to generated_at + data_retention_days (30). Returns NaN for a profile with neither: treated as expired.
 */
export function profileExpiryMs(profile) {
  const stated = Date.parse(profile?.privacy_boundaries?.expires_at);
  if (Number.isFinite(stated)) return stated;
  const days = Number(profile?.privacy_boundaries?.data_retention_days);
  const gen = Date.parse(profile?.generated_at);
  return Number.isFinite(gen) && Number.isFinite(days) ? gen + days * DAY_MS : NaN;
}

/** True when the profile is past its expiry, has none we can read, or claims to be generated in the future (clock or tampering). */
export function isProfileExpired(profile, now = Date.now()) {
  const exp = profileExpiryMs(profile);
  if (!Number.isFinite(exp)) return true;
  const gen = Date.parse(profile?.generated_at);
  if (Number.isFinite(gen) && gen > now + 5 * 60 * 1000) return true;
  return now >= exp;
}

/** True when the person last agreed more than TOKEN_CONSENT_DAYS ago. A missing date counts as expired (fail closed). */
export function consentExpired(consentedAt, now = Date.now()) {
  const t = Date.parse(consentedAt);
  return !Number.isFinite(t) || now - t >= TOKEN_CONSENT_DAYS * DAY_MS;
}
