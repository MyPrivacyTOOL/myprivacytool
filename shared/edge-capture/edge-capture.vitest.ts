// @vitest-environment node
// MPC-7490 tests: each class, the unknown fallback, store failure, switch off, and the "never delays" guarantee.
// The retention cut is tested against a real Postgres in supabase/tests/schema.test.sql. All rows here are made up.
import { describe, expect, it, vi } from "vitest";
import { classify, treatAsPerson } from "./classify";
import { buildVisit, captureEnabled, captureVisit, cleanReferrer, recordVisit, type CaptureEnv } from "./capture";
import { RULES, RULESET_VERSION, type RequestFacts } from "./ruleset";
import { onRequest } from "../../functions/_middleware";
import routes from "../../public/_routes.json";

const browserHeaders = { accept: "text/html", "accept-language": "en-GB" };
const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36",
  asnOrg: "Example Home Broadband",
  headers: browserHeaders,
  httpProtocol: "HTTP/2",
  ...over,
});

describe("classifier: each class", () => {
  it("ai: known AI crawler and agent tokens (R1)", () => {
    for (const ua of ["Mozilla/5.0 (compatible; GPTBot/1.1)", "ClaudeBot/1.0", "PerplexityBot/1.0", "Mozilla/5.0 Applebot-Extended", "Mozilla/5.0 (compatible; ExampleChatGPT-User/1.0) ChatGPT-User"]) {
      expect(classify(facts({ userAgent: ua })), ua).toMatchObject({ cls: "ai", rule: "R1" });
    }
  });
  it("ai wins over search bot: Applebot-Extended is ai, plain Applebot is bot", () => {
    expect(classify(facts({ userAgent: "Mozilla/5.0 (Applebot-Extended/0.1)" })).cls).toBe("ai");
    expect(classify(facts({ userAgent: "Mozilla/5.0 (Applebot/0.1)" }))).toMatchObject({ cls: "bot", rule: "R2" });
  });
  it("bot: search crawlers (R2), scrapers and clients (R3), generic bot words (R4), bare requests (R6)", () => {
    expect(classify(facts({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }))).toMatchObject({ cls: "bot", rule: "R2" });
    expect(classify(facts({ userAgent: "python-requests/2.31", headers: {} }))).toMatchObject({ cls: "bot", rule: "R3" });
    expect(classify(facts({ userAgent: "Mozilla/5.0 (compatible; AhrefsBot/7.0)" }))).toMatchObject({ cls: "bot", rule: "R3" });
    expect(classify(facts({ userAgent: "Mozilla/5.0 (compatible; ExampleAIBot/1.0)" }))).toMatchObject({ cls: "bot", rule: "R4" });
    expect(classify(facts({ userAgent: "ExampleCrawler/0.9" }))).toMatchObject({ cls: "bot", rule: "R4" });
    expect(classify(facts({ userAgent: "" }))).toMatchObject({ cls: "bot", rule: "R6" });
    expect(classify(facts({ userAgent: "ExampleClient/1.0", headers: {} }))).toMatchObject({ cls: "bot", rule: "R6" });
    expect(classify(facts({ httpProtocol: "HTTP/1.0" }))).toMatchObject({ cls: "bot", rule: "R6" });
  });
  it("unknown, not bot: a browser UA with the browser headers stripped is R9 (a person hiding details keeps the IP cut)", () => {
    expect(classify(facts({ headers: {} }))).toMatchObject({ cls: "unknown", rule: "R9" });
    expect(treatAsPerson(classify(facts({ headers: {} })).cls)).toBe(true);
  });
  it("person: a plain browser from a home network falls through to R8", () => {
    expect(classify(facts())).toEqual({ cls: "person", rule: "R8", rulesetVersion: RULESET_VERSION });
  });
});

describe("classifier: unknown fallback", () => {
  it("a browser UA from a hosting network is unknown (R5), not person and not bot", () => {
    expect(classify(facts({ asnOrg: "Example Cloud Services (AWS)" }))).toMatchObject({ cls: "unknown", rule: "R5" });
  });
  it("unknown is treated as a person; bot and ai are not", () => {
    expect(treatAsPerson("unknown")).toBe(true);
    expect(treatAsPerson("person")).toBe(true);
    expect(treatAsPerson("bot")).toBe(false);
    expect(treatAsPerson("ai")).toBe(false);
  });
  it("a rule that throws yields unknown/ERR instead of failing", () => {
    const spy = vi.spyOn(RULES[0], "test").mockImplementation(() => { throw new Error("boom"); });
    expect(classify(facts())).toMatchObject({ cls: "unknown", rule: "ERR" });
    spy.mockRestore();
  });
  it("rule ids are unique and the version is set", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(RULESET_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

const req = (url: string, headers: Record<string, string> = {}, cf: Record<string, unknown> = {}): Request => {
  const r = new Request(url, { headers });
  Object.defineProperty(r, "cf", { value: cf });
  return r;
};

describe("raw visit row", () => {
  it("keeps raw facts, the class, the rule and the version; drops query string, cookie and credentials", () => {
    const row = buildVisit(
      req("https://www.example.test/scan?email=a@b.test&utm=x", {
        "user-agent": "ExampleCrawler/1.0", cookie: "session=abc", authorization: "Bearer zzz", "cf-connecting-ip": "192.0.2.7",
        "cf-ipcountry": "hk", referer: "https://ref.example.test/page?q=secret#frag", "accept-language": "en",
      }, { asn: 64500, asOrganization: "Example Net", colo: "HKG", httpProtocol: "HTTP/2" }),
      200,
    );
    expect(row).toMatchObject({
      host: "www.example.test", path: "/scan", method: "GET", status: 200, user_agent: "ExampleCrawler/1.0", ip: "192.0.2.7",
      country: "HK", asn: 64500, network: "Example Net", colo: "HKG", referrer: "https://ref.example.test/page",
      class: "bot", rule: "R4", ruleset_version: RULESET_VERSION,
    });
    expect(JSON.stringify(row)).not.toMatch(/secret|a@b\.test|session=abc|Bearer|utm/);
    expect(row.headers).toEqual({ "accept-language": "en" });
  });
  it("cleans referrers and bad country codes", () => {
    expect(cleanReferrer("not a url")).toBeNull();
    expect(cleanReferrer(null)).toBeNull();
    expect(buildVisit(req("https://x.test/", { "cf-ipcountry": "T1" }), 200).country).toBeNull();
  });
});

const env: CaptureEnv = { EDGE_CAPTURE_ENABLED: "true", SUPABASE_URL: "https://store.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

describe("switch", () => {
  it("is off unless explicitly on", () => {
    for (const v of [undefined, "", "0", "false", "off", "no", "maybe"]) expect(captureEnabled({ EDGE_CAPTURE_ENABLED: v })).toBe(false);
    for (const v of ["1", "true", "TRUE", "on", "yes"]) expect(captureEnabled({ EDGE_CAPTURE_ENABLED: v })).toBe(true);
    expect(captureEnabled(undefined)).toBe(false);
  });
  it("switch off: the middleware passes the response through and makes no call and no waitUntil", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const waitUntil = vi.fn();
    const res = new Response("page", { status: 200 });
    const out = await onRequest({ request: req("https://x.test/"), env: { ...env, EDGE_CAPTURE_ENABLED: undefined }, next: async () => res, waitUntil });
    expect(out).toBe(res);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("routing: pages, robots.txt and /api/* run the middleware; static assets do not", () => {
    expect(routes.include).toEqual(["/*"]);
    for (const p of ["/assets/*", "/blog/*", "/email/*", "/favicon.ico", "/og-image.jpg", "/placeholder.svg", "/site.webmanifest"]) expect(routes.exclude).toContain(p);
    expect(routes.exclude).not.toContain("/robots.txt");
    expect(routes.exclude).not.toContain("/api/*");
  });
});

describe("store failure and no delay", () => {
  it("posts one row to the store with the service key when on", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    expect(await captureVisit(env, req("https://x.test/p", { "user-agent": "Mozilla/5.0 Chrome/1 Safari/1", accept: "x", "accept-language": "en" }), 200, f)).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://store.example.test/rest/v1/edge_visits");
    expect(init.headers.authorization).toBe("Bearer service-key");
    expect(JSON.parse(init.body)).toMatchObject({ path: "/p", class: "person", rule: "R8" });
  });
  it("store down (network error), store error (500), missing config: false, never throws", async () => {
    expect(await captureVisit(env, req("https://x.test/"), 200, vi.fn().mockRejectedValue(new Error("down")))).toBe(false);
    expect(await captureVisit(env, req("https://x.test/"), 200, vi.fn().mockResolvedValue(new Response("no", { status: 500 })))).toBe(false);
    const f = vi.fn();
    expect(await recordVisit({ EDGE_CAPTURE_ENABLED: "1" }, buildVisit(req("https://x.test/"), 200), f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("a malformed request cannot make capture throw", async () => {
    expect(await captureVisit(env, { url: "::bad::" } as unknown as Request, 200, vi.fn())).toBe(false);
  });
  it("the response is returned before the write finishes, even if the store never answers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const pending: Promise<unknown>[] = [];
    const res = new Response("page", { status: 200 });
    const out = await onRequest({ request: req("https://x.test/"), env, next: async () => res, waitUntil: (p) => pending.push(p) });
    expect(out).toBe(res);
    expect(pending).toHaveLength(1);
    fetchSpy.mockRestore();
  });
  it("store failure inside the middleware leaves the response untouched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const pending: Promise<unknown>[] = [];
    const res = new Response("page", { status: 200 });
    const out = await onRequest({ request: req("https://x.test/"), env, next: async () => res, waitUntil: (p) => pending.push(p) });
    expect(out).toBe(res);
    await expect(Promise.all(pending)).resolves.toEqual([false]);
    fetchSpy.mockRestore();
  });
  it("a waitUntil that throws does not affect the response", async () => {
    const res = new Response("page");
    const out = await onRequest({ request: req("https://x.test/"), env, next: async () => res, waitUntil: () => { throw new Error("x"); } });
    expect(out).toBe(res);
  });
});
