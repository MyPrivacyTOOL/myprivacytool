// MPC-8689 pilot: WeChat Official Account extras. A person messages our Official Account; WeChat POSTs the message as XML and the reply goes back as a passive XML reply.
// 5 hexagons from the message (confirmed against developers.weixin.qq.com, Receiving_standard_messages and the passive reply page): OpenID (FromUserName), what they sent (MsgType, Content, PicUrl,
// MediaId), voice recording (MediaId, Format, MediaId16K), message time (CreateTime) and shared location (Location_X, Location_Y, Scale, Label). WeChat retries up to 3 times after 5 seconds,
// so the reply is built synchronously and nothing slow runs here. Plain-text mode only (not the encrypted mode).
// AUTH: GET (URL verification) and POST carry signature, timestamp and nonce; signature = SHA1 of the lexicographically sorted token, timestamp and nonce joined together, hex. That rule is the
// documented Official Account scheme but the pages I could read did not include it, so it is unconfirmed here; a wrong rule fails closed (every request 401).
// B lookup (confirmed against api_userinfo): GET https://api.weixin.qq.com/cgi-bin/user/info?access_token=&openid= (certified accounts only): subscribe and subscribe_time, subscribe_scene, qr_scene,
// qr_scene_str. Needs WECHAT_ACCESS_TOKEN (we do not fetch or refresh one here); it must finish inside WeChat's 5-second window, so it has a 3-second limit and a failure is not_checked.
// Off unless WECHAT_EXTRAS=on; allow-listed OpenIDs only (WECHAT_PROBE_OPENIDS). Not built: cross-app ID (Verify).
import { createLogger } from "./logger";
import { type Env, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, extrasReply, filled, toStates, type ExtraDef } from "./extras-common";

const log = createLogger("social-listeners:wechat");
export const WECHAT_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "wc.openid", label: "WeChat OpenID", arrival: "A", source: "FromUserName (OpenID)" },
  { id: "wc.message", label: "What they sent", arrival: "A", source: "MsgType, Content, PicUrl, MediaId, Format" },
  { id: "wc.voice", label: "Voice recording", arrival: "A", source: "voice MediaId, MediaId16K" },
  { id: "wc.time", label: "Message time", arrival: "A", source: "CreateTime" },
  { id: "wc.location", label: "Shared location", arrival: "C", source: "Location_X, Location_Y, Scale, Label" },
  { id: "wc.follow", label: "Follow status and date", arrival: "B", source: "subscribe, subscribe_time" },
  { id: "wc.follow_scene", label: "How they found us", arrival: "B", source: "subscribe_scene, qr_scene, qr_scene_str" },
];

/** One field out of the flat XML WeChat sends ("<Tag><![CDATA[x]]></Tag>" or "<Tag>x</Tag>"). No XML parser, no entities, no nesting. */
export function xmlField(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`).exec(xml);
  return m ? (m[1] ?? m[2] ?? "") : null;
}

/** The two lookup hexagons from the user-info answer. null = the lookup failed (not checked). subscribe 0 means no other data is returned, so both are 'not returned'. */
export function wechatInfoStates(info: Record<string, unknown> | null): { returned: Record<string, boolean>; skipped: string[] } {
  if (!info) return { returned: {}, skipped: ["wc.follow", "wc.follow_scene"] };
  const subscribed = info.subscribe === 1;
  return { returned: { "wc.follow": subscribed && filled(info.subscribe_time), "wc.follow_scene": subscribed && (filled(info.subscribe_scene) || filled(info.qr_scene) || filled(info.qr_scene_str)) }, skipped: [] };
}

export function wechatStates(xml: string, info: Record<string, unknown> | null = null) {
  const wi = wechatInfoStates(info);
  const f = (t: string) => xmlField(xml, t);
  const type = f("MsgType");
  return toStates(WECHAT_EXTRA_HEXAGONS, {
    "wc.openid": filled(f("FromUserName")),
    "wc.message": filled(type) && (filled(f("Content")) || filled(f("PicUrl")) || filled(f("MediaId")) || type !== "text"),
    "wc.voice": type === "voice" && (filled(f("MediaId")) || filled(f("MediaId16K"))),
    "wc.time": filled(f("CreateTime")) && Number.isFinite(Number(f("CreateTime"))),
    "wc.location": type === "location" && filled(f("Location_X")) && filled(f("Location_Y")),
    ...wi.returned,
  }, wi.skipped);
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function wechatSignature(token: string, timestamp: string, nonce: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode([token, timestamp, nonce].sort().join(""))));
}
async function signed(url: URL, env: Env): Promise<boolean> {
  const { searchParams: q } = url;
  const [sig, ts, nonce] = [q.get("signature"), q.get("timestamp"), q.get("nonce")];
  if (!env.WECHAT_TOKEN || !sig || !ts || !nonce) return false; // fail closed
  return timingSafeEqual(sig, await wechatSignature(env.WECHAT_TOKEN, ts, nonce));
}

const cdata = (s: string) => `<![CDATA[${s.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
export function passiveReply(toUser: string, fromUser: string, text: string, now = Math.floor(Date.now() / 1000)): string {
  return `<xml><ToUserName>${cdata(toUser)}</ToUserName><FromUserName>${cdata(fromUser)}</FromUserName><CreateTime>${now}</CreateTime><MsgType>${cdata("text")}</MsgType><Content>${cdata(text)}</Content></xml>`;
}

export async function wechatLookup(openid: string, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  try {
    const r = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/user/info?access_token=${encodeURIComponent(token)}&openid=${encodeURIComponent(openid)}`, { signal: AbortSignal.timeout(3000) });
    const j = r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    return j && typeof j === "object" && j.errcode === undefined ? j : null;
  } catch { return null; }
}

export async function handleWechatExtras(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (env.WECHAT_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  if (!(await signed(url, env))) { log.warn("signature_invalid"); return new Response("Unauthorized", { status: 401 }); }
  if (request.method === "GET") return new Response(url.searchParams.get("echostr") ?? "", { headers: { "content-type": "text/plain" } }); // URL verification
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  const from = xmlField(raw, "FromUserName"), to = xmlField(raw, "ToUserName");
  if (!from || !to || xmlField(raw, "MsgType") === null) return new Response("success"); // nothing to answer (events, empty bodies); "success" tells WeChat not to retry
  if (!allowedId(env.WECHAT_PROBE_OPENIDS, from)) { log.info("not_allowed"); return new Response("success"); }
  const states = wechatStates(raw, await wechatLookup(from, env.WECHAT_ACCESS_TOKEN, fetchImpl));
  log.info("replied", { seen: states.filter((s) => s.state === "returned").length }); // counts only
  return new Response(passiveReply(from, to, extrasReply("WeChat", WECHAT_EXTRA_HEXAGONS, states)), { headers: { "content-type": "application/xml" } });
}
