// @vitest-environment node
// MPC-8528: RestCaseStore request shape and fail-closed behaviour against a FAKE fetch. No network, no Supabase project.
// SQL behaviour (atomic dedupe) is covered by supabase/proposed/mpc_8528_support_cases.test.sql on a throwaway Postgres.
import { describe, it, expect, vi } from "vitest";
import { RestCaseStore, handleInbound, buildTools, type SupportDeps, type Model, type Notifier, type InboundEvent } from "./index";

const row = { id: "c1", ref: "SUP-ABCDEFGH", channel: "web", thread_key: null, sender_handle: "v1", state: "new", state_reason: null, identity_level: "channel_asserted", linked_subject_id: null, tenant_id: null, policy_version: "p", knowledge_version: null, created_at: "2026-10-26T00:00:00Z", updated_at: "2026-10-26T00:00:00Z", reopen_count: 0 };
type Call = { url: string; init: RequestInit };
function fake(handler: (c: Call) => { status?: number; body?: unknown } | Promise<never>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c = { url, init }; calls.push(c);
    const r = await handler(c);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, store: new RestCaseStore({ baseUrl: "https://test.invalid", serviceKey: "k-test", fetchImpl }) };
}
const ev: InboundEvent = { channel: "web", providerEventId: "e1", text: "hi", senderHandle: "v1", receivedAt: "2026-10-26T00:00:00Z" };

describe("RestCaseStore", () => {
  it("rejects non-https base URLs and a missing key", () => {
    expect(() => new RestCaseStore({ baseUrl: "http://example.com", serviceKey: "k" })).toThrow();
    expect(() => new RestCaseStore({ baseUrl: "https://x.test", serviceKey: "" })).toThrow();
  });
  it("calls the atomic intake RPC with service credentials and maps the case", async () => {
    const { store, calls } = fake(() => ({ body: { case: row, duplicate: false } }));
    const r = await store.createCaseFromEvent(ev, { ref: "SUP-ABCDEFGH", policyVersion: "p", now: "n" });
    expect(r.case.ref).toBe("SUP-ABCDEFGH"); expect(r.duplicate).toBe(false);
    expect(calls[0].url).toBe("https://test.invalid/rest/v1/rpc/support_create_case_from_event");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.apikey).toBe("k-test"); expect(h.Authorization).toBe("Bearer k-test");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ p_channel: "web", p_event_id: "e1", p_sender: "v1" });
  });
  it("uses the Supabase /rest/v1 prefix by default and honours restPrefix", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => { urls.push(u); return new Response("[]", { status: 200 }); }) as unknown as typeof fetch;
    await new RestCaseStore({ baseUrl: "https://test.invalid", serviceKey: "k", fetchImpl }).getCase("c1");
    await new RestCaseStore({ baseUrl: "https://test.invalid", serviceKey: "k", fetchImpl, restPrefix: "" }).getCase("c1");
    expect(urls[0]).toBe("https://test.invalid/rest/v1/support_cases?id=eq.c1&limit=1");
    expect(urls[1]).toBe("https://test.invalid/support_cases?id=eq.c1&limit=1");
  });
  it("URL-encodes filter values so a hostile thread key cannot add filters", async () => {
    const { store, calls } = fake(() => ({ body: [] }));
    await store.findCaseByThread("email", "x&state=eq.closed");
    expect(calls[0].url).toContain("thread_key=eq.x%26state%3Deq.closed");
    expect(calls[0].url.match(/state=/g)).toBeNull();
  });
  it("throws on non-2xx, malformed bodies, and network errors (fail closed)", async () => {
    await expect(fake(() => ({ status: 500 })).store.createCaseFromEvent(ev, { ref: "r", policyVersion: "p", now: "n" })).rejects.toThrow(/500/);
    await expect(fake(() => ({ body: { nope: 1 } })).store.createCaseFromEvent(ev, { ref: "r", policyVersion: "p", now: "n" })).rejects.toThrow(/unexpected/);
    await expect(fake(() => Promise.reject(new Error("ECONNRESET"))).store.getCase("c1")).rejects.toThrow();
    await expect(fake(() => ({ body: [] })).store.updateCase("c1", { state: "triage" }, "n")).rejects.toThrow(/not updated/);
  });
  it("upserts receipts by (case, idempotency key) and only writes whitelisted case columns", async () => {
    const { store, calls } = fake((c) => ({ body: c.url.includes("receipts") ? [{ id: "r1", case_id: "c1", tool: "t", idempotency_key: "k", policy_version: "p", outcome: "unknown", detail: null, cost_units: 0, created_at: "n" }] : [row] }));
    const rc = await store.putReceipt({ caseId: "c1", tool: "t", idempotencyKey: "k", policyVersion: "p", outcome: "unknown", costUnits: 0, at: "n" });
    expect(rc.outcome).toBe("unknown");
    expect(calls[0].url).toContain("on_conflict=case_id,idempotency_key");
    expect((calls[0].init.headers as Record<string, string>).Prefer).toContain("merge-duplicates");
    await store.updateCase("c1", { state: "triage", id: "evil", ref: "SUP-HACKED" } as never, "n");
    const patch = JSON.parse(calls[1].init.body as string);
    expect(Object.keys(patch).sort()).toEqual(["state", "updated_at"]);
  });
  it("end to end with the service: a failing store write yields no reference and no reply", async () => {
    const { store } = fake(() => ({ status: 503 }));
    const sent: string[] = [];
    const notifier: Notifier = { send: async (_r, _c, t) => { sent.push(t); return { providerMessageId: "p" }; } };
    const model: Model = { complete: vi.fn(async () => ({ text: "x" })) };
    const deps: SupportDeps = { store, policy: { version: "p", maxToolCallsPerTurn: 1, tools: {} }, tools: buildTools(store), notifier, model };
    const r = await handleInbound(deps, ev);
    expect(r.caseRef).toBeUndefined(); expect(r.replyText).toContain("no case was created");
    expect(sent).toHaveLength(0); expect(model.complete).not.toHaveBeenCalled();
  });
});
