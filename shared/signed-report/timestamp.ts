// MPC-8281: RFC 3161 time-stamp client. Builds a TimeStampReq for a SHA-256 digest, posts it to the authority and returns the raw response.
// Only the PKIStatus is read (granted / grantedWithMods). The authority's CMS signature on the token is not validated here.

import type { TimestampProof } from "./signing";

const der = (tag: number, body: Uint8Array): Uint8Array => {
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  const out = new Uint8Array(1 + len.length + n);
  out[0] = tag;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
};
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// AlgorithmIdentifier { id-sha256 2.16.840.1.101.3.4.2.1, NULL }
const SHA256_ALG = der(0x30, cat(der(0x06, Uint8Array.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01])), Uint8Array.from([0x05, 0x00])));

export function buildTimeStampReq(digest: Uint8Array, nonce: Uint8Array): Uint8Array {
  if (digest.length !== 32) throw new Error("expected a SHA-256 digest");
  const imprint = der(0x30, cat(SHA256_ALG, der(0x04, digest)));
  return der(0x30, cat(der(0x02, Uint8Array.from([1])), imprint, der(0x02, nonce), der(0x01, Uint8Array.from([0xff])))); // version 1, imprint, nonce, certReq TRUE
}

/** PKIStatus is the first INTEGER inside the PKIStatusInfo at the top of a TimeStampResp. 0 = granted, 1 = grantedWithMods. */
export function responseStatus(resp: Uint8Array): number {
  // 30 len | 30 len | 02 01 <status>
  let i = 1;
  i += resp[i] < 0x80 ? 1 : 1 + (resp[i] & 0x7f);
  if (resp[i] !== 0x30) throw new Error("bad TimeStampResp");
  i += 1;
  i += resp[i] < 0x80 ? 1 : 1 + (resp[i] & 0x7f);
  if (resp[i] !== 0x02 || resp[i + 1] !== 1) throw new Error("bad PKIStatus");
  return resp[i + 2];
}

export function rfc3161Timestamper(url: string, fetchImpl: typeof fetch = fetch) {
  return async (digestHex: string): Promise<TimestampProof | null> => {
    const digest = Uint8Array.from(digestHex.match(/../g)!.map((h) => parseInt(h, 16)));
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    nonce[0] &= 0x7f; // keep the INTEGER positive
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/timestamp-query" }, body: buildTimeStampReq(digest, nonce) });
    if (!res.ok) return null;
    const resp = new Uint8Array(await res.arrayBuffer());
    const status = responseStatus(resp);
    if (status !== 0 && status !== 1) return null;
    let bin = "";
    for (let i = 0; i < resp.length; i++) bin += String.fromCharCode(resp[i]);
    return { authority: new URL(url).host, hash_alg: "SHA-256", hashed: digestHex, token: btoa(bin) };
  };
}
