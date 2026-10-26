// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "./src/logger";
import type { Env } from "./src/shared";
import { runXProbe, xActors } from "./src/x-probe";

const quiet: Logger = { info() {}, warn() {}, error() {} };
const BEARER = "BEARER-SECRET";

interface Call { url: string; body: unknown; auth: string | undefined }
interface SavedRow { platform: string; sender_id: string; kind: string; payload: Record<string, unknown> }

function setup(opts: { fullFieldsStatus?: number; throws?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers?.Authorization });
    if (opts.throws) throw new Error("network down");
    if (url.startsWith("https://sb.test/")) return new Response(null, { status: 201 });
    if (url.includes("/tweets")) return Response.json({ data: [{ id: "1", text: "hello" }] });
    if (opts.fullFieldsStatus && url.includes("verified_type")) return Response.json({ errors: [{ message: "invalid field" }] }, { status: opts.fullFieldsStatus });
    return Response.json({ data: { id: "111", username: "Tester", description: "bio" } });
  }));
  const env = (over: Record<string, unknown> = {}) =>
    ({ SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc", X_BEARER_TOKEN: BEARER, PROBE_MODE: "on", PROBE_X_IDS: "111", ...over }) as unknown as Env;
  return { calls, env };
}

const saved = (calls: Call[]): SavedRow[] => calls.filter((c) => c.url === "https://sb.test/rest/v1/channel_probe_captures").flatMap((c) => c.body as SavedRow[]);
const xCalls = (calls: Call[]): Call[] => calls.filter((c) => c.url.startsWith("https://api.x.com/"));

const dm = (sender: string, over: Record<string, unknown> = {}) => ({
  for_user_id: "999",
  users: { [sender]: { screen_name: "Tester" } },
  direct_message_events: [{ type: "message_create", message_create: { sender_id: sender, target: { recipient_id: "999" }, message_data: { text: "hi" } } }],
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("x probe is off unless PROBE_MODE=on and the sender is on a list", () => {
  it("does nothing when PROBE_MODE is unset", async () => {
    const { calls, env } = setup();
    await runXProbe(env({ PROBE_MODE: undefined }), dm("111"), quiet);
    expect(calls).toEqual([]);
  });
  it("does nothing for PROBE_MODE=all (it only ever follows the allow-list in mode on)", async () => {
    const { calls, env } = setup();
    await runXProbe(env({ PROBE_MODE: "all" }), dm("111"), quiet);
    expect(calls).toEqual([]);
  });
  it("does nothing when no list is set", async () => {
    const { calls, env } = setup();
    await runXProbe(env({ PROBE_X_IDS: undefined }), dm("111"), quiet);
    expect(calls).toEqual([]);
  });
  it("does nothing for a sender who is not on a list", async () => {
    const { calls, env } = setup();
    await runXProbe(env(), dm("222"), quiet);
    expect(calls).toEqual([]);
  });
  it("ignores our own echoes (sender is the account the event was delivered for)", async () => {
    const { calls, env } = setup();
    await runXProbe(env({ PROBE_X_IDS: "999" }), dm("999"), quiet);
    expect(calls).toEqual([]);
  });
});

describe("x probe on", () => {
  it("saves the raw event and both public lookups for an allow-listed id", async () => {
    const { calls, env } = setup();
    const p = dm("111");
    await runXProbe(env(), p, quiet);
    const rows = saved(calls);
    expect(rows.map((r) => r.kind)).toEqual(["update", "lookup:users", "lookup:users/tweets"]);
    expect(rows.every((r) => r.platform === "x" && r.sender_id === "111")).toBe(true);
    expect(rows[0].payload).toEqual(p);
    expect(rows[1].payload.status).toBe(200);
    expect(rows[1].payload.fields).toBe("full");
    expect(xCalls(calls).every((c) => c.auth === `Bearer ${BEARER}`)).toBe(true);
  });
  it("never writes the bearer token into a saved row", async () => {
    const { calls, env } = setup();
    await runXProbe(env(), dm("111"), quiet);
    expect(JSON.stringify(saved(calls))).not.toContain(BEARER);
  });
  it("matches an allow-listed handle, with or without @ and in any case", async () => {
    const { calls, env } = setup();
    await runXProbe(env({ PROBE_X_IDS: undefined, PROBE_X_HANDLES: "@tester" }), dm("111"), quiet);
    expect(saved(calls).map((r) => r.kind)).toContain("update");
  });
  it("falls back to the documented fields when X refuses a field name, and keeps both answers", async () => {
    const { calls, env } = setup({ fullFieldsStatus: 400 });
    await runXProbe(env(), dm("111"), quiet);
    const user = saved(calls).find((r) => r.kind === "lookup:users");
    expect(user?.payload.fields).toBe("safe");
    expect((user?.payload.full_attempt as { status: number }).status).toBe(400);
    expect(user?.payload.status).toBe(200);
  });
  it("saves only the raw event when no bearer token is set", async () => {
    const { calls, env } = setup();
    await runXProbe(env({ X_BEARER_TOKEN: undefined }), dm("111"), quiet);
    expect(saved(calls).map((r) => r.kind)).toEqual(["update"]);
    expect(xCalls(calls)).toEqual([]);
  });
  it("never throws when every call fails", async () => {
    const { env } = setup({ throws: true });
    await expect(runXProbe(env(), dm("111"), quiet)).resolves.toBeUndefined();
  });
});

describe("xActors", () => {
  it("reads DM senders, mention authors, new followers and likers, never our own account", () => {
    const actors = xActors({
      for_user_id: "999",
      users: { "5": { screen_name: "dmer" } },
      direct_message_events: [{ message_create: { sender_id: "5", message_data: { text: "x" } } }, { message_create: { sender_id: "999", message_data: { text: "echo" } } }],
      tweet_create_events: [{ user: { id_str: "6", screen_name: "poster" } }],
      follow_events: [{ source: { id: "7", screen_name: "follower" } }],
      favorite_events: [{ user: { id: 8, screen_name: "liker" } }],
    });
    expect(actors).toEqual([{ id: "5", handle: "dmer" }, { id: "6", handle: "poster" }, { id: "7", handle: "follower" }, { id: "8", handle: "liker" }]);
  });
  it("returns nothing for a non-object payload", () => {
    expect(xActors(null)).toEqual([]);
    expect(xActors("x")).toEqual([]);
  });
});
