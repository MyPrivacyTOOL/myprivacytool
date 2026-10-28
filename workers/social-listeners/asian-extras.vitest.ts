// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689 pilot: KakaoTalk, WeChat and Zalo extras. Synthetic payloads and made-up secrets: nothing here reaches a platform.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KAKAO_EXTRA_HEXAGONS, handleKakaoExtras, kakaoStates } from "./src/kakao-extras";
import { WECHAT_EXTRA_HEXAGONS, handleWechatExtras, passiveReply, wechatSignature, wechatStates, xmlField } from "./src/wechat-extras";
import { ZALO_EXTRA_HEXAGONS, handleZaloExtras, zaloStates } from "./src/zalo-extras";
import { KAKAO_EXTRA_IDS, WECHAT_EXTRA_IDS, ZALO_EXTRA_IDS } from "../../shared/hexagon-registry/channels.js";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";
import type { Env } from "./src/shared";

afterEach(() => { vi.restoreAllMocks(); });
const st = (l: { id: string; state: string }[]) => Object.fromEntries(l.map((x) => [x.id, x.state]));

describe("catalogue", () => {
  it("KakaoTalk 6, WeChat 5 and Zalo 4 are catalogue items marked OK and still 'new'; the lists match the registry", () => {
    expect(KAKAO_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(KAKAO_EXTRA_IDS);
    expect(WECHAT_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(WECHAT_EXTRA_IDS);
    expect(ZALO_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(ZALO_EXTRA_IDS);
    for (const d of [...KAKAO_EXTRA_HEXAGONS, ...WECHAT_EXTRA_HEXAGONS, ...ZALO_EXTRA_HEXAGONS]) {
      const item = HEXAGON_CATALOGUE.find((h) => h.id === d.id);
      expect(item, d.id).toBeTruthy();
      expect([item!.status, item!.access, item!.arrival]).toEqual(["new", "OK", d.arrival]);
    }
  });
});

describe("KakaoTalk", () => {
  const env = (over: Record<string, unknown> = {}) => ({ KAKAO_EXTRAS: "on", KAKAO_SKILL_SECRET: "kk-secret", KAKAO_PROBE_IDS: "bk1", ...over }) as unknown as Env;
  const req = (over: Record<string, unknown> = {}) => ({ userRequest: { timezone: "Asia/Seoul", lang: "ko", utterance: "hello", block: { id: "b", name: "Welcome" }, user: { id: "bk1", type: "botUserKey", properties: { plusfriendUserKey: "pk", isFriend: true, botUserKey: "bk1" } }, ...over }, action: { name: "a", params: {} }, bot: { id: "x", name: "y" } });
  const post = (body: unknown, e: Env, key: string | null = "kk-secret") => handleKakaoExtras(new Request(`https://x/webhook/kakao${key === null ? "" : `?k=${key}`}`, { method: "POST", body: JSON.stringify(body) }), e);

  it("reads the skill request; isFriend is 'not returned' when absent (not added or blocked)", () => {
    expect(st(kakaoStates(req()))).toEqual({ "kk.bot_user_key": "returned", "kk.channel_key": "returned", "kk.is_friend": "returned", "kk.timezone": "returned", "kk.lang": "returned", "kk.message": "returned" });
    const bare = { userRequest: { user: { id: "bk1", properties: { plusfriendUserKey: "pk" } } } };
    expect(st(kakaoStates(bare))).toMatchObject({ "kk.is_friend": "not_returned", "kk.timezone": "not_returned", "kk.lang": "not_returned", "kk.message": "not_returned", "kk.channel_key": "returned" });
    for (const v of Object.values(st(kakaoStates({})))) expect(v).not.toBe("returned");
  });
  it("is off by default, POST only, and needs the URL secret (fails closed, constant time)", async () => {
    expect((await post(req(), env({ KAKAO_EXTRAS: undefined }))).status).toBe(404);
    expect((await handleKakaoExtras(new Request("https://x/webhook/kakao?k=kk-secret"), env())).status).toBe(405);
    for (const key of [null, "", "wrong"]) expect((await post(req(), env(), key)).status).toBe(401);
    expect((await post(req(), env({ KAKAO_SKILL_SECRET: undefined }), "anything")).status).toBe(401);
  });
  it("answers an allow-listed user in the skill response format with what was seen, and no one else", async () => {
    const body: any = await (await post(req(), env())).json();
    expect(body.version).toBe("2.0");
    const text = body.template.outputs[0].simpleText.text as string;
    expect(text).toContain("Seen: Bot user key, Channel user key, Channel friend, Timezone, Language, What they sent");
    expect(text).not.toContain("bk1");
    expect(text).not.toContain("hello");
    for (const e of [env({ KAKAO_PROBE_IDS: "other" }), env({ KAKAO_PROBE_IDS: undefined })]) expect(((await (await post(req(), e)).json()) as any).template.outputs[0].simpleText.text).toContain("not available to you yet");
    expect((await post("not json" as any, env())).status).toBe(400);
  });
});

describe("WeChat", () => {
  const TOKEN = "wx-token";
  const env = (over: Record<string, unknown> = {}) => ({ WECHAT_EXTRAS: "on", WECHAT_TOKEN: TOKEN, WECHAT_PROBE_OPENIDS: "oUser1", ...over }) as unknown as Env;
  const xml = (type: string, extra = "") => `<xml><ToUserName><![CDATA[gh_acct]]></ToUserName><FromUserName><![CDATA[oUser1]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[${type}]]></MsgType>${extra}<MsgId>1</MsgId></xml>`;
  const TEXT = xml("text", "<Content><![CDATA[secret words]]></Content>");
  const q = async (over: Record<string, string> = {}) => {
    const ts = "1700000000", nonce = "n1";
    const sig = createHash("sha1").update([TOKEN, ts, nonce].sort().join("")).digest("hex");
    return new URLSearchParams({ signature: sig, timestamp: ts, nonce, ...over }).toString();
  };
  const post = async (body: string, e: Env, over: Record<string, string> = {}) => handleWechatExtras(new Request(`https://x/webhook/wechat?${await q(over)}`, { method: "POST", body }), e);

  it("parses flat XML with and without CDATA, and reads the message by type", () => {
    expect(xmlField(TEXT, "FromUserName")).toBe("oUser1");
    expect(xmlField(TEXT, "CreateTime")).toBe("1700000000");
    expect(xmlField(TEXT, "Nope")).toBeNull();
    expect(st(wechatStates(TEXT))).toEqual({ "wc.openid": "returned", "wc.message": "returned", "wc.voice": "not_returned", "wc.time": "returned", "wc.location": "not_returned" });
    expect(st(wechatStates(xml("voice", "<MediaId><![CDATA[m]]></MediaId><Format><![CDATA[amr]]></Format>")))["wc.voice"]).toBe("returned");
    expect(st(wechatStates(xml("location", "<Location_X>23.1</Location_X><Location_Y>113.2</Location_Y><Scale>20</Scale><Label><![CDATA[x]]></Label>")))["wc.location"]).toBe("returned");
    expect(st(wechatStates(xml("location", "<Location_X>23.1</Location_X>")))["wc.location"]).toBe("not_returned");
  });
  it("signature: SHA1 of the sorted token, timestamp and nonce; 401 on anything else, even for URL verification", async () => {
    expect(await wechatSignature(TOKEN, "1700000000", "n1")).toBe(createHash("sha1").update([TOKEN, "1700000000", "n1"].sort().join("")).digest("hex"));
    expect((await post(TEXT, env(), { signature: "bad" })).status).toBe(401);
    expect((await post(TEXT, env({ WECHAT_TOKEN: undefined }))).status).toBe(401);
    expect((await handleWechatExtras(new Request("https://x/webhook/wechat?echostr=hi"), env())).status).toBe(401);
    expect((await post(TEXT, env({ WECHAT_EXTRAS: undefined }))).status).toBe(404);
  });
  it("answers the GET URL verification with echostr when signed", async () => {
    const res = await handleWechatExtras(new Request(`https://x/webhook/wechat?${await q({ echostr: "abc123" })}`), env());
    expect(await res.text()).toBe("abc123");
  });
  it("replies with a passive XML reply (user and account swapped) to an allow-listed OpenID, and 'success' to everyone else", async () => {
    const out = await (await post(TEXT, env())).text();
    expect(out).toMatch(/^<xml><ToUserName><!\[CDATA\[oUser1\]\]><\/ToUserName><FromUserName><!\[CDATA\[gh_acct\]\]><\/FromUserName><CreateTime>\d+<\/CreateTime><MsgType><!\[CDATA\[text\]\]><\/MsgType>/);
    expect(out).toContain("Seen: WeChat OpenID, What they sent");
    expect(out).not.toContain("secret words");
    expect(out).not.toContain("oUser1</Content>");
    for (const e of [env({ WECHAT_PROBE_OPENIDS: "other" }), env({ WECHAT_PROBE_OPENIDS: undefined })]) expect(await (await post(TEXT, e)).text()).toBe("success");
    expect(await (await post("<xml></xml>", env())).text()).toBe("success");
    expect(passiveReply("a", "b", "x]]>y", 5)).toContain("x]]]]><![CDATA[>y");
  });
});

describe("Zalo", () => {
  const env = (over: Record<string, unknown> = {}) => ({ ZALO_EXTRAS: "on", ZALO_WEBHOOK_SECRET: "zl-secret", ZALO_PROBE_IDS: "z1", ...over }) as unknown as Env;
  const ev = (over: Record<string, unknown> = {}) => ({ app_id: "a", event_name: "user_send_text", sender: { id: "z1" }, recipient: { id: "oa" }, message: { text: "hello", msg_id: "m" }, timestamp: "1700000000000", ...over });
  const post = (body: unknown, e: Env, key: string | null = "zl-secret") => handleZaloExtras(new Request(`https://x/webhook/zalo${key === null ? "" : `?k=${key}`}`, { method: "POST", body: JSON.stringify(body) }), e);

  it("reads the event: location only from a location event with coordinates; a business card by its event name", () => {
    expect(st(zaloStates(ev()))).toEqual({ "zl.sender_id": "returned", "zl.message": "returned", "zl.location": "not_returned", "zl.business_card": "not_returned" });
    expect(st(zaloStates(ev({ event_name: "user_send_location", message: { msg_id: "m", attachments: [{ type: "location", payload: { coordinates: { latitude: "10.8", longitude: "106.6" } } }] } })))).toMatchObject({ "zl.location": "returned", "zl.message": "not_returned" });
    expect(st(zaloStates(ev({ event_name: "user_send_location", message: { msg_id: "m", attachments: [{ type: "location", payload: {} }] } })))["zl.location"]).toBe("not_returned");
    expect(st(zaloStates(ev({ event_name: "user_send_business_card", message: {} })))["zl.business_card"]).toBe("returned");
    for (const v of Object.values(st(zaloStates({})))) expect(v).not.toBe("returned");
  });
  it("is off by default, POST only, needs the URL secret, and ignores events that are not a user's message", async () => {
    expect((await post(ev(), env({ ZALO_EXTRAS: undefined }))).status).toBe(404);
    expect((await handleZaloExtras(new Request("https://x/webhook/zalo?k=zl-secret"), env())).status).toBe(405);
    for (const key of [null, "", "wrong"]) expect((await post(ev(), env(), key)).status).toBe(401);
    expect((await post(ev(), env({ ZALO_WEBHOOK_SECRET: undefined }), "x")).status).toBe(401);
    expect(await (await post({ event_name: "follow", sender: { id: "z1" } }, env())).json()).toEqual({ ok: true, checked: false });
  });
  it("answers an allow-listed sender with states and counts only, never a value, and checks no one else", async () => {
    const body: any = await (await post(ev(), env())).json();
    expect(body).toMatchObject({ ok: true, checked: true, seen: 2, total: 4 });
    const text = JSON.stringify(body);
    expect(text).not.toContain("hello");
    expect(text).not.toContain("z1");
    expect(await (await post(ev({ sender: { id: "other" } }), env())).json()).toEqual({ ok: true, checked: false });
    expect(await (await post(ev(), env({ ZALO_PROBE_IDS: undefined }))).json()).toEqual({ ok: true, checked: false });
  });
});
