// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { composeReply, replyTarget } from "./src/reply";
import { confirmedN, confirmedY, confirmPrompt, firstHexagon, unknown } from "../telegram-webhook/messages.js";

const KEYS = {
  firstHexagon: ["bot.first_hexagon.title", "bot.first_hexagon.name", "bot.first_hexagon.location", "bot.first_hexagon.phone",
    "bot.first_hexagon.email", "bot.first_hexagon.social", "bot.first_hexagon.brokers", "bot.first_hexagon.question",
    "bot.first_hexagon.reply_y", "bot.first_hexagon.reply_n"],
  confirmedYes: ["bot.confirmed_y.title", "bot.confirmed_y.generating", "bot.confirmed_y.cta", "bot.confirmed_y.duration"],
  confirmedNo: ["bot.confirmed_n.title", "bot.confirmed_n.cta", "bot.confirmed_n.duration"],
  welcome: ["bot.unknown.title", "bot.unknown.body", "bot.unknown.free"],
  confirmPrompt: ["bot.confirm_prompt"],
};

describe("composeReply", () => {
  it("matches the text the old telegram-webhook Worker sent, for every message", () => {
    expect(composeReply(KEYS.firstHexagon, "en")).toBe(firstHexagon("en"));
    expect(composeReply(KEYS.confirmedYes, "en")).toBe(confirmedY("en"));
    expect(composeReply(KEYS.confirmedNo, "en")).toBe(confirmedN("en"));
    expect(composeReply(KEYS.welcome, "en")).toBe(unknown("en"));
    expect(composeReply(KEYS.confirmPrompt, "en")).toBe(confirmPrompt("en"));
  });
  it("falls back to English for untranslated or unknown locales", () => {
    expect(composeReply(KEYS.welcome, "es")).toBe(unknown("en"));
    expect(composeReply(KEYS.welcome, "xx")).toBe(unknown("en"));
    expect(composeReply(KEYS.welcome, undefined)).toBe(unknown("en"));
  });
  it("skips unknown keys and returns empty for bad input", () => {
    expect(composeReply(["nope", 5, "bot.confirm_prompt"], "en")).toBe(confirmPrompt("en"));
    expect(composeReply(undefined, "en")).toBe("");
    expect(composeReply([], "en")).toBe("");
  });
});

describe("replyTarget", () => {
  it("returns the chat id of a message update only", () => {
    expect(replyTarget({ message: { chat: { id: 42 } } })).toBe(42);
    expect(replyTarget({ edited_message: { chat: { id: 42 } } })).toBeNull();
    expect(replyTarget({ update_id: 1 })).toBeNull();
    expect(replyTarget(null)).toBeNull();
  });
});

describe("Telegram reply flow", () => {
  const update = '{"update_id":1,"message":{"chat":{"id":4242},"text":"hi","from":{"language_code":"en"}}}';
  const brainBody = { ok: true, message_keys: KEYS.welcome, locale: "en" };
  const brain = (body: unknown = brainBody, status = 200) => ({ fetch: vi.fn(async () => Response.json(body, { status })) });
  const env = (b = brain(), extra: object = {}) => ({ TELEGRAM_WEBHOOK_SECRET: "tg", TELEGRAM_BOT_TOKEN: "123:abc", CORE_BRAIN: b, ...extra });
  const post = (e: object, body = update) =>
    worker.fetch(new Request("https://w/webhook/telegram", { method: "POST", body, headers: { "X-Telegram-Bot-Api-Secret-Token": "tg" } }), e as never);
  const telegram = () => vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true }));
  afterEach(() => vi.restoreAllMocks());

  it("sends core-brain's chosen message to the chat", async () => {
    const tg = telegram();
    expect((await post(env())).status).toBe(200);
    expect(tg).toHaveBeenCalledOnce();
    expect(tg.mock.calls[0][0]).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    const sent = JSON.parse(String((tg.mock.calls[0][1] as RequestInit).body));
    expect(sent).toEqual({ chat_id: 4242, text: unknown("en"), parse_mode: "Markdown" });
  });
  it("sends nothing when core-brain ignores the update", async () => {
    const tg = telegram();
    expect((await post(env(brain({ ok: true, ignored: true })))).status).toBe(200);
    expect(tg).not.toHaveBeenCalled();
  });
  it("sends nothing for updates without a message", async () => {
    const tg = telegram();
    expect((await post(env(), '{"update_id":2,"edited_message":{"chat":{"id":1},"text":"x"}}')).status).toBe(200);
    expect(tg).not.toHaveBeenCalled();
  });
  it("still answers 200 and skips sending when the bot token is unset", async () => {
    const tg = telegram();
    expect((await post(env(brain(), { TELEGRAM_BOT_TOKEN: undefined }))).status).toBe(200);
    expect(tg).not.toHaveBeenCalled();
  });
  it("still answers 200 when Telegram rejects or the send throws", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 403 }));
    expect((await post(env())).status).toBe(200);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    expect((await post(env())).status).toBe(200);
  });
  it("returns 502 and sends nothing when core-brain fails, so Telegram retries", async () => {
    const tg = telegram();
    expect((await post(env(brain({ error: "x" }, 500)))).status).toBe(502);
    expect(tg).not.toHaveBeenCalled();
  });
  it("hands the send to waitUntil when an execution context exists", async () => {
    const tg = telegram();
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    const req = new Request("https://w/webhook/telegram", { method: "POST", body: update, headers: { "X-Telegram-Bot-Api-Secret-Token": "tg" } });
    expect((await worker.fetch(req, env() as never, ctx as never)).status).toBe(200);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(tg).toHaveBeenCalledOnce();
  });
});
