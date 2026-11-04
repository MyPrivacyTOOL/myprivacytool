// MPC-8281: ed25519 signing and verification of report files (Web Crypto only, no Node built-ins: this runs in Cloudflare Pages Functions).
// A signed file is { report, signature }. The signature covers the canonical form of { issuer, signed_at, report }, so changing the report,
// the issuer or the date breaks it. The public key is embedded, so a file can be checked without any lookup; whether that key is OURS is a
// separate question (see verifySignedReport's issuer_key_trusted).

export const ISSUER = "MyPrivacyTOOL";

export interface TimestampProof {
  authority: string;
  hash_alg: "SHA-256";
  hashed: string; // hex SHA-256 of the canonical signed bytes, the value the authority stamped
  token: string; // base64 RFC 3161 TimeStampResp
}

export interface Signature {
  alg: "Ed25519";
  issuer: string;
  signed_at: string;
  key_id: string;
  public_key: string; // base64url raw 32 bytes
  value: string; // base64url
  timestamp: TimestampProof | null;
}

export interface SignedReport<T = unknown> {
  report: T;
  signature: Signature;
}

const enc = new TextEncoder();

export const b64u = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64u = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Sorted keys, no whitespace. Rejects values JSON cannot carry faithfully (NaN, Infinity, undefined, functions). */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
    }
    default:
      throw new Error("canonicalize: unsupported value of type " + typeof value);
  }
}

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed.
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export interface SigningKey {
  privateKey: CryptoKey;
  publicKeyRaw: Uint8Array;
  keyId: string;
}

/** Accepts the secret as base64 of either a 32-byte seed or a PKCS#8 document. The key is never created or logged here. */
export async function importSigningKey(secretB64: string): Promise<SigningKey> {
  const raw = Uint8Array.from(atob(secretB64.trim().replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  let pkcs8: Uint8Array;
  if (raw.length === 32) {
    pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
    pkcs8.set(PKCS8_PREFIX);
    pkcs8.set(raw, PKCS8_PREFIX.length);
  } else pkcs8 = raw;
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as JsonWebKey;
  if (!jwk.x) throw new Error("signing key has no public half");
  const publicKeyRaw = fromB64u(jwk.x);
  const keyId = "mpt-report-" + toHex(await sha256(publicKeyRaw)).slice(0, 16);
  // Make the key non-extractable for the rest of its life in this isolate.
  const locked = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  return { privateKey: locked, publicKeyRaw, keyId };
}

const signingBytes = (report: unknown, issuer: string, signedAt: string): Uint8Array => enc.encode(canonicalize({ issuer, signed_at: signedAt, report }));

export type Timestamper = (digestHex: string) => Promise<TimestampProof | null>;

export async function signReport<T>(report: T, key: SigningKey, opts: { now?: Date; timestamper?: Timestamper } = {}): Promise<SignedReport<T>> {
  const signedAt = (opts.now ?? new Date()).toISOString();
  const bytes = signingBytes(report, ISSUER, signedAt);
  const value = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, bytes));
  let timestamp: TimestampProof | null = null;
  if (opts.timestamper) {
    try {
      timestamp = await opts.timestamper(toHex(await sha256(bytes)));
    } catch {
      timestamp = null; // authority down: the file is still signed, and says it has no external time proof
    }
  }
  return {
    report,
    signature: { alg: "Ed25519", issuer: ISSUER, signed_at: signedAt, key_id: key.keyId, public_key: b64u(key.publicKeyRaw), value: b64u(value), timestamp },
  };
}

/** Detached signature over arbitrary bytes (for the PDF, which is signed as a file). */
export async function signBytes(data: Uint8Array, key: SigningKey, now: Date = new Date()) {
  const signedAt = now.toISOString();
  const digest = toHex(await sha256(data));
  const bytes = enc.encode(canonicalize({ issuer: ISSUER, signed_at: signedAt, sha256: digest }));
  const value = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, bytes));
  return { alg: "Ed25519" as const, issuer: ISSUER, signed_at: signedAt, key_id: key.keyId, public_key: b64u(key.publicKeyRaw), sha256: digest, value: b64u(value) };
}

export interface VerifyResult {
  signature_valid: boolean;
  issuer: string | null;
  signed_at: string | null;
  key_id: string | null;
  /** true only when the embedded key equals a key we published. An attacker can sign with their own key, so signature_valid alone does not mean "from us". */
  issuer_key_trusted: boolean;
  timestamped: boolean;
  /** true when the RFC 3161 token is present and contains the digest of the signed bytes. The authority's own signature on the token is NOT checked here. */
  timestamp_binds_digest: boolean;
  reason?: string;
}

const bytesContain = (hay: Uint8Array, needle: Uint8Array): boolean => {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

const fail = (reason: string): VerifyResult => ({
  signature_valid: false, issuer: null, signed_at: null, key_id: null, issuer_key_trusted: false, timestamped: false, timestamp_binds_digest: false, reason,
});

export async function verifySignedReport(doc: unknown, trustedPublicKeys: string[] = []): Promise<VerifyResult> {
  const d = doc as Partial<SignedReport> | null;
  const sig = d?.signature as Signature | undefined;
  if (!d || typeof d !== "object" || !("report" in d) || !sig || sig.alg !== "Ed25519" || typeof sig.value !== "string" || typeof sig.public_key !== "string" || typeof sig.signed_at !== "string" || typeof sig.issuer !== "string") {
    return fail("not a signed report");
  }
  let ok = false;
  let bytes: Uint8Array;
  try {
    bytes = signingBytes(d.report, sig.issuer, sig.signed_at);
    const pub = await crypto.subtle.importKey("raw", fromB64u(sig.public_key), { name: "Ed25519" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "Ed25519" }, pub, fromB64u(sig.value), bytes);
  } catch {
    return fail("malformed signature");
  }
  const trusted = ok && trustedPublicKeys.includes(sig.public_key);
  let stamped = false;
  let binds = false;
  if (ok && sig.timestamp && typeof sig.timestamp.token === "string") {
    stamped = true;
    try {
      const digest = await sha256(bytes);
      binds = sig.timestamp.hashed === toHex(digest) && bytesContain(Uint8Array.from(atob(sig.timestamp.token), (c) => c.charCodeAt(0)), digest);
    } catch {
      binds = false;
    }
  }
  return { signature_valid: ok, issuer: sig.issuer, signed_at: sig.signed_at, key_id: sig.key_id ?? null, issuer_key_trusted: trusted, timestamped: stamped, timestamp_binds_digest: binds, ...(ok ? {} : { reason: "signature does not match the report" }) };
}

export async function verifyDetached(data: Uint8Array, sig: { sha256: string; signed_at: string; issuer: string; public_key: string; value: string }, trustedPublicKeys: string[] = []): Promise<{ signature_valid: boolean; file_matches: boolean; issuer_key_trusted: boolean }> {
  const digest = toHex(await sha256(data));
  const fileMatches = digest === sig.sha256;
  try {
    const pub = await crypto.subtle.importKey("raw", fromB64u(sig.public_key), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, pub, fromB64u(sig.value), enc.encode(canonicalize({ issuer: sig.issuer, signed_at: sig.signed_at, sha256: sig.sha256 })));
    return { signature_valid: ok, file_matches: fileMatches, issuer_key_trusted: ok && trustedPublicKeys.includes(sig.public_key) };
  } catch {
    return { signature_valid: false, file_matches: fileMatches, issuer_key_trusted: false };
  }
}
