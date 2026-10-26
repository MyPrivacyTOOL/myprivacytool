// MPC-8281: request handlers for POST /api/report-download and POST /api/verify-report. Kept out of functions/ so they can be tested with plain Requests.

import { importSigningKey, signReport, signBytes, verifySignedReport, verifyDetached, fromB64u, type Timestamper } from "./signing";
import { rfc3161Timestamper } from "./timestamp";

export interface SignedReportEnv {
  REPORT_SIGNING_ENABLED?: string; // "1" to sign; anything else and the download route answers 503
  REPORT_SIGNING_KEY?: string; // secret: base64 32-byte ed25519 seed or PKCS#8. Set as a Pages secret, never a plain variable
  REPORT_SIGNING_PUBLIC_KEYS?: string; // comma-separated base64url public keys we have published (current and retired)
  REPORT_TSA_URL?: string; // RFC 3161 authority; unset = signed without an external time proof
}

export interface Deps {
  /** Level 2 (proof of possession) gate, MPC-7902. Until that exists this must answer false, so nothing is signed. */
  level2Passed: (request: Request, env: SignedReportEnv) => Promise<boolean>;
  timestamper?: Timestamper;
  now?: Date;
}

export const defaultDeps: Deps = { level2Passed: async () => false };

const MAX_BODY = 1_000_000;
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const trustedKeys = (env: SignedReportEnv): string[] => (env.REPORT_SIGNING_PUBLIC_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(request: Request): Promise<{ ok: true; value: Record<string, any> } | { ok: false; res: Response }> {
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, res: json({ error: "too_large" }, 413) };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: json({ error: "invalid_json" }, 400) };
  }
}

/** Body: { report: <object> } for JSON, or { pdf_base64: <string> } for a detached signature over the PDF bytes. */
export async function handleDownload(request: Request, env: SignedReportEnv, deps: Deps = defaultDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (env.REPORT_SIGNING_ENABLED !== "1" || !env.REPORT_SIGNING_KEY) return json({ error: "signing_unavailable" }, 503);
  if (!(await deps.level2Passed(request, env))) return json({ error: "level2_required" }, 403);
  const body = await readJson(request);
  if (!body.ok) return body.res;
  let key;
  try {
    key = await importSigningKey(env.REPORT_SIGNING_KEY);
  } catch {
    return json({ error: "signing_unavailable" }, 503); // never echo key material or import errors
  }
  const timestamper = deps.timestamper ?? (env.REPORT_TSA_URL ? rfc3161Timestamper(env.REPORT_TSA_URL) : undefined);
  try {
    if (typeof body.value?.pdf_base64 === "string") {
      const pdf = fromB64(body.value.pdf_base64);
      return json({ signature: await signBytes(pdf, key, deps.now) });
    }
    if (body.value && typeof body.value.report === "object" && body.value.report !== null) {
      return json(await signReport(body.value.report, key, { now: deps.now, timestamper }));
    }
  } catch {
    return json({ error: "unsignable" }, 422);
  }
  return json({ error: "report_required" }, 400);
}

/** Body: a signed JSON file, or { pdf_base64, signature } for a PDF with its detached signature. */
export async function handleVerify(request: Request, env: SignedReportEnv): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await readJson(request);
  if (!body.ok) return body.res;
  const keys = trustedKeys(env);
  const v = body.value;
  if (v && typeof v.pdf_base64 === "string" && v.signature) {
    try {
      const r = await verifyDetached(fromB64(v.pdf_base64), v.signature, keys);
      return json({ verified: r.signature_valid && r.file_matches && r.issuer_key_trusted, ...r });
    } catch {
      return json({ verified: false, error: "malformed" }, 400);
    }
  }
  const r = await verifySignedReport(v, keys);
  // "Verified" means: signature intact AND made by a key we published. A valid signature from an unknown key is reported, not blessed.
  return json({ verified: r.signature_valid && r.issuer_key_trusted, ...r });
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
