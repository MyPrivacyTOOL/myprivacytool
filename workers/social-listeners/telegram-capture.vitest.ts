// @vitest-environment node
// CK-8502 owner decision D1, Telegram: hexagon values of a private message are recorded once per update, only with the flag on; STOP erases for any sender.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";

interface Ev { key: string; data: Record<string, unknown> | null; at: string | null }
let contacts: Map<string, Ev[]>;
let calls: { url: string; body: string }[];
const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input), body = String(init?.body ?? "");
  calls.push({ url, body });
  if (url.includes("/rpc/mpt_social_record")) {
    const a = JSON.parse(body);
    const list = contacts.get(`${a.p_platform}:${a.p_user_id}`) ?? [];
    if (list.some((e) => e.key === a.p_event_key)) return Response.json({ duplicate: true });
    list.push({ key: a.p_event_key, data: a.p_data, at: a.p_occurred_at });
    contacts.set(`${a.p_platform}:${a.p_user_id}`, list);
    return Response.json({ duplicate: false });
  }
  if (url.includes("/rpc/mpt_erase_social_contact")) { const a = JSON.parse(body); return Response.json(contacts.delete(`${a.p_platform}:${a.p_user_id}`) ? 1 : 0); }
  if (url.includes("/rpc/")) return Response.json(1);
  return new Response("{}");
});
beforeEach(() => { contacts = new Map(); calls = []; stub.mockClear(); vi.stubGlobal("fetch", stub); });
afterEach(() => vi.unstubAllGlobals());

const brain = () => ({ fetch: vi.fn(async () => Response.json({ ok: true, ignored: true })) });
const env = (over: object = {}, b = brain()) => ({ TELEGRAM_WEBHOOK_SECRET: "tg", SUPABASE_URL: "https://db.test", SUPABASE_KEY: "k", CORE_BRAIN: b, ...over });
const update = (id: number, text: string, from: object = {}, chat: object = { id: 7, type: "private" }) =>
  ({ update_id: id, message: { message_id: 1, date: 1_793_000_000, text, chat, from: { id: 7, is_bot: false, first_name: "Ann", last_name: "Lee", username: "ann7", language_code: "en", ...from } } });
const send = (u: object, e: object) => worker.fetch(new Request("https://w/webhook/telegram", { method: "POST", body: JSON.stringify(u), headers: { "X-Telegram-Bot-Api-Secret-Token": "tg" } }), e as never);

describe("Telegram hexagon capture", () => {
  it("flag off (default): nothing is recorded", async () => {
    await send(update(1, "hello"), env());
    expect(contacts.size).toBe(0);
  });

  it("flag on: one row per update with the hexagon values, the platform update id and message time", async () => {
    await send(update(2, "hello there"), env({ TELEGRAM_CAPTURE_HEXAGONS: "on" }));
    const ev = contacts.get("telegram:7")![0];
    expect(ev.key).toBe("tg:2");
    expect(ev.at).toBe(new Date(1_793_000_000_000).toISOString());
    expect(ev.data).toMatchObject({ "tg.first_name": "Ann", "tg.last_name": "Lee", "tg.username": "ann7", "tg.language": "en", "tg.message_text": "hello there", "tg.update_counter": 2 });
    expect(Object.keys(ev.data!).every((k) => k.startsWith("tg."))).toBe(true);
  });

  it("a Telegram retry of the same update adds nothing", async () => {
    const e = env({ TELEGRAM_CAPTURE_HEXAGONS: "on" });
    await send(update(3, "hi"), e); await send(update(3, "hi"), e);
    expect(contacts.get("telegram:7")!.length).toBe(1);
  });

  it("groups, bots and non-message updates are not captured; no profile or photo lookup is made", async () => {
    const e = env({ TELEGRAM_CAPTURE_HEXAGONS: "on" });
    await send(update(4, "hi", {}, { id: -100, type: "group" }), e);
    await send(update(5, "hi", { is_bot: true }), e);
    await send({ update_id: 6, edited_message: { text: "x" } }, e);
    expect(contacts.size).toBe(0);
    expect(calls.filter((c) => c.url.includes("api.telegram.org"))).toEqual([]);
  });

  it("with TELEGRAM_ID_HMAC_KEY set the stored id is the hash, never the plain id", async () => {
    await send(update(7, "hi"), env({ TELEGRAM_CAPTURE_HEXAGONS: "on", TELEGRAM_ID_HMAC_KEY: "k".repeat(40) }));
    const keys = [...contacts.keys()];
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^telegram:h1:[0-9a-f]{64}$/);
  });

  it("STOP from any private sender erases the capture and the conversation row, is not recorded, and never reaches core-brain", async () => {
    const b = brain(); const e = env({ TELEGRAM_CAPTURE_HEXAGONS: "on", TELEGRAM_BOT_TOKEN: "1:abc" }, b);
    await send(update(8, "hello"), e);
    expect(contacts.has("telegram:7")).toBe(true);
    const r = await send(update(9, "STOP"), e);
    expect(r.status).toBe(200);
    expect(contacts.has("telegram:7")).toBe(false);
    expect(calls.some((c) => c.url.includes("/rpc/mpt_erase_chat_sender"))).toBe(true);
    expect(calls.some((c) => c.url.includes("api.telegram.org") && c.body.includes("Done"))).toBe(true);
    expect(b.fetch).toHaveBeenCalledTimes(1);   // only the "hello", not the STOP
  });

  it("with the flag off STOP behaves as before (nothing extra)", async () => {
    await send(update(10, "STOP"), env());
    expect(calls.some((c) => c.url.includes("/rpc/mpt_erase_social_contact"))).toBe(false);
  });
});
