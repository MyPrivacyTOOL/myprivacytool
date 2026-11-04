// @vitest-environment node
// MPC-8530 D-3: account lookup. Fake fetch only; synthetic addresses. The real column/unique-index behaviour is the schema's (users_email_lower_key).
import { describe, it, expect } from "vitest";
import { RestAccountLookup } from "./index";

const ID = "11111111-2222-3333-4444-555555555555";
function mk(rows: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, headers: init.headers as Record<string, string> }); return new Response(JSON.stringify(rows), { status }); }) as typeof fetch;
  return { calls, lookup: new RestAccountLookup({ baseUrl: "https://x.test", serviceKey: "k", fetchImpl }) };
}

describe("RestAccountLookup", () => {
  it("returns the user id and the constant tenant for one exact (case-insensitive) match, selecting only id and email", async () => {
    const t = mk([{ id: ID, email: "Ana@Example.Invalid" }]);
    expect(await t.lookup.findByEmail("ana@example.invalid")).toEqual({ subjectId: ID, tenantId: "mpt" });
    expect(t.calls[0].url).toContain("/rest/v1/users?email=ilike.ana%40example.invalid&select=id,email&limit=2");
    expect(t.calls[0].headers.Authorization).toBe("Bearer k");
  });
  it("neutralises the ILIKE underscore wildcard so ana_b cannot match anaXb", async () => {
    const t = mk([{ id: ID, email: "anaXb@example.invalid" }]);
    expect(await t.lookup.findByEmail("ana_b@example.invalid")).toBeNull();
    expect(t.calls[0].url).toContain("ana%5C_b%40example.invalid");
  });
  it("treats an address with * % \\ or whitespace as no account WITHOUT calling the database", async () => {
    const t = mk([{ id: ID, email: "x" }]);
    for (const bad of ["a*@example.invalid", "a%@example.invalid", "a\\b@example.invalid", "a b@example.invalid", "", "x".repeat(256)]) expect(await t.lookup.findByEmail(bad)).toBeNull();
    expect(t.calls).toHaveLength(0);
  });
  it("returns null for zero rows, for two rows, and for rows that are not an exact match", async () => {
    expect(await mk([]).lookup.findByEmail("a@example.invalid")).toBeNull();
    expect(await mk([{ id: ID, email: "a@example.invalid" }, { id: "99999999-2222-3333-4444-555555555555", email: "a@example.invalid" }]).lookup.findByEmail("a@example.invalid")).toBeNull();
    expect(await mk([{ id: ID, email: "ab@example.invalid" }]).lookup.findByEmail("a@example.invalid")).toBeNull();
  });
  it("rejects a returned id that is not a uuid", async () => {
    expect(await mk([{ id: "not-a-uuid", email: "a@example.invalid" }]).lookup.findByEmail("a@example.invalid")).toBeNull();
  });
  it("throws on a non-2xx response or a non-array body so the caller can swallow it", async () => {
    await expect(mk({}, 500).lookup.findByEmail("a@example.invalid")).rejects.toThrow(/500/);
    await expect(mk({ message: "x" }).lookup.findByEmail("a@example.invalid")).rejects.toThrow(/unexpected/);
  });
  it("refuses an insecure base url and a missing key", () => {
    expect(() => new RestAccountLookup({ baseUrl: "http://example.com", serviceKey: "k" })).toThrow();
    expect(() => new RestAccountLookup({ baseUrl: "https://x.test", serviceKey: "" })).toThrow();
  });
  it("plugs into requestProof: a database failure looks exactly like no account (same answer, no mail)", async () => {
    const { requestProof } = await import("./index");
    const { MemoryCaseStore } = await import("./memory-store");
    const pending: Promise<unknown>[] = []; const sent: string[] = [];
    const deps = (rows: unknown, status: number) => ({ store: new MemoryCaseStore(), accounts: mk(rows, status).lookup, issuer: { issue: async () => ({ token: "T".repeat(43), id: "p" }) }, mailer: { send: async (to: string) => { sent.push(to); } }, defer: (p: Promise<unknown>) => { pending.push(p); }, verifyUrl: "https://x.test/v", now: () => new Date("2026-10-27T00:00:00Z") });
    const hit = await requestProof(deps([{ id: ID, email: "a@example.invalid" }], 200), { email: "a@example.invalid" });
    const miss = await requestProof(deps([], 200), { email: "b@example.invalid" });
    const down = await requestProof(deps({}, 500), { email: "c@example.invalid" });
    await Promise.all(pending);
    expect(hit).toEqual(miss); expect(miss).toEqual(down);
    expect(sent).toEqual(["a@example.invalid"]);
  });
});
