// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { logRetentionDays, loggedSender, optInIds, resolveSession } from "./src/event-log";
import worker from "./src/index";
import type { Env } from "./src/shared";

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
interface LogRow { direction: "in" | "out" | "brain"; kind: string; sender_id: string; chat_id: string; update_id: number | null; session_id: string; payload: unknown; expires_at: string | null }
interface Out { method: string; request: unknown; status: number; response: unknown }

const TOKEN = "123:SECRET-BOT-TOKEN";
const LOG_URL = "https://sb.test/rest/v1/telegram_event_log";
const asEnv = (o: object) => o as unknown as Env;
const update = (id = 1, from = 111) => ({
  update_id: id,
  message: { message_id: 7, date: 1700000000, text: "hello", from: { id: from, is_bot: false, first_name: "Test" }, chat: { id: from, type: "private" } },
});

interface Opts { previous?: { session_id: string; created_at: string }; lookupStatus?: number; insertThrows?: boolean; brain?: () => Response | Promise<Response> }

function setup(envOver: Record<string, unknown> = {}, opts: Opts = {}) {
  const calls: Call[] = [];
  const stored = new Map<string, LogRow>(); // what the database keeps: unique (direction, update_id, kind) where update_id is not null
  const brain = vi.fn(opts.brain ?? (async () => Response.json({ message_keys: ["bot.unknown.title"], locale: "en" })));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith(`${LOG_URL}?`)) {
      if (opts.lookupStatus) return new Response("err", { status: opts.lookupStatus });
      return Response.json(opts.previous ? [opts.previous] : []);
    }
    if (url === LOG_URL) {
      if (opts.insertThrows) throw new Error("db down");
      const row = calls[calls.length - 1].body as LogRow;
      const key = row.update_id === null ? `null:${stored.size}` : `${row.direction}|${row.update_id}|${row.kind}`;
      if (!stored.has(key)) stored.set(key, row); // ON CONFLICT DO NOTHING
      return new Response(null, { status: 201 });
    }
    if (url.includes("/getChat")) return Response.json({ ok: true, result: { id: 111, type: "private", bio: "hi" } });
    if (url.includes("/getUserProfilePhotos")) return Response.json({ ok: true, result: { total_count: 0, photos: [] } });
    return Response.json({ ok: true, result: { message_id: 99 } });
  }));
  const env = asEnv({ TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc", CORE_BRAIN: { fetch: brain }, ...envOver });
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  return { calls, brain, post, stored: () => [...stored.values()] };
}

const inserts = (calls: Call[]): Call[] => calls.filter((c) => c.url === LOG_URL);
const rows = (calls: Call[]): LogRow[] => inserts(calls).map((c) => c.body as LogRow);
const byDirection = (calls: Call[], d: LogRow["direction"]): LogRow[] => rows(calls).filter((r) => r.direction === d);
const asOut = (r: LogRow): Out => r.payload as Out;

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const ON = { PROBE_MODE: "on" };

describe("scope", () => {
  it("logs an allow-listed sender with a session id", async () => {
    const { calls, post } = setup({ ...ON, PROBE_TELEGRAM_IDS: "111" });
    const u = update();
    expect((await post(u)).status).toBe(200);
    const inbound = byDirection(calls, "in");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ kind: "message", sender_id: "111", chat_id: "111", update_id: 1, session_id: "111:111:1", payload: u });
  });
  it("logs an opted-in sender who is not on the allow-list", async () => {
    const { calls, post } = setup({ ...ON, PROBE_TELEGRAM_IDS: "999", PROBE_LOG_OPTIN_IDS: "5, 111" });
    await post(update());
    expect(byDirection(calls, "in")).toMatchObject([{ sender_id: "111", session_id: "111:111:1" }]);
  });
  it("does not log an unlisted sender in mode on", async () => {
    const { calls, brain, post } = setup({ ...ON, PROBE_TELEGRAM_IDS: "999", PROBE_LOG_OPTIN_IDS: "998" });
    expect((await post(update())).status).toBe(200);
    expect(inserts(calls)).toEqual([]);
    expect(calls.some((c) => c.url.startsWith(LOG_URL))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("does not log in mode all, even for allow-listed and opted-in senders (no in, out or brain rows)", async () => {
    const { calls, post } = setup({ PROBE_MODE: "all", PROBE_TELEGRAM_IDS: "111", PROBE_LOG_OPTIN_IDS: "111" });
    await post(update());
    expect(calls.some((c) => c.url.startsWith(LOG_URL))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/channel_probe_captures"))).toBe(true); // PR 366 behaviour is untouched
  });
  it("mode off does nothing", async () => {
    const { calls, brain, post } = setup({ PROBE_TELEGRAM_IDS: "111", PROBE_LOG_OPTIN_IDS: "111" });
    expect((await post(update())).status).toBe(200);
    expect(calls.some((c) => c.url.includes("supabase") || c.url.includes("sb.test"))).toBe(false);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("logs every update type updateActor supports, untrimmed, with a chat id (the sender id when the update has no chat)", async () => {
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    const cb = { update_id: 2, callback_query: { id: "c", from: { id: 111, is_bot: false }, message: { message_id: 1, chat: { id: -500, type: "supergroup" } }, data: "x", extra: { deep: [1, 2, 3] } } };
    const inline = { update_id: 3, inline_query: { id: "q", from: { id: 111, is_bot: false }, query: "hi", offset: "" } };
    const reaction = { update_id: 4, message_reaction: { chat: { id: 5, type: "private" }, user: { id: 111 }, date: 1, new_reaction: [] } };
    for (const u of [cb, inline, reaction]) await post(u);
    const inbound = byDirection(calls, "in");
    expect(inbound.map((r) => [r.kind, r.chat_id])).toEqual([["callback_query", "-500"], ["inline_query", "111"], ["message_reaction", "5"]]);
    expect(inbound.map((r) => r.payload)).toEqual([cb, inline, reaction]);
  });
  it("ignores bots", async () => {
    const { calls, post } = setup({ ...ON, PROBE_TELEGRAM_IDS: "111" });
    const u = update();
    u.message.from.is_bot = true;
    await post(u);
    expect(inserts(calls)).toEqual([]);
  });
});

describe("outbound and brain rows", () => {
  it("stores the sendMessage request, status and response, and the bot token appears in no row", async () => {
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    await post(update());
    const out = byDirection(calls, "out");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "sendMessage", update_id: 1, session_id: "111:111:1", chat_id: "111" });
    expect(asOut(out[0])).toMatchObject({ method: "sendMessage", status: 200, request: { chat_id: 111, parse_mode: "Markdown" }, response: { ok: true, result: { message_id: 99 } } });
    expect(JSON.stringify(rows(calls))).not.toContain("SECRET-BOT-TOKEN");
    expect(JSON.stringify(calls.filter((c) => c.url === LOG_URL))).not.toContain("SECRET-BOT-TOKEN");
  });
  it("scrubs the token even if Telegram were to echo it back", async () => {
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/sendMessage")) return Response.json({ ok: false, description: `bad ${TOKEN}` }, { status: 400 });
      return real(input, init);
    }));
    await post(update());
    const out = byDirection(calls, "out");
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0])).toContain("[redacted]");
    expect(JSON.stringify(out[0])).not.toContain("SECRET-BOT-TOKEN");
  });
  it("logs the probe lookups made for a logged chat as out rows, repeated methods suffixed", async () => {
    const { calls, post } = setup({ ...ON, PROBE_TELEGRAM_IDS: "111" });
    await post(update());
    const kinds = byDirection(calls, "out").map((r) => r.kind).sort();
    expect(kinds).toEqual(["getChat", "getUserProfilePhotos", "sendMessage"]);
  });
  it("stores a /probeid reply as an out row", async () => {
    const { calls, brain, post } = setup({ ...ON, PROBE_TELEGRAM_IDS: "111" });
    const u = update();
    u.message.text = "/probeid";
    await post(u);
    expect(byDirection(calls, "out").map((r) => r.kind)).toEqual(["sendMessage"]);
    expect(brain).not.toHaveBeenCalled();
  });
  it("links the brain row to the update by update_id and session", async () => {
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    await post(update(42));
    const brainRows = byDirection(calls, "brain");
    expect(brainRows).toHaveLength(1);
    expect(brainRows[0]).toMatchObject({ kind: "core-brain", update_id: 42, session_id: "111:111:1", payload: { outcome: "ok", status: 200, body: { message_keys: ["bot.unknown.title"], locale: "en" } } });
    expect(new Set(rows(calls).map((r) => r.update_id))).toEqual(new Set([42]));
  });
  it("logs a core-brain failure as decision_unavailable and still returns 502 as before", async () => {
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" }, { brain: () => new Response("no", { status: 500 }) });
    expect((await post(update())).status).toBe(502);
    expect(byDirection(calls, "brain")).toMatchObject([{ kind: "decision_unavailable", payload: { outcome: "unavailable" } }]);
  });
  it("a successful retry of a failed update_id still logs its decision and out rows", async () => {
    let attempt = 0;
    const { post, stored } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" }, {
      brain: () => (++attempt === 1 ? new Response("down", { status: 502 }) : Response.json({ message_keys: ["bot.unknown.title"], locale: "en" })),
    });
    expect((await post(update(77))).status).toBe(502); // first attempt: core-brain is down, Telegram will retry
    expect((await post(update(77))).status).toBe(200); // retry succeeds
    const keys = stored().map((r) => `${r.direction}|${r.kind}`).sort();
    expect(keys).toEqual(["brain|core-brain", "brain|decision_unavailable", "in|message", "out|sendMessage"]); // one inbound, both decisions, the reply
    expect(stored().every((r) => r.update_id === 77 && r.session_id === "111:111:1")).toBe(true);
  });
});

describe("dedupe", () => {
  it("inserts with ON CONFLICT DO NOTHING so a retried update_id is not duplicated", async () => {
    const { calls, post, stored } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    await post(update(7));
    const once = stored().length;
    await post(update(7));
    expect(stored()).toHaveLength(once); // the second delivery adds nothing
    const ins = inserts(calls);
    expect(ins.length).toBeGreaterThan(0);
    expect(ins.every((c) => c.method === "POST" && c.headers.Prefer.includes("resolution=ignore-duplicates"))).toBe(true);
    // Both deliveries send the same natural key; the database's unique index (direction, update_id, kind) keeps one.
    const keys = rows(calls).map((r) => `${r.direction}|${r.update_id}|${r.kind}`);
    const first = keys.slice(0, keys.length / 2);
    expect(keys.slice(keys.length / 2)).toEqual(first);
  });
});

describe("sessions", () => {
  const prefix = "111:111:";
  it("starts at 1, continues within 30 minutes, rolls over after 30 minutes of silence", async () => {
    const env = asEnv({ SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc" });
    const now = Date.parse("2026-10-15T12:00:00Z");
    const withPrev = (ageMin: number, session_id = `${prefix}3`) => {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ session_id, created_at: new Date(now - ageMin * 60_000).toISOString() }])));
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    expect(await resolveSession(env, "111", "111", now)).toBe(`${prefix}1`);
    withPrev(29);
    expect(await resolveSession(env, "111", "111", now)).toBe(`${prefix}3`);
    withPrev(31);
    expect(await resolveSession(env, "111", "111", now)).toBe(`${prefix}4`);
  });
  it("rolls over end to end after 30 minutes", async () => {
    const old = { session_id: "111:111:2", created_at: new Date(Date.now() - 31 * 60_000).toISOString() };
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" }, { previous: old });
    await post(update());
    expect(new Set(rows(calls).map((r) => r.session_id))).toEqual(new Set(["111:111:3"]));
  });
  it("keeps the session within 30 minutes end to end", async () => {
    const recent = { session_id: "111:111:2", created_at: new Date(Date.now() - 5 * 60_000).toISOString() };
    const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" }, { previous: recent });
    await post(update());
    expect(new Set(rows(calls).map((r) => r.session_id))).toEqual(new Set(["111:111:2"]));
  });
  it("fails open to a new session when the lookup errors or the old id is unreadable", async () => {
    const now = 1_800_000_000_000;
    const env = asEnv({ SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc" });
    const fresh = `${prefix}${Math.floor(now / 1000)}`;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await resolveSession(env, "111", "111", now)).toBe(fresh);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    expect(await resolveSession(env, "111", "111", now)).toBe(fresh);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ session_id: "garbage", created_at: new Date(now).toISOString() }])));
    expect(await resolveSession(env, "111", "111", now)).toBe(fresh);
  });
});

describe("retention", () => {
  it("defaults to 90 days, clamps to 1-365, and accepts forever", () => {
    expect(logRetentionDays(asEnv({}))).toBe(90);
    expect(logRetentionDays(asEnv({ PROBE_LOG_RETENTION_DAYS: "abc" }))).toBe(90);
    expect(logRetentionDays(asEnv({ PROBE_LOG_RETENTION_DAYS: "30" }))).toBe(30);
    expect(logRetentionDays(asEnv({ PROBE_LOG_RETENTION_DAYS: "0" }))).toBe(1);
    expect(logRetentionDays(asEnv({ PROBE_LOG_RETENTION_DAYS: "-5" }))).toBe(1);
    expect(logRetentionDays(asEnv({ PROBE_LOG_RETENTION_DAYS: "9999" }))).toBe(365);
    expect(logRetentionDays(asEnv({ PROBE_LOG_RETENTION_DAYS: " Forever " }))).toBeNull();
  });
  it("writes expires_at accordingly: 90 days by default, a clamped value, null for forever", async () => {
    const days = async (v?: string): Promise<string | null> => {
      const { calls, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111", PROBE_LOG_RETENTION_DAYS: v });
      const before = Date.now();
      await post(update());
      const at = rows(calls)[0].expires_at;
      return at === null ? null : ((Date.parse(at) - before) / 86_400_000).toFixed(1);
    };
    expect(await days()).toBe("90.0");
    expect(await days("9999")).toBe("365.0");
    expect(await days("forever")).toBeNull();
  });
});

describe("failures never break the webhook", () => {
  it("returns 200 and forwards when every log write throws", async () => {
    const { calls, brain, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" }, { insertThrows: true, lookupStatus: 500 });
    expect((await post(update())).status).toBe(200);
    expect(brain).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.includes("/sendMessage"))).toBe(true);
  });
  it("returns 200 and forwards when storage is not configured", async () => {
    const { brain, post } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111", SUPABASE_URL: undefined });
    expect((await post(update())).status).toBe(200);
    expect(brain).toHaveBeenCalledTimes(1);
  });
  it("uses ctx.waitUntil so log writes do not hold the response", async () => {
    const { post: _p, ...rest } = setup({ ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    void _p;
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const env = asEnv({ TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc", CORE_BRAIN: { fetch: rest.brain }, ...ON, PROBE_LOG_OPTIN_IDS: "111" });
    const res = await worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(update()) }), env, ctx);
    expect(res.status).toBe(200);
    expect(waited.length).toBeGreaterThan(0);
    await Promise.all(waited);
    expect(rest.calls.filter((c) => c.url === LOG_URL).length).toBeGreaterThanOrEqual(3); // in, brain, out
  });
});

describe("helpers", () => {
  it("optInIds keeps numeric ids only; loggedSender needs mode on and a listed id", () => {
    expect([...optInIds(asEnv({ PROBE_LOG_OPTIN_IDS: " 1, x ,22,, 3a" }))]).toEqual(["1", "22"]);
    expect(loggedSender(asEnv({ PROBE_MODE: "on", PROBE_LOG_OPTIN_IDS: "111" }), update())).toBe("111");
    expect(loggedSender(asEnv({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "111" }), update())).toBe("111");
    expect(loggedSender(asEnv({ PROBE_MODE: "all", PROBE_TELEGRAM_IDS: "111" }), update())).toBeNull();
    expect(loggedSender(asEnv({ PROBE_MODE: "on" }), update())).toBeNull();
    expect(loggedSender(asEnv({ PROBE_MODE: "on", PROBE_TELEGRAM_IDS: "111" }), null)).toBeNull();
  });
});
