// LinkedIn webhook listener (MPC-7640): challenge + signed message events. Validate and route only.
// LinkedIn's messaging API is partner-gated, so this accepts whatever event shape the approved product delivers and
// leaves interpretation to core-brain (parseLinkedInEnvelope). Signature scheme: LinkedIn Webhooks (Client Secret HMAC).
import { createLogger } from "./logger";
import { type Env, forwardToCoreBrain, hex, hmacSha256, parseJson, readRawBody, timingSafeEqual } from "./shared";

const log = createLogger("social-listeners:linkedin");

/** GET ?challengeCode=...: answer { challengeCode, challengeResponse: hex(HMAC-SHA256(client secret, challengeCode)) }. */
async function handleChallenge(request: Request, env: Env): Promise<Response> {
  const code = new URL(request.url).searchParams.get("challengeCode");
  if (!env.LINKEDIN_CLIENT_SECRET || !code) return new Response("Bad Request", { status: 400 });
  return Response.json({ challengeCode: code, challengeResponse: hex(await hmacSha256(env.LINKEDIN_CLIENT_SECRET, code)) });
}

/** POST: X-LI-Signature = "hmacsha256=" + hex(HMAC-SHA256(client secret, raw body)). */
export async function verifyLinkedInSignature(request: Request, rawBody: string, env: Env): Promise<boolean> {
  if (!env.LINKEDIN_CLIENT_SECRET) return false; // fail closed
  const expected = "hmacsha256=" + hex(await hmacSha256(env.LINKEDIN_CLIENT_SECRET, rawBody));
  return timingSafeEqual(request.headers.get("X-LI-Signature"), expected);
}

export async function handleLinkedInWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return handleChallenge(request, env);
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  if (!(await verifyLinkedInSignature(request, raw, env))) {
    log.warn("signature_invalid");
    return new Response("Unauthorized", { status: 401 });
  }
  const payload = parseJson(raw);
  if (payload === null || typeof payload !== "object") return new Response("Bad Request", { status: 400 });

  const ok = await forwardToCoreBrain(env, { source: "linkedin", receivedAt: new Date().toISOString(), payload }, log);
  // 5xx on forward failure so LinkedIn retries delivery.
  return ok ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
}
