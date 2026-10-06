/**
 * AES-256-GCM token encryption (Web Crypto). MPC-115 security requirement 1: no plaintext token
 * ever reaches the database.
 *
 * Ciphertext format:  v<keyVersion>.<iv b64url>.<ciphertext+tag b64url>
 *   - fresh random 96-bit IV per call
 *   - keyVersion lets us rotate ENCRYPTION_KEY: new writes use the current version, old rows keep
 *     decrypting with the key for their stored version (also stored in channel_tokens.key_version)
 *   - optional AAD binds a ciphertext to its row (channel:subject:column), so a ciphertext copied
 *     to another row fails authentication
 */
import { b64url, fromB64url, hexToBytes } from './encoding.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function importKey(keyHex) {
  return crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plaintext, keyHex, { keyVersion = 1, aad = '' } = {}) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    await importKey(keyHex),
    enc.encode(plaintext),
  );
  return `v${keyVersion}.${b64url(iv)}.${b64url(ct)}`;
}

export function parseCiphertext(payload) {
  const m = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(payload || ''));
  if (!m) throw new Error('malformed ciphertext');
  return { keyVersion: Number(m[1]), iv: fromB64url(m[2]), ct: fromB64url(m[3]) };
}

export async function decryptToken(payload, keyHex, { aad = '' } = {}) {
  const { iv, ct } = parseCiphertext(payload);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      await importKey(keyHex),
      ct,
    );
    return dec.decode(pt);
  } catch {
    // Deliberately generic: do not leak whether the key, AAD or data was wrong.
    throw new Error('decryption failed');
  }
}

/** Resolve the key for a stored key_version. Current version -> ENCRYPTION_KEY, older -> ENCRYPTION_KEY_V<n>. */
export function keyForVersion(env, version) {
  const current = Number(env.ENCRYPTION_KEY_VERSION || 1);
  const key = version === current ? env.ENCRYPTION_KEY : env[`ENCRYPTION_KEY_V${version}`];
  if (!key) throw new Error(`no encryption key configured for version ${version}`);
  return key;
}
