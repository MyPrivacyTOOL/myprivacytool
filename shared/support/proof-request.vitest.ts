// @vitest-environment node
// MPC-8530 D-3: requesting an identity proof. Synthetic addresses and ips only, in-memory store, fake mailer. No network, no provider, no production data.
import { describe, it, expect, vi } from "vitest";
import { requestProof, buildProofEmail, ResendProofMailer, PROOF_TTL_SECONDS, type ProofRequestDeps } from "./index";
import { MemoryCaseStore } from "./memory-store";

const T0 = new Date("2026-10-27T00:00:00Z");
function mk(over: Partial<ProofRequestDeps> & { known?: string[] } = {}) {
  const store = new MemoryCaseStore();
  const known = new Set(over.known ?? ["a@example.invalid"]);
  const sent: { to: string; subject: string; text: string; key: string }[] = [];
  const issued: { subject: string; tenant: string; ttl?: number }[] = [];
  const pending: Promise<unknown>[] = [];
  const errors: string[] = [];
  const deps: ProofRequestDeps = {
    store,
    accounts: { findByEmail: vi.fn(async (e: string) => (known.has(e) ? { subjectId: `sub-${e}`, tenantId: "t1" } : null)) },
    issuer: { issue: vi.fn(async (subjectId: string, tenantId: string, ttl?: number) => { issued.push({ subject: subjectId, tenant: tenantId, ttl }); return { token: "T".repeat(43), id: "proof-1" }; }) },
    mailer: { send: vi.fn(async (to, subject, text, key) => { sent.push({ to, subject, text, key }); }) },
    defer: (p) => { pending.push(p); },
    verifyUrl: "https://myprivacytool.io/support/verify",
    now: () => T0,
    onBackgroundError: (r) => errors.push(r),
    ...over,
  };
  return { deps, store, sent, issued, errors, settle: () => Promise.all(pending) };
}

describe("requestProof: no account enumeration", () => {
  it("gives the identical answer for an account that exists and one that does not", async () => {
    const t = mk();
    const hit = await requestProof(t.deps, { email: "a@example.invalid", ip: "203.0.113.1" });
    const miss = await requestProof(t.deps, { email: "nobody@example.invalid", ip: "203.0.113.2" });
    expect(hit).toEqual(miss);
    expect(hit).toEqual({ status: "accepted" });
  });
  it("sends mail only for an existing account, and only to that address", async () => {
    const t = mk();
    await requestProof(t.deps, { email: "A@Example.Invalid ", ip: "203.0.113.1" });
    await requestProof(t.deps, { email: "nobody@example.invalid", ip: "203.0.113.2" });
    await t.settle();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe("a@example.invalid");
    expect(t.issued).toEqual([{ subject: "sub-a@example.invalid", tenant: "t1", ttl: PROOF_TTL_SECONDS }]);
    expect(PROOF_TTL_SECONDS).toBe(900);
  });
  it("answers before the lookup finishes (same timing for hit and miss): a hanging lookup does not delay the answer", async () => {
    const t = mk({ accounts: { findByEmail: () => new Promise(() => undefined) } });
    const r = await Promise.race([requestProof(t.deps, { email: "a@example.invalid" }), new Promise((res) => setTimeout(() => res("slow"), 200))]);
    expect(r).toEqual({ status: "accepted" });
  });
  it("a failing mailer or lookup never changes the answer and reports only a reason code", async () => {
    const t = mk({ mailer: { send: async () => { throw new Error("boom a@example.invalid"); } } });
    const r = await requestProof(t.deps, { email: "a@example.invalid" });
    await t.settle();
    expect(r).toEqual({ status: "accepted" });
    expect(t.errors).toEqual(["proof_request_failed"]);
    expect(t.errors.join()).not.toContain("example.invalid");
  });
});

describe("requestProof: limits and fail-closed", () => {
  it("allows 3 requests per address per hour, counted whether or not the account exists", async () => {
    for (const email of ["a@example.invalid", "nobody@example.invalid"]) {
      const t = mk();
      const r = [];
      for (let i = 0; i < 4; i++) r.push((await requestProof(t.deps, { email, ip: `203.0.113.${i}` })).status);
      expect(r).toEqual(["accepted", "accepted", "accepted", "rate_limited"]);
    }
  });
  it("allows 20 requests per ip per hour across different addresses", async () => {
    const t = mk();
    const r: string[] = [];
    for (let i = 0; i < 21; i++) r.push((await requestProof(t.deps, { email: `u${i}@example.invalid`, ip: "203.0.113.9" })).status);
    expect(r.filter((s) => s === "accepted")).toHaveLength(20);
    expect(r[20]).toBe("rate_limited");
  });
  it("the window rolls forward after an hour", async () => {
    const t = mk();
    for (let i = 0; i < 3; i++) await requestProof(t.deps, { email: "a@example.invalid", ip: "203.0.113.1" });
    expect((await requestProof(t.deps, { email: "a@example.invalid", ip: "203.0.113.1" })).status).toBe("rate_limited");
    const later = { ...t.deps, now: () => new Date(T0.getTime() + 3_600_001) };
    expect((await requestProof(later, { email: "a@example.invalid", ip: "203.0.113.1" })).status).toBe("accepted");
  });
  it("stores only hashed keys: no address or ip appears in the usage table", async () => {
    const t = mk();
    await requestProof(t.deps, { email: "a@example.invalid", ip: "203.0.113.1" });
    const keys = JSON.stringify((t.store as unknown as { usage: unknown[] }).usage);
    expect(keys).not.toContain("example.invalid");
    expect(keys).not.toContain("203.0.113.1");
    expect(keys).toMatch(/proof:addr:[0-9a-f]{64}/);
  });
  it("fails closed when the limiter cannot be read or written: no lookup, no mail", async () => {
    for (const method of ["usageSince", "recordUsage"]) {
      const t = mk();
      t.store.failBefore.add(method);
      expect((await requestProof(t.deps, { email: "a@example.invalid" })).status).toBe("unavailable");
      await t.settle();
      expect(t.deps.accounts.findByEmail).not.toHaveBeenCalled();
      expect(t.sent).toHaveLength(0);
    }
  });
  it("rejects anything that is not an email before touching the store", async () => {
    const t = mk();
    for (const bad of [undefined, null, 5, "", "no-at", "a b@x.y", "a@b@c", "x".repeat(300) + "@example.invalid", "<a>@x.y"])
      expect((await requestProof(t.deps, { email: bad })).status).toBe("invalid");
    expect((t.store as unknown as { usage: unknown[] }).usage).toHaveLength(0);
  });
});

describe("proof email and mailer", () => {
  it("puts the token in the URL fragment, says 15 minutes and never asks for a password or text code", () => {
    const m = buildProofEmail("T".repeat(43), "https://myprivacytool.io/support/verify#old");
    expect(m.text).toContain(`https://myprivacytool.io/support/verify#${"T".repeat(43)}`);
    expect(m.text).not.toContain("#old");
    expect(m.text).toMatch(/15 minutes/);
    expect(m.text).toMatch(/never ask you for a password/);
  });
  it("ResendProofMailer throws unless Resend confirms the send, and sends only to the one address", async () => {
    const calls: { body: { to: string[] }; key: string }[] = [];
    const ok = new ResendProofMailer({ apiKey: "k", from: "support@example.invalid", fetchImpl: (async (_u: string, init: RequestInit) => { calls.push({ body: JSON.parse(init.body as string), key: (init.headers as Record<string, string>)["Idempotency-Key"] }); return new Response(JSON.stringify({ id: "e1" }), { status: 200 }); }) as typeof fetch });
    await ok.send("a@example.invalid", "s", "t", "support-proof-1");
    expect(calls[0].body.to).toEqual(["a@example.invalid"]); expect(calls[0].key).toBe("support-proof-1");
    const noId = new ResendProofMailer({ apiKey: "k", from: "f@example.invalid", fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch });
    await expect(noId.send("a@example.invalid", "s", "t", "k")).rejects.toThrow(/did not confirm/);
    const bad = new ResendProofMailer({ apiKey: "k", from: "f@example.invalid", fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch });
    await expect(bad.send("a@example.invalid", "s", "t", "k")).rejects.toThrow(/HTTP 500/);
    await expect(ok.send("not an email", "s", "t", "k")).rejects.toThrow(/invalid address/);
  });
});
