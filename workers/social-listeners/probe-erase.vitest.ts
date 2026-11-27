// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-9907 (option A, 2026-11-26): /privacy says nothing from a Telegram message is recorded before the 19-or-over Y, and that STOP deletes.
// So the bot-wide probe logger is off in the deployed config, and STOP removes the rows it logged while it was on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { eraseProbeCaptures } from "./src/probe-reader";
import type { Env } from "./src/shared";

const ID = 6000000005; // synthetic, never a real account
const toml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "wrangler.toml"), "utf8");
const msg = (text: string, chatType = "private") => ({
  update_id: 1,
  message: { message_id: 7, date: 1700000000, text, from: { id: ID, is_bot: false, first_name: "T" }, chat: { id: chatType === "private" ? ID : -100, type: chatType } },
});

function setup(envOver: Record<string, unknown> = {}, o: { eraseStatus?: number; probeRows?: number; rpcCount?: number } = {}) {
  const calls: { url: string; method: string }[] = [];
  const replies: string[] = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/sendMessage")) replies.push(String(JSON.parse(String(init?.body)).text));
    if (url.includes("api.telegram.org")) return Response.json({ ok: true, result: {} });
    if (url.includes("/channel_probe_captures") && method === "DELETE") {
      if (o.eraseStatus) return new Response("", { status: o.eraseStatus });
      return Response.json(Array.from({ length: o.probeRows ?? 2 }, (_, i) => ({ id: i })));
    }
    if (url.includes("/rpc/")) return Response.json(o.rpcCount ?? 1);
    return Response.json([]);
  }));
  const brain = vi.fn(async () => Response.json({ ok: true, ignored: true }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: "1:T", SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: brain }, PROBE_MODE: "off", TELEGRAM_CAPTURE_HEXAGONS: "on", ...envOver } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  const probe = () => calls.filter((c) => c.url.includes("/channel_probe_captures"));
  return { post, probe, replies, brain, calls, env };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the bot-wide probe logger is off", () => {
  it("the deployed config sets PROBE_MODE off", () => {
    expect(toml.match(/^PROBE_MODE\s*=.*$/gm)).toEqual(['PROBE_MODE = "off"']);
  });
  it("a message before the Y writes nothing to the probe log and makes no profile lookup", async () => {
    const t = setup();
    await t.post(msg("scan me"));
    expect(t.probe()).toEqual([]);
    expect(t.calls.filter((c) => /getChat|getUserProfile|getFile/.test(c.url))).toEqual([]);
    expect(t.brain).toHaveBeenCalled();
  });
});

const ERASE = `https://x.supabase.co/rest/v1/channel_probe_captures?platform=eq.telegram&sender_id=eq.${ID}&select=id`;

describe("STOP removes the sender's probe-log rows", () => {
  it.each(["STOP", "/stop", "delete my data"])("%s from any private sender, limited to that sender", async (text) => {
    const t = setup();
    await t.post(msg(text));
    expect(t.probe()).toEqual([{ url: ERASE, method: "DELETE" }]);
    expect(t.replies).toEqual([expect.stringMatching(/^Done\. I deleted what I recorded/)]);
  });
  it("still removes them with capture switched off", async () => {
    const t = setup({ TELEGRAM_CAPTURE_HEXAGONS: undefined });
    await t.post(msg("STOP"));
    expect(t.probe()).toEqual([{ url: ERASE, method: "DELETE" }]);
  });
  it("says it did not finish when the probe log cannot be cleared", async () => {
    const t = setup({}, { eraseStatus: 500 });
    await t.post(msg("STOP"));
    expect(t.replies).toEqual([expect.stringMatching(/^I could not finish deleting/)]);
  });
  it("a scan test account is told data was removed when only probe rows existed", async () => {
    const t = setup({ TELEGRAM_CAPTURE_HEXAGONS: undefined, PROBE_TELEGRAM_IDS: String(ID) }, { rpcCount: 0 });
    await t.post(msg("STOP"));
    expect(t.replies).toEqual([expect.stringMatching(/^Done\. I deleted your saved scan results/)]);
    expect(t.brain).not.toHaveBeenCalled();
  });
  it("a scan test account hears about a failure too", async () => {
    const t = setup({ TELEGRAM_CAPTURE_HEXAGONS: undefined, PROBE_TELEGRAM_IDS: String(ID) }, { eraseStatus: 500 });
    await t.post(msg("STOP"));
    expect(t.replies).toEqual([expect.stringMatching(/^I could not finish deleting everything/)]);
  });
  it("ordinary text and group messages remove nothing", async () => {
    for (const u of [msg("please stop texting me"), msg("hello"), msg("STOP", "group")]) {
      const t = setup();
      await t.post(u);
      expect(t.probe().filter((c) => c.method === "DELETE")).toEqual([]);
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
  it.each(["", "1&sender_id=neq.0", "abc", "*"])("refuses the id %j and sends no request", async (id) => {
    const t = setup();
    expect(await eraseProbeCaptures(t.env, id)).toBeNull();
    expect(t.calls).toEqual([]);
  });
});
