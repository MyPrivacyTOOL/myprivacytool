// @vitest-environment node
// MPC-8528: RestCaseStore and the service over a REAL PostgREST on a throwaway Postgres (CI job `support-rest`).
// Skips itself unless SUPPORT_REST_URL is set. Never point it at a Supabase project: it writes synthetic rows.
// Every assertion reads state back from the database through the API; nothing is satisfied by a canned response.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { RestCaseStore, RestProofStore, ProofVerifier, hashProof, handleInbound, buildTools, newCaseRef, type InboundEvent, type Notifier, type Model, type SupportDeps, type SupportPolicy, APPROVED_MODEL_BUDGET } from "./index";

const URL_ = process.env.SUPPORT_REST_URL;
const SECRET = process.env.SUPPORT_REST_JWT_SECRET ?? "";
const run = URL_ && SECRET && /^http:\/\/(localhost|127\.0\.0\.1)/.test(URL_) ? describe : describe.skip;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => {
  const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${head}.${createHmac("sha256", SECRET).update(head).digest("base64url")}`;
};
const store = (role = "service_role") => new RestCaseStore({ baseUrl: URL_ ?? "http://localhost:0", serviceKey: jwt(role), restPrefix: "" });
const now = new Date().toISOString();
const ev = (o: Partial<InboundEvent> = {}): InboundEvent => ({ channel: "web", providerEventId: `it-${randomUUID()}`, text: "I can't find my report", senderHandle: "visitor-1", receivedAt: now, ...o });
const init = () => ({ ref: newCaseRef(), policyVersion: "it-test", now });

run("RestCaseStore against PostgREST + Postgres", () => {
  beforeAll(async () => {
    // Fail fast and clearly if PostgREST cannot see the schema (an empty schema cache otherwise shows up as 404 everywhere).
    const r = await fetch(`${URL_}/`, { headers: { Authorization: `Bearer ${jwt("service_role")}` } });
    const spec = (await r.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});
    for (const need of ["/support_cases", "/support_messages", "/support_action_receipts", "/support_usage", "/rpc/support_create_case_from_event", "/rpc/support_append_inbound"])
      expect(paths, `PostgREST does not expose ${need}; exposed: ${paths.join(", ")}`).toContain(need);
  });
  it("creates a case, and a repeated provider event returns the same case without a second one", async () => {
    const s = store(); const e = ev();
    const a = await s.createCaseFromEvent(e, init());
    expect(a.duplicate).toBe(false);
    const back = await s.getCaseByRef(a.case.ref);
    expect(back?.id).toBe(a.case.id); expect(back?.state).toBe("new"); expect(back?.identityLevel).toBe("channel_asserted");
    const b = await s.createCaseFromEvent(e, init());
    expect(b.duplicate).toBe(true); expect(b.case.id).toBe(a.case.id);
  });
  it("the same event id on another channel is a different event", async () => {
    const s = store(); const e = ev();
    const a = await s.createCaseFromEvent(e, init());
    const b = await s.createCaseFromEvent({ ...e, channel: "email" }, init());
    expect(b.duplicate).toBe(false); expect(b.case.id).not.toBe(a.case.id);
  });
  it("10 parallel identical events (no thread) end with exactly one surviving case", async () => {
    const s = store(); const e = ev({ senderHandle: undefined });
    const inits = Array.from({ length: 10 }, init);
    const results = await Promise.allSettled(inits.map((i) => s.createCaseFromEvent(e, i)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof s.createCaseFromEvent>>> => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok.map((r) => r.value.case.id)).size).toBe(1);
    expect(ok.filter((r) => !r.value.duplicate)).toHaveLength(1);
    const alive = (await Promise.all(inits.map((i) => s.getCaseByRef(i.ref)))).filter(Boolean);
    expect(alive).toHaveLength(1); // every losing attempt's case was removed in the same transaction
  });
  it("10 parallel identical events on one thread never produce two cases (a conflict fails closed)", async () => {
    const s = store(); const e = ev({ threadKey: `th-${randomUUID()}` });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => s.createCaseFromEvent(e, init())));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof s.createCaseFromEvent>>> => r.status === "fulfilled");
    expect(new Set(ok.map((r) => r.value.case.id)).size).toBeLessThanOrEqual(1);
    const found = await s.findCaseByThread("web", e.threadKey!);
    expect(found).not.toBeNull();
    if (ok.length) expect(ok[0].value.case.id).toBe(found!.id);
    const retry = await s.createCaseFromEvent(e, init()); // a customer retry after any failure dedupes to the same case
    expect(retry.duplicate).toBe(true); expect(retry.case.id).toBe(found!.id);
  });
  it("append stores once and reports a repeat as duplicate", async () => {
    const s = store(); const c = (await s.createCaseFromEvent(ev({ threadKey: `th-${randomUUID()}` }), init())).case;
    const e2 = ev({ text: "reply" });
    expect((await s.appendInbound(c.id, e2)).duplicate).toBe(false);
    expect((await s.appendInbound(c.id, e2)).duplicate).toBe(true);
  });
  it("updateCase changes only whitelisted columns and throws for an unknown case", async () => {
    const s = store(); const c = (await s.createCaseFromEvent(ev(), init())).case;
    const u = await s.updateCase(c.id, { state: "triage", reopenCount: 2, ref: "SUP-HACKED00", id: "x" } as never, now);
    expect(u.state).toBe("triage"); expect(u.reopenCount).toBe(2); expect(u.ref).toBe(c.ref); expect(u.id).toBe(c.id);
    await expect(s.updateCase(randomUUID(), { state: "triage" }, now)).rejects.toThrow(/not updated/);
  });
  it("the database refuses an illegal state and an unverified 'verified' link", async () => {
    const s = store(); const c = (await s.createCaseFromEvent(ev(), init())).case;
    await expect(s.updateCase(c.id, { state: "escalated_to_founder" as never }, now)).rejects.toThrow();
    await expect(s.updateCase(c.id, { identityLevel: "verified" }, now)).rejects.toThrow(); // needs subject and tenant
    const ok = await s.updateCase(c.id, { identityLevel: "verified", linkedSubjectId: "u1", tenantId: "t1" }, now);
    expect(ok.linkedSubjectId).toBe("u1");
  });
  it("receipts upsert by (case, key): the write-ahead 'unknown' is replaced, never duplicated", async () => {
    const s = store(); const c = (await s.createCaseFromEvent(ev(), init())).case;
    const base = { caseId: c.id, tool: "t", idempotencyKey: "k1", policyVersion: "p", costUnits: 0, at: now };
    const a = await s.putReceipt({ ...base, outcome: "unknown", detail: "started" });
    const b = await s.putReceipt({ ...base, outcome: "success", detail: "done" });
    expect(b.id).toBe(a.id);
    const got = await s.getReceipt(c.id, "k1");
    expect(got?.outcome).toBe("success"); expect(got?.detail).toBe("done");
  });
  it("outbound messages and delivery status persist", async () => {
    const s = store(); const c = (await s.createCaseFromEvent(ev(), init())).case;
    const m = await s.addOutbound(c.id, "hello", "ai", now);
    expect(m.delivery).toBe("queued");
    await s.setDelivery(m.id, "failed");
    const r = await fetch(`${URL_}/support_messages?id=eq.${m.id}&select=delivery`, { headers: { Authorization: `Bearer ${jwt("service_role")}` } });
    expect((await r.json())[0].delivery).toBe("failed");
  });
  it("usage accounting sums calls and cost inside the window", async () => {
    const s = store(); const key = `tool:${randomUUID()}`;
    await s.recordUsage(key, 2, now); await s.recordUsage(key, 3, now);
    expect(await s.usageSince(key, new Date(Date.now() - 60_000).toISOString())).toEqual({ calls: 2, costUnits: 5 });
    expect(await s.usageSince(key, new Date(Date.now() + 60_000).toISOString())).toEqual({ calls: 0, costUnits: 0 });
  });
  it("anon and authenticated roles cannot read or call anything over HTTP", async () => {
    const body = JSON.stringify({ p_channel: "web", p_event_id: `deny-${randomUUID()}`, p_thread_key: null, p_sender: null, p_text: "x", p_ref: newCaseRef(), p_policy: "p" });
    const read = (role?: string) => fetch(`${URL_}/support_cases?select=id&limit=1`, { headers: role ? { Authorization: `Bearer ${jwt(role)}` } : {} });
    const call = (role?: string) => fetch(`${URL_}/rpc/support_create_case_from_event`, { method: "POST", headers: { "Content-Type": "application/json", ...(role ? { Authorization: `Bearer ${jwt(role)}` } : {}) }, body });
    // positive control: the same requests succeed for service_role, so a denial below means a permission refusal, not a missing route
    expect((await read("service_role")).status).toBe(200);
    expect((await call("service_role")).status).toBe(200);
    for (const role of ["anon", "authenticated", undefined]) {
      for (const res of [await read(role), await call(role)]) expect([401, 403], `${role ?? "no token"}`).toContain(res.status);
    }
  });
  it("handleInbound end to end: the persisted case, messages and receipt match what the customer was told", async () => {
    const s = store(); const sent: string[] = [];
    const notifier: Notifier = { send: async (_r, _c, t) => { sent.push(t); return { providerMessageId: "p" }; } };
    const model: Model = { complete: vi.fn(async () => ({ text: "", toolCalls: [{ tool: "get_case_status", args: {} }] })) };
    const deps: SupportDeps = {
      store: s, notifier, model, tools: buildTools(s),
      knowledge: { search: async () => [{ id: "faq", version: "v1", status: "approved", approvedBy: "owner", title: "t", body: "b", scope: [] }] },
      policy: { version: "it-policy", maxToolCallsPerTurn: 2, modelBudget: APPROVED_MODEL_BUDGET, tools: { get_case_status: { approvedPolicyVersion: "it-only", requiredIdentity: "channel_asserted", maxCallsPerHour: 5, maxCostUnitsPerDay: 5, timeoutMs: 3000 } } },
    };
    const e = ev({ threadKey: `th-${randomUUID()}` });
    const r1 = await handleInbound(deps, e);
    expect(r1.caseRef).toBeDefined(); expect(r1.delivered).toBe(true);
    const stored = await s.getCaseByRef(r1.caseRef!);
    expect(stored?.state).toBe("waiting_customer");
    expect(sent[0]).toContain(r1.caseRef!); expect(sent[0]).toMatch(/state=/);
    const rr = await fetch(`${URL_}/support_action_receipts?case_id=eq.${stored!.id}&select=tool,outcome,policy_version`, { headers: { Authorization: `Bearer ${jwt("service_role")}` } });
    expect(await rr.json()).toEqual([{ tool: "get_case_status", outcome: "success", policy_version: "it-policy" }]);
    const r2 = await handleInbound(deps, e); // a repeated provider event
    expect(r2.duplicate).toBe(true); expect(sent).toHaveLength(1); expect(model.complete).toHaveBeenCalledTimes(1);
  });

  describe("identity proofs on real Postgres", () => {
    const pstore = () => new RestProofStore({ baseUrl: URL_ ?? "http://localhost:0", serviceKey: jwt("service_role"), restPrefix: "" });
    const verifiedPolicy: SupportPolicy = {
      version: "it-proof-policy", maxToolCallsPerTurn: 1, modelBudget: APPROVED_MODEL_BUDGET,
      tools: { get_case_status: { approvedPolicyVersion: "it-only", requiredIdentity: "verified", maxCallsPerHour: 5, maxCostUnitsPerDay: 5, timeoutMs: 3000 } },
    };
    const mkDeps = (s: RestCaseStore): SupportDeps => ({
      store: s, policy: verifiedPolicy, tools: buildTools(s), notifier: { send: async () => ({ providerMessageId: "p" }) } as Notifier,
      model: { complete: async () => ({ text: "", toolCalls: [{ tool: "get_case_status", args: {} }] }) } as Model,
      verifier: new ProofVerifier(pstore()),
    });
    const receipts = async (caseId: string) => (await (await fetch(`${URL_}/support_action_receipts?case_id=eq.${caseId}&select=outcome&order=created_at`, { headers: { Authorization: `Bearer ${jwt("service_role")}` } })).json()) as { outcome: string }[];

    it("a proof redeems exactly once; replay, unknown and malformed tokens give nothing", async () => {
      const p = pstore(); const { token } = await p.issue(`user-${randomUUID()}`, "t1", 600);
      expect(await p.redeem(token)).toMatchObject({ tenantId: "t1" });
      expect(await p.redeem(token)).toBeNull(); // single use
      expect(await p.redeem("A".repeat(43))).toBeNull(); // well-formed but unknown
      expect(await p.redeem("junk")).toBeNull();
    });
    it("8 parallel redemptions of one proof: exactly one winner", async () => {
      const p = pstore(); const { token } = await p.issue(`user-${randomUUID()}`, "t1", 600);
      const results = await Promise.all(Array.from({ length: 8 }, () => p.redeem(token)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });
    it("an expired proof cannot be redeemed", async () => {
      const p = pstore(); const { token } = await p.issue(`user-${randomUUID()}`, "t1", 600);
      const h = await hashProof(token);
      const r = await fetch(`${URL_}/support_proofs?token_hash=eq.${h}`, { method: "PATCH", headers: { Authorization: `Bearer ${jwt("service_role")}`, "Content-Type": "application/json" }, body: JSON.stringify({ created_at: new Date(Date.now() - 7_200_000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() }) });
      expect(r.ok).toBe(true);
      expect(await p.redeem(token)).toBeNull();
    });
    it("the database refuses out-of-range lifetimes", async () => {
      await expect(pstore().issue("u", "t", 30)).rejects.toThrow(); await expect(pstore().issue("u", "t", 7200)).rejects.toThrow();
    });
    it("end to end: a redeemed proof links the case and lets the verified tool run once; no proof, a replayed proof and a different user are all refused", async () => {
      const s = store(); const p = pstore(); const subject = `user-${randomUUID()}`; const thread = `th-${randomUUID()}`;
      const deps = mkDeps(s);
      const { token } = await p.issue(subject, "t1", 600);
      const r1 = await handleInbound(deps, ev({ threadKey: thread }), token);
      const c = (await s.getCaseByRef(r1.caseRef!))!;
      expect(c.identityLevel).toBe("verified"); expect(c.linkedSubjectId).toBe(subject); expect(c.tenantId).toBe("t1");
      expect(await receipts(c.id)).toEqual([{ outcome: "success" }]);
      // same thread, no proof: back to channel_asserted, the verified tool is denied
      await handleInbound(deps, ev({ threadKey: thread, text: "and now?" }));
      // same thread, the SAME proof again: already consumed, so denied
      await handleInbound(deps, ev({ threadKey: thread, text: "again" }), token);
      // same thread, a valid proof for a DIFFERENT user: the link is not replaced and the call is denied
      const other = await p.issue(`user-${randomUUID()}`, "t1", 600);
      await handleInbound(deps, ev({ threadKey: thread, text: "hi" }), other.token);
      expect((await s.getCase(c.id))?.linkedSubjectId).toBe(subject);
      const outcomes = (await receipts(c.id)).map((x) => x.outcome);
      // 1 success; the no-proof attempt and the other-user attempt are both downgraded to channel_asserted and share one idempotency key, so the
      // second is a replay of the first stored denial (no new row); the replayed-proof attempt is anonymous and has its own denied row.
      expect(outcomes.filter((o) => o === "success")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "denied")).toHaveLength(2);
      expect(outcomes).toHaveLength(3); // nothing else ran: no second success for any of the three refused attempts
    });
  });
});

