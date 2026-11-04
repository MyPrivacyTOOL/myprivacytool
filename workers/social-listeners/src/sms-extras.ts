// MPC-8689 pilot: Twilio SMS extras. A person texts our number and gets a private TwiML reply listing what Twilio sent with that one message.
// 4 hexagons from the webhook parameters (confirmed against twilio.com/docs/messaging/guides/webhook-request): phone number, number's home area (From City/State/Zip/Country,
// "sent when Twilio can look them up"), message time (the request time), what you typed (Body, NumSegments). Signature: X-Twilio-Signature = base64(HMAC-SHA1(auth token,
// URL + sorted key+value pairs)), the same scheme as workers/webhook-receiver/security.js. Off unless SMS_EXTRAS=on; allow-listed numbers only (SMS_PROBE_NUMBERS).
// Not built: number type, original carrier, number timezone and number region (need a phone-number library with carrier and geocoder data, not added); MMS pictures (Verify);
// every Twilio Lookup item (Paid) and "number on other apps" (Not allowed: account probing).
import { createLogger } from "./logger";
import { type Env, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, b64, extrasReply, filled, hmac, toStates, type ExtraDef } from "./extras-common";

const log = createLogger("social-listeners:sms");
export const SMS_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "sms.number", label: "Phone number", arrival: "A", source: "Twilio From" },
  { id: "sms.number_area", label: "Number's home area", arrival: "A", source: "Twilio FromCity, FromState, FromZip, FromCountry" },
  { id: "sms.message_time", label: "Message time", arrival: "A", source: "Twilio request time" },
  { id: "sms.message_text", label: "What you typed", arrival: "A", source: "Twilio Body, NumSegments" },
];

export function smsStates(p: URLSearchParams, now: Date = new Date()) {
  const has = (k: string) => filled(p.get(k));
  return toStates(SMS_EXTRA_HEXAGONS, {
    "sms.number": has("From"),
    "sms.number_area": ["FromCity", "FromState", "FromZip", "FromCountry"].some(has),
    "sms.message_time": Number.isFinite(now.getTime()), // Twilio sends no timestamp parameter: the request time is the message time
    "sms.message_text": has("Body"),
  });
}

export async function verifyTwilioSignature(request: Request, params: URLSearchParams, env: Env): Promise<boolean> {
  if (!env.TWILIO_AUTH_TOKEN) return false; // fail closed
  let data = env.TWILIO_WEBHOOK_URL || request.url;
  for (const k of [...new Set(params.keys())].sort()) data += k + params.getAll(k).join("");
  return timingSafeEqual(request.headers.get("X-Twilio-Signature"), b64(await hmac("SHA-1", env.TWILIO_AUTH_TOKEN, data)));
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const twiml = (text: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(text)}</Message></Response>`, { headers: { "content-type": "text/xml" } });

export async function handleSmsExtras(request: Request, env: Env, now: Date = new Date()): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.SMS_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  const params = new URLSearchParams(raw);
  if (!(await verifyTwilioSignature(request, params, env))) { log.warn("signature_invalid"); return new Response("Unauthorized", { status: 401 }); }
  if (!allowedId(env.SMS_PROBE_NUMBERS, params.get("From"))) { log.info("not_allowed"); return twiml("This check is not available to you yet."); }
  const states = smsStates(params, now);
  log.info("replied", { seen: states.filter((s) => s.state === "returned").length }); // counts only
  return twiml(extrasReply("Twilio", SMS_EXTRA_HEXAGONS, states));
}
