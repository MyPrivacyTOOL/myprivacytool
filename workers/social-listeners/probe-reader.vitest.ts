// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { isProbeIdRequest, isProbeSender, probeIds, telegramSender } from "./src/probe-reader";

const TOKEN = "123:SECRET-BOT-TOKEN";
const update = (over: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 7, date: 1700000000, text: "hello", from: { id: 111, is_bot: false, first_name: "Test", language_code: "en" }, chat: { id: 111, type: "private" }, ...over },
});

function setup(envOver: Record<string, unknown> = {}) {
  const calls: { url: string; body: any }[] = [];
  const brain = vi.fn(async () => Response.json({ ignored: true }));
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes("/getChat")) return Response.json({ ok: true, result: { id: 111, type: "private", bio: "hi", personal_chat: { id: -100999, type: "channel" } } });
    if (url.includes("/getUserProfilePhotos")) return Response.json({ ok: true, result: { total_count: 1, photos: [[{ file_id: "f" }]] } });
    return Response.json({ ok: true });
  }));
  const env = {
    TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: brain }, ...envOver,
  } as any;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u),
  }), env);
  return { calls, brain, post };
}

const saved = (calls: { url: string; body: any }[]) => calls.filter((c) => c.url === "https://sb.test/rest/v1/channel_probe_captures").flatMap((c) => c.body);

afterEach(() => vi.unstubAllGlobals());

describe("probe reader is off by default", () => {
  it("captures nothing and calls no lookups when PROBE_MODE is unset", async () => {
    const { calls, brain, post } = setup({ PROBE_TELEGRAM_IDS: "111" });
    expect((await post(update())).status).toBe(200);
    expect(saved(calls)).toEqual([]);
    expect(calls.some((c) => c.url.includes("/getChat"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("ignores /probeid when off (goes to core-brain as before)", async () => {
    const { calls, brain, post } = setup();
    await post(update({ text: "/probeid" }));
    expect(calls.some((c) => c.url.includes("/sendMessage"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
});

describe("probe reader on", () => {
  it("saves the raw update and each lookup for an allow-listed test account, and still forwards to core-brain", async () => {
    const { calls, brain, post } = setup({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "999, 111" });
    const u = update();
    expect((await post(u)).status).toBe(200);
    const rows = saved(calls);
    expect(rows.map((r: any) => r.kind)).toEqual(["message", "lookup:getChat", "lookup:getUserProfilePhotos", "lookup:getChat(personal_chat)"]);
    expect(rows[0]).toMatchObject({ platform: "telegram", sender_id: "111", payload: u });
    expect(rows[1].payload.response.result.bio).toBe("hi");
    expect(JSON.stringify(rows)).not.toContain("SECRET-BOT-TOKEN");
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("never captures a sender who is not on the allow-list", async () => {
    const { calls, brain, post } = setup({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "999" });
    await post(update());
    expect(saved(calls)).toEqual([]);
    expect(calls.some((c) => c.url.includes("/getChat"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("never captures when the allow-list is empty", async () => {
    const { calls, post } = setup({ PROBE_MODE: "on" });
    await post(update());
    expect(saved(calls)).toEqual([]);
  });
  it("answers /probeid with the sender's own id only, without calling core-brain or saving anything", async () => {
    const { calls, brain, post } = setup({ PROBE_MODE: "on" });
    expect((await post(update({ text: "/probeid@MyPrivacyTOOL_Bot" }))).status).toBe(200);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    expect(send?.body).toEqual({ chat_id: 111, text: "Your Telegram id is 111" });
    expect(brain).not.toHaveBeenCalled();
    expect(saved(calls)).toEqual([]);
  });
  it("still answers 200 and forwards when saving fails", async () => {
    const { brain, post, calls } = setup({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "111", SUPABASE_URL: undefined });
    expect((await post(update())).status).toBe(200);
    expect(brain).toHaveBeenCalledTimes(1);
    expect(saved(calls)).toEqual([]);
  });
});

describe("helpers", () => {
  it("telegramSender accepts private user messages only", () => {
    expect(telegramSender(update())).toEqual({ id: "111", chatId: 111 });
    expect(telegramSender(update({ chat: { id: -5, type: "group" } }))).toBeNull();
    expect(telegramSender(update({ from: { id: 5, is_bot: true } }))).toBeNull();
    expect(telegramSender({ edited_message: {} })).toBeNull();
    expect(telegramSender(null)).toBeNull();
  });
  it("probeIds keeps numeric ids only", () => {
    expect([...probeIds({ PROBE_TELEGRAM_IDS: " 1, x ,22,, 3a" } as any)]).toEqual(["1", "22"]);
    expect(probeIds({} as any).size).toBe(0);
  });
  it("isProbeSender needs mode on and a listed id", () => {
    expect(isProbeSender({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "111" } as any, update())).toBe(true);
    expect(isProbeSender({ PROBE_MODE: "off", PROBE_TELEGRAM_IDS: "111" } as any, update())).toBe(false);
  });
  it("isProbeIdRequest matches only the exact command", () => {
    expect(isProbeIdRequest(update({ text: "/probeid" }))).toBe(true);
    expect(isProbeIdRequest(update({ text: "/probeid please" }))).toBe(false);
    expect(isProbeIdRequest(update({ text: "hello" }))).toBe(false);
  });
});
