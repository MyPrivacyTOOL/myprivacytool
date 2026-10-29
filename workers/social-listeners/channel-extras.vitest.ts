// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689 pilot: SMS (Twilio), Viber and LINE extras. Synthetic payloads, keys made up for the test, stubbed fetch: nothing here reaches a platform.
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SMS_EXTRA_HEXAGONS, handleSmsExtras, smsStates } from "./src/sms-extras";
import { VIBER_EXTRA_HEXAGONS, handleViberExtras, viberStates } from "./src/viber-extras";
import { LINE_EXTRA_HEXAGONS, handleLineExtras, lineStates } from "./src/line-extras";
import { LINE_EXTRA_IDS, SMS_EXTRA_IDS, VIBER_EXTRA_IDS } from "../../shared/hexagon-registry/channels.js";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";
import type { Env } from "./src/shared";

afterEach(() => { vi.restoreAllMocks(); });
const states = (l: { id: string; state: string }[]) => Object.fromEntries(l.map((x) => [x.id, x.state]));

describe("the extras are catalogue items", () => {
  it("SMS 4, Viber 9, LINE 5: each id is in the catalogue, marked OK, still 'new', and the lists match the registry", () => {
    expect(SMS_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(SMS_EXTRA_IDS);
    expect(VIBER_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(VIBER_EXTRA_IDS);
    expect(LINE_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(LINE_EXTRA_IDS);
    for (const d of [...SMS_EXTRA_HEXAGONS, ...VIBER_EXTRA_HEXAGONS, ...LINE_EXTRA_HEXAGONS]) {
      const item = HEXAGON_CATALOGUE.find((h) => h.id === d.id);
      expect(item, d.id).toBeTruthy();
      expect(item!.status).toBe("new");
      expect(item!.access).toBe("OK");
      expect(item!.arrival).toBe(d.arrival);
    }
  });
});

describe("SMS (Twilio)", () => {
  const PARAMS = { From: "+15005550006", To: "+15005550001", Body: "hi", NumSegments: "1", FromCity: "Springfield", FromCountry: "US", MessageSid: "SM1", AccountSid: "AC1" };
  const URL_ = "https://x.test/webhook/sms-extras";
  const env = (over: Record<string, unknown> = {}) => ({ SMS_EXTRAS: "on", TWILIO_AUTH_TOKEN: "tok", SMS_PROBE_NUMBERS: "+15005550006", ...over }) as unknown as Env;
  const sig = (p: Record<string, string>, token = "tok") => createHmac("sha1", token).update(URL_ + Object.keys(p).sort().map((k) => k + p[k]).join("")).digest("base64");
  const post = (p: Record<string, string>, e: Env, headers: Record<string, string> = {}) =>
    handleSmsExtras(new Request(URL_, { method: "POST", body: new URLSearchParams(p).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig(p), ...headers } }), e);

  it("reads the parameters Twilio sent, never invents the area, and is 'not returned' for a missing field", () => {
    expect(states(smsStates(new URLSearchParams(PARAMS)))).toEqual({ "sms.number": "returned", "sms.number_area": "returned", "sms.message_time": "returned", "sms.message_text": "returned" });
    expect(states(smsStates(new URLSearchParams({ From: "+1500", Body: "" })))).toMatchObject({ "sms.number_area": "not_returned", "sms.message_text": "not_returned" });
  });
  it("is off by default, POST only, and 401 on a bad or missing signature (fails closed without a token)", async () => {
    expect((await post(PARAMS, env({ SMS_EXTRAS: undefined }))).status).toBe(404);
    expect((await handleSmsExtras(new Request(URL_), env())).status).toBe(405);
    expect((await post(PARAMS, env(), { "X-Twilio-Signature": sig(PARAMS, "wrong") })).status).toBe(401);
    expect((await post({ ...PARAMS, Body: "tampered" }, env(), { "X-Twilio-Signature": sig(PARAMS) })).status).toBe(401);
    expect((await post(PARAMS, env({ TWILIO_AUTH_TOKEN: undefined }))).status).toBe(401);
  });
  it("replies with TwiML to an allow-listed number only, listing what was seen, escaped, without the number itself", async () => {
    const res = await post(PARAMS, env());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    const xml = await res.text();
    expect(xml).toMatch(/^<\?xml[^>]*\?><Response><Message>/);
    expect(xml).toContain("Seen: Phone number, Number&#39;s home area, Message time, What you typed");
    expect(xml).toContain("not part of any score");
    expect(xml).not.toContain("+15005550006");
    expect(xml).not.toContain("Springfield");
    for (const e of [env({ SMS_PROBE_NUMBERS: "+19999999999" }), env({ SMS_PROBE_NUMBERS: undefined })]) expect(await (await post(PARAMS, e)).text()).toContain("not available to you yet");
  });
});

describe("Viber", () => {
  const TOKEN = "viber-test-token";
  const env = (over: Record<string, unknown> = {}) => ({ VIBER_EXTRAS: "on", VIBER_AUTH_TOKEN: TOKEN, VIBER_PROBE_IDS: "u1", ...over }) as unknown as Env;
  const sender = { id: "u1", name: "Nelly", avatar: "https://a", country: "GB", language: "en", api_version: 10 };
  const msg = (over: Record<string, unknown> = {}) => ({ event: "message", timestamp: 1, message_token: 5, sender, message: { type: "text", text: "hi" }, ...over });
  const post = async (cb: unknown, e: Env, f?: typeof fetch, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify(cb);
    return handleViberExtras(new Request("https://x/webhook/viber", { method: "POST", body: raw, headers: { "X-Viber-Content-Signature": createHmac("sha256", TOKEN).update(raw).digest("hex"), ...headers } }), e, f);
  };

  it("reads sender and message; location and contact only when the person shared them; context only from a deep link", () => {
    expect(states(viberStates(msg()))).toEqual({ "vb.user_id": "returned", "vb.name_photo": "returned", "vb.country": "returned", "vb.language": "returned", "vb.api_version": "returned", "vb.message": "returned", "vb.deeplink": "not_returned", "vb.location": "not_returned", "vb.contact": "not_returned" });
    expect(states(viberStates(msg({ message: { type: "location", location: { lat: 1.5, lon: 2.5 } } })))["vb.location"]).toBe("returned");
    expect(states(viberStates(msg({ message: { type: "contact", contact: { name: "X", phone_number: "+1500" } } })))["vb.contact"]).toBe("returned");
    expect(states(viberStates({ event: "conversation_started", context: "ad7", user: sender }))).toMatchObject({ "vb.deeplink": "returned", "vb.user_id": "returned", "vb.message": "not_returned" });
    for (const v of Object.values(states(viberStates({})))) expect(v).not.toBe("returned");
  });
  it("is off by default, 401 on a bad signature, and acknowledges (and ignores) events that are not a person's message", async () => {
    expect((await post(msg(), env({ VIBER_EXTRAS: undefined }))).status).toBe(404);
    expect((await post(msg(), env(), undefined, { "X-Viber-Content-Signature": "00" })).status).toBe(401);
    expect((await handleViberExtras(new Request("https://x/webhook/viber", { method: "POST", body: JSON.stringify(msg()) }), env())).status).toBe(401);
    const f = vi.fn();
    expect((await post({ event: "delivered", sender }, env(), f as any)).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
  it("sends the private reply through send_message for an allow-listed id, and nothing to anyone else", async () => {
    const calls: any[] = [];
    const f = (async (u: string, init: any) => { calls.push({ u, init, body: JSON.parse(init.body) }); return new Response("{}"); }) as unknown as typeof fetch;
    expect((await post(msg(), env(), f)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].u).toBe("https://chatapi.viber.com/pa/send_message");
    expect(calls[0].init.headers["X-Viber-Auth-Token"]).toBe(TOKEN);
    expect(calls[0].body).toMatchObject({ receiver: "u1", type: "text" });
    expect(calls[0].body.text).toContain("Seen: Viber user ID, Name and photo");
    expect(calls[0].body.text).not.toContain("Nelly");
    const other = vi.fn();
    await post(msg({ sender: { ...sender, id: "u2" } }), env(), other as any);
    await post(msg(), env({ VIBER_PROBE_IDS: undefined }), other as any);
    expect(other).not.toHaveBeenCalled();
  });
  it("answers conversation_started in the callback itself", async () => {
    const res = await post({ event: "conversation_started", context: "ad7", user: sender }, env());
    const body: any = await res.json();
    expect(body.type).toBe("text");
    expect(body.text).toContain("Where they came from");
  });
});

describe("LINE", () => {
  const SECRET = "line-test-secret";
  const env = (over: Record<string, unknown> = {}) => ({ LINE_EXTRAS: "on", LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "at", LINE_PROBE_IDS: "U1", ...over }) as unknown as Env;
  const ev = (over: Record<string, unknown> = {}) => ({ type: "message", replyToken: "rt", source: { type: "user", userId: "U1" }, message: { id: "1", type: "text", text: "hi" }, ...over });
  const post = (events: unknown[], e: Env, f?: typeof fetch, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify({ destination: "x", events });
    return handleLineExtras(new Request("https://x/webhook/line", { method: "POST", body: raw, headers: { "x-line-signature": createHmac("sha256", SECRET).update(raw).digest("base64"), ...headers } }), e, f);
  };

  it("reads the event: group and location only when present; follow and unfollow as the follow state", () => {
    expect(states(lineStates(ev()))).toEqual({ "line.user_id": "returned", "line.message": "returned", "line.follow_state": "not_returned", "line.group": "not_returned", "line.location": "not_returned" });
    expect(states(lineStates(ev({ source: { type: "group", groupId: "G", userId: "U1" } })))["line.group"]).toBe("returned");
    expect(states(lineStates(ev({ message: { type: "location", latitude: 1, longitude: 2, address: "a" } })))["line.location"]).toBe("returned");
    expect(states(lineStates({ type: "follow", follow: { isUnblocked: true }, source: { type: "user", userId: "U1" } }))["line.follow_state"]).toBe("returned");
    expect(states(lineStates({ type: "unfollow", source: { type: "user", userId: "U1" } }))["line.follow_state"]).toBe("returned");
    for (const v of Object.values(states(lineStates({})))) expect(v).not.toBe("returned");
  });
  it("is off by default and 401 on a bad or missing signature", async () => {
    expect((await post([ev()], env({ LINE_EXTRAS: undefined }))).status).toBe(404);
    expect((await post([ev()], env(), undefined, { "x-line-signature": "AAAA" })).status).toBe(401);
    expect((await handleLineExtras(new Request("https://x/webhook/line", { method: "POST", body: "{}" }), env())).status).toBe(401);
    expect((await post([ev()], env({ LINE_CHANNEL_SECRET: undefined }))).status).toBe(401);
  });
  it("replies once per allowed message event using its reply token, and ignores everyone else and other event types", async () => {
    const calls: any[] = [];
    const f = (async (u: string, init: any) => { calls.push({ u, init, body: JSON.parse(init.body) }); return new Response("{}"); }) as unknown as typeof fetch;
    expect((await post([ev(), ev({ source: { type: "user", userId: "U2" } }), { type: "postback", source: { userId: "U1" } }], env(), f)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].u).toBe("https://api.line.me/v2/bot/message/reply");
    expect(calls[0].init.headers.authorization).toBe("Bearer at");
    expect(calls[0].body.replyToken).toBe("rt");
    expect(calls[0].body.messages[0].text).toContain("Seen: LINE user ID, What they sent");
    expect(calls[0].body.messages[0].text).not.toContain("U1");
    const none = vi.fn();
    await post([ev()], env({ LINE_PROBE_IDS: undefined }), none as any);
    expect(none).not.toHaveBeenCalled();
  });
  it("never logs the payload, the ids or the token", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
    await post([ev()], env(), (async () => new Response("{}")) as unknown as typeof fetch);
    expect(logs.join("\n")).not.toMatch(/U1|rt"|hi|line-test-secret|Bearer/);
  });
});
