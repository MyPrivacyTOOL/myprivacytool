// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689: the bot's "footprint" command (the Telegram to Web handoff link). Synthetic sender and a stubbed fetch only; nothing here reaches Telegram or Supabase.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { sha256Hex } from "../../shared/dashboard/crypto";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000001;
const SNAP = "00000000-0000-4000-8000-0000000000a1";

function setup(envOver: Record<string, unknown> = {}, opts: { snaps?: unknown[]; recent?: unknown[]; saveOk?: boolean } = {}) {
  const calls: { url: string; method: string; body: any }[] = [];
  const logs: string[] = [];
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/rest/v1/profile_snapshots")) return Response.json(opts.snaps ?? [{ id: SNAP }]);
    if (url.includes("/rest/v1/dashboard_links") && (init?.method ?? "GET") === "GET") return Response.json(opts.recent ?? []);
    if (url.includes("/rest/v1/dashboard_links")) return new Response(null, { status: opts.saveOk === false ? 500 : 201 });
    return Response.json({ ok: true });
  }));
  const brain = vi.fn(async () => Response.json({ ignored: true }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, PROBE_TELEGRAM_IDS: String(ID), TELEGRAM_FOOTPRINT_LINKS: "on", SUPABASE_URL: "https://db.test", SUPABASE_KEY: "svc-key", CORE_BRAIN: { fetch: brain }, ...envOver } as unknown as Env;
  const post = (text: string, id = ID) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" },
    body: JSON.stringify({ update_id: 5, message: { message_id: 1, date: 1, text, from: { id, is_bot: false, first_name: "T" }, chat: { id, type: "private" } } }) }), env);
  return { calls, logs, post, brain, sent: () => calls.filter((c) => c.url.includes("/sendMessage")), saved: () => calls.filter((c) => c.method === "POST" && c.url.includes("/dashboard_links")) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("footprint command", () => {
  it("issues one /f/ link: UUID-only URL, hashed in storage, footprint scope, 15 minute expiry, says it shares ids not values", async () => {
    const t = setup();
    expect((await t.post("footprint")).status).toBe(200);
    const text = t.sent()[0].body.text as string;
    const m = /https:\/\/www\.myprivacytool\.io\/f\/([0-9a-f-]{36})/.exec(text)!;
    expect(m).toBeTruthy();
    expect(text).toContain("not your values");
    expect(text).not.toContain(String(ID));
    const row = t.saved()[0].body;
    expect(row.token_hash).toBe(await sha256Hex(m[1]));
    expect(row).toMatchObject({ sender_id: String(ID), snapshot_id: SNAP, scope: "footprint" });
    expect(JSON.stringify(row)).not.toContain(m[1]);
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(15 * 60_000);
    expect(t.brain).not.toHaveBeenCalled();
    expect(t.logs.join("\n")).not.toContain(m[1]);
  });
  it("only the exact command, from an allow-listed sender, while TELEGRAM_FOOTPRINT_LINKS is on (the dashboard switch does not turn it on)", async () => {
    for (const text of ["send my footprint", "footprint please", "my footprint"]) {
      const t = setup();
      await t.post(text);
      expect(t.saved()).toHaveLength(0);
    }
    const off = setup({ TELEGRAM_FOOTPRINT_LINKS: undefined, TELEGRAM_DASHBOARD_LINKS: "on" });
    await off.post("/footprint");
    expect(off.saved()).toHaveLength(0);
    const stranger = setup();
    await stranger.post("/footprint", 6000000002);
    expect(stranger.saved()).toHaveLength(0);
  });
  it("tells the person when there is no completed scan, and issues nothing", async () => {
    const t = setup({}, { snaps: [] });
    await t.post("/footprint");
    expect(t.saved()).toHaveLength(0);
    expect(t.sent()[0].body.text as string).toContain("scan me");
  });
  it("the dashboard command still issues a dashboard link with no scope field", async () => {
    const t = setup({ TELEGRAM_DASHBOARD_LINKS: "on" });
    await t.post("/dashboard");
    expect(t.saved()[0].body).not.toHaveProperty("scope");
    expect(t.sent()[0].body.text as string).toContain("/d/");
  });
});
