// MPC-9883: canonical JSON + SHA-256 for the recipient registry. Plain JavaScript on purpose: the Vite site, Pages Functions, Workers and the
// Node sync script (scripts/sync-recipients.mjs) all import this one file, and Node cannot import TypeScript without a build step.
// WebCrypto (globalThis.crypto.subtle) exists in all four runtimes.

/** JSON with object keys sorted at every level and no whitespace, so two copies of the same data always hash the same. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The registry_hash: SHA-256 of the canonical JSON of the whole recipients.json document. */
export async function registryHash(registryFile) {
  return sha256Hex(canonicalJson(registryFile));
}
