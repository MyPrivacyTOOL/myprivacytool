// MPC-8689 pilot: KakaoTalk extras. A person messages our KakaoTalk channel chatbot; Kakao calls our skill server and the reply goes back in the response, private to that person.
// 6 hexagons from the skill request (confirmed against kakaobusiness.gitbook.io skill_guide/answer_json_format): bot user key (userRequest.user.id), channel user key
// (properties.plusfriendUserKey, always provided), channel friend (properties.isFriend, absent when not added or blocked), timezone, language, and what they sent (utterance, block, action params).
// AUTH: that page documents NO signature or token on requests from Kakao to the skill server, so this endpoint is gated by a secret in the URL we register as the skill URL
// (/webhook/kakao?k=<KAKAO_SKILL_SECRET>), compared in constant time. Treat the secret like a key: it is the only thing between this URL and the internet.
// Response shape (version 2.0, template.outputs[].simpleText.text) is the standard skill response; this page was not fetched for it, so it is the one unverified step.
// Off unless KAKAO_EXTRAS=on; allow-listed bot user keys only (KAKAO_PROBE_IDS). Not built: Kakao account link (Verify), when they linked and every Kakao Login item (sign-in).
import { createLogger } from "./logger";
import { type Env, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, extrasReply, filled, obj, toStates, type ExtraDef, type Obj } from "./extras-common";

const log = createLogger("social-listeners:kakao");
export const KAKAO_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "kk.bot_user_key", label: "Bot user key", arrival: "A", source: "userRequest.user.id / botUserKey" },
  { id: "kk.channel_key", label: "Channel user key", arrival: "A", source: "properties.plusfriendUserKey" },
  { id: "kk.is_friend", label: "Channel friend", arrival: "A", source: "properties.isFriend" },
  { id: "kk.timezone", label: "Timezone", arrival: "A", source: "userRequest.timezone" },
  { id: "kk.lang", label: "Language", arrival: "A", source: "userRequest.lang" },
  { id: "kk.message", label: "What they sent", arrival: "A", source: "utterance, block.name, params" },
];

export function kakaoStates(request: unknown) {
  const body = obj(request) ?? {};
  const ur = obj(body.userRequest) ?? {};
  const user = obj(ur.user) ?? {};
  const props = obj(user.properties) ?? {};
  const action = obj(body.action) ?? {};
  return toStates(KAKAO_EXTRA_HEXAGONS, {
    "kk.bot_user_key": filled(user.id) || filled(props.botUserKey),
    "kk.channel_key": filled(props.plusfriendUserKey),
    "kk.is_friend": props.isFriend === true,
    "kk.timezone": filled(ur.timezone),
    "kk.lang": filled(ur.lang),
    "kk.message": filled(ur.utterance) || filled(obj(ur.block)?.name) || filled(action.params),
  });
}

const reply = (text: string) => Response.json({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });

export async function handleKakaoExtras(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.KAKAO_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const key = new URL(request.url).searchParams.get("k");
  if (!env.KAKAO_SKILL_SECRET || !timingSafeEqual(key, env.KAKAO_SKILL_SECRET)) { log.warn("secret_invalid"); return new Response("Unauthorized", { status: 401 }); }
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  let body: Obj | null;
  try { body = obj(JSON.parse(raw)); } catch { body = null; }
  if (!body) return new Response("Bad Request", { status: 400 });
  const user = obj(obj(body.userRequest)?.user);
  if (!allowedId(env.KAKAO_PROBE_IDS, user?.id)) { log.info("not_allowed"); return reply("This check is not available to you yet."); }
  const states = kakaoStates(body);
  log.info("replied", { seen: states.filter((s) => s.state === "returned").length }); // counts only
  return reply(extrasReply("KakaoTalk", KAKAO_EXTRA_HEXAGONS, states));
}
