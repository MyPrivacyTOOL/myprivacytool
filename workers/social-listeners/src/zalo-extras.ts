// MPC-8689 pilot: Zalo Official Account extras. Someone messages our Zalo OA; Zalo POSTs a webhook event. 4 hexagons from the event (confirmed against docs.zaloplatforms.com,
// "user sends message" events): Zalo user ID (sender.id), what they sent (event_name user_send_text/image/link/audio/video/sticker/file, message.text, attachments), shared location
// (user_send_location, attachment location.coordinates) and business card (user_send_business_card; the docs define no attachment structure for it, so it counts as returned by the event name alone).
// AUTH: the page that describes Zalo's webhook signature returned 404, so the scheme is NOT confirmed and this endpoint is gated by a secret in the URL we register as the webhook URL
// (/webhook/zalo?k=<ZALO_WEBHOOK_SECRET>), compared in constant time. Replacing it with Zalo's own signature is a follow-up once the scheme is confirmed.
// Nothing is sent back to the person (the OA send-message API was not confirmed): the answer lists states and counts only, visible in Zalo's webhook log.
// Off unless ZALO_EXTRAS=on; allow-listed Zalo user ids only (ZALO_PROBE_IDS). Not built: display name and photo, follower and last contact (user-detail API with a token), sensitive flag (Verify), shared contact details.
import { createLogger } from "./logger";
import { type Env, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, filled, obj, toStates, type ExtraDef, type Obj } from "./extras-common";

const log = createLogger("social-listeners:zalo");
export const ZALO_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "zl.sender_id", label: "Zalo user ID", arrival: "A", source: "sender.id, user_id_by_app" },
  { id: "zl.message", label: "What they sent", arrival: "A", source: "event_name user_send_*, message" },
  { id: "zl.location", label: "Shared location", arrival: "C", source: "user_send_location" },
  { id: "zl.business_card", label: "Business card", arrival: "C", source: "user_send_business_card" },
];
const SEND_EVENTS = new Set(["user_send_text", "user_send_image", "user_send_link", "user_send_audio", "user_send_video", "user_send_sticker", "user_send_file"]);

export function zaloStates(event: unknown) {
  const e = obj(event) ?? {};
  const name = typeof e.event_name === "string" ? e.event_name : "";
  const msg = obj(e.message) ?? {};
  const coords = (Array.isArray(msg.attachments) ? msg.attachments : []).map((a) => obj(obj(obj(a)?.payload)?.coordinates)).find((c) => c && typeof c.latitude !== "undefined" && typeof c.longitude !== "undefined");
  return toStates(ZALO_EXTRA_HEXAGONS, {
    "zl.sender_id": filled(obj(e.sender)?.id) || filled(e.user_id_by_app),
    "zl.message": SEND_EVENTS.has(name) && (filled(msg.text) || filled(msg.attachments) || filled(msg.msg_id)),
    "zl.location": name === "user_send_location" && Boolean(coords),
    "zl.business_card": name === "user_send_business_card",
  });
}

export async function handleZaloExtras(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.ZALO_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const key = new URL(request.url).searchParams.get("k");
  if (!env.ZALO_WEBHOOK_SECRET || !timingSafeEqual(key, env.ZALO_WEBHOOK_SECRET)) { log.warn("secret_invalid"); return new Response("Unauthorized", { status: 401 }); }
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  let e: Obj | null;
  try { e = obj(JSON.parse(raw)); } catch { e = null; }
  if (!e) return new Response("Bad Request", { status: 400 });
  if (typeof e.event_name !== "string" || !e.event_name.startsWith("user_send_")) return Response.json({ ok: true, checked: false });
  if (!allowedId(env.ZALO_PROBE_IDS, obj(e.sender)?.id)) { log.info("not_allowed"); return Response.json({ ok: true, checked: false }); }
  const states = zaloStates(e);
  const seen = states.filter((s) => s.state === "returned").length;
  log.info("checked", { seen }); // counts only
  return Response.json({ ok: true, checked: true, seen, total: states.length, states: states.map((s) => ({ id: s.id, state: s.state })) });
}
