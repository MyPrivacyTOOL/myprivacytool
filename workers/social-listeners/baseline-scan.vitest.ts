// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { buildReport, isConsentConfirmation, RISK_VERSION, stripFileIds } from "./src/baseline-scan";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000001; // synthetic, never a real account
interface Call { url: string; body: Record<string, any> }
const yes = (over: Record<string, unknown> = {}, updateId = 10) => ({
  update_id: updateId,
  message: { message_id: 7, date: 1700000000, text: "Y", from: { id: ID, is_bot: false, first_name: "Test", language_code: "en" }, chat: { id: ID, type: "private" }, ...over },
});
const decision = (over: Record<string, unknown> = {}) => ({
  ok: true, intent: "verify", state: "awaiting_confirmation", next_state: "confirmed", state_source: "supabase", locale: "en", message_keys: ["bot.confirmed_y.title"], ...over,
});
const CHAT = { ok: true, result: { id: ID, type: "private", first_name: "Test", username: "t_user", bio: "hello", birthdate: { day: 1, month: 2 }, accent_color_id: ID % 7, photo: { small_file_id: "SECRET-SMALL", small_file_unique_id: "u1", big_file_id: "SECRET-BIG", big_file_unique_id: "u2" } } };
const PHOTOS = { ok: true, result: { total_count: 1, photos: [[{ file_id: "SECRET-PHOTO", file_unique_id: "u1", width: 160, height: 160 }]] } };

function setup(envOver: Record<string, unknown> = {}, o: { brain?: unknown; chat?: unknown; photos?: unknown; chatStatus?: number; tgThrows?: boolean; dbStatus?: number; dbThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((m) => { logs.push(String(m)); });
  vi.spyOn(console, "warn").mockImplementation((m) => { logs.push(String(m)); });
  vi.spyOn(console, "error").mockImplementation((m) => { logs.push(String(m)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (o.tgThrows && url.includes("api.telegram.org") && !url.includes("sendMessage")) throw new Error("tg down");
    if (url.includes("/getChat")) return new Response(JSON.stringify(o.chat ?? CHAT), { status: o.chatStatus ?? 200 });
    if (url.includes("/getUserProfilePhotos")) return Response.json(o.photos ?? PHOTOS);
    if (url.includes("profile_snapshots")) { if (o.dbThrows) throw new Error("db down"); return new Response("", { status: o.dbStatus ?? 201 }); }
    return Response.json({ ok: true });
  }));
  const brain = vi.fn(async () => Response.json(o.brain ?? decision()));
  const env = {
    TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: brain }, TELEGRAM_BASELINE_SCAN: "on", PROBE_TELEGRAM_IDS: String(ID), ...envOver,
  } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  const tg = (m: string) => calls.filter((c) => c.url.includes(`/${m}`));
  const snaps = () => calls.filter((c) => c.url.includes("profile_snapshots"));
  return { calls, logs, post, tg, snaps, brain };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("baseline scan gating", () => {
  it("runs for an allow-listed sender after the consent confirmation, for that sender only", async () => {
    const { post, tg, snaps } = setup();
    expect((await post(yes())).status).toBe(200);
    expect(tg("getChat")).toHaveLength(1);
    expect(tg("getChat")[0].body).toEqual({ chat_id: String(ID) });
    expect(tg("getUserProfilePhotos")[0].body.user_id).toBe(ID);
    expect(snaps()).toHaveLength(1);
    expect(tg("sendMessage")).toHaveLength(2); // the existing Y reply, then the report
    expect(tg("sendMessage")[1].body.text).toMatch(/\/10/);
  });
  it("does nothing when the flag is off (default) or the sender is not allow-listed; existing reply unchanged", async () => {
    for (const over of [{ TELEGRAM_BASELINE_SCAN: undefined }, { PROBE_TELEGRAM_IDS: "999" }, { PROBE_TELEGRAM_IDS: undefined }]) {
      const { post, tg, snaps } = setup(over);
      await post(yes());
      expect(tg("getChat")).toHaveLength(0);
      expect(snaps()).toHaveLength(0);
      expect(tg("sendMessage")).toHaveLength(1);
    }
  });
  it("a Y outside the awaiting_confirmation state is not consent", async () => {
    for (const brain of [decision({ state: "new", next_state: "awaiting_confirmation", intent: "scan" }), decision({ state: "confirmed", next_state: "confirmed" }), decision({ state: "declined", next_state: "declined" }), decision({ state_source: "fallback", next_state: null })]) {
      const { post, tg } = setup({}, { brain });
      await post(yes());
      expect(tg("getChat")).toHaveLength(0);
    }
    expect(isConsentConfirmation(null)).toBe(false);
  });
  it("never scans a target from the message text or a group chat", async () => {
    const { post, tg } = setup();
    await post(yes({ text: "Y 12345" }));
    expect(tg("getChat")[0].body.chat_id).toBe(String(ID));
    const g = setup();
    await g.post(yes({ chat: { id: -100, type: "group" } }));
    expect(g.tg("getChat")).toHaveLength(0);
  });
  it("snapshot writes are idempotent (unique key + ignore-duplicates) for a replayed update", async () => {
    const { post, snaps } = setup();
    await post(yes());
    await post(yes());
    for (const s of snaps()) {
      expect(s.url).toContain("on_conflict=platform,sender_id,update_id");
      expect(s.body.update_id).toBe(10);
    }
  });
});

describe("failure handling", () => {
  it("a failed required call is not a successful scan: no score, a failed snapshot, honest message", async () => {
    const { post, tg, snaps } = setup({}, { chatStatus: 429, chat: { ok: false, error_code: 429 } });
    await post(yes());
    expect(snaps()[0].body.status).toBe("failed");
    expect(snaps()[0].body.score).toBeNull();
    expect(tg("sendMessage")[1].body.text).not.toMatch(/\/10/);
  });
  it("Telegram timeout/outage and database failure never fail the webhook", async () => {
    expect((await setup({}, { tgThrows: true }).post(yes())).status).toBe(200);
    const db = setup({}, { dbThrows: true });
    expect((await db.post(yes())).status).toBe(200);
    expect(db.tg("sendMessage")[1].body.text).toMatch(/\/10/); // report still sent when only storage failed
    expect((await setup({}, { dbStatus: 500 }).post(yes())).status).toBe(200);
  });
});

describe("data handling", () => {
  it("strips bot-specific file ids from the stored payload and keeps file_unique_id", async () => {
    const { post, snaps } = setup();
    await post(yes());
    const stored = JSON.stringify(snaps()[0].body);
    expect(stored).not.toMatch(/SECRET-(SMALL|BIG|PHOTO)/);
    expect(stored).toContain("u1");
    expect(stripFileIds({ a: { file_id: "x", small_file_id: "y", file_unique_id: "z" } })).toEqual({ a: { file_unique_id: "z" } });
  });
  it("never writes the bot token or file ids to logs, and stores versions + consent link", async () => {
    const { post, logs, snaps } = setup();
    await post(yes());
    expect(logs.join("\n")).not.toMatch(/SECRET/);
    const row = snaps()[0].body;
    expect(row).toMatchObject({ scan_version: "telegram-baseline-1", risk_version: RISK_VERSION, consent: { state_after: "confirmed", confirming_update_id: 10 }, sender_id: String(ID) });
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now());
  });
});

describe("report contract", () => {
  const ok = (r: unknown) => ({ status: 200, response: r });
  it("scores from the versioned ranking and keeps score and snapshot items consistent", () => {
    const full = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    const locked = buildReport(yes(), ok({ ok: true, result: { id: ID, type: "private", first_name: "T" } }), ok({ ok: true, result: { total_count: 0, photos: [] } }))!;
    expect(full.score).toBeLessThan(locked.score);
    expect(full.score).toBeGreaterThanOrEqual(0);
    expect(full.score).toBe(Math.round(Math.max(0, 10 - full.items.reduce((s, i) => s + i.penalty, 0)) * 10) / 10);
    expect(full.items.find((i) => i.field === "username")!.penalty).toBe(3);
  });
  it("makes no hidden/verified-privacy claims and keeps unsupported insights out", () => {
    const { text } = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    expect(text).not.toMatch(/✅|hidden from everyone|protected|message count|account (age|era|created)/i);
    expect(text).toMatch(/cannot inspect/);
    expect(text).not.toMatch(/SECRET|file_id/);
  });
  it("missing or partial fields degrade gracefully; failures yield null", () => {
    expect(buildReport(yes(), ok({ ok: true, result: { id: ID } }), ok({ ok: true, result: {} }))).not.toBeNull();
    expect(buildReport(yes(), { status: 0, response: { error: "x" } }, ok(PHOTOS))).toBeNull();
    expect(buildReport(yes(), ok(CHAT), { status: 200, response: { ok: false } })).toBeNull();
  });
});
