// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-7893: the bot's "dashboard" command. Synthetic sender and a stubbed fetch only; nothing here reaches Telegram or Supabase.
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
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, PROBE_TELEGRAM_IDS: String(ID), TELEGRAM_DASHBOARD_LINKS: "on", SUPABASE_URL: "https://db.test", SUPABASE_KEY: "svc-key", CORE_BRAIN: { fetch: brain }, ...envOver } as unknown as Env;
  const post = (text: string, id = ID) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" },
    body: JSON.stringify({ update_id: 5, message: { message_id: 1, date: 1, text, from: { id, is_bot: false, first_name: "T" }, chat: { id, type: "private" } } }) }), env);
  return { calls, logs, post, brain, sent: () => calls.filter((c) => c.url.includes("/sendMessage")), saved: () => calls.filter((c) => c.method === "POST" && c.url.includes("/dashboard_links")) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("dashboard command", () => {
  it("issues one link: UUID-only URL, hashed in storage, 15 minute expiry, scoped to the newest complete snapshot, nothing else triggered", async () => {
    const t = setup();
    expect((await t.post("/dashboard")).status).toBe(200);
    const text = t.sent()[0].body.text as string;
    const m = /https:\/\/www\.myprivacytool\.io\/d\/([0-9a-f-]{36})/.exec(text)!;
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(text).not.toContain(String(ID));
    expect(t.sent()[0].body.link_preview_options).toEqual({ is_disabled: true });
    const row = t.saved()[0].body;
    expect(row.token_hash).toBe(await sha256Hex(m[1]));
    expect(JSON.stringify(row)).not.toContain(m[1]);
    expect(row).toMatchObject({ sender_id: String(ID), snapshot_id: SNAP });
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(15 * 60_000);
    expect(t.calls.some((c) => c.url.includes("/getChat") || c.url.includes("/getUserProfilePhotos") || c.url.includes("deep_jobs"))).toBe(false);
    expect(t.brain).not.toHaveBeenCalled();
    expect(t.logs.join("\n")).not.toContain(m[1]);
    expect(t.logs.join("\n")).not.toContain("SECRET");
  });
  it("only an exact command from an allow-listed sender while the flag is on", async () => {
    for (const text of ["please send my dashboard", "dashboard https://example.com", "I like my dashboard"]) {
      const t = setup();
      await t.post(text);
      expect(t.saved()).toHaveLength(0);
    }
    const off = setup({ TELEGRAM_DASHBOARD_LINKS: undefined });
    await off.post("/dashboard");
    expect(off.saved()).toHaveLength(0);
    const other = setup();
    await other.post("/dashboard", 777);
    expect(other.saved()).toHaveLength(0);
    for (const text of ["dashboard", "/Dashboard", "/dashboard@MyBot"]) {
      const t = setup();
      await t.post(text);
      expect(t.saved()).toHaveLength(1);
    }
  });
  it("no completed scan: says so and stores no link", async () => {
    const t = setup({}, { snaps: [] });
    await t.post("/dashboard");
    expect(t.saved()).toHaveLength(0);
    expect(t.sent()[0].body.text).toMatch(/no completed scan/);
  });
  it("limits links per hour", async () => {
    const t = setup({}, { recent: [1, 2, 3, 4, 5].map((n) => ({ token_hash: String(n) })) });
    await t.post("/dashboard");
    expect(t.saved()).toHaveLength(0);
    expect(t.sent()[0].body.text).toMatch(/several dashboard links/);
  });
  it("a failed save never sends a link", async () => {
    const t = setup({}, { saveOk: false });
    await t.post("/dashboard");
    expect(t.sent()[0].body.text).not.toMatch(/\/d\//);
  });
});
