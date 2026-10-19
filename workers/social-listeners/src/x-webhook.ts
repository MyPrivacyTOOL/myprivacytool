// X (Twitter) Account Activity API listener: DM + mention events. Validate and route only.
import { createLogger } from "./logger";
import { type MirrorDm, describeShape, extractDms, extractMirrorDms, handleDeleteDm, handleMirrorDm, handleOrdinaryDm, isConsentPending, selfId } from "./mirror-bot";
import { probeMode } from "./probe-reader";
import { extractEngagement, isDeleteRequest, touchContact } from "./social";
import { type Env, base64, forwardToCoreBrain, hmacSha256, parseJson, pick, readRawBody, timingSafeEqual } from "./shared";
import { runXProbe } from "./x-probe";

const log = createLogger("social-listeners:x");

/** GET: CRC challenge. response_token = "sha256=" + base64(HMAC-SHA256(consumer secret, crc_token)). */
async function handleCrc(request: Request, env: Env): Promise<Response> {
  const crc = new URL(request.url).searchParams.get("crc_token");
  if (!env.X_CONSUMER_SECRET || !crc) return new Response("Bad Request", { status: 400 });
  // Length only (never the value): a Consumer Key (25) pasted where the Consumer Secret (50) belongs is the usual reason X reports "Invalid response_token".
  log.info("x_crc_challenge", { secret_length: env.X_CONSUMER_SECRET.length });
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

  // Channel probe (test-only, off unless PROBE_MODE=on): saves events from OUR OWN allow-listed test accounts (PROBE_X_IDS / PROBE_X_HANDLES) and the public lookups; everyone else is untouched. docs/channel-probe-x.md.
  if (probeMode(env) === "on") {
    const probe = runXProbe(env, payload, log);
    if (ctx?.waitUntil) ctx.waitUntil(probe);
    else await probe;
  }

  // MPC-7628: MIRROR DMs are answered here (consent -> public scan -> educational DM); the scan result and message text are never stored.
  // A bare Y/N counts only when it answers our consent request (checked against the DM history, nothing stored); otherwise it is an ordinary message.
  const mirrorDms: MirrorDm[] = [];
  for (const dm of extractMirrorDms(payload)) {
    if (!dm.bare || (await isConsentPending(env, dm.senderId, selfId(payload), log))) mirrorDms.push(dm);
  }
  // Any other DM gets the welcome reply straight away. Needs our own id so our own messages are never answered.
  const me = selfId(payload);
  const others = me ? extractDms(payload).filter((d) => !mirrorDms.some((m) => m.senderId === d.senderId && m.text === d.text)) : [];
  const deletes = others.filter((d) => isDeleteRequest(d.text));
  const welcomed = others.filter((d) => !isDeleteRequest(d.text));

  // Follows, likes, shares and mentions go into the CRM feed. They still flow on to core-brain below.
  const engagement = me ? extractEngagement(payload, me) : [];
  if (engagement.length > 0) {
    const noted = Promise.all(engagement.map((e) => touchContact(env, e.userId, e.handle, e.event, log, e.event === "follow" ? true : undefined)));
    if (ctx?.waitUntil) ctx.waitUntil(noted);
    else await noted;
  }

  if (mirrorDms.length > 0 || welcomed.length > 0 || deletes.length > 0) {
    const work = Promise.all([
      ...mirrorDms.map((dm) => handleMirrorDm(env, dm, log)),
      ...welcomed.map((dm) => handleOrdinaryDm(env, dm, log)),
      ...deletes.map((dm) => handleDeleteDm(env, dm, log)),
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    const legacy = (payload as { direct_message_events?: unknown[] }).direct_message_events;
    // Legacy payloads can mix MIRROR DMs with other events: forward only the rest (every DM we answer is counted in the funnel by funnel.ts instead, so core-brain does not log it twice). Any other shape is fully handled here.
    if (!Array.isArray(legacy)) return new Response("OK");
    const handled = [...mirrorDms, ...welcomed, ...deletes];
    const rest = legacy.filter(
      (e) => !handled.some((d) => d.senderId === String(pick(e, "message_create", "sender_id")) && d.text === pick(e, "message_create", "message_data", "text")),
    );
    const remaining = { ...(payload as object), direct_message_events: rest } as { tweet_create_events?: unknown[] };
    if (rest.length === 0 && !remaining.tweet_create_events?.length) return new Response("OK");
    return (await forwardToCoreBrain(env, { source: "x", receivedAt: new Date().toISOString(), payload: remaining }, log))
      ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
  }
  log.info("x_event_received", describeShape(payload)); // names only: lets an unfamiliar event shape be diagnosed from logs

  const ok = await forwardToCoreBrain(env, { source: "x", receivedAt: new Date().toISOString(), payload }, log);
  // 5xx on forward failure so X retries delivery.
  return ok ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
}
