/* eslint-disable @typescript-eslint/no-explicit-any -- loose fetch mocks */
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { lookupRiskSummary, exposureScore, riskLevel, createMemoryCache, InvalidInputError, hashKey } from "./osint-lookup";
import { renderMirror, buildMirrorParts, maskEmail } from "./risk-templates";
import { advanceToRiskAware } from "./conversation-state";
import { createLogger, noopLogger } from "@mpt/utils";

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  ({ status, ok: status < 400, json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Response;

const BREACHES = [
  { Name: "Adobe", BreachDate: "2013-10-04", DataClasses: ["Email addresses", "Passwords"] },
  { Name: "LinkedIn", BreachDate: "2012-05-05", DataClasses: ["Email addresses", "Passwords"] },
];
const hibp = (breaches: unknown, pastes: unknown = []) =>
  vi.fn(async (url: any) => (String(url).includes("breachedaccount") ? breaches : pastes) as Response);

describe("scoring", () => {
  it("exposure_score = breaches*10 + pastes*5, clamped 0..100", () => {
    expect(exposureScore(0, 0)).toBe(0);
    expect(exposureScore(2, 1)).toBe(25);
    expect(exposureScore(20, 20)).toBe(100);
  });
  it("bands", () => {
    expect([0, 10, 29, 30, 59, 60, 100].map(riskLevel)).toEqual(["low", "medium", "medium", "high", "high", "critical", "critical"]);
    expect(riskLevel(null)).toBe("unknown");
  });
});

describe("lookupRiskSummary", () => {
  const deps = (f: any, extra = {}) => ({ hibpApiKey: "k", fetchImpl: f, cache: createMemoryCache(), logger: noopLogger, ...extra });

  it("known-breached email -> score, breach list, urgent next steps", async () => {
    const f = hibp(res(200, BREACHES), res(200, [{}]));
    const s = await lookupRiskSummary("  Bob@Example.com ", "email", deps(f));
    expect(s).toMatchObject({ input_value: "bob@example.com", status: "checked", breach_count: 2, paste_count: 1, exposure_score: 25, risk_level: "medium", confidence: "high" });
    expect(s.breach_list[0]).toEqual({ name: "Adobe", date: "2013-10-04", data_classes: ["Email addresses", "Passwords"] });
    expect(s.next_steps).toContain("risk.next.rotate_reused");
  });
  it("clean email (404s) -> checked, score 0, low", async () => {
    const s = await lookupRiskSummary("clean@example.com", "email", deps(hibp(res(404), res(404))));
    expect(s).toMatchObject({ breach_count: 0, paste_count: 0, exposure_score: 0, risk_level: "low", next_steps: ["risk.next.nothing_urgent", "risk.next.monitor"] });
  });
  it("caches 24h: second call makes no HTTP requests; cache key is a hash, not the email", async () => {
    const f = hibp(res(200, BREACHES), res(404));
    const cache = createMemoryCache();
    const set = vi.spyOn(cache, "set");
    await lookupRiskSummary("a@b.co", "email", deps(f, { cache }));
    const calls = f.mock.calls.length;
    await lookupRiskSummary("A@B.CO", "email", deps(f, { cache }));
    expect(f.mock.calls.length).toBe(calls);
    expect(set.mock.calls[0][0]).toBe(await hashKey("email", "a@b.co"));
    expect(set.mock.calls[0][0]).not.toContain("a@b.co");
    expect(set.mock.calls[0][2]).toBe(86400);
  });
  it("graceful fallback: no key, HTTP 500, timeout, 429 -> not_checked, no score, nothing cached", async () => {
    for (const d of [
      deps(hibp(res(200, [])), { hibpApiKey: undefined }),
      deps(vi.fn(async () => res(500))),
      deps(vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); })),
      deps(vi.fn(async () => res(429, null, { "retry-after": "0" }))),
    ]) {
      const s = await lookupRiskSummary("x@y.co", "email", d);
      expect(s).toMatchObject({ status: "not_checked", exposure_score: null, breach_count: null, risk_level: "unknown", confidence: "low" });
      expect(await d.cache.get(await hashKey("email", "x@y.co"))).toBeNull();
    }
  });
  it("paste lookup failing -> still scored from breaches, confidence medium", async () => {
    const s = await lookupRiskSummary("p@q.co", "email", deps(hibp(res(200, BREACHES), res(500))));
    expect(s).toMatchObject({ paste_count: null, exposure_score: 20, confidence: "medium" });
  });
  it("phone/handle/domain: no network call, not_checked (never guessed)", async () => {
    const f = vi.fn();
    for (const [v, t] of [["+14155550123", "phone"], ["@bob", "handle"], ["https://Example.com/x", "domain"]] as const) {
      const s = await lookupRiskSummary(v, t, deps(f));
      expect(s).toMatchObject({ status: "not_checked", exposure_score: null });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("invalid input throws InvalidInputError", async () => {
    for (const [v, t] of [["nope", "email"], ["12345", "phone"], ["a b", "handle"], ["x", "domain"]] as const)
      await expect(lookupRiskSummary(v, t, deps(vi.fn()))).rejects.toBeInstanceOf(InvalidInputError);
  });
  it("only sends read-only GETs to HIBP and never logs the raw value", async () => {
    const lines: string[] = [];
    const f = hibp(res(200, BREACHES), res(404));
    await lookupRiskSummary("secret.person@example.com", "email", deps(f, { logger: createLogger("t", { sink: (l) => lines.push(l) }) }));
    for (const c of f.mock.calls as any[]) { expect(String(c[0])).toMatch(/^https:\/\/haveibeenpwned\.com\/api\/v3\//); expect(c[1].method).toBeUndefined(); }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("")).not.toContain("secret.person");
  });
});

describe("mirror + localization", () => {
  const en = JSON.parse(readFileSync("locales/en/main.json", "utf8"));
  const master = JSON.parse(readFileSync("locales/master_keys.json", "utf8")).keys.map((k: any) => k.key);
  const deps = { hibpApiKey: "k", cache: createMemoryCache(), logger: noopLogger };

  it("every emitted key exists in master_keys.json and has an en string", async () => {
    const summaries = [
      await lookupRiskSummary("a@b.co", "email", { ...deps, fetchImpl: hibp(res(200, BREACHES), res(200, [{}, {}])) }),
      await lookupRiskSummary("c@d.co", "email", { ...deps, fetchImpl: hibp(res(200, Array(7).fill(BREACHES[0])), res(404)) }),
      await lookupRiskSummary("e@f.co", "email", { ...deps, fetchImpl: hibp(res(404), res(404)) }),
      await lookupRiskSummary("g@h.co", "email", { ...deps, fetchImpl: hibp(res(200, BREACHES), res(500)) }),
      await lookupRiskSummary("@bob", "handle", deps),
    ];
    for (const s of summaries) for (const p of buildMirrorParts(s)) { expect(master).toContain(p.key); expect(en[p.key]).toBeTruthy(); }
  });
  it("renders the mirror in en with the masked email, breach names and score", async () => {
    const s = await lookupRiskSummary("bob.smith@example.com", "email", { ...deps, fetchImpl: hibp(res(200, BREACHES), res(404)) });
    const m = renderMirror(s, en);
    expect(m.missing_keys).toEqual([]);
    expect(m.text).toContain("b******@example.com");
    expect(m.text).toContain("2 known data breaches");
    expect(m.text).toContain("Seen in: Adobe, LinkedIn");
    expect(m.text).toContain("Exposure score: *20/100*");
    expect(m.text).not.toContain("bob.smith");
  });
  it("untranslated locale falls back to en and reports the missing keys", async () => {
    const ja = JSON.parse(readFileSync("locales/ja/main.json", "utf8"));
    const s = await lookupRiskSummary("e@f.co", "email", { ...deps, fetchImpl: hibp(res(404), res(404)) });
    const m = renderMirror(s, ja, en);
    expect(m.text).toContain("nothing found");
    expect(m.missing_keys.length).toBeGreaterThan(0);
    expect(maskEmail("ab@x.io")).toBe("a*@x.io");
  });
});

describe("advanceToRiskAware", () => {
  const LEAD = "00000000-0000-0000-0000-0000000000c1";
  const base = { supabaseUrl: "https://x.supabase.co/", supabaseKey: "svc", logger: noopLogger };
  it("PATCHes only rows still in 'new' and reports advanced", async () => {
    const f = vi.fn(async () => res(200, [{ id: 1 }]));
    expect(await advanceToRiskAware(LEAD, "telegram", { ...base, fetchImpl: f as any })).toBe("advanced");
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe(`https://x.supabase.co/rest/v1/conversation_states?lead_id=eq.${LEAD}&channel=eq.telegram&state=eq.new`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).state).toBe("risk_aware");
  });
  it("no matching row -> unchanged; HTTP/network failure or bad args -> error", async () => {
    expect(await advanceToRiskAware(LEAD, "web", { ...base, fetchImpl: (async () => res(200, [])) as any })).toBe("unchanged");
    expect(await advanceToRiskAware(LEAD, "web", { ...base, fetchImpl: (async () => res(401)) as any })).toBe("error");
    expect(await advanceToRiskAware(LEAD, "web", { ...base, fetchImpl: (async () => { throw new Error("x"); }) as any })).toBe("error");
    expect(await advanceToRiskAware("1;drop", "web", base)).toBe("error");
  });
});
