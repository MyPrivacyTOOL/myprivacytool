// @vitest-environment node
// MPC-8528: the support Worker's HTTP surface. Injected in-memory store and fakes: no network, no provider, no database.
import { describe, it, expect, vi } from "vitest";
import { createHandler, type Env } from "./index";
import { MemoryCaseStore } from "../../shared/support/memory-store";
import { buildTools, DEFAULT_POLICY, type SupportDeps, type Model, type Notifier } from "../../shared/support";

const TOKEN = "t-test-token";
const env = (o: Partial<Env> = {}): Env => ({ SUPPORT_AI_ENABLED: "1", SUPPORT_INTAKE_TOKEN: TOKEN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k", RATE_LIMITER: { limit: async () => ({ success: true }) }, ...o });
const body = (o: Record<string, unknown> = {}) => ({ channel: "web", providerEventId: `e-${Math.random()}`, text: "I can't find my report", senderHandle: "v1", ...o });
const post = (b: unknown, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }, path = "/intake") =>
  new Request(`https://w.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof b === "string" ? b : JSON.stringify(b) });

function setup(over: Partial<SupportDeps> = {}) {
  const store = new MemoryCaseStore(); const sent: string[] = [];
  const notifier: Notifier = { send: async (_r, _c, t) => { sent.push(t); return { providerMessageId: "p" }; } };
  const model: Model = { complete: vi.fn(async () => ({ text: "", toolCalls: [{ tool: "diagnose_report_status", args: {} }] })) };
  const build = vi.fn((): SupportDeps => ({ store, policy: DEFAULT_POLICY, tools: buildTools(store), notifier, model, ...over }));
  return { store, sent, model, build, handler: createHandler(build) };
}

describe("fail-closed gates", () => {
  it("disabled by default: 503, nothing built, nothing stored", async () => {
    const t = setup();
    const r = await t.handler(post(body()), env({ SUPPORT_AI_ENABLED: "0" }));
    expect(r.status).toBe(503); expect((await r.json()).error.code).toBe("support_disabled");
    expect(t.build).not.toHaveBeenCalled(); expect(t.store.cases.size).toBe(0);
    expect((await t.handler(post(body()), { ...env(), SUPPORT_AI_ENABLED: undefined })).status).toBe(503);
  });
  it("enabled but missing a binding, the token, or the rate limiter: 503 not_configured", async () => {
    const t = setup();
    for (const miss of ["SUPPORT_INTAKE_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMITER"] as const) {
      const r = await t.handler(post(body()), env({ [miss]: undefined }));
      expect(r.status, miss).toBe(503); expect((await r.json()).error.code).toBe("not_configured");
    }
    expect(t.store.cases.size).toBe(0);
  });
  it("wrong, missing and malformed credentials: 401, nothing stored", async () => {
    const t = setup();
    for (const h of [{}, { Authorization: "Bearer nope" }, { Authorization: TOKEN }, { Authorization: `bearer ${TOKEN}` }, { Authorization: `Bearer ${TOKEN}x` }] as Record<string, string>[]) expect((await t.handler(post(body(), h), env())).status).toBe(401);
    expect(t.store.cases.size).toBe(0);
  });
  it("rate limiter: over the limit is 429, and a limiter error fails closed (503) before any model or store work", async () => {
    const t = setup();
    const r = await t.handler(post(body()), env({ RATE_LIMITER: { limit: async () => ({ success: false }) } }));
    expect(r.status).toBe(429); expect(r.headers.get("Retry-After")).toBe("60");
    const r2 = await t.handler(post(body()), env({ RATE_LIMITER: { limit: async () => { throw new Error("binding down"); } } }));
    expect(r2.status).toBe(503);
    expect(t.build).not.toHaveBeenCalled(); expect(t.model.complete).not.toHaveBeenCalled(); expect(t.store.cases.size).toBe(0);
  });
});

describe("identity proof", () => {
  const goodToken = "A".repeat(43);
  it("a well-formed proof reaches the verifier; a malformed one is dropped before it", async () => {
    const seen: (string | undefined)[] = [];
    const verifier = { resolve: async (p: string | undefined) => { seen.push(p); return { level: "anonymous" as const }; } };
    const t = setup({ verifier });
    await t.handler(post(body({ proof: goodToken })), env());
    await t.handler(post(body({ proof: "not-a-token" })), env());
    await t.handler(post(body({ proof: 12345 })), env());
    expect(seen).toEqual([goodToken]); // the verifier is only ever asked about the well-formed one
  });
});

describe("request validation", () => {
  it("rejects bad JSON, unknown channel, missing event id, empty text, oversize bodies", async () => {
    const t = setup();
    expect((await t.handler(post("{nope"), env())).status).toBe(400);
    expect((await t.handler(post(body({ channel: "fax" })), env())).status).toBe(400);
    expect((await t.handler(post(body({ providerEventId: "  " })), env())).status).toBe(400);
    expect((await t.handler(post(body({ text: "   " })), env())).status).toBe(400);
    expect((await t.handler(post(body({ text: "a".repeat(40_000) })), env())).status).toBe(413);
    expect(t.store.cases.size).toBe(0);
  });
  it("only POST /intake and GET /health exist", async () => {
    const t = setup();
    expect((await t.handler(new Request("https://w.test/intake"), env())).status).toBe(405);
    expect((await t.handler(new Request("https://w.test/other"), env())).status).toBe(404);
    const h = await (await t.handler(new Request("https://w.test/health"), env({ SUPPORT_AI_ENABLED: "0" }))).json();
    expect(h).toMatchObject({ ok: true, enabled: false, configured: true });
    expect(JSON.stringify(h)).not.toContain(TOKEN); expect(JSON.stringify(h)).not.toContain("x.test"); // booleans only
  });
});

describe("intake", () => {
  it("bare HELP stores nothing and calls nothing", async () => {
    const t = setup();
    const r = await t.handler(post(body({ helpOnly: true, text: "" })), env());
    expect(r.status).toBe(200); const j = await r.json(); expect(j.caseRef).toBeNull(); expect(j.reply).toContain("does not start a scan");
    expect(t.store.cases.size).toBe(0); expect(t.model.complete).not.toHaveBeenCalled();
  });
  it("a real message is stored before the reference is returned; the persisted case matches the response", async () => {
    const t = setup({ model: undefined });
    const r = await t.handler(post(body()), env());
    const j = await r.json();
    expect(r.status).toBe(200); expect(j.caseRef).toMatch(/^SUP-/);
    const stored = [...t.store.cases.values()][0];
    expect(stored.ref).toBe(j.caseRef); expect(stored.state).toBe(j.state); expect(t.store.messages.filter((m) => m.direction === "inbound")).toHaveLength(1);
  });
  it("a store failure returns 503 not_recorded with NO case reference and no model call", async () => {
    const t = setup(); t.store.failBefore.add("createCaseFromEvent");
    const r = await t.handler(post(body()), env());
    const j = await r.json();
    expect(r.status).toBe(503); expect(j.error.code).toBe("not_recorded"); expect(j.caseRef).toBeUndefined(); expect(j.reply).toContain("no case was created");
    expect(t.model.complete).not.toHaveBeenCalled(); expect(t.sent).toHaveLength(0);
  });
  it("a repeated provider event returns the same case and does no second reply or model call", async () => {
    const t = setup(); const b = body();
    const a = await (await t.handler(post(b), env())).json(); const c = await (await t.handler(post(b), env())).json();
    expect(c.duplicate).toBe(true); expect(c.caseRef).toBe(a.caseRef); expect(t.sent).toHaveLength(1); expect(t.model.complete).toHaveBeenCalledTimes(1);
  });
  it("no verifier is wired and the shipped policy approves nothing: a model-requested private tool is denied or disabled, never run", async () => {
    const t = setup();
    await t.handler(post(body()), env());
    expect([...t.store.receipts.values()].map((x) => x.outcome)).toEqual(["denied"]);
  });
  it("an unexpected error is a 500 that logs metadata only, never message text", async () => {
    const t = setup(); t.store.failBefore.add("addOutbound");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const secret = "my-very-private-sentence";
    const r = await t.handler(post(body({ text: secret })), env());
    expect(r.status).toBe(500);
    expect(spy.mock.calls.flat().join(" ")).not.toContain(secret);
    spy.mockRestore();
  });
  it("buildDeps failure is 503, not a crash", async () => {
    const h = createHandler(() => { throw new Error("bad config"); });
    expect((await h(post(body()), env())).status).toBe(503);
  });
});
