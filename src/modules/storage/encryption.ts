/**
 * AES-256-GCM helpers (Web Crypto) for encrypting channel tokens at rest.
 * Key: 32 random bytes, base64-encoded, supplied via CHANNEL_TOKEN_ENCRYPTION_KEY.
 * Ciphertext format: "v1:<base64 iv>:<base64 ciphertext+tag>".
 */
const VERSION = "v1";
const IV_BYTES = 12;

const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromB64 = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromB64(base64Key);
  if (raw.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (base64-encoded) for AES-256-GCM");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function generateKeyBase64(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${VERSION}:${toB64(iv)}:${toB64(ct)}`;
}

export async function decrypt(payload: string, key: CryptoKey): Promise<string> {
  const [version, iv, ct] = payload.split(":");
  if (version !== VERSION || !iv || !ct) throw new Error("Unsupported ciphertext format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct));
  return new TextDecoder().decode(pt);
}
