// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import type { Env } from "./src/shared";
import { isProbeIdRequest, isProbeSender, lookupHours, probeIds, probeMode, retentionDays, telegramSender, updateActor } from "./src/probe-reader";

interface Call { url: string; body: unknown }
interface SavedRow { kind: string; sender_id: string; expires_at: string; payload: { response: { result: { bio?: string; file_path?: string } } } }
const asEnv = (o: object) => o as unknown as Env;

const TOKEN = "123:SECRET-BOT-TOKEN";
const update = (over: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 7, date: 1700000000, text: "hello", from: { id: 111, is_bot: false, first_name: "Test", language_code: "en" }, chat: { id: 111, type: "private" }, ...over },
});

interface Opts { recent?: boolean; throttleStatus?: number; telegramThrows?: boolean; saveThrows?: boolean; brainOk?: boolean }

function setup(envOver: Record<string, unknown> = {}, opts: Opts = {}) {
  const calls: Call[] = [];
  const brain = vi.fn(async () => Response.json({ ignored: true }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.startsWith("https://sb.test/rest/v1/channel_probe_captures?")) {
      if (opts.throttleStatus) return new Response("err", { status: opts.throttleStatus });
      return Response.json(opts.recent ? [{ id: "x" }] : []);
    }
    if (opts.saveThrows && url === "https://sb.test/rest/v1/channel_probe_captures") throw new Error("db down");
    if (opts.telegramThrows && url.includes("api.telegram.org")) throw new Error("tg down");
    if (url.includes("/getFile")) return Response.json({ ok: true, result: { file_id: (body as { file_id: string }).file_id, file_path: `photos/${(body as { file_id: string }).file_id}.jpg` } });
    if (url.includes("/getChat")) return Response.json({ ok: true, result: { id: 111, type: "private", bio: "hi", personal_chat: { id: -100999, type: "channel" } } });
    if (url.includes("/getUserProfilePhotos")) return Response.json({ ok: true, result: { total_count: 1, photos: [[{ file_id: "f-small", width: 90, height: 90 }, { file_id: "f", width: 640, height: 640 }]] } });
    return Response.json({ ok: true });
  }));
  const env = {
    TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: brain }, ...envOver,
  } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u),
  }), env);
  return { calls, brain, post };
}

const saved = (calls: Call[]): SavedRow[] => calls.filter((c) => c.url === "https://sb.test/rest/v1/channel_probe_captures").flatMap((c) => c.body as SavedRow[]);

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
    expect(rows.map((r) => r.kind)).toEqual(["message", "lookup:getChat", "lookup:getUserProfilePhotos", "lookup:getChat(personal_chat)"]);
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
    expect([...probeIds(asEnv({ PROBE_TELEGRAM_IDS: " 1, x ,22,, 3a" }))]).toEqual(["1", "22"]);
    expect(probeIds(asEnv({})).size).toBe(0);
  });
  it("isProbeSender needs mode on and a listed id", () => {
    expect(isProbeSender(asEnv({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "111" }), update())).toBe(true);
    expect(isProbeSender(asEnv({ PROBE_MODE: "off", PROBE_TELEGRAM_IDS: "111" }), update())).toBe(false);
  });
  it("isProbeIdRequest matches only the exact command", () => {
    expect(isProbeIdRequest(update({ text: "/probeid" }))).toBe(true);
    expect(isProbeIdRequest(update({ text: "/probeid please" }))).toBe(false);
    expect(isProbeIdRequest(update({ text: "hello" }))).toBe(false);
  });
});

const kinds = (rows: SavedRow[]) => rows.map((r) => r.kind);

describe("probe reader mode all", () => {
  const all = { PROBE_MODE: "all" };
  it("captures a sender who is not on any allow-list, with the full lookup set and a 90 day expiry", async () => {
    const { calls, brain, post } = setup(all);
    const u = update();
    const before = Date.now();
    expect((await post(u)).status).toBe(200);
    const rows = saved(calls);
    expect(kinds(rows).sort()).toEqual(["lookup:getChat", "lookup:getChat(personal_chat)", "lookup:getFile", "lookup:getUserPersonalChatMessages", "lookup:getUserProfileAudios", "lookup:getUserProfilePhotos", "update"]);
    expect(rows.find((r) => r.kind === "update")).toMatchObject({ platform: "telegram", sender_id: "111", payload: u });
    const days = (Date.parse(rows[0].expires_at) - before) / 86_400_000;
    expect(days).toBeGreaterThan(89.99);
    expect(days).toBeLessThan(90.01);
    expect(rows.every((r) => typeof r.expires_at === "string")).toBe(true);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("uses the wider lookup parameters and getFile on the largest photo only as metadata (no download)", async () => {
    const { calls, post } = setup(all);
    await post(update());
    const tg = (m: string) => calls.find((c) => c.url.includes(`/${m}`))?.body;
    expect(tg("getUserProfilePhotos")).toEqual({ user_id: 111, limit: 100 });
    expect(tg("getUserProfileAudios")).toEqual({ user_id: 111 });
    expect(tg("getUserPersonalChatMessages")).toEqual({ user_id: 111, limit: 20 });
    expect(tg("getFile")).toEqual({ file_id: "f" });
    expect(calls.some((c) => c.url.includes("/file/bot"))).toBe(false);
    const fileRow = saved(calls).find((r) => r.kind === "lookup:getFile");
    expect(fileRow.payload.response.result.file_path).toBe("photos/f.jpg");
  });
  it("does not handle /probeid in this mode (goes to core-brain)", async () => {
    const { calls, brain, post } = setup(all);
    await post(update({ text: "/probeid" }));
    expect(calls.some((c) => c.url.includes("/sendMessage"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("skips bots", async () => {
    const { calls, brain, post } = setup(all);
    await post(update({ from: { id: 5, is_bot: true } }));
    expect(saved(calls)).toEqual([]);
    expect(calls.some((c) => c.url.includes("api.telegram.org"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("captures callback_query and message_reaction senders, and getChatMember for a group chat", async () => {
    const cb = { update_id: 2, callback_query: { id: "c", from: { id: 222, is_bot: false }, message: { message_id: 1, chat: { id: -500, type: "supergroup" } }, data: "x" } };
    const a = setup(all);
    await a.post(cb);
    expect(saved(a.calls).every((r) => r.sender_id === "222")).toBe(true);
    expect(a.calls.find((c) => c.url.includes("/getChatMember"))?.body).toEqual({ chat_id: -500, user_id: 222 });
    expect(kinds(saved(a.calls))).toContain("lookup:getChatMember");
    const b = setup(all);
    await b.post({ update_id: 3, message_reaction: { chat: { id: 5, type: "private" }, user: { id: 333 }, date: 1 } });
    expect(saved(b.calls)[0]).toMatchObject({ sender_id: "333", kind: "update" });
    expect(b.calls.some((c) => c.url.includes("/getChatMember"))).toBe(false);
  });
  it("updateActor reads every supported update type and rejects bots / non-numeric ids", () => {
    const user = { id: 9, is_bot: false };
    for (const t of ["message", "edited_message", "callback_query", "inline_query", "chosen_inline_result", "my_chat_member", "chat_member", "chat_join_request", "business_message", "edited_business_message", "shipping_query", "pre_checkout_query"]) {
      expect(updateActor({ [t]: { from: user } })?.id).toBe("9");
    }
    expect(updateActor({ message_reaction: { user } })?.id).toBe("9");
    expect(updateActor({ poll_answer: { user } })?.id).toBe("9");
    expect(updateActor({ poll_answer: { voter_chat: { id: 1 } } })).toBeNull();
    expect(updateActor({ message: { from: { id: "9" } } })).toBeNull();
    expect(updateActor({ message: { from: { id: 9, is_bot: true } } })).toBeNull();
    expect(updateActor({ channel_post: { chat: { id: 1 } } })).toBeNull();
    expect(updateActor(null)).toBeNull();
  });
  it("throttles lookups for a sender seen within PROBE_LOOKUP_HOURS but still saves the raw update", async () => {
    const { calls, post } = setup(all, { recent: true });
    await post(update());
    expect(kinds(saved(calls))).toEqual(["update"]);
    expect(calls.some((c) => c.url.includes("/getChat"))).toBe(false);
    const check = calls.find((c) => c.url.includes("channel_probe_captures?"));
    expect(check?.url).toContain("sender_id=eq.111");
    expect(check?.url).toContain("kind=eq.lookup%3AgetChat");
  });
  it("fails open to doing the lookups when the throttle check errors", async () => {
    const a = setup(all, { throttleStatus: 500 });
    await a.post(update());
    expect(kinds(saved(a.calls))).toContain("lookup:getChat");
    const b = setup({ ...all, SUPABASE_URL: "https://sb.test" }, { throttleStatus: 503 });
    expect((await b.post(update())).status).toBe(200);
  });
  it("applies the retention clamp and the throttle-hours fallback", () => {
    expect(retentionDays(asEnv({}))).toBe(90);
    expect(retentionDays(asEnv({ PROBE_RETENTION_DAYS: "30" }))).toBe(30);
    expect(retentionDays(asEnv({ PROBE_RETENTION_DAYS: "0" }))).toBe(1);
    expect(retentionDays(asEnv({ PROBE_RETENTION_DAYS: "9999" }))).toBe(365);
    expect(retentionDays(asEnv({ PROBE_RETENTION_DAYS: "abc" }))).toBe(90);
    expect(lookupHours(asEnv({}))).toBe(24);
    expect(lookupHours(asEnv({ PROBE_LOOKUP_HOURS: "6" }))).toBe(6);
    expect(lookupHours(asEnv({ PROBE_LOOKUP_HOURS: "-1" }))).toBe(24);
  });
  it("sets the clamped expiry on saved rows", async () => {
    const { calls, post } = setup({ ...all, PROBE_RETENTION_DAYS: "9999" });
    const before = Date.now();
    await post(update());
    const days = (Date.parse(saved(calls)[0].expires_at) - before) / 86_400_000;
    expect(days).toBeGreaterThan(364.99);
    expect(days).toBeLessThan(365.01);
  });
  it("never writes the bot token into a saved row", async () => {
    const { calls, post } = setup(all);
    await post(update());
    expect(JSON.stringify(saved(calls))).not.toContain("SECRET-BOT-TOKEN");
  });
  it("still returns 200 and forwards when every Telegram call fails", async () => {
    const { calls, brain, post } = setup(all, { telegramThrows: true });
    expect((await post(update())).status).toBe(200);
    expect(brain).toHaveBeenCalledTimes(1);
    expect(kinds(saved(calls))).toContain("update");
  });
  it("still returns 200 and forwards when the save throws", async () => {
    const { brain, post } = setup(all, { saveThrows: true });
    expect((await post(update())).status).toBe(200);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("only saves the raw update when the bot token is unset", async () => {
    const { calls, post } = setup({ ...all, TELEGRAM_BOT_TOKEN: undefined });
    await post(update());
    expect(kinds(saved(calls))).toEqual(["update"]);
  });
  it.each([undefined, "off", "ALL", "true", ""])("does nothing for PROBE_MODE=%s", async (mode) => {
    const { calls, brain, post } = setup({ PROBE_MODE: mode });
    await post(update());
    expect(saved(calls)).toEqual([]);
    expect(calls.some((c) => c.url.includes("api.telegram.org"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
    expect(probeMode(asEnv({ PROBE_MODE: mode }))).toBe("off");
  });
  it("isProbeSender in all mode needs only a non-bot actor", () => {
    expect(isProbeSender(asEnv({ PROBE_MODE: "all" }), update())).toBe(true);
    expect(isProbeSender(asEnv({ PROBE_MODE: "all" }), update({ from: { id: 1, is_bot: true } }))).toBe(false);
  });
});
