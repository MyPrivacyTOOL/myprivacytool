// @vitest-environment node
// MPC-8601: core-brain webhook. Qwen and Supabase are stubbed through global fetch; no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_KEY: "sb-test-key",
  QWEN_API_KEY: "qwen-test-key",
  WEBHOOK_SECRET: "hook-secret",
};

/** The response fields these tests read. */
type Reply = { error?: { code?: string }; locale?: string; message_keys?: string[]; response_key?: string; state_source?: string };
type Stub = { qwen?: unknown; state?: unknown; qwenFail?: boolean; stateFail?: boolean; rpcFail?: "http" | "throw" };
let calls: { url: string; init?: RequestInit }[] = [];

function stub({ qwen, state = [], qwenFail, stateFail, rpcFail }: Stub) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/rpc/mpt_brain_record")) {
      if (rpcFail === "throw") throw new TypeError("network down");
      if (rpcFail === "http") return new Response("missing function", { status: 404 });
      return Response.json({ state: "ok", trust_level: 0, persisted: true });
    }
    if (String(url).includes("/chat/completions")) {
      if (qwenFail) return new Response("boom", { status: 500 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(qwen) } }] });
    }
    if (stateFail) return new Response("boom", { status: 500 });
    return Response.json(state);
  });
}

async function post(body: unknown, headers: Record<string, string> = { "x-mpt-webhook-secret": env.WEBHOOK_SECRET }, e: Record<string, unknown> = env) {
  const res = await worker.fetch(
    new Request("https://brain.test/webhook", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    e as unknown as typeof env,
  );
  return { status: res.status, body: (await res.json()) as Reply };
}

const msg = (text: string, extra = {}) => ({ platform: "telegram", sender_id: "42", message_text: text, ...extra });

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.unstubAllGlobals());

describe("auth and validation", () => {
  it("rejects a missing or wrong secret and never calls out", async () => {
    stub({});
    const noSecret = await post(msg("hi"), {});
    expect(noSecret.status).toBe(401);
    expect(noSecret.body.error?.code).toBe("unauthorized");
    expect((await post(msg("hi"), { "x-mpt-webhook-secret": "nope" })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("fails closed (503) when a binding is missing", async () => {
    stub({});
    const r = await post(msg("hi"), undefined, { ...env, WEBHOOK_SECRET: undefined });
    expect(r.status).toBe(503);
    expect(r.body.error?.code).toBe("not_configured");
  });

  it("400 on bad JSON or bad structure, 405 on GET", async () => {
    stub({});
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ platform: "telegram" })).status).toBe(400);
    expect((await post(msg("   "))).status).toBe(400);
    const get = await worker.fetch(new Request("https://brain.test/webhook"), env);
    expect(get.status).toBe(405);
  });

  it("GET /health reports configuration as a boolean; unknown paths 404", async () => {
    const ok = await worker.fetch(new Request("https://brain.test/health"), env);
    expect(await ok.json()).toEqual({ ok: true, worker: "core-brain", configured: true, rate_limit: { sender: false, global: false } });
    const limited = { ...env, RATE_LIMITER: { limit: async () => ({ success: true }) } };
    expect(((await (await worker.fetch(new Request("https://brain.test/health"), limited)).json()) as Record<string, unknown>).rate_limit).toEqual({ sender: true, global: false });
    const bare = await worker.fetch(new Request("https://brain.test/health"), {} as typeof env);
    expect(((await bare.json()) as Record<string, unknown>).configured).toBe(false);
    expect((await worker.fetch(new Request("https://brain.test/x"), env)).status).toBe(404);
  });
});

describe("intent -> response key", () => {
  it("scan for an anonymous user returns the First Hexagon keys", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.95 } });
    const r = await post(msg("scan me"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ intent: "scan", intent_source: "qwen", trust_level: 0, state_source: "anonymous", locale: "en" });
    expect(r.body.response_key).toBe("bot.first_hexagon.title");
    expect(r.body.message_keys).toHaveLength(10);
  });

  it("scan for a trusted user (conversation_states.trust_level) goes to the report CTA", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 }, state: [{ trust_level: 3, state: "confirmed" }] });
    const r = await post(msg("scan me"));
    expect(r.body).toMatchObject({ trust_level: 3, state: "confirmed", state_source: "supabase", response_key: "bot.confirmed_y.title" });
  });

  it("looks the sender up by channel and sender_id with the service key", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    await post(msg("help"));
    const sb = calls.find((c) => c.url.includes("/rest/v1/conversation_states"))!;
    const q = new URL(sb.url).searchParams;
    expect(q.get("channel")).toBe("eq.telegram");
    expect(q.get("sender_id")).toBe("eq.42");
    expect((sb.init!.headers as Record<string, string>).apikey).toBe(env.SUPABASE_KEY);
  });

  it("help and unknown return the welcome keys", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    expect((await post(msg("how does this work?"))).body.response_key).toBe("bot.unknown.title");
    stub({ qwen: { intent: "unknown", confidence: 0.9 } });
    expect((await post(msg("lorem"))).body.message_keys).toEqual(["bot.unknown.title", "bot.unknown.body", "bot.unknown.free"]);
  });

  it("a bare Y/N while awaiting_confirmation is verify, decided without calling Qwen", async () => {
    stub({ state: [{ trust_level: 0, state: "awaiting_confirmation" }] });
    const yes = await post(msg("Y"));
    expect(yes.body).toMatchObject({ intent: "verify", intent_source: "rules", response_key: "bot.confirmed_y.title" });
    const no = await post(msg("no"));
    expect(no.body.response_key).toBe("bot.confirmed_n.title");
    expect(calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("verify with a non-yes/no answer while pending re-prompts; verify with nothing pending acts as scan", async () => {
    stub({ qwen: { intent: "verify", confidence: 0.9 }, state: [{ trust_level: 0, state: "awaiting_confirmation" }] });
    expect((await post(msg("I think so?"))).body.response_key).toBe("bot.confirm_prompt");
    stub({ qwen: { intent: "verify", confidence: 0.9 } });
    expect((await post(msg("verify me"))).body.response_key).toBe("bot.first_hexagon.title");
  });

  it("a bare email or phone number gets the not-supported reply, with no Qwen call and no state change", async () => {
    stub({ state: [{ trust_level: 1, state: "confirmed" }] });
    for (const text of ["me@example.com", "+852 9123 4567"]) {
      const r = await post(msg(text));
      expect(r.body).toMatchObject({ intent: "unknown", intent_source: "rules", response_key: "bot.contact_unsupported", next_state: "confirmed" });
    }
    expect(calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("normalizes locale (pt-BR -> pt) and falls back to en for unsupported ones", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    expect((await post(msg("help", { locale: "pt-BR" }))).body.locale).toBe("pt");
    expect((await post(msg("help", { locale: "xx" }))).body.locale).toBe("en");
  });

  it("accepts a raw Telegram update", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const r = await post({ message: { chat: { id: 7 }, text: "scan", from: { language_code: "ja" } } });
    expect(r.body).toMatchObject({ intent: "scan", locale: "ja" });
    expect(new URL(calls.find((c) => c.url.includes("conversation_states"))!.url).searchParams.get("sender_id")).toBe("eq.7");
  });
});

describe("degradation and privacy", () => {
  it("Qwen outage or low confidence falls back to rules", async () => {
    stub({ qwenFail: true });
    expect((await post(msg("scan me"))).body).toMatchObject({ intent: "scan", intent_source: "rules" });
    stub({ qwen: { intent: "help", confidence: 0.1 } });
    expect((await post(msg("scan me"))).body).toMatchObject({ intent: "scan", intent_source: "rules" });
    stub({ qwen: { intent: "bogus", confidence: 1 } });
    expect((await post(msg("help please"))).body).toMatchObject({ intent: "help", intent_source: "rules" });
  });

  it("works without a Qwen key: rules classify, and Qwen is never called", async () => {
    stub({ qwen: { intent: "help", confidence: 1 } });
    const { QWEN_API_KEY: _omit, ...noQwen } = env;
    const r = await post(msg("scan me"), undefined, noQwen);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ intent: "scan", intent_source: "rules" });
    expect(calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("Supabase outage degrades to an anonymous user, never an error", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 }, stateFail: true });
    const r = await post(msg("scan"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ trust_level: 0, state_source: "fallback", response_key: "bot.first_hexagon.title" });
  });

  it("platforms without a conversation_states channel (X) skip the lookup", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const r = await post(msg("scan", { platform: "x" }));
    expect(r.body.state_source).toBe("anonymous");
    expect(calls.some((c) => c.url.includes("conversation_states"))).toBe(false);
  });

  it("redacts emails and phone numbers before text goes to Qwen, and sends the key from env", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    await post(msg("scan jane.doe@example.com or +1 (555) 123-4567"));
    const q = calls.find((c) => c.url.includes("/chat/completions"))!;
    const sent = JSON.parse(q.init!.body as string).messages[1].content;
    expect(sent).toBe("scan [email] or [phone]");
    expect((q.init!.headers as Record<string, string>).authorization).toBe("Bearer qwen-test-key");
    expect(q.url).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  it("never logs message text, sender ids or keys", async () => {
    const spy = vi.spyOn(console, "log");
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    await post(msg("my secret text jane@example.com", { sender_id: "sender-9999" }));
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("routed");
    for (const leak of ["secret text", "jane@example.com", "sender-9999", env.SUPABASE_KEY, env.QWEN_API_KEY, env.WEBHOOK_SECRET]) {
      expect(logged).not.toContain(leak);
    }
  });
});

describe("state write-back and interaction log (mpt_brain_record)", () => {
  const rpcCalls = () => calls.filter((c) => c.url.includes("/rest/v1/rpc/mpt_brain_record"));
  const rpcBody = (i = 0) => JSON.parse(rpcCalls()[i].init!.body as string);

  it("a first scan records awaiting_confirmation for that sender, with the service key", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.95 } });
    const r = await post(msg("scan me"));
    expect(r.body).toMatchObject({ response_key: "bot.first_hexagon.title", state: "new", next_state: "awaiting_confirmation" });
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].url).toBe("https://proj.supabase.co/rest/v1/rpc/mpt_brain_record");
    expect(rpcBody()).toEqual({
      p_channel: "telegram", p_sender_id: "42", p_intent: "scan", p_intent_source: "qwen",
      p_response_key: "bot.first_hexagon.title", p_new_state: "awaiting_confirmation", p_trust_floor: 0,
    });
    const h = rpcCalls()[0].init!.headers as Record<string, string>;
    expect(h.apikey).toBe(env.SUPABASE_KEY);
    expect(h.authorization).toBe(`Bearer ${env.SUPABASE_KEY}`);
  });

  it("yes while awaiting_confirmation confirms and raises trust to the confirmed level", async () => {
    stub({ state: [{ trust_level: 0, state: "awaiting_confirmation" }] });
    const r = await post(msg("Y"));
    expect(r.body).toMatchObject({ response_key: "bot.confirmed_y.title", next_state: "confirmed" });
    expect(rpcBody()).toMatchObject({ p_intent: "verify", p_intent_source: "rules", p_new_state: "confirmed", p_trust_floor: 1 });
  });

  it("no while awaiting_confirmation is declined and does not raise trust", async () => {
    stub({ state: [{ trust_level: 0, state: "awaiting_confirmation" }] });
    const r = await post(msg("no"));
    expect(r.body).toMatchObject({ response_key: "bot.confirmed_n.title", next_state: "declined" });
    expect(rpcBody()).toMatchObject({ p_new_state: "declined", p_trust_floor: 0 });
  });

  it("an unclear answer while pending keeps awaiting_confirmation; help and unknown leave the state alone", async () => {
    stub({ qwen: { intent: "verify", confidence: 0.9 }, state: [{ trust_level: 0, state: "awaiting_confirmation" }] });
    await post(msg("I think so?"));
    expect(rpcBody()).toMatchObject({ p_new_state: "awaiting_confirmation", p_trust_floor: 0 });
    stub({ qwen: { intent: "help", confidence: 0.9 }, state: [{ trust_level: 2, state: "confirmed" }] });
    await post(msg("how does this work?"));
    expect(rpcBody()).toMatchObject({ p_intent: "help", p_new_state: "confirmed", p_trust_floor: 0 });
  });

  it("a repeat scan from a confirmed sender stays confirmed and never asks the database to lower trust", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 }, state: [{ trust_level: 3, state: "declined" }] });
    const r = await post(msg("scan me"));
    expect(r.body.response_key).toBe("bot.confirmed_y.title");
    expect(rpcBody()).toMatchObject({ p_new_state: "confirmed", p_trust_floor: 0 });
  });

  it("when the state could not be read, the write keeps the stored state instead of resetting it from a guess", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 }, stateFail: true });
    const r = await post(msg("scan me"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: "new", state_source: "fallback", next_state: null });
    expect(rpcBody()).toMatchObject({ p_channel: "telegram", p_sender_id: "42", p_new_state: null, p_trust_floor: 0 });
  });

  it("an interaction on X is log-only: no sender id sent, and its state is not advanced", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const r = await post(msg("scan", { platform: "x" }));
    expect(r.body).toMatchObject({ response_key: "bot.first_hexagon.title", state: "new", next_state: "new" });
    expect(rpcBody()).toMatchObject({ p_channel: "x", p_sender_id: null, p_new_state: "new", p_trust_floor: 0 });
  });

  it("writes back for /ingest/social Telegram envelopes too", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const res = await worker.fetch(
      new Request("https://brain.test/ingest/social", {
        method: "POST",
        headers: { authorization: `Bearer ${env.WEBHOOK_SECRET}` },
        body: JSON.stringify({ source: "telegram", payload: { message: { chat: { id: 5 }, text: "scan me" } } }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpcBody()).toMatchObject({ p_channel: "telegram", p_sender_id: "5", p_new_state: "awaiting_confirmation" });
  });

  it("never sends message text, emails or the Qwen key to the write-back call", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    await post(msg("my secret text jane@example.com +1 555 123 4567"));
    const body = rpcCalls()[0].init!.body as string;
    for (const leak of ["secret text", "jane@example.com", "555 123", env.QWEN_API_KEY, env.WEBHOOK_SECRET]) {
      expect(body).not.toContain(leak);
    }
  });

  it("the reply is identical when the write fails (HTTP error, network error, migration not applied)", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const ok = await post(msg("scan me"));
    for (const rpcFail of ["http", "throw"] as const) {
      stub({ qwen: { intent: "scan", confidence: 0.9 }, rpcFail });
      const failed = await post(msg("scan me"));
      expect(failed.status).toBe(200);
      expect(failed.body).toEqual(ok.body);
    }
  });

  it("a failed write is logged as a warning without leaking text, sender ids or keys", async () => {
    const logSpy = vi.spyOn(console, "log");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub({ qwen: { intent: "scan", confidence: 0.9 }, rpcFail: "http" });
    await post(msg("my secret text", { sender_id: "sender-9999" }));
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls].map((c) => String(c[0])).join("\n");
    expect(logged).toContain("state write failed");
    for (const leak of ["secret text", "sender-9999", env.SUPABASE_KEY, env.WEBHOOK_SECRET]) expect(logged).not.toContain(leak);
  });

  it("with an ExecutionContext the write runs after the reply (waitUntil) and is not awaited", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const waitUntil = vi.fn();
    const res = await worker.fetch(
      new Request("https://brain.test/webhook", { method: "POST", headers: { "x-mpt-webhook-secret": env.WEBHOOK_SECRET }, body: JSON.stringify(msg("scan me")) }),
      env,
      { waitUntil } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    await waitUntil.mock.calls[0][0];
    expect(rpcCalls()).toHaveLength(1);
  });

  it("does not write anything for rejected requests", async () => {
    stub({});
    await post(msg("hi"), {});
    await post({ platform: "telegram" });
    expect(rpcCalls()).toHaveLength(0);
  });

  // The fake below mirrors public.mpt_brain_record (state upsert, trust = greatest(existing, floor)); the real function is
  // covered by supabase/tests/schema.test.sql. This proves the Worker's decisions chain correctly across messages.
  it("trust advances across a conversation: scan -> teaser, yes -> confirmed, scan again -> report CTA", async () => {
    const db = new Map<string, { trust_level: number; state: string }>();
    const log: { before: { trust_level: number; state: string }; after: { trust_level: number; state: string }; key: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/chat/completions")) return new Response("down", { status: 500 }); // rules classify
      if (u.pathname.endsWith("/rpc/mpt_brain_record")) {
        const b = JSON.parse(init!.body as string);
        if (b.p_sender_id) {
          const row = db.get(`${b.p_channel}:${b.p_sender_id}`) ?? { trust_level: 0, state: "new" };
          const after = { state: b.p_new_state, trust_level: Math.max(row.trust_level, b.p_trust_floor) };
          log.push({ before: row, after, key: b.p_response_key });
          db.set(`${b.p_channel}:${b.p_sender_id}`, after);
        }
        return Response.json({});
      }
      const sender = (u.searchParams.get("sender_id") ?? "").replace("eq.", "");
      const row = db.get(`telegram:${sender}`);
      return Response.json(row ? [row] : []);
    });

    const t1 = await post(msg("scan me"));
    expect(t1.body).toMatchObject({ trust_level: 0, state_source: "anonymous", response_key: "bot.first_hexagon.title", next_state: "awaiting_confirmation" });
    const t2 = await post(msg("Y"));
    expect(t2.body).toMatchObject({ trust_level: 0, state: "awaiting_confirmation", state_source: "supabase", response_key: "bot.confirmed_y.title", next_state: "confirmed" });
    const t3 = await post(msg("scan me"));
    expect(t3.body).toMatchObject({ trust_level: 1, state: "confirmed", response_key: "bot.confirmed_y.title" });
    expect(db.get("telegram:42")).toEqual({ state: "confirmed", trust_level: 1 });
    expect(log.map((l) => l.after.trust_level)).toEqual([0, 1, 1]);

    // a different sender is untouched, and a "no" never raises trust
    const other = await post(msg("scan me", { sender_id: "77" }));
    expect(other.body).toMatchObject({ trust_level: 0, response_key: "bot.first_hexagon.title" });
    await post(msg("no", { sender_id: "77" }));
    expect(db.get("telegram:77")).toEqual({ state: "declined", trust_level: 0 });
  });
});

describe("POST /ingest/social (MPC-8301 hand-off)", () => {
  const bearer = { authorization: `Bearer ${env.WEBHOOK_SECRET}` };
  const ingest = async (body: unknown, headers: Record<string, string> = bearer) => {
    const res = await worker.fetch(
      new Request("https://brain.test/ingest/social", { method: "POST", headers, body: JSON.stringify(body) }),
      env,
    );
    return { status: res.status, body: (await res.json()) as Reply };
  };
  const tg = (text: string) => ({ source: "telegram", receivedAt: "2026-10-07T00:00:00Z", payload: { message: { chat: { id: 5 }, text } } });
  const xdm = (sender: string, text: string, forUser = "999") => ({
    source: "x",
    receivedAt: "2026-10-07T00:00:00Z",
    payload: { for_user_id: forUser, direct_message_events: [{ type: "message_create", message_create: { sender_id: sender, message_data: { text } } }] },
  });

  const li = (sender: string, text: string, org = "urn:li:organization:1") => ({
    source: "linkedin",
    receivedAt: "2026-10-07T00:00:00Z",
    payload: { organization: org, events: [{ from: sender, message: { text } }] },
  });

  it("requires the bearer token (service-binding callers included) and never calls out without it", async () => {
    stub({});
    expect((await ingest(tg("hi"), {})).status).toBe(401);
    expect((await ingest(tg("hi"), { authorization: "Bearer nope" })).status).toBe(401);
    expect((await ingest(tg("hi"), { "x-mpt-webhook-secret": env.WEBHOOK_SECRET })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("routes a Telegram envelope and looks the sender up on the telegram channel", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const r = await ingest(tg("scan me"));
    expect(r.body).toMatchObject({ ok: true, intent: "scan", response_key: "bot.first_hexagon.title" });
    const q = new URL(calls.find((c) => c.url.includes("conversation_states"))!.url).searchParams;
    expect(q.get("channel")).toBe("eq.telegram");
    expect(q.get("sender_id")).toBe("eq.5");
  });

  it("routes an X DM as an anonymous user (no X state channel yet)", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    const r = await ingest(xdm("123", "how does this work?"));
    expect(r.body).toMatchObject({ ok: true, intent: "help", state_source: "anonymous", response_key: "bot.unknown.title" });
    expect(calls.some((c) => c.url.includes("conversation_states"))).toBe(false);
  });

  it("routes a LinkedIn message as an anonymous user (no LinkedIn state channel yet)", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    const r = await ingest(li("urn:li:person:abc", "how does this work?"));
    expect(r.body).toMatchObject({ ok: true, intent: "help", state_source: "anonymous", response_key: "bot.unknown.title" });
    expect(calls.some((c) => c.url.includes("conversation_states"))).toBe(false);
  });

  it("ignores LinkedIn events with no text and our own messages", async () => {
    stub({});
    for (const body of [li("urn:li:person:abc", ""), li("urn:li:organization:1", "echo", "urn:li:organization:1"), { source: "linkedin", payload: { events: [] } }]) {
      expect((await ingest(body)).body).toEqual({ ok: true, ignored: true });
    }
    expect(calls).toHaveLength(0);
  });

  it("acknowledges verified events with no user text, and our own messages, with 200 ignored (no retry storm)", async () => {
    stub({});
    for (const body of [
      { source: "x", payload: { favorite_events: [{}] } },
      { source: "x", payload: { direct_message_events: [] } },
      xdm("999", "echo of our own reply"),
      { source: "telegram", payload: { edited_message: { chat: { id: 1 }, text: "x" } } },
    ]) {
      const r = await ingest(body);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, ignored: true });
    }
    expect(calls).toHaveLength(0);
  });

  it("400 on an unknown source", async () => {
    stub({});
    expect((await ingest({ source: "myspace", payload: {} })).status).toBe(400);
  });
});

describe("rate limiting (MPC-7257)", () => {
  // Fake Workers Rate Limiting binding: allows `max` calls per key, then refuses. Records every key it is asked about.
  const limiter = (max: number) => {
    const seen = new Map<string, number>();
    const keys: string[] = [];
    return { keys, limit: async ({ key }: { key: string }) => { keys.push(key); const n = (seen.get(key) ?? 0) + 1; seen.set(key, n); return { success: n <= max }; } };
  };

  it("lets 10 requests through and returns 429 on the 11th, with Retry-After and the shared error shape", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    const e = { ...env, RATE_LIMITER: limiter(10) };
    for (let i = 0; i < 10; i++) expect((await post(msg("help"), undefined, e)).status).toBe(200);
    const before = calls.length;
    const res = await worker.fetch(new Request("https://brain.test/webhook", { method: "POST", headers: { "x-mpt-webhook-secret": env.WEBHOOK_SECRET }, body: JSON.stringify(msg("help")) }), e);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({ error: { code: "rate_limited", message: "Too many requests" } });
    expect(calls.length).toBe(before); // no Qwen or Supabase call for a throttled request
  });

  it("limits each sender separately, keyed by platform:sender_id", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    const l = limiter(1);
    const e = { ...env, RATE_LIMITER: l };
    expect((await post(msg("help", { sender_id: "1" }), undefined, e)).status).toBe(200);
    expect((await post(msg("help", { sender_id: "1" }), undefined, e)).status).toBe(429);
    expect((await post(msg("help", { sender_id: "2" }), undefined, e)).status).toBe(200);
    expect(l.keys).toEqual(["telegram:1", "telegram:1", "telegram:2"]);
  });

  it("applies the global backstop after the per-sender check", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    const e = { ...env, RATE_LIMITER: limiter(10), RATE_LIMITER_GLOBAL: limiter(2) };
    expect((await post(msg("help", { sender_id: "1" }), undefined, e)).status).toBe(200);
    expect((await post(msg("help", { sender_id: "2" }), undefined, e)).status).toBe(200);
    expect((await post(msg("help", { sender_id: "3" }), undefined, e)).status).toBe(429);
  });

  it("does not consume the limit for requests that fail auth or validation", async () => {
    stub({});
    const l = limiter(10);
    const e = { ...env, RATE_LIMITER: l };
    expect((await post(msg("help"), {}, e)).status).toBe(401);
    expect((await post("not json", undefined, e)).status).toBe(400);
    expect(l.keys).toEqual([]);
  });

  it("fails open when the binding is missing or throws", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    expect((await post(msg("help"))).status).toBe(200);
    const broken = { limit: async () => { throw new Error("boom"); } };
    expect((await post(msg("help"), undefined, { ...env, RATE_LIMITER: broken })).status).toBe(200);
  });

  it("never logs the sender id or message text when throttling", async () => {
    stub({});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await post(msg("my secret text", { sender_id: "sender-777" }), undefined, { ...env, RATE_LIMITER: limiter(0) });
    const out = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(out).toContain("rate_limited");
    expect(out).not.toContain("sender-777");
    expect(out).not.toContain("my secret text");
  });
});
