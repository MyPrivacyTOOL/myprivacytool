// X (Twitter) Account Activity API listener: DM + mention events. Validate and route only.
import { createLogger } from "./logger";
import { type MirrorDm, describeShape, extractMirrorDms, handleMirrorDm, isConsentPending, selfId } from "./mirror-bot";
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

export async function handleXWebhook(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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

  // MPC-7628: MIRROR DMs are answered here (consent -> public scan -> educational DM) and never stored or forwarded.
  // A bare Y/N counts only when it answers our consent request (checked against the DM history, nothing stored); otherwise it is an ordinary message.
  const mirrorDms: MirrorDm[] = [];
  for (const dm of extractMirrorDms(payload)) {
    if (!dm.bare || (await isConsentPending(env, dm.senderId, selfId(payload), log))) mirrorDms.push(dm);
  }
  if (mirrorDms.length > 0) {
    const work = Promise.all(mirrorDms.map((dm) => handleMirrorDm(env, dm, log)));
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    const legacy = (payload as { direct_message_events?: any[] }).direct_message_events;
    // Legacy payloads can mix MIRROR DMs with other events: forward only the rest. Any other shape is fully handled here.
    if (!Array.isArray(legacy)) return new Response("OK");
    const rest = legacy.filter(
      (e) => !mirrorDms.some((d) => d.senderId === String(e?.message_create?.sender_id) && d.text === e?.message_create?.message_data?.text),
    );
    const others = { ...(payload as object), direct_message_events: rest } as { tweet_create_events?: unknown[] };
    if (rest.length === 0 && !others.tweet_create_events?.length) return new Response("OK");
    return (await forwardToCoreBrain(env, { source: "x", receivedAt: new Date().toISOString(), payload: others }, log))
      ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
  }
  log.info("x_event_received", describeShape(payload)); // names only: lets an unfamiliar event shape be diagnosed from logs

  const ok = await forwardToCoreBrain(env, { source: "x", receivedAt: new Date().toISOString(), payload }, log);
  // 5xx on forward failure so X retries delivery.
  return ok ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
}
