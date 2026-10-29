// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689: the event-driven Telegram extras (edits, blocked or unblocked). Synthetic sender and a stubbed fetch only; nothing reaches Telegram or Supabase.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { eventReply, observeEventExtra } from "./src/event-extras";
import { eraseSender } from "./src/delete-my-data";
import { createLogger } from "./src/logger";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000001;
const edit = (over: Record<string, unknown> = {}, id = ID) => ({ update_id: 7, edited_message: { message_id: 1, date: 1, edit_date: 1_790_000_000, text: "my secret edit", from: { id, is_bot: false, first_name: "T" }, chat: { id, type: "private" }, ...over } });
const member = (status: string, over: Record<string, unknown> = {}, id = ID) => ({ update_id: 8, my_chat_member: { chat: { id, type: "private" }, from: { id, is_bot: false, first_name: "T" }, date: 1_790_000_100, old_chat_member: { status: "member" }, new_chat_member: { status }, ...over } });

function setup(envOver: Record<string, unknown> = {}, opts: { rpcOk?: boolean; rpcStatus?: number } = {}) {
  const calls: { url: string; body: any }[] = [];
  const logs: string[] = [];
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/rpc/")) return opts.rpcOk === false ? new Response("{}", { status: opts.rpcStatus ?? 500 }) : Response.json(1);
    return Response.json({ ok: true });
  }));
  const brain = vi.fn(async () => Response.json({ ignored: true }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, PROBE_TELEGRAM_IDS: String(ID), TELEGRAM_BASELINE_SCAN: "on", SUPABASE_URL: "https://db.test", SUPABASE_KEY: "svc-key", CORE_BRAIN: { fetch: brain }, ...envOver } as unknown as Env;
  const post = (update: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(update) }), env);
  return { calls, logs, post, brain, env, sent: () => calls.filter((c) => c.url.includes("/sendMessage")), flags: () => calls.filter((c) => c.url.includes("/rpc/mpt_record_event_flag")) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("observeEventExtra (pure)", () => {
  it("reads a private edit and a private block or unblock, and nothing else", () => {
    expect(observeEventExtra(edit())).toMatchObject({ flag: "tg.edits", state: "edited", senderId: String(ID), chatId: ID, at: 1_790_000_000 });
    expect(observeEventExtra(member("kicked"))).toMatchObject({ flag: "tg.blocked_bot", state: "blocked" });
    expect(observeEventExtra(member("member"))).toMatchObject({ flag: "tg.blocked_bot", state: "unblocked" });
    expect(observeEventExtra(member("administrator"))).toBeNull();
    expect(observeEventExtra(edit({ chat: { id: -100, type: "supergroup" } }))).toBeNull();
    expect(observeEventExtra(edit({ from: { id: ID, is_bot: true } }))).toBeNull();
    expect(observeEventExtra(edit({ edit_date: undefined }))).toBeNull();
    expect(observeEventExtra(member("kicked", { chat: { id: -5, type: "group" } }))).toBeNull();
    expect(observeEventExtra({ update_id: 1, message: { text: "hi" } })).toBeNull();
    expect(observeEventExtra(null)).toBeNull();
  });
  it("answers an edit and an unblock, never a block, and never repeats the edited text", () => {
    const e = observeEventExtra(edit())!;
    expect(eventReply(e, true)).toContain("Edits");
    expect(eventReply(e, true)).not.toContain("secret");
    expect(eventReply(e, false)).toContain("nothing was kept");
    expect(eventReply(observeEventExtra(member("member"))!, true)).toContain("unblocked");
    expect(eventReply(observeEventExtra(member("kicked"))!, true)).toBeNull();
  });
});

describe("webhook: event extras", () => {
  it("stores a flag (never the text), replies once, and core-brain never sees it", async () => {
    const t = setup();
    expect((await t.post(edit())).status).toBe(200);
    expect(t.flags()).toHaveLength(1);
    expect(t.flags()[0].body).toMatchObject({ p_sender_id: String(ID), p_flag: "tg.edits", p_state: "edited" });
    expect(JSON.stringify(t.calls.map((c) => c.body))).not.toContain("my secret edit");
    expect(t.sent()).toHaveLength(1);
    expect(t.sent()[0].body.text).toContain("Extra check (not part of your number): Edits");
    expect(t.brain).not.toHaveBeenCalled();
    expect(t.logs.join("\n")).not.toContain("my secret edit");
    expect(t.logs.join("\n")).not.toContain(TOKEN);
    // a second edit straight away still counts in storage but does not send a second reply
    await t.post(edit());
    expect(t.flags()).toHaveLength(2);
    expect(t.sent()).toHaveLength(1);
  });
  it("a block is stored and not answered; an unblock is stored and answered", async () => {
    const t = setup();
    await t.post(member("kicked"));
    expect(t.flags()[0].body).toMatchObject({ p_flag: "tg.blocked_bot", p_state: "blocked" });
    expect(t.sent()).toHaveLength(0);
    await t.post(member("member"));
    expect(t.flags()[1].body).toMatchObject({ p_state: "unblocked" });
    expect(t.sent()).toHaveLength(1);
  });
  it("does nothing when the switch is off, the sender is not on the allow-list, or TELEGRAM_SCAN_SCOPE=all is the only reason", async () => {
    for (const over of [{ TELEGRAM_BASELINE_SCAN: "off" }, { PROBE_TELEGRAM_IDS: "7" }, { PROBE_TELEGRAM_IDS: "", TELEGRAM_SCAN_SCOPE: "all" }]) {
      const t = setup(over);
      await t.post(edit());
      expect(t.flags()).toHaveLength(0);
      expect(t.sent()).toHaveLength(0);
    }
  });
  it("says so when the flag could not be saved, and never stores under the plain id when hashing is on", async () => {
    const bad = setup({ PROBE_TELEGRAM_IDS: "6000000002" }, { rpcOk: false }); // own sender: the reply cooldown is per sender
    await bad.post(edit({}, 6000000002));
    expect(bad.sent()[0].body.text).toContain("nothing was kept");
    const hashed = setup({ TELEGRAM_ID_HMAC_KEY: "k".repeat(40), PROBE_TELEGRAM_IDS: "6000000003" });
    await hashed.post(edit({}, 6000000003));
    expect(hashed.flags()[0].body.p_sender_id).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(JSON.stringify(hashed.flags()[0].body)).not.toContain("6000000003");
  });
});

describe("STOP deletes the flags", () => {
  const log = createLogger("test");
  it("calls mpt_delete_event_flags and counts what it removed", async () => {
    const t = setup();
    const r = await eraseSender(t.env, String(ID), log);
    expect(t.calls.some((c) => c.url.includes("/rpc/mpt_delete_event_flags"))).toBe(true);
    expect(r.failed).toBe(false);
  });
  it("a database that does not have the function yet (404) is nothing to delete, not a failed STOP; any other error is a failure", async () => {
    const missing = setup({}, { rpcOk: false, rpcStatus: 404 });
    const only = (await eraseSender(missing.env, String(ID), log));
    expect(only.failed).toBe(true); // the other functions also 404 here, so STOP is still reported as failed
    vi.unstubAllGlobals(); vi.restoreAllMocks();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => { const u = String(input instanceof Request ? input.url : input); calls.push(u); return u.includes("mpt_delete_event_flags") ? new Response("{}", { status: 404 }) : Response.json(0); }));
    expect((await eraseSender({ SUPABASE_URL: "https://db.test", SUPABASE_KEY: "k" } as unknown as Env, String(ID), log)).failed).toBe(false);
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input instanceof Request ? input.url : input).includes("mpt_delete_event_flags") ? new Response("{}", { status: 500 }) : Response.json(0)));
    expect((await eraseSender({ SUPABASE_URL: "https://db.test", SUPABASE_KEY: "k" } as unknown as Env, String(ID), log)).failed).toBe(true);
  });
});
