// X (Twitter) Account Activity API listener: DM + mention events. Validate and route only.
import { createLogger } from "./logger";
import { type Env, base64, forwardToCoreBrain, hmacSha256, parseJson, readRawBody, timingSafeEqual } from "./shared";

const log = createLogger("social-listeners:x");

/** GET: CRC challenge. response_token = "sha256=" + base64(HMAC-SHA256(consumer secret, crc_token)). */
async function handleCrc(request: Request, env: Env): Promise<Response> {
  const crc = new URL(request.url).searchParams.get("crc_token");
  if (!env.X_CONSUMER_SECRET || !crc) return new Response("Bad Request", { status: 400 });
  const token = "sha256=" + base64(await hmacSha256(env.X_CONSUMER_SECRET, crc));
  return Response.json({ response_token: token });
}

/** POST: X-Twitter-Webhooks-Signature = "sha256=" + base64(HMAC-SHA256(consumer secret, raw body)). */
export async function verifyXSignature(request: Request, rawBody: string, env: Env): Promise<boolean> {
  if (!env.X_CONSUMER_SECRET) return false; // fail closed
  const expected = "sha256=" + base64(await hmacSha256(env.X_CONSUMER_SECRET, rawBody));
  return timingSafeEqual(request.headers.get("X-Twitter-Webhooks-Signature"), expected);
}

export async function handleXWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return handleCrc(request, env);
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  if (!(await verifyXSignature(request, raw, env))) {
    log.warn("signature_invalid");
    return new Response("Unauthorized", { status: 401 });
  }
  const payload = parseJson(raw);
  if (payload === null || typeof payload !== "object") return new Response("Bad Request", { status: 400 });

  const ok = await forwardToCoreBrain(env, { source: "x", receivedAt: new Date().toISOString(), payload }, log);
  // 5xx on forward failure so X retries delivery.
  return ok ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
}
