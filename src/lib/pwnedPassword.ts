// MPC-9776: free, browser-only password exposure check using the Pwned Passwords range API (k-anonymity).
import { recipientFetch } from '@/lib/recipientClient';
// The password is hashed (SHA-1) in the browser; ONLY the first 5 hex characters of the hash are sent. The full hash and the
// password never leave the page, are never stored, logged or sent to analytics. Matching happens locally. Free, no key.
// https://haveibeenpwned.com/API/v3#PwnedPasswords

export type PwnedResult =
  | { status: 'checked'; count: number }      // count 0 = not found in the known-breach corpus
  | { status: 'error'; reason: string };      // never guesses: an error is "not checked", not "safe"

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 5000;

export async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Parse a range response ("SUFFIX:COUNT" per line) and return the count for `suffix`. Padding rows (count 0) mean not found. */
export function countForSuffix(body: string, suffix: string): number {
  for (const line of body.split(/\r?\n/)) {
    const [s, c] = line.trim().split(':');
    if (s && s.toUpperCase() === suffix) return Math.max(0, parseInt(c, 10) || 0);
  }
  return 0;
}

export async function checkPwnedPassword(password: string, fetchImpl?: typeof fetch): Promise<PwnedResult> {
  if (!password) return { status: 'error', reason: 'empty' };
  let hash: string;
  try { hash = await sha1Hex(password); } catch { return { status: 'error', reason: 'hashing unavailable' }; }
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await recipientFetch('pwned-passwords', RANGE_URL + prefix, {
      method: 'GET',
      headers: { 'Add-Padding': 'true' },   // pad responses so their size does not reveal which range matched
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl.signal,
    }, ['password_hash_prefix'], fetchImpl ? { fetchImpl } : {});
    if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` };
    return { status: 'checked', count: countForSuffix(await res.text(), suffix) };
  } catch {
    return { status: 'error', reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Off unless VITE_PASSWORD_CHECK is exactly "true". Rollback: unset it and redeploy. */
export const passwordCheckEnabled = (): boolean => import.meta.env.VITE_PASSWORD_CHECK === 'true';
