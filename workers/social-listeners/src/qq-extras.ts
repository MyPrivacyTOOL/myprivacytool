// MPC-8689 pilot: QQ bot extras. QQ POSTs events to our callback URL (HTTP callback mode). 2 hexagons, confirmed against bot.q.qq.com: the person's QQ OpenID (C2C_MESSAGE_CREATE:
// author.user_openid) and added-or-blocked-bot (the event types FRIEND_ADD, FRIEND_DEL and C2C_MSG_REJECT). The docs give those three event types but no payload fields, so the id for the allow-list
// is read from d.openid, d.user_openid or d.author.user_openid, and an event with none is ignored. SIGNATURE (confirmed, sign page): header X-Signature-Ed25519 (hex, 64 bytes, and the top three bits of
// the last byte must be zero) over X-Signature-Timestamp + raw body, Ed25519 key pair generated from a 32-byte seed made by repeating the bot secret. Callback address validation (op 13) is answered by
// signing event_ts + plain_token with the same key. The op 12 ACK body ({"op":12}) is the one unverified step: the docs say op 12 is the HTTP callback ACK but the body was not shown.
// Nothing is sent to the person (the QQ send-message API was not confirmed) and nothing is returned but the ACK: the result is a counts-only log line. Off unless QQ_EXTRAS=on; allow-listed OpenIDs only
// (QQ_PROBE_OPENIDS). Not built: what they sent (marked Verify).
import { createLogger } from "./logger";
import { type Env, readRawBody } from "./shared";
import { allowedId, filled, obj, toStates, type ExtraDef, type Obj } from "./extras-common";

const log = createLogger("social-listeners:qq");
export const QQ_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "qq.openid", label: "QQ OpenID", arrival: "A", source: "author.user_openid (C2C_MESSAGE_CREATE)" },
  { id: "qq.friend_state", label: "Added or blocked bot", arrival: "A", source: "FRIEND_ADD, FRIEND_DEL, C2C_MSG_REJECT" },
];
const FRIEND_EVENTS = new Set(["FRIEND_ADD", "FRIEND_DEL", "C2C_MSG_REJECT"]);

/** The openid of the person behind an event, or null. */
export function eventOpenid(d: Obj | null): string | null {
  const v = d?.openid ?? d?.user_openid ?? obj(d?.author)?.user_openid;
  return typeof v === "string" && v !== "" ? v : null;
}

export function qqStates(type: string, d: Obj | null) {
  return toStates(QQ_EXTRA_HEXAGONS, {
    "qq.openid": type === "C2C_MESSAGE_CREATE" && filled(obj(d?.author)?.user_openid),
    "qq.friend_state": FRIEND_EVENTS.has(type),
  });
}

// ---- Ed25519 from the bot secret
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array | null => (/^([0-9a-f]{2})+$/i.test(h) ? Uint8Array.from(h.match(/../g) as string[], (b) => parseInt(b, 16)) : null);
export function seedFromSecret(secret: string): Uint8Array {
  const bytes = enc.encode(secret);
  if (bytes.length === 0) throw new Error("empty secret");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = bytes[i % bytes.length]; // repeat the secret until it fills 32 bytes
  return out;
}
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
async function privateKey(secret: string, extractable = false): Promise<CryptoKey> {
  const der = new Uint8Array(PKCS8_PREFIX.length + 32);
  der.set(PKCS8_PREFIX); der.set(seedFromSecret(secret), PKCS8_PREFIX.length);
  return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, extractable, ["sign"]);
}
async function publicKeyBytes(secret: string): Promise<Uint8Array> {
  const jwk = (await crypto.subtle.exportKey("jwk", await privateKey(secret, true))) as { x: string };
  const b = atob(jwk.x.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export async function qqSign(secret: string, message: string): Promise<string> {
  return hex(await crypto.subtle.sign({ name: "Ed25519" }, await privateKey(secret), enc.encode(message)));
}
export async function verifyQqSignature(secret: string | undefined, sigHex: string | null, timestamp: string | null, rawBody: string): Promise<boolean> {
  if (!secret || !sigHex || !timestamp) return false; // fail closed
  const sig = fromHex(sigHex);
  if (!sig || sig.length !== 64 || (sig[63] & 224) !== 0) return false;
  try {
    const key = await crypto.subtle.importKey("raw", await publicKeyBytes(secret), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(timestamp + rawBody));
  } catch { return false; }
}

export async function handleQqExtras(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.QQ_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  let body: Obj | null;
  try { body = obj(JSON.parse(raw)); } catch { body = null; }
  if (!body || !env.QQ_BOT_SECRET) return new Response(body ? "Unauthorized" : "Bad Request", { status: body ? 401 : 400 });
  const d = obj(body.d);
  // Callback address validation: answering proves we hold the bot secret, and QQ's sample request carries no signature headers.
  if (body.op === 13) {
    if (typeof d?.plain_token !== "string" || typeof d?.event_ts !== "string") return new Response("Bad Request", { status: 400 });
    return Response.json({ plain_token: d.plain_token, signature: await qqSign(env.QQ_BOT_SECRET, d.event_ts + d.plain_token) });
  }
  if (!(await verifyQqSignature(env.QQ_BOT_SECRET, request.headers.get("X-Signature-Ed25519"), request.headers.get("X-Signature-Timestamp"), raw))) { log.warn("signature_invalid"); return new Response("Unauthorized", { status: 401 }); }
  const ack = () => Response.json({ op: 12 });
  if (body.op !== 0 || typeof body.t !== "string") return ack();
  const openid = eventOpenid(d);
  if (!allowedId(env.QQ_PROBE_OPENIDS, openid)) { log.info("not_allowed"); return ack(); }
  const states = qqStates(body.t, d);
  log.info("checked", { seen: states.filter((s) => s.state === "returned").length }); // counts only
  return ack();
}
