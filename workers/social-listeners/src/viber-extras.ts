// MPC-8689 pilot: Viber extras. A person messages our Viber bot and gets a private reply listing what Viber sent with that one callback.
// 9 hexagons from the callback (confirmed against developers.viber.com): Viber user ID, name and photo, country, language, app capability level (sender.api_version),
// what they sent (message type, text, media, sticker), where they came from (conversation_started context), shared location (message.location lat/lon) and shared contact
// (message.contact phone_number). Signature: X-Viber-Content-Signature = HMAC-SHA256(auth token, JSON body), hex. Off unless VIBER_EXTRAS=on; allow-listed ids only (VIBER_PROBE_IDS).
// B lookups (confirmed against the same docs): get_user_details (primary_device_os, device_type, viber_version, mcc, mnc; two calls per user per 12 hours) and get_online
// (online_status 0 online, 1 offline, 2 undisclosed, 3 try later, 4 unavailable; last_online). They need VIBER_AUTH_TOKEN and a subscribed user; any failure is not_checked.
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
  { id: "vb.device", label: "Phone OS and model", arrival: "B", source: "get_user_details: primary_device_os, device_type" },
  { id: "vb.app_version", label: "Viber version", arrival: "B", source: "get_user_details: viber_version" },
  { id: "vb.carrier", label: "Mobile carrier", arrival: "B", source: "get_user_details: mcc, mnc" },
  { id: "vb.online", label: "Online status", arrival: "B", source: "get_online: online_status, last_online" },
];

/** The person: `sender` on a message callback, `user` on conversation_started. */
export const viberPerson = (cb: Obj): Obj | null => obj(cb.sender) ?? obj(cb.user);

export interface ViberLookups { details: Obj | null; online: Obj | null }
/** The four B hexagons from the two lookups. null = that lookup failed (not checked). online_status 3 (try later) and 4 (unavailable) are not an answer. */
export function viberLookupStates(l: ViberLookups): { returned: Record<string, boolean>; skipped: string[] } {
  const returned: Record<string, boolean> = {};
  const skipped: string[] = [];
  const u = l.details;
  if (u) Object.assign(returned, { "vb.device": filled(u.primary_device_os) || filled(u.device_type), "vb.app_version": filled(u.viber_version), "vb.carrier": filled(u.mcc) || filled(u.mnc) });
  else skipped.push("vb.device", "vb.app_version", "vb.carrier");
  const o = l.online;
  if (o && typeof o.online_status === "number" && o.online_status <= 2) returned["vb.online"] = o.online_status !== 2 || filled(o.last_online); // 2 = the person hides it
  else skipped.push("vb.online");
  return { returned, skipped };
}

export function viberStates(callback: unknown, lookups: ViberLookups = { details: null, online: null }) {
  const lk = viberLookupStates(lookups);
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
    ...lk.returned,
  }, lk.skipped);
}

export async function verifyViberSignature(signature: string | null, rawBody: string, env: Env): Promise<boolean> {
  if (!env.VIBER_AUTH_TOKEN || !signature) return false; // fail closed
  return timingSafeEqual(signature, hex(await hmac("SHA-256", env.VIBER_AUTH_TOKEN, rawBody)));
}

async function viberPost(path: string, body: unknown, token: string, fetchImpl: typeof fetch): Promise<Obj | null> {
  try {
    const r = await fetchImpl(`https://chatapi.viber.com/pa/${path}`, { method: "POST", headers: { "content-type": "application/json", "X-Viber-Auth-Token": token }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    const j = r.ok ? obj(await r.json()) : null;
    return j && j.status === 0 ? j : null;
  } catch { return null; }
}
export async function viberLookup(userId: unknown, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ViberLookups> {
  if (!token || typeof userId !== "string") return { details: null, online: null };
  const [d, o] = await Promise.all([viberPost("get_user_details", { id: userId }, token, fetchImpl), viberPost("get_online", { ids: [userId] }, token, fetchImpl)]);
  const users = Array.isArray(o?.users) ? o.users : [];
  return { details: obj(d?.user), online: obj(users[0]) };
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
  const states = viberStates(cb, await viberLookup(person?.id, env.VIBER_AUTH_TOKEN, fetchImpl));
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
