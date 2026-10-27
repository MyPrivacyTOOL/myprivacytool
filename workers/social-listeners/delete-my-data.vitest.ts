// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { isDeleteCommandText } from "./src/delete-my-data";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000005; // synthetic, never a real account
const OTHER = 6000000006;
const msg = (text: string, uid: number, id = ID, chatType = "private") => ({
  update_id: uid,
  message: { message_id: 7, date: 1700000000, text, from: { id, is_bot: false, first_name: "T" }, chat: { id: chatType === "private" ? id : -100, type: chatType } },
});

interface Opts { counts?: Record<string, number>; fail?: string[] }
function setup(envOver: Record<string, unknown> = {}, o: Opts = {}) {
  const calls: { url: string; body: any }[] = [];
  const logs: string[] = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((m) => { logs.push(String(m)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("api.telegram.org")) return Response.json({ ok: true, result: {} });
    const fn = url.split("/rpc/")[1];
    if (o.fail?.includes(fn)) return new Response("", { status: 500 });
    return Response.json(o.counts?.[fn] ?? 1);
  }));
  const brain = vi.fn(async () => Response.json({ ok: true, ignored: true }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: brain }, PROBE_TELEGRAM_IDS: String(ID), ...envOver } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  const rpcs = () => calls.filter((c) => c.url.includes("/rpc/")).map((c) => ({ fn: c.url.split("/rpc/")[1], args: c.body }));
  const sent = () => calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => String(c.body.text));
  return { post, calls, logs, brain, rpcs, sent };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("delete my data command", () => {
  it("matches exact whole messages only", () => {
    for (const t of ["stop", "STOP", "/stop", " Stop ", "delete my data", "Delete  my   data", "/deletemydata", "/delete", "/stop@MyPrivacyTOOL_Bot"]) expect(isDeleteCommandText(t)).toBe(true);
    for (const t of ["please stop texting me", "stop it now", "don't stop", "delete", "delete my data please", "", "stopp", undefined, 5]) expect(isDeleteCommandText(t as any)).toBe(t === "delete");
  });

  it("erases consent first, then snapshots, then DEEP data, for the sender only, and never reaches core-brain", async () => {
    const t = setup();
    await t.post(msg("STOP", 1));
    expect(t.rpcs()).toEqual([
      { fn: "mpt_erase_chat_sender", args: { p_channel: "telegram", p_sender_id: String(ID) } },
      { fn: "mpt_delete_profile_snapshots", args: { p_sender_id: String(ID) } },
      { fn: "mpt_delete_deep_data", args: { p_sender_id: String(ID) } },
    ]);
    expect(t.sent()).toHaveLength(1);
    expect(t.sent()[0]).toMatch(/^Done\. I deleted your saved scan results/);
    expect(t.sent()[0]).toMatch(/will not re-check/);
    expect(t.brain).not.toHaveBeenCalled();
  });

  it("works with every feature switch off, so people can always delete", async () => {
    const t = setup({ TELEGRAM_BASELINE_SCAN: undefined, TELEGRAM_FIX_WIZARD: undefined });
    await t.post(msg("delete my data", 2));
    expect(t.rpcs()).toHaveLength(3);
  });

  it("says nothing was stored when every function deleted zero rows, and is safe to repeat", async () => {
    const t = setup({}, { counts: { mpt_erase_chat_sender: 0, mpt_delete_profile_snapshots: 0, mpt_delete_deep_data: 0 } });
    await t.post(msg("/stop", 3));
    await t.post(msg("/stop", 4));
    expect(t.sent()).toHaveLength(2);
    expect(t.sent().every((m) => /Nothing was stored/.test(m))).toBe(true);
  });

  it("never claims success when any step fails", async () => {
    for (const fn of ["mpt_erase_chat_sender", "mpt_delete_profile_snapshots", "mpt_delete_deep_data"]) {
      const t = setup({}, { fail: [fn] });
      await t.post(msg("STOP", 5));
      expect(t.sent()).toHaveLength(1);
      expect(t.sent()[0]).toMatch(/could not finish deleting/);
      expect(t.sent()[0]).not.toMatch(/^Done/);
    }
  });

  it("reports failure when storage is not configured", async () => {
    const t = setup({ SUPABASE_URL: undefined });
    await t.post(msg("STOP", 6));
    expect(t.sent()[0]).toMatch(/could not finish deleting/);
  });
});

describe("who it applies to", () => {
  it("leaves senders outside the scan scope to the normal bot (default test-account scope)", async () => {
    const t = setup();
    await t.post(msg("stop", 10, OTHER));
    expect(t.rpcs()).toHaveLength(0);
    expect(t.sent()).toHaveLength(0);
    expect(t.brain).toHaveBeenCalled();
  });
  it("covers any private sender when the scope is all, but only that sender's own data", async () => {
    const t = setup({ TELEGRAM_SCAN_SCOPE: "all" });
    await t.post(msg("stop", 11, OTHER));
    expect(t.rpcs().map((r) => r.args.p_sender_id)).toEqual([String(OTHER), String(OTHER), String(OTHER)]);
  });
  it("ignores group chats", async () => {
    const t = setup({ TELEGRAM_SCAN_SCOPE: "all" });
    await t.post(msg("stop", 12, ID, "group"));
    expect(t.rpcs()).toHaveLength(0);
  });
  it("takes the sender from the update, never from message text", async () => {
    const t = setup({ TELEGRAM_SCAN_SCOPE: "all" });
    await t.post(msg(`stop ${OTHER}`, 13));
    expect(t.rpcs()).toHaveLength(0);
  });
});

describe("privacy of logs", () => {
  it("never logs the token or the id", async () => {
    const t = setup();
    await t.post(msg("STOP", 20));
    const all = t.logs.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(String(ID));
  });
});
