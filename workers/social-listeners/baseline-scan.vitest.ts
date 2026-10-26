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
    expect(tg("sendMessage")[1].body.text).toMatch(/risk \(draft test report\): \d+ \/ 30 - (Low|Medium|High) exposure/);
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
    expect(tg("sendMessage")[1].body.text).not.toMatch(/ \/ 30|exposure/);
  });
  it("Telegram timeout/outage and database failure never fail the webhook", async () => {
    expect((await setup({}, { tgThrows: true }).post(yes())).status).toBe(200);
    const db = setup({}, { dbThrows: true });
    expect((await db.post(yes())).status).toBe(200);
    expect(db.tg("sendMessage")[1].body.text).toMatch(/ \/ 30 - /); // report still sent when only storage failed
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
  it("risk is the number of returned hexagons out of 30 (no weights), with the website's bands", () => {
    const full = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    const locked = buildReport(yes(), ok({ ok: true, result: { id: ID, type: "private", first_name: "T" } }), ok({ ok: true, result: { total_count: 0, photos: [] } }))!;
    expect(full.risk.possible).toBe(30);
    expect(full.risk.returned).toBe(full.hexagons.filter((h) => h.state === "returned").length);
    expect(full.risk.returned).toBeGreaterThan(locked.risk.returned);
    expect(full.risk.percent).toBe(Math.round((full.risk.returned / 30) * 100));
    expect(full.risk.band).toBe(full.risk.percent >= 70 ? "high" : full.risk.percent >= 40 ? "medium" : "low");
    expect(locked.risk.band).toBe("low");
    expect(full.risk.notChecked).toBeGreaterThan(0); // disabled hexagons are reported, never counted
  });
  it("makes no hidden/verified-privacy claims and keeps unsupported insights out", () => {
    const { text } = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    expect(text).not.toMatch(/hidden from everyone|protected|message count|account (age|era|created)/i);
    expect(text).toMatch(/✅ Never sent to bots by Telegram: phone number \(unless you tap a share button\), last seen, IP address, device\./);
    expect(text).toMatch(/not a check of your own privacy settings/);
    expect(text).toMatch(/does not verify your settings|not a check of your own/);
    expect(text).not.toMatch(/SECRET|file_id/);
  });
  it("missing or partial fields degrade gracefully; failures yield null", () => {
    expect(buildReport(yes(), ok({ ok: true, result: { id: ID } }), ok({ ok: true, result: {} }))).not.toBeNull();
    expect(buildReport(yes(), { status: 0, response: { error: "x" } }, ok(PHOTOS))).toBeNull();
    expect(buildReport(yes(), ok(CHAT), { status: 200, response: { ok: false } })).toBeNull();
  });
});

describe("/scanstatus", () => {
  it("answers three yes/no lines only, never a value, and only in PROBE_MODE=on", async () => {
    const on = setup({ PROBE_MODE: "on", TELEGRAM_BASELINE_SCAN: "on" });
    await on.post(yes({ text: "/scanstatus" }));
    const text = on.tg("sendMessage")[0].body.text as string;
    expect(text).toBe("Baseline scan switch on: yes\nYour id is on the allow-list: yes\nSnapshot storage configured: yes");
    expect(text).not.toContain(String(ID));
    expect(on.brain).not.toHaveBeenCalled();
    const off = setup({ PROBE_MODE: "on", TELEGRAM_BASELINE_SCAN: undefined, PROBE_TELEGRAM_IDS: "999" });
    await off.post(yes({ text: "/scanstatus" }));
    expect(off.tg("sendMessage")[0].body.text).toMatch(/switch on: no\nYour id is on the allow-list: no/);
    const none = setup({}, {});
    await none.post(yes({ text: "/scanstatus" }));
    expect(none.tg("sendMessage")[0].body.text).not.toMatch(/allow-list/); // goes to core-brain as before when PROBE_MODE is not on
  });
});

describe("channel hexagons (TG)", () => {
  const ok = (r: unknown) => ({ status: 200, response: r });
  it("gives every one of the 30 Telegram hexagons a state, tagged with the channel code and arrival class", () => {
    const { hexagons } = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    expect(hexagons).toHaveLength(30);
    expect(hexagons.every((h) => h.channel === "TG" && h.id.startsWith("tg.") && ["A", "B", "C", "D"].includes(h.arrival))).toBe(true);
    const by = Object.fromEntries(hexagons.map((h) => [h.id, h.state]));
    expect(by["tg.numeric_id"]).toBe("returned");
    expect(by["tg.bio"]).toBe("returned");
    expect(by["tg.birthday"]).toBe("returned");
    expect(by["tg.business_hours"]).toBe("not_returned"); // successful check, field absent: never "hidden"
    expect(by["tg.message_counter"]).toBe("not_checked"); // disabled until measured
    expect(by["tg.phone_shared"]).toBe("not_checked"); // no share button exists
    expect(by["tg.group_role"]).toBe("not_checked");
  });
  it("a locked-down account returns far fewer hexagons than a public one, and the summary says which tool and how many", () => {
    const locked = buildReport(yes(), ok({ ok: true, result: { id: ID, type: "private", first_name: "T" } }), ok({ ok: true, result: { total_count: 0, photos: [] } }))!;
    const full = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    const n = (r: { hexagons: { state: string }[] }) => r.hexagons.filter((h) => h.state === "returned").length;
    expect(n(locked)).toBeLessThan(n(full));
    expect(full.text).toMatch(/\d+ \/ 30/);
    expect(full.text).toMatch(/\[A\] Sent with every message: \d+ of 8/);
    expect(full.text).toMatch(/\[B\] Public profile lookup: \d+ of 17/);
  });
  it("stores the hexagon states and channel code in the snapshot report", async () => {
    const { post, snaps } = setup();
    await post(yes());
    const report = snaps()[0].body.report;
    expect(report.channel).toBe("TG");
    expect(report.risk).toMatchObject({ possible: 30 });
    expect(report.never_sent).toContain("last seen");
    expect(snaps()[0].body.score).toBeNull();
    expect(snaps()[0].body.risk_version).toBe("risk-count-1");
    expect(report.hexagons).toHaveLength(30);
    expect(JSON.stringify(report)).not.toMatch(/SECRET/);
  });
});
