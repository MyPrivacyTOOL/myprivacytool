// MPC-7893: hashing and random values for the one-time dashboard link. Web Crypto only, so it runs in Pages Functions, Workers and Node.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuidV4 = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as base64url: the opaque session cookie value (256 bits). */
export function randomSessionValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const SESSION_COOKIE = "__Host-mpt_dash";
/** MPC-8689: the footprint handoff session has its own cookie, so it can never overwrite or be mistaken for a dashboard session. */
export const FOOTPRINT_COOKIE = "__Host-mpt_fp";
export const LINK_MINUTES = 15;
export const SESSION_MINUTES = 30;
