// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-7894 gate 3: Telegram sender ids stored as a keyed hash when TELEGRAM_ID_HMAC_KEY is set. Synthetic ids, stubbed fetch only.
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { RISK_VERSION, SCAN_VERSION, hexagonStates } from "./src/baseline-scan";
import { redactStoredId, senderFilter, senderIds, senderKey } from "./src/sender-key";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000007;
const KEY = "k".repeat(40);
const HASH = "h1:" + createHmac("sha256", KEY).update(`telegram:${ID}`).digest("hex");
const B8 = "aaaaaaaa";
const BASE_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const from = { id: ID, is_bot: false, first_name: "T", username: "synthetic_user" };
const CHAT = { id: ID, first_name: "T", username: "synthetic_user", bio: "my bio", photo: { small_file_id: "SECRET" } };
const PHOTOS = { total_count: 1, photos: [[{ file_unique_id: "u1", width: 1, height: 1 }]] };
const baseline = () => ({ id: BASE_ID, created_at: "2026-10-26T14:24:10Z", scan_version: SCAN_VERSION, risk_version: RISK_VERSION, sender_id: HASH, report: { channel: "TG", hexagons: hexagonStates({ update_id: 1, message: { from } }, CHAT, PHOTOS.photos) } });

interface Call { url: string; method: string; body: any }
function setup(envOver: Record<string, unknown> = {}, o: { snaps?: any[] } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((m) => { logs.push(String(m)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("api.telegram.org")) {
      if (url.endsWith("/getChat")) return Response.json({ ok: true, result: CHAT });
      if (url.endsWith("/getUserProfilePhotos")) return Response.json({ ok: true, result: PHOTOS });
      return Response.json({ ok: true, result: {} });
    }
    if (url.includes("/rpc/")) return Response.json(1);
    if (url.includes("/rest/v1/conversation_states")) return Response.json([{ state: "confirmed" }]);
    if (url.includes("/rest/v1/profile_snapshots")) {
      if (method === "GET") return Response.json(url.includes(`scan_version=eq.${SCAN_VERSION}`) || url.includes("select=id,sender_id") ? (o.snaps ?? [baseline()]) : []);
      return Response.json([{ id: "rrrrrrrr-0000-0000-0000-000000000000" }], { status: 201 });
    }
    if (url.includes("/rest/v1/fix_wizard_items")) return method === "GET" ? Response.json([]) : new Response("", { status: 201 });
    if (url.includes("/rest/v1/dashboard_links")) return method === "GET" ? Response.json([]) : new Response("", { status: 201 });
    return Response.json({ ok: true });
  }));
  const brain = vi.fn(async () => Response.json({ ok: true, ignored: true }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc", CORE_BRAIN: { fetch: brain },
    PROBE_TELEGRAM_IDS: String(ID), TELEGRAM_FIX_WIZARD: "on", TELEGRAM_DASHBOARD_LINKS: "on", ...envOver } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  const msg = (text: string, uid: number) => ({ update_id: uid, message: { message_id: 7, date: 1700000000, text, from, chat: { id: ID, type: "private" } } });
  const cb = (data: string, uid: number) => ({ update_id: uid, callback_query: { id: `cbq${uid}`, from, data, message: { message_id: 55, chat: { id: ID, type: "private" } } } });
  return { calls, logs, post, msg, cb, brain, writes: () => calls.filter((c) => c.method !== "GET" && c.url.includes("sb.test")) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("senderKey", () => {
  it("is the plain id when no key is set (default, test accounts)", async () => {
    expect(await senderKey({} as Env, String(ID))).toBe(String(ID));
    expect(await senderKey({ TELEGRAM_ID_HMAC_KEY: "" } as Env, String(ID))).toBe(String(ID));
    expect(await senderIds({} as Env, String(ID))).toEqual({ plain: String(ID), key: String(ID), read: [String(ID)] });
  });
  it("is h1: plus the HMAC-SHA256 of telegram:<id> under the secret, deterministic, per id and per key, without the id in it", async () => {
    const env = { TELEGRAM_ID_HMAC_KEY: KEY } as Env;
    expect(await senderKey(env, String(ID))).toBe(HASH);
    expect(await senderKey(env, String(ID))).toBe(HASH);
    expect(HASH).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(HASH).not.toContain(String(ID));
    expect(await senderKey(env, String(ID + 1))).not.toBe(HASH);
    expect(await senderKey({ TELEGRAM_ID_HMAC_KEY: "z".repeat(40) } as Env, String(ID))).not.toBe(HASH);
    expect(await senderIds(env, String(ID))).toEqual({ plain: String(ID), key: HASH, read: [HASH, String(ID)] });
  });
  it("throws on a too-short key and never falls back to the plain id", async () => {
    await expect(senderKey({ TELEGRAM_ID_HMAC_KEY: "short" } as Env, String(ID))).rejects.toThrow(/misconfigured/);
  });
  it("builds eq for one key and in.(...) for the key plus the legacy id", () => {
    expect(senderFilter(["1"])).toBe("sender_id=eq.1");
    expect(senderFilter([HASH, "1"])).toBe(`sender_id=in.(%22${HASH}%22,%221%22)`);
  });
  it("drops only the numeric id from a stored getChat answer, and only when hashing is on", () => {
    const ans = { status: 200, response: { ok: true, result: { id: ID, username: "u", bio: "b" } } };
    expect(redactStoredId(ans, {} as Env)).toBe(ans);
    expect(redactStoredId(ans, { TELEGRAM_ID_HMAC_KEY: KEY } as Env)).toEqual({ status: 200, response: { ok: true, result: { username: "u", bio: "b" } } });
    expect(ans.response.result.id).toBe(ID);
  });
});

describe("baseline scan with hashing on", () => {
  const consent = { ok: true, intent: "verify", state: "awaiting_confirmation", next_state: "confirmed", state_source: "supabase", locale: "en", message_keys: ["bot.confirmed_y.title"] };
  const yes = (uid: number) => ({ update_id: uid, message: { message_id: 7, date: 1700000000, text: "Y", from, chat: { id: ID, type: "private" } } });
  it("stores the hash as sender_id, no plain id in that column or the stored getChat, and still calls Telegram with the plain id", async () => {
    const t = setup({ TELEGRAM_BASELINE_SCAN: "on", TELEGRAM_ID_HMAC_KEY: KEY });
    t.brain.mockResolvedValue(Response.json(consent));
    await t.post(yes(10));
    const row = t.writes().find((c) => c.url.includes("profile_snapshots"))!.body;
    expect(row.sender_id).toBe(HASH);
    expect(row.get_chat.response.result.id).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(`"sender_id":"${ID}"`);
    expect(t.calls.find((c) => c.url.endsWith("/getChat"))!.body.chat_id).toBe(String(ID));
  });
  it("with no key it stores the plain id exactly as before", async () => {
    const t = setup({ TELEGRAM_BASELINE_SCAN: "on" });
    t.brain.mockResolvedValue(Response.json(consent));
    await t.post(yes(11));
    const row = t.writes().find((c) => c.url.includes("profile_snapshots"))!.body;
    expect(row.sender_id).toBe(String(ID));
    expect(row.get_chat.response.result.id).toBe(ID);
  });
  it("a misconfigured key stores nothing at all (never the plain id) and the webhook still answers 200", async () => {
    const t = setup({ TELEGRAM_BASELINE_SCAN: "on", TELEGRAM_ID_HMAC_KEY: "short" });
    t.brain.mockResolvedValue(Response.json(consent));
    expect((await t.post(yes(12))).status).toBe(200);
    expect(t.writes().filter((c) => c.url.includes("profile_snapshots"))).toHaveLength(0);
  });
});

describe("fix wizard with hashing on", () => {
  it("reads under the key and the legacy plain id, writes under the key only, calls Telegram and core-brain's table with the plain id", async () => {
    const t = setup({ TELEGRAM_ID_HMAC_KEY: KEY });
    await t.post(t.cb(`fw|${B8}|f|bi`, 30));
    const gets = t.calls.filter((c) => c.method === "GET" && /profile_snapshots|fix_wizard_items/.test(c.url));
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.some((c) => c.url.includes(`sender_id=in.(%22${HASH}%22,%22${ID}%22)`))).toBe(true);
    const written = t.writes().filter((c) => /profile_snapshots|fix_wizard_items/.test(c.url));
    expect(written.length).toBeGreaterThan(0);
    for (const w of written) expect(w.body.sender_id).toBe(HASH);
    expect(t.calls.find((c) => c.url.endsWith("/getChat"))!.body.chat_id).toBe(String(ID));
    expect(t.calls.find((c) => c.url.includes("conversation_states"))!.url).toContain(`sender_id=eq.${ID}`);
  });
  it("a misconfigured key sends nothing to the database", async () => {
    const t = setup({ TELEGRAM_ID_HMAC_KEY: "short" });
    await t.post(t.msg("/fix", 31));
    expect(t.calls.filter((c) => c.url.includes("sb.test"))).toHaveLength(0);
  });
});

describe("STOP with hashing on", () => {
  it("deletes under the plain id for core-brain and DEEP, and under the key and the legacy plain id for scans", async () => {
    const t = setup({ TELEGRAM_ID_HMAC_KEY: KEY });
    await t.post(t.msg("STOP", 40));
    const r = t.calls.filter((c) => c.url.includes("/rpc/")).map((c) => ({ fn: c.url.split("/rpc/")[1], id: c.body.p_sender_id }));
    expect(r).toEqual([
      { fn: "mpt_erase_chat_sender", id: String(ID) },
      { fn: "mpt_delete_profile_snapshots", id: HASH },
      { fn: "mpt_delete_profile_snapshots", id: String(ID) },
      { fn: "mpt_delete_deep_data", id: String(ID) },
    ]);
    expect(t.calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.body.text)[0]).toMatch(/^Done\./);
  });
  it("with a misconfigured key it still deletes the plain-id data but never says Done", async () => {
    const t = setup({ TELEGRAM_ID_HMAC_KEY: "short" });
    await t.post(t.msg("STOP", 41));
    expect(t.calls.filter((c) => c.url.includes("/rpc/")).map((c) => c.url.split("/rpc/")[1])).toContain("mpt_delete_profile_snapshots");
    expect(t.calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.body.text)[0]).toMatch(/could not finish deleting/);
  });
});

describe("dashboard link with hashing on", () => {
  it("looks scans up under both keys and issues the link under the snapshot's own sender key", async () => {
    const t = setup({ TELEGRAM_ID_HMAC_KEY: KEY }, { snaps: [{ id: BASE_ID, sender_id: HASH }] });
    await t.post(t.msg("/dashboard", 50));
    const snapGet = t.calls.find((c) => c.method === "GET" && c.url.includes("profile_snapshots"))!;
    expect(snapGet.url).toContain(`sender_id=in.(%22${HASH}%22,%22${ID}%22)`);
    const link = t.writes().find((c) => c.url.includes("dashboard_links"))!.body;
    expect(link.sender_id).toBe(HASH);
    expect(link.snapshot_id).toBe(BASE_ID);
  });
});

describe("logs", () => {
  it("never contain the key, the hash or the plain id", async () => {
    const t = setup({ TELEGRAM_ID_HMAC_KEY: KEY });
    await t.post(t.cb(`fw|${B8}|f|bi`, 60));
    await t.post(t.msg("STOP", 61));
    const all = t.logs.join("\n");
    for (const secret of [KEY, HASH, String(ID), TOKEN]) expect(all).not.toContain(secret);
  });
});
