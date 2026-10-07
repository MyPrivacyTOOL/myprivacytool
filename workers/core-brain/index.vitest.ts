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

type Stub = { qwen?: any; state?: any; qwenFail?: boolean; stateFail?: boolean };
let calls: { url: string; init?: RequestInit }[] = [];

function stub({ qwen, state = [], qwenFail, stateFail }: Stub) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/chat/completions")) {
      if (qwenFail) return new Response("boom", { status: 500 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(qwen) } }] });
    }
    if (stateFail) return new Response("boom", { status: 500 });
    return Response.json(state);
  });
}

async function post(body: unknown, headers: Record<string, string> = { "x-mpt-webhook-secret": env.WEBHOOK_SECRET }, e: any = env) {
  const res = await worker.fetch(
    new Request("https://brain.test/webhook", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    e,
  );
  return { status: res.status, body: (await res.json()) as any };
}

const msg = (text: string, extra = {}) => ({ platform: "telegram", sender_id: "42", message_text: text, ...extra });

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.unstubAllGlobals());

describe("auth and validation", () => {
  it("rejects a missing or wrong secret and never calls out", async () => {
    stub({});
    const noSecret = await post(msg("hi"), {});
    expect(noSecret.status).toBe(401);
    expect(noSecret.body.error.code).toBe("unauthorized");
    expect((await post(msg("hi"), { "x-mpt-webhook-secret": "nope" })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("fails closed (503) when a binding is missing", async () => {
    stub({});
    const r = await post(msg("hi"), undefined, { ...env, WEBHOOK_SECRET: undefined });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("not_configured");
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
    expect(await ok.json()).toEqual({ ok: true, worker: "core-brain", configured: true });
    const bare = await worker.fetch(new Request("https://brain.test/health"), {} as any);
    expect((await bare.json() as any).configured).toBe(false);
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

  it("looks the sender up by channel and context->>sender_id with the service key", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    await post(msg("help"));
    const sb = calls.find((c) => c.url.includes("/rest/v1/conversation_states"))!;
    const q = new URL(sb.url).searchParams;
    expect(q.get("channel")).toBe("eq.telegram");
    expect(q.get("context->>sender_id")).toBe("eq.42");
    expect((sb.init!.headers as any).apikey).toBe(env.SUPABASE_KEY);
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

  it("normalizes locale (pt-BR -> pt) and falls back to en for unsupported ones", async () => {
    stub({ qwen: { intent: "help", confidence: 0.9 } });
    expect((await post(msg("help", { locale: "pt-BR" }))).body.locale).toBe("pt");
    expect((await post(msg("help", { locale: "xx" }))).body.locale).toBe("en");
  });

  it("accepts a raw Telegram update", async () => {
    stub({ qwen: { intent: "scan", confidence: 0.9 } });
    const r = await post({ message: { chat: { id: 7 }, text: "scan", from: { language_code: "ja" } } });
    expect(r.body).toMatchObject({ intent: "scan", locale: "ja" });
    expect(new URL(calls.find((c) => c.url.includes("conversation_states"))!.url).searchParams.get("context->>sender_id")).toBe("eq.7");
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
    expect((q.init!.headers as any).authorization).toBe("Bearer qwen-test-key");
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
