// MPC-8689 pilot: LINE extras. A person messages our LINE official account and gets a private reply listing what LINE sent with that one webhook event.
// 5 hexagons from the event (confirmed against developers.line.biz): LINE user ID (source.userId), what they sent (message type and text), follow or unblock (follow.isUnblocked,
// unfollow), group membership (source type group or room, groupId, roomId) and shared location (message.latitude, longitude, address). Signature: x-line-signature = base64(HMAC-SHA256(channel
// secret, raw body)). Off unless LINE_EXTRAS=on; allow-listed ids only (LINE_PROBE_IDS).
// Not built: display name and photo, status message and app language (they need GET /v2/bot/profile/{userId}, whose field names I could not confirm in the docs read), LINE Login email and
// LINE Profile+ (the person must sign in). The reply endpoint (POST /v2/bot/message/reply) is only confirmed indirectly (the validate endpoint sits beside it); it is the one unverified step.
import { createLogger } from "./logger";
import { type Env, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, b64, extrasReply, filled, hmac, obj, toStates, type ExtraDef, type Obj } from "./extras-common";

const log = createLogger("social-listeners:line");
export const LINE_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "line.user_id", label: "LINE user ID", arrival: "A", source: "webhook source.userId" },
  { id: "line.message", label: "What they sent", arrival: "A", source: "message event: type, text" },
  { id: "line.follow_state", label: "Follow or unblock", arrival: "A", source: "follow event follow.isUnblocked, unfollow" },
  { id: "line.group", label: "Group membership", arrival: "A", source: "source.type, groupId, roomId" },
  { id: "line.location", label: "Shared location", arrival: "C", source: "location message: latitude, longitude, address" },
];

export function lineStates(event: unknown) {
  const e = obj(event) ?? {};
  const src = obj(e.source) ?? {};
  const m = obj(e.message) ?? {};
  return toStates(LINE_EXTRA_HEXAGONS, {
    "line.user_id": filled(src.userId),
    "line.message": e.type === "message" && (filled(m.type) || filled(m.text)),
    "line.follow_state": e.type === "follow" || e.type === "unfollow",
    "line.group": src.type === "group" || src.type === "room" || filled(src.groupId) || filled(src.roomId),
    "line.location": m.type === "location" && typeof m.latitude === "number" && typeof m.longitude === "number",
  });
}

export async function verifyLineSignature(signature: string | null, rawBody: string, env: Env): Promise<boolean> {
  if (!env.LINE_CHANNEL_SECRET || !signature) return false; // fail closed
  return timingSafeEqual(signature, b64(await hmac("SHA-256", env.LINE_CHANNEL_SECRET, rawBody)));
}

export async function handleLineExtras(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.LINE_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  if (!(await verifyLineSignature(request.headers.get("x-line-signature"), raw, env))) { log.warn("signature_invalid"); return new Response("Unauthorized", { status: 401 }); }
  let body: Obj | null;
  try { body = obj(JSON.parse(raw)); } catch { body = null; }
  if (!body) return new Response("Bad Request", { status: 400 });
  const events = Array.isArray(body.events) ? body.events : [];
  for (const ev of events.slice(0, 10)) {
    const e = obj(ev);
    if (!e || (e.type !== "message" && e.type !== "follow")) continue;
    if (!allowedId(env.LINE_PROBE_IDS, obj(e.source)?.userId)) { log.info("not_allowed"); continue; }
    const states = lineStates(e);
    log.info("replied", { seen: states.filter((s) => s.state === "returned").length }); // counts only
    if (env.LINE_CHANNEL_ACCESS_TOKEN && typeof e.replyToken === "string") {
      try {
        await fetchImpl("https://api.line.me/v2/bot/message/reply", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
          body: JSON.stringify({ replyToken: e.replyToken, messages: [{ type: "text", text: extrasReply("LINE", LINE_EXTRA_HEXAGONS, states) }] }), signal: AbortSignal.timeout(5000),
        });
      } catch { log.warn("reply_failed"); }
    }
  }
  return new Response("OK"); // LINE expects a 200 for every delivery
}
