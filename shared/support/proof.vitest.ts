// @vitest-environment node
// MPC-8528: identity proofs. Fake fetch only here; the single-use / expiry behaviour itself is tested on real Postgres
// (supabase/tests/proposed-mpc-8528-support-cases.test.sql and the support-rest CI job).
import { describe, it, expect } from "vitest";
import { newProofToken, hashProof, isProofToken, RestProofStore, ProofVerifier, resolveIdentity } from "./index";

type Call = { url: string; body: unknown };
const fake = (respond: (c: Call) => { status?: number; body?: unknown }) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { const c = { url, body: JSON.parse(init.body as string) }; calls.push(c); const r = respond(c); return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 }); }) as unknown as typeof fetch;
  return { calls, store: new RestProofStore({ baseUrl: "https://x.test", serviceKey: "k", fetchImpl }) };
};

describe("proof tokens", () => {
  it("are 43 url-safe characters, unique, and hash to 64 hex characters", async () => {
    const a = newProofToken(), b = newProofToken();
    expect(isProofToken(a)).toBe(true); expect(a).not.toBe(b);
    const h = await hashProof(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/); expect(await hashProof(a)).toBe(h); expect(await hashProof(b)).not.toBe(h);
  });
  it("anything that is not a token is rejected by shape", () => {
    for (const bad of [undefined, null, 42, "", "short", "a".repeat(44), "a".repeat(42) + "=", "a b".padEnd(43, "c"), "../".padEnd(43, "a")]) expect(isProofToken(bad), String(bad)).toBe(false);
  });
});

describe("RestProofStore", () => {
  it("issue sends only the hash, never the token, and returns the token once", async () => {
    const f = fake(() => ({ body: "11111111-1111-1111-1111-111111111111" }));
    const { token, id } = await f.store.issue("user-A", "t1", 600);
    expect(id).toMatch(/^1111/);
    const sent = JSON.stringify(f.calls[0].body);
    expect(sent).not.toContain(token); expect(f.calls[0].body).toMatchObject({ p_token_hash: await hashProof(token), p_subject: "user-A", p_tenant: "t1", p_ttl_seconds: 600 });
    expect(f.calls[0].url).toBe("https://x.test/rest/v1/rpc/support_issue_proof");
  });
  it("redeem returns the identity, and null for a malformed token WITHOUT calling the database", async () => {
    const f = fake(() => ({ body: { subject_id: "user-A", tenant_id: "t1" } }));
    expect(await f.store.redeem(newProofToken())).toEqual({ subjectId: "user-A", tenantId: "t1" });
    expect(await f.store.redeem("not-a-token")).toBeNull();
    expect(f.calls).toHaveLength(1);
  });
  it("redeem is null when the database says the proof is used, expired or unknown; errors throw", async () => {
    expect(await fake(() => ({ body: null })).store.redeem(newProofToken())).toBeNull();
    await expect(fake(() => ({ status: 503 })).store.redeem(newProofToken())).rejects.toThrow(/503/);
    await expect(fake(() => ({ body: 7 })).store.issue("u", "t")).rejects.toThrow(/not issued/);
  });
});

describe("ProofVerifier + resolveIdentity", () => {
  it("only a redeemed proof is verified; no proof, a bad proof and a refused proof are anonymous", async () => {
    const ok = new ProofVerifier(fake(() => ({ body: { subject_id: "user-A", tenant_id: "t1" } })).store);
    expect(await ok.resolve(newProofToken(), "web")).toEqual({ level: "verified", subjectId: "user-A", tenantId: "t1" });
    expect((await ok.resolve(undefined, "web")).level).toBe("anonymous");
    expect((await ok.resolve("junk", "web")).level).toBe("anonymous");
    expect((await new ProofVerifier(fake(() => ({ body: null })).store).resolve(newProofToken(), "web")).level).toBe("anonymous");
  });
  it("a database failure fails closed to channel_asserted, never verified", async () => {
    const v = new ProofVerifier(fake(() => ({ status: 500 })).store);
    const id = await resolveIdentity(v, newProofToken(), "web", "visitor-1");
    expect(id.level).toBe("channel_asserted");
  });
});
