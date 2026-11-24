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
    // The response legitimately holds a random 10-digit update_id and millisecond timestamps, which can contain "555" or "666" by chance
    // (the old whole-body substring check failed about 1 run in 9, MPC-11120). So check the fields: only these keys exist, the random/time
    // ones are not an id, and everything else (verdict, problems, budget, reply start) carries neither synthetic id.
    expect(Object.keys(body).sort()).toEqual(["brain_at", "budget_ms", "in_at", "ms", "out_at", "pass", "problems", "reply_text_start", "sent_at", "update_id"]);
    const { update_id, sent_at, in_at, brain_at, out_at, ms, ...rest } = body;
    for (const id of ["555", "666"]) {
      expect(JSON.stringify(rest)).not.toContain(id);
      for (const v of [update_id, sent_at, in_at, brain_at, out_at, ms]) expect(String(v)).not.toBe(id);
    }
    expect(update_id).toBeGreaterThanOrEqual(2_000_000_000);
  });
  it("is not fooled by a random update_id or timestamp that happens to contain a synthetic id", async () => {
    const real = Math.random;
    vi.spyOn(Math, "random").mockReturnValue(0.5555 / 0.9); // update_id = 2_000_000_000 + floor(0.5555/0.9 * 900_000_000) -> 2555500000, contains "555"
    try {
      const { call } = setup();
      const text = await (await call()).text();
      const body = JSON.parse(text);
      expect(String(body.update_id)).toContain("555"); // the case that used to fail the old check
      expect(body.pass).toBe(true);
      const { update_id, sent_at, in_at, brain_at, out_at, ms, ...rest } = body;
      expect(JSON.stringify(rest)).not.toContain("555");
    } finally { vi.restoreAllMocks(); Math.random = real; }
  });
});
