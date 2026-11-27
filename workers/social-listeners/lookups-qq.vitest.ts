// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689 pilot: the token-based lookups for Viber, Zalo and WeChat, and the QQ extras. Synthetic payloads, made-up secrets, stubbed fetch: nothing here reaches a platform.
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viberLookup, viberLookupStates, viberStates, VIBER_EXTRA_HEXAGONS } from "./src/viber-extras";
import { zaloDetailStates, zaloLookup, zaloStates, ZALO_EXTRA_HEXAGONS } from "./src/zalo-extras";
import { wechatInfoStates, wechatLookup, wechatStates, WECHAT_EXTRA_HEXAGONS } from "./src/wechat-extras";
import { QQ_EXTRA_HEXAGONS, eventOpenid, handleQqExtras, qqSign, qqStates, seedFromSecret, verifyQqSignature } from "./src/qq-extras";
import { QQ_EXTRA_IDS, VIBER_EXTRA_IDS, WECHAT_EXTRA_IDS, ZALO_EXTRA_IDS } from "../../shared/hexagon-registry/channels.js";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";
import type { Env } from "./src/shared";

afterEach(() => { vi.restoreAllMocks(); });
const st = (l: { id: string; state: string }[]) => Object.fromEntries(l.map((x) => [x.id, x.state]));

describe("catalogue", () => {
  it("the new hexagons are catalogue items marked OK and still 'new'; the lists match the registry", () => {
    expect(VIBER_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(VIBER_EXTRA_IDS);
    expect(WECHAT_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(WECHAT_EXTRA_IDS);
    expect(ZALO_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(ZALO_EXTRA_IDS);
    expect(QQ_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(QQ_EXTRA_IDS);
    for (const d of [...VIBER_EXTRA_HEXAGONS, ...WECHAT_EXTRA_HEXAGONS, ...ZALO_EXTRA_HEXAGONS, ...QQ_EXTRA_HEXAGONS]) {
      const item = HEXAGON_CATALOGUE.find((h) => h.id === d.id);
      expect(item, d.id).toBeTruthy();
      expect([item!.status, item!.access, item!.arrival]).toEqual(["new", "OK", d.arrival]);
    }
  });
});

describe("Viber lookups (get_user_details, get_online)", () => {
  const cb = { event: "message", sender: { id: "u1", name: "N", country: "GB", language: "en", api_version: 10 }, message: { type: "text", text: "hi" } };
  const DETAILS = { id: "u1", primary_device_os: "Android 14", device_type: "Pixel 7", viber_version: "21.0", mcc: 234, mnc: 10 };
  const ok = (body: unknown) => new Response(JSON.stringify(body));
  const f = (details: unknown, online: unknown) => (async (u: string) => (String(u).endsWith("get_user_details") ? ok(details) : ok(online))) as unknown as typeof fetch;

  it("reads the four B hexagons; a failed lookup is 'not checked'; 'undisclosed' counts only when a last-online time is shown", () => {
    const all = st(viberStates(cb, { details: DETAILS, online: { id: "u1", online_status: 0, online_status_message: "online" } }));
    expect(all).toMatchObject({ "vb.device": "returned", "vb.app_version": "returned", "vb.carrier": "returned", "vb.online": "returned" });
    expect(st(viberStates(cb, { details: null, online: null }))).toMatchObject({ "vb.device": "not_checked", "vb.carrier": "not_checked", "vb.online": "not_checked" });
    expect(viberLookupStates({ details: { id: "u1" }, online: { online_status: 2 } }).returned).toMatchObject({ "vb.device": false, "vb.carrier": false, "vb.online": false });
    expect(viberLookupStates({ details: null, online: { online_status: 3 } }).skipped).toContain("vb.online"); // 'try later' is not an answer
    expect(viberLookupStates({ details: null, online: { online_status: 2, last_online: 1700000000 } }).returned["vb.online"]).toBe(true);
  });
  it("calls the two documented endpoints with the token and the one user id; any failure is null", async () => {
    const calls: any[] = [];
    const spy = (async (u: string, i: any) => { calls.push({ u, h: i.headers, b: JSON.parse(i.body) }); return String(u).endsWith("get_user_details") ? ok({ status: 0, user: DETAILS }) : ok({ status: 0, users: [{ id: "u1", online_status: 1 }] }); }) as unknown as typeof fetch;
    const r = await viberLookup("u1", "tok", spy);
    expect(calls.map((c) => c.u).sort()).toEqual(["https://chatapi.viber.com/pa/get_online", "https://chatapi.viber.com/pa/get_user_details"]);
    expect(calls.every((c) => c.h["X-Viber-Auth-Token"] === "tok")).toBe(true);
    expect(calls.find((c) => c.u.endsWith("get_user_details")).b).toEqual({ id: "u1" });
    expect(calls.find((c) => c.u.endsWith("get_online")).b).toEqual({ ids: ["u1"] });
    expect(r.details?.viber_version).toBe("21.0");
    expect(r.online?.online_status).toBe(1);
    expect(await viberLookup("u1", undefined, spy)).toEqual({ details: null, online: null });
    expect(await viberLookup("u1", "tok", f({ status: 1, status_message: "receiverNoSuitableDevice" }, { status: 0, users: [] }))).toEqual({ details: null, online: null });
    expect(await viberLookup("u1", "tok", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toEqual({ details: null, online: null });
  });
});

describe("Zalo user detail", () => {
  const DATA = { user_id: "4572947693969771653", display_name: "Nelly", avatar: "https://a", user_is_follower: true, user_last_interaction_date: "20/10/2026", shared_info: { name: "N", phone: "0900" } };
  const ev = { app_id: "a", event_name: "user_send_text", sender: { id: "4572947693969771653" }, message: { text: "hi", msg_id: "m" } };
  it("reads the three lookup hexagons; empty shared_info is 'not returned'; a failed lookup is 'not checked'", () => {
    expect(st(zaloStates(ev, DATA))).toMatchObject({ "zl.name_photo": "returned", "zl.follower": "returned", "zl.shared_info": "returned" });
    expect(zaloDetailStates({ ...DATA, shared_info: {} }).returned["zl.shared_info"]).toBe(false);
    expect(zaloDetailStates({ user_id: "1" }).returned).toEqual({ "zl.name_photo": false, "zl.follower": false, "zl.shared_info": false });
    expect(zaloDetailStates(null).skipped).toHaveLength(3);
  });
  it("calls the documented endpoint with the access_token header and the user id; any failure is null", async () => {
    const calls: any[] = [];
    const f = (async (u: string, i: any) => { calls.push({ u, h: i.headers }); return new Response(JSON.stringify({ error: 0, message: "Success", data: DATA })); }) as unknown as typeof fetch;
    expect((await zaloLookup("4572947693969771653", "tok", f))?.display_name).toBe("Nelly");
    expect(calls[0].u).toBe(`https://openapi.zalo.me/v3.0/oa/user/detail?data=${encodeURIComponent('{"user_id":"4572947693969771653"}')}`);
    expect(calls[0].h.access_token).toBe("tok");
    expect(await zaloLookup("4572947693969771653", undefined, f)).toBeNull();
    expect(await zaloLookup("../x", "tok", f)).toBeNull();
    expect(await zaloLookup("4572947693969771653", "tok", (async () => new Response(JSON.stringify({ error: -216, message: "token" }))) as unknown as typeof fetch)).toBeNull();
    expect(await zaloLookup("4572947693969771653", "tok", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("WeChat user info", () => {
  const xml = "<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[oU]]></FromUserName><CreateTime>1</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[x]]></Content></xml>";
  it("reads follow status and scene only for a subscribed user (subscribe 0 returns no other data); a failed lookup is 'not checked'", () => {
    expect(st(wechatStates(xml, { subscribe: 1, openid: "oU", subscribe_time: 1700000000, subscribe_scene: "ADD_SCENE_QR_CODE", qr_scene: 5 }))).toMatchObject({ "wc.follow": "returned", "wc.follow_scene": "returned" });
    expect(wechatInfoStates({ subscribe: 0, openid: "oU" }).returned).toEqual({ "wc.follow": false, "wc.follow_scene": false });
    expect(st(wechatStates(xml, null))).toMatchObject({ "wc.follow": "not_checked", "wc.follow_scene": "not_checked" });
  });
  it("calls cgi-bin/user/info with the token and openid inside a 3 second limit; WeChat error codes and failures are null", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify({ subscribe: 1, openid: "oU" })); }) as unknown as typeof fetch;
    expect(await wechatLookup("oU", "tok", f)).toMatchObject({ subscribe: 1 });
    expect(urls[0]).toBe("https://api.weixin.qq.com/cgi-bin/user/info?access_token=tok&openid=oU");
    expect(await wechatLookup("oU", undefined, f)).toBeNull();
    expect(await wechatLookup("oU", "tok", (async () => new Response(JSON.stringify({ errcode: 40001, errmsg: "x" }))) as unknown as typeof fetch)).toBeNull();
    expect(await wechatLookup("oU", "tok", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("QQ", () => {
  const SECRET = "qq-bot-secret-test";
  const env = (over: Record<string, unknown> = {}) => ({ QQ_EXTRAS: "on", QQ_BOT_SECRET: SECRET, QQ_PROBE_OPENIDS: "OPEN1", ...over }) as unknown as Env;
  // independent signer (node:crypto) so the test does not just compare the module with itself
  const nodeKey = (secret: string) => {
    const seed = Buffer.alloc(32); const b = Buffer.from(secret);
    for (let i = 0; i < 32; i++) seed[i] = b[i % b.length];
    return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  };
  const nodeSignHex = (secret: string, msg: string) => nodeSign(null, Buffer.from(msg), nodeKey(secret)).toString("hex");
  const post = (body: unknown, e: Env, headers: Record<string, string> | null = {}, ts = "1700000000") => {
    const raw = JSON.stringify(body);
    const h = headers === null ? {} : { "X-Signature-Timestamp": ts, "X-Signature-Ed25519": nodeSignHex(SECRET, ts + raw), ...headers };
    return handleQqExtras(new Request("https://x/webhook/qq", { method: "POST", body: raw, headers: h }), e);
  };
  const c2c = (over: Record<string, unknown> = {}) => ({ op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "m", author: { user_openid: "OPEN1" }, content: "hi" }, ...over });

  it("derives the seed by repeating the bot secret to 32 bytes, and signs exactly like an independent Ed25519 implementation", async () => {
    expect(Array.from(seedFromSecret("ab")).slice(0, 5)).toEqual([97, 98, 97, 98, 97]);
    expect(seedFromSecret("x".repeat(40)).length).toBe(32);
    expect(await qqSign(SECRET, "hello")).toBe(nodeSignHex(SECRET, "hello"));
    const pub = createPublicKey(nodeKey(SECRET));
    expect(nodeVerify(null, Buffer.from("hello"), pub, Buffer.from(await qqSign(SECRET, "hello"), "hex"))).toBe(true);
  });
  it("verifies timestamp + raw body, and refuses a wrong key, a changed body, a short signature and a missing header", async () => {
    const sig = nodeSignHex(SECRET, "1{}");
    expect(await verifyQqSignature(SECRET, sig, "1", "{}")).toBe(true);
    expect(await verifyQqSignature(SECRET, sig, "2", "{}")).toBe(false);
    expect(await verifyQqSignature(SECRET, sig, "1", "{ }")).toBe(false);
    expect(await verifyQqSignature("other-secret", sig, "1", "{}")).toBe(false);
    expect(await verifyQqSignature(SECRET, sig.slice(0, 100), "1", "{}")).toBe(false);
    expect(await verifyQqSignature(SECRET, null, "1", "{}")).toBe(false);
    expect(await verifyQqSignature(undefined, sig, "1", "{}")).toBe(false);
  });
  it("answers the op 13 address validation with plain_token and a signature over event_ts + plain_token", async () => {
    const res = await post({ op: 13, d: { plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts: "1725442341" } }, env(), null);
    const body: any = await res.json();
    expect(body.plain_token).toBe("Arq0D5A61EgUu4OxUvOp");
    expect(body.signature).toBe(nodeSignHex(SECRET, "1725442341Arq0D5A61EgUu4OxUvOp"));
    expect((await post({ op: 13, d: {} }, env(), null)).status).toBe(400);
  });
  it("reads the states: openid from a C2C message, added-or-blocked from the three friend events", () => {
    expect(st(qqStates("C2C_MESSAGE_CREATE", { author: { user_openid: "O" } }))).toEqual({ "qq.openid": "returned", "qq.friend_state": "not_returned" });
    for (const t of ["FRIEND_ADD", "FRIEND_DEL", "C2C_MSG_REJECT"]) expect(st(qqStates(t, { openid: "O" }))["qq.friend_state"]).toBe("returned");
    expect(st(qqStates("OTHER", null))).toEqual({ "qq.openid": "not_returned", "qq.friend_state": "not_returned" });
    expect(eventOpenid({ openid: "a" })).toBe("a");
    expect(eventOpenid({ author: { user_openid: "b" } })).toBe("b");
    expect(eventOpenid({})).toBeNull();
  });
  it("is off by default, POST only, 401 on a bad signature (fails closed without a secret), and acks an allow-listed event", async () => {
    expect((await post(c2c(), env({ QQ_EXTRAS: undefined }))).status).toBe(404);
    expect((await handleQqExtras(new Request("https://x/webhook/qq"), env())).status).toBe(405);
    expect((await post(c2c(), env(), { "X-Signature-Ed25519": "00".repeat(64) })).status).toBe(401);
    expect((await post(c2c(), env(), null)).status).toBe(401);
    expect((await post(c2c(), env({ QQ_BOT_SECRET: undefined }))).status).toBe(401);
    const res = await post(c2c(), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ op: 12 });
  });
  it("only logs counts for an allow-listed openid, ignores everyone else, and never logs the payload", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
    await post(c2c(), env());
    await post(c2c({ d: { author: { user_openid: "STRANGER" }, content: "hi" } }), env());
    await post(c2c(), env({ QQ_PROBE_OPENIDS: undefined }));
    const all = logs.join("\n");
    expect(all).toContain("checked");
    expect(all.match(/"event":"checked"/g)?.length ?? 0).toBe(1);
    expect(all).not.toMatch(/OPEN1|STRANGER|qq-bot-secret/);
  });
});
