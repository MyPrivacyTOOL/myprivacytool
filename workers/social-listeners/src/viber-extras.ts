// MPC-8689 pilot: Viber extras. A person messages our Viber bot and gets a private reply listing what Viber sent with that one callback.
// 9 hexagons from the callback (confirmed against developers.viber.com): Viber user ID, name and photo, country, language, app capability level (sender.api_version),
// what they sent (message type, text, media, sticker), where they came from (conversation_started context), shared location (message.location lat/lon) and shared contact
// (message.contact phone_number). Signature: X-Viber-Content-Signature = HMAC-SHA256(auth token, JSON body), hex. Off unless VIBER_EXTRAS=on; allow-listed ids only (VIBER_PROBE_IDS).
// Not built: phone OS and model, Viber version, mobile carrier (user-details API) and online status (get_online): each needs its own call with the token.
import { createLogger } from "./logger";
import { type Env, hex, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, extrasReply, filled, hmac, obj, toStates, type ExtraDef, type Obj } from "./extras-common";

const log = createLogger("social-listeners:viber");
export const VIBER_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "vb.user_id", label: "Viber user ID", arrival: "A", source: "sender.id" },
  { id: "vb.name_photo", label: "Name and photo", arrival: "A", source: "sender.name, sender.avatar" },
  { id: "vb.country", label: "Country", arrival: "A", source: "sender.country" },
  { id: "vb.language", label: "Language", arrival: "A", source: "sender.language" },
  { id: "vb.api_version", label: "App capability level", arrival: "A", source: "sender.api_version" },
  { id: "vb.message", label: "What they sent", arrival: "A", source: "message.type, text, media, sticker_id" },
  { id: "vb.deeplink", label: "Where they came from", arrival: "A", source: "conversation_started context" },
  { id: "vb.location", label: "Shared location", arrival: "C", source: "message.location.lat, lon" },
  { id: "vb.contact", label: "Shared contact or phone", arrival: "C", source: "message.contact.phone_number" },
];

/** The person: `sender` on a message callback, `user` on conversation_started. */
export const viberPerson = (cb: Obj): Obj | null => obj(cb.sender) ?? obj(cb.user);

export function viberStates(callback: unknown) {
  const cb = obj(callback) ?? {};
  const u = viberPerson(cb) ?? {};
  const m = obj(cb.message) ?? {};
  const loc = obj(m.location), contact = obj(m.contact);
  return toStates(VIBER_EXTRA_HEXAGONS, {
    "vb.user_id": filled(u.id),
    "vb.name_photo": filled(u.name) || filled(u.avatar),
    "vb.country": filled(u.country),
    "vb.language": filled(u.language),
    "vb.api_version": typeof u.api_version === "number",
    "vb.message": filled(m.type) || filled(m.text) || filled(m.media) || filled(m.sticker_id),
    "vb.deeplink": filled(cb.context),
    "vb.location": typeof loc?.lat === "number" && typeof loc?.lon === "number",
    "vb.contact": filled(contact?.phone_number),
  });
}

export async function verifyViberSignature(signature: string | null, rawBody: string, env: Env): Promise<boolean> {
  if (!env.VIBER_AUTH_TOKEN || !signature) return false; // fail closed
  return timingSafeEqual(signature, hex(await hmac("SHA-256", env.VIBER_AUTH_TOKEN, rawBody)));
}

export async function handleViberExtras(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.VIBER_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  if (!(await verifyViberSignature(request.headers.get("X-Viber-Content-Signature"), raw, env))) { log.warn("signature_invalid"); return new Response("Unauthorized", { status: 401 }); }
  let cb: Obj | null;
  try { cb = obj(JSON.parse(raw)); } catch { cb = null; }
  if (!cb) return new Response("Bad Request", { status: 400 });
  // Only a person's message or the start of a conversation is a check; webhook setup, delivered, seen and the rest are acknowledged and ignored.
  if (cb.event !== "message" && cb.event !== "conversation_started") return new Response("OK");
  const person = viberPerson(cb);
  if (!allowedId(env.VIBER_PROBE_IDS, person?.id)) { log.info("not_allowed"); return new Response("OK"); }
  const states = viberStates(cb);
  const text = extrasReply("Viber", VIBER_EXTRA_HEXAGONS, states);
  log.info("replied", { seen: states.filter((s) => s.state === "returned").length }); // counts only
  if (cb.event === "conversation_started") return Response.json({ sender: { name: "MyPrivacyTOOL" }, type: "text", text }); // answered in the callback, no token needed
  if (env.VIBER_AUTH_TOKEN) {
    try {
      await fetchImpl("https://chatapi.viber.com/pa/send_message", {
        method: "POST", headers: { "content-type": "application/json", "X-Viber-Auth-Token": env.VIBER_AUTH_TOKEN },
        body: JSON.stringify({ receiver: person?.id, type: "text", sender: { name: "MyPrivacyTOOL" }, text }), signal: AbortSignal.timeout(5000),
      });
    } catch { log.warn("send_failed"); }
  }
  return new Response("OK");
}
