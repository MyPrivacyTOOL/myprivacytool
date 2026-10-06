/** base64url / hex helpers shared by the Worker modules (WebCrypto only, no Node APIs). */

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex || '')) throw new Error('encryption key must be 64 hex chars (32 bytes)');
  return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
}

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
