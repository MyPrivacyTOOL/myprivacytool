/**
 * POST /papit/verify (MPC-10833): the one place a PaPIT profile comes back to us from outside, so the one place that can
 * refuse a stale one. Stateless: nothing is stored, no session or token is read, the body is never logged.
 *
 *   200 {valid:true, expires_at}                  fresh, and the receipt matches
 *   410 {error:'profile_expired', expires_at}     expires_at has passed (or generated_at + 30 days, for a profile issued before expires_at existed)
 *   422 {error:'invalid_profile'}                 not a PaPIT v1 profile, receipt does not match, or expires_at is outside generated_at .. +30 days
 *   400 {error:'bad_request'}  /  413 {error:'too_large'}
 *
 * The receipt is an unkeyed checksum: this proves the copy is unchanged from what the sender hands us, not who made it.
 */
import { json } from './http.js';
import { profileStatus, verifyReceipt } from './papit.js';

export const MAX_VERIFY_BYTES = 32 * 1024;

export async function verifyProfile(request, now = () => Date.now()) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_VERIFY_BYTES) return json({ error: 'too_large' }, 413);
  const text = await request.text();
  if (text.length > MAX_VERIFY_BYTES) return json({ error: 'too_large' }, 413);
  let profile;
  try { profile = JSON.parse(text); } catch { return json({ error: 'bad_request' }, 400); }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return json({ error: 'bad_request' }, 400);

  if (profile.version !== '1.0' || typeof profile.cryptographic_receipt !== 'string') return json({ error: 'invalid_profile' }, 422);
  const { status, expires_at: expiresAt } = profileStatus(profile, now());
  if (status === 'invalid') return json({ error: 'invalid_profile' }, 422);
  if (!(await verifyReceipt(profile))) return json({ error: 'invalid_profile' }, 422);
  if (status === 'expired') return json({ error: 'profile_expired', expires_at: expiresAt }, 410);
  return json({ valid: true, expires_at: expiresAt }, 200);
}
