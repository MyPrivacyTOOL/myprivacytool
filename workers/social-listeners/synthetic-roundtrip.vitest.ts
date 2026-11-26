// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import type { Env } from "./src/shared";

const LOG = "https://x.supabase.co/rest/v1/telegram_event_log";
const asEnv = (o: object) => o as unknown as Env;
afterEach(() => vi.unstubAllGlobals());

function setup(over: Record<string, unknown> = {}) {
  const rows: Array<{ created_at: string; direction: string; kind: string; sender_id: string; update_id: number; payload: unknown }> = [];
  const sent: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${LOG}?`)) { const u = Number(/update_id=eq\.(\d+)/.exec(url)?.[1]); return Response.json(rows.filter((r) => r.update_id === u)); }
    if (url === LOG) { const r = JSON.parse(String(init?.body)); rows.push({ ...r, created_at: new Date().toISOString() }); return new Response(null, { status: 201 }); }
    if (url.includes("/sendMessage")) { sent.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, result: { message_id: 9 } }); }
    return Response.json({ ok: true, result: {} });
  }));
  const brain = vi.fn(async () => Response.json({ message_keys: ["bot.unknown.title"], locale: "en" }));
  const env = asEnv({ TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: "1:T", SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k", CORE_BRAIN: { fetch: brain }, PROBE_MODE: "all", SYNTHETIC_IDS: "555, 666", ...over });
  const call = (headers: Record<string, string> = { "X-Telegram-Bot-Api-Secret-Token": "s" }) => worker.fetch(new Request("https://x/synthetic/telegram-roundtrip", { method: "POST", headers }), env);
  return { call, sent, rows };
}

describe("POST /synthetic/telegram-roundtrip", () => {
  it("rejects a wrong secret and a GET", async () => {
    const { call, sent } = setup();
    expect((await call({ "X-Telegram-Bot-Api-Secret-Token": "bad" })).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await worker.fetch(new Request("https://x/synthetic/telegram-roundtrip"), asEnv({}))).status).toBe(405);
  });
  it("is 503 when SYNTHETIC_IDS is unset and sends nothing", async () => {
    const { call, sent } = setup({ SYNTHETIC_IDS: undefined });
    expect((await call()).status).toBe(503);
    expect(sent).toEqual([]);
  });
  it("sends ONLY to the first synthetic id, passes with in/brain/out, and never returns the id", async () => {
    const { call, sent, rows } = setup();
    const res = await call();
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.pass).toBe(true);
    expect(body.in_at && body.brain_at && body.out_at).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect((sent[0] as { chat_id: number }).chat_id).toBe(555);
    expect(rows.every((r) => r.sender_id === "555")).toBe(true);
    // The body holds a random update_id and timestamps, which can contain "555" or "666" by chance (it turned #859 red), so a substring
    // check on the whole body is flaky. Check the fields instead: the exact set of keys, and that no field that could carry an id does.
    expect(Object.keys(body).sort()).toEqual(["brain_at", "budget_ms", "in_at", "ms", "out_at", "pass", "problems", "reply_text_start", "sent_at", "update_id"]);
    expect(typeof body.update_id).toBe("number");
    expect([555, 666]).not.toContain(body.update_id);
    for (const key of ["problems", "reply_text_start"]) {
      expect(JSON.stringify(body[key])).not.toContain("555");
      expect(JSON.stringify(body[key])).not.toContain("666");
    }
  });
  it("is not failed by a random update_id that happens to contain a synthetic id (the case that used to turn CI red)", async () => {
    // update_id = 2_000_000_000 + floor(random * 900_000_000). 0.5555 / 0.9 gives 2_555_500_000, which contains "555".
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5555 / 0.9);
    try {
      const { call } = setup();
      const body = JSON.parse(await (await call()).text());
      expect(String(body.update_id)).toContain("555"); // proves the setup hits the old failure
      expect(body.pass).toBe(true);
      for (const key of ["problems", "reply_text_start"]) {
        expect(JSON.stringify(body[key])).not.toContain("555");
        expect(JSON.stringify(body[key])).not.toContain("666");
      }
    } finally { random.mockRestore(); }
  });
});
