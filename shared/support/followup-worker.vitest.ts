import { describe, expect, it } from "vitest";
import { applyDeliveryReceipt, FOLLOWUP_TEXT, runFollowupCycle, type DueFollowup, type FollowupStore } from "./followup-worker";
import { RestFollowupStore } from "./rest-followup-store";
import { reportDefect, type EngineeringIntake } from "./engineering-intake";
import { guardModelText } from "./reply";
import type { CaseMessage, SupportCase } from "./types";

const NOW = "2026-10-27T08:00:00.000Z";
const mkCase = (id: string, state: SupportCase["state"] = "waiting_system"): SupportCase => ({
  id, ref: "SUP-AAAAAAA2", channel: "email", threadKey: "<t@example.invalid>", senderHandle: "customer@example.invalid", state,
  identityLevel: "channel_asserted", policyVersion: "unapproved-0", createdAt: NOW, updatedAt: NOW, reopenCount: 0,
});

class FakeStore implements FollowupStore {
  attempts: { key: string; outcome: string; receipt: string | null }[] = [];
  unconfirmed = false;
  failClaim = false;
  constructor(public due: DueFollowup[]) {}
  async claimDue() { if (this.failClaim) throw new Error("db down"); return this.due; }
  async recordAttempt(_c: string, key: string, _k: string, outcome: "attempted" | "delivered" | "failed", receipt: string | null) {
    if (this.attempts.some((a) => a.key === key)) return "duplicate" as const;
    this.attempts.push({ key, outcome, receipt });
    return "recorded" as const;
  }
  async markDelivered(key: string, receipt: string) {
    const a = this.attempts.find((x) => x.key === key && x.outcome !== "delivered");
    if (!a) return false;
    a.outcome = "delivered"; a.receipt = receipt; return true;
  }
  async hasUnconfirmedAttempt() { return this.unconfirmed; }
}

function setup(due: DueFollowup[], c: SupportCase | null, notify: "ok" | "fail" = "ok") {
  const store = new FakeStore(due);
  const sent: { text: string; to?: string }[] = [];
  const outbound: CaseMessage[] = [];
  const deliveries: string[] = [];
  const deps = {
    store, owner: "w1", now: () => NOW,
    cases: {
      getCase: async () => c,
      addOutbound: async (caseId: string, text: string) => { const m = { id: "m1", caseId, direction: "outbound", text, author: "system", at: NOW, delivery: "queued" } as CaseMessage; outbound.push(m); return m; },
      setDelivery: async (_id: string, s: string) => { deliveries.push(s); },
    },
    notifier: { send: async (_ref: string, _ch: string, text: string, _t?: string, to?: string) => { if (notify === "fail") throw new Error("smtp down"); sent.push({ text, to }); return { providerMessageId: "prov-1" }; } },
  };
  return { store, sent, outbound, deps };
}
const DUE = (kind: string | null = "update", attempts = 0): DueFollowup => ({ caseId: "c1", nextActionKind: kind, attemptCount: attempts, maxAttempts: 3 });

describe("follow-up worker (MPC-8529)", () => {
  it("sends one fixed message to the original sender and records 'attempted', never 'delivered'", async () => {
    const t = setup([DUE()], mkCase("c1"));
    const r = await runFollowupCycle(t.deps);
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe("customer@example.invalid");
    expect(t.store.attempts).toEqual([{ key: "c1:update:1", outcome: "attempted", receipt: "prov-1" }]);
  });
  it("only a provider receipt makes it delivered", async () => {
    const t = setup([DUE()], mkCase("c1"));
    await runFollowupCycle(t.deps);
    expect(await applyDeliveryReceipt(t.store, "c1:update:1", "receipt-9")).toBe(true);
    expect(t.store.attempts[0].outcome).toBe("delivered");
    expect(await applyDeliveryReceipt(t.store, "c1:update:1", "again")).toBe(false);
  });
  it("a failed send is recorded as failed, with no claim of delivery", async () => {
    const t = setup([DUE()], mkCase("c1"), "fail");
    const r = await runFollowupCycle(t.deps);
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(t.store.attempts[0].outcome).toBe("failed");
    expect(r.errors).toEqual(["send:Error"]);          // class only: no address, text or reference in the report
  });
  it("the same step has the same key, so a repeated cycle cannot create a second attempt", async () => {
    const t = setup([DUE()], mkCase("c1"));
    await runFollowupCycle(t.deps);
    await runFollowupCycle(t.deps);
    expect(t.store.attempts).toHaveLength(1);
  });
  it("a re-check of an unconfirmed send sends nothing new and counts towards the bound", async () => {
    const t = setup([DUE("update", 1)], mkCase("c1"));
    t.store.unconfirmed = true;
    const r = await runFollowupCycle(t.deps);
    expect(r).toMatchObject({ sent: 0, rechecked: 1 });
    expect(t.sent).toHaveLength(0);
    expect(t.store.attempts).toEqual([{ key: "c1:update:2:recheck", outcome: "failed", receipt: null }]);
  });
  it("never acts on a resolved, closed or blocked case", async () => {
    for (const s of ["resolved", "closed", "blocked"] as const) {
      const t = setup([DUE()], mkCase("c1", s));
      const r = await runFollowupCycle(t.deps);
      expect(r.terminal).toBe(1);
      expect(t.sent).toHaveLength(0);
      expect(t.store.attempts).toHaveLength(0);
    }
  });
  it("skips action kinds it does not own (e.g. verify_resolution)", async () => {
    const t = setup([DUE("verify_resolution")], mkCase("c1"));
    expect((await runFollowupCycle(t.deps)).skipped).toBe(1);
    expect(t.sent).toHaveLength(0);
  });
  it("a store outage records nothing and reports no success", async () => {
    const t = setup([DUE()], mkCase("c1"));
    t.store.failClaim = true;
    await expect(runFollowupCycle(t.deps)).rejects.toThrow("db down");
    expect(t.store.attempts).toHaveLength(0);
  });
  it("a lookup failure on one case leaves its lease to expire and does not stop the others", async () => {
    const t = setup([DUE(), { ...DUE(), caseId: "c2" }], mkCase("c1"));
    let n = 0;
    t.deps.cases.getCase = async () => { n += 1; if (n === 1) throw new Error("timeout"); return mkCase("c2"); };
    const r = await runFollowupCycle(t.deps);
    expect(r.errors).toEqual(["cycle:Error"]);
    expect(r.sent).toBe(1);
  });
  it("the fixed texts never promise a human, a response time or an outcome", () => {
    for (const [kind, f] of Object.entries(FOLLOWUP_TEXT)) {
      const text = f("SUP-AAAAAAA2");
      expect(guardModelText(text, false), kind).not.toBeNull();          // survives the same guard applied to model text
      expect(text, kind).toMatch(/automated/i);
      expect(text, kind).not.toMatch(/\b(resolved soon|within \d|team|staff|agent will|we will (fix|call))\b/i);
    }
  });
});

describe("RestFollowupStore", () => {
  const mk = (handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) =>
    new RestFollowupStore({ baseUrl: "http://127.0.0.1:3000", serviceKey: "k", restPrefix: "", fetchImpl: (async (url: string, init: RequestInit) => {
      const r = handler(url, init);
      return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch });
  it("claims via rpc and maps rows", async () => {
    let seen = "";
    const s = mk((url, init) => { seen = `${init.method} ${url} ${init.body}`; return { status: 200, body: [{ case_id: "c1", next_action_kind: "update", attempt_count: 1, max_attempts: 3 }] }; });
    expect(await s.claimDue("w1", 5, 60)).toEqual([{ caseId: "c1", nextActionKind: "update", attemptCount: 1, maxAttempts: 3 }]);
    expect(seen).toContain("POST http://127.0.0.1:3000/rpc/support_followup_claim_due");
    expect(seen).toContain('"p_owner":"w1"');
  });
  it("throws on a non-2xx or malformed body (fail closed)", async () => {
    await expect(mk(() => ({ status: 503 })).claimDue("w", 1, 1)).rejects.toThrow("503");
    await expect(mk(() => ({ status: 200, body: { nope: 1 } })).claimDue("w", 1, 1)).rejects.toThrow("unexpected");
    await expect(mk(() => ({ status: 200, body: "maybe" })).recordAttempt("c", "k", "update", "failed", null, null)).rejects.toThrow("unexpected");
  });
  it("refuses a non-https, non-local base URL", () => {
    expect(() => new RestFollowupStore({ baseUrl: "http://example.com", serviceKey: "k" })).toThrow("https");
  });
  it("scopes the unconfirmed lookup to a case, kind and time window", async () => {
    let url = "";
    const s = mk((u) => { url = u; return { status: 200, body: [{ idempotency_key: "x" }] }; });
    expect(await s.hasUnconfirmedAttempt("c1", "update", "2026-10-26T08:00:00.000Z")).toBe(true);
    expect(url).toContain("case_id=eq.c1");
    expect(url).toContain("outcome=eq.attempted");
    expect(url).toContain("attempted_at=gte.");
  });
});

describe("engineering handoff port (MPC-8529)", () => {
  const input = { caseRef: "SUP-AAAAAAA2", area: "report" as const, summary: "Report link 404 for jane@example.invalid token=abcdef0123456789abcdef0123456789" };
  it("sends only the sanitised payload", async () => {
    let got = "";
    const intake: EngineeringIntake = { submit: async (h) => { got = JSON.stringify(h); return { reference: "ENG-1" }; } };
    const r = await reportDefect(intake, input);
    expect(r).toMatchObject({ sent: true, reference: "ENG-1" });
    expect(got).not.toMatch(/jane|abcdef0123456789/);
    expect(got).toContain('"autoFixAllowed":false');
  });
  it("an unavailable or missing intake never throws and is reported as not sent", async () => {
    expect(await reportDefect({ submit: async () => { throw new Error("503"); } }, input)).toMatchObject({ sent: false, reason: "intake_unavailable" });
    expect(await reportDefect(null, input)).toMatchObject({ sent: false, reason: "not_configured" });
  });
});
