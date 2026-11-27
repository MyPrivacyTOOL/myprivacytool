// @vitest-environment node
// MPC-9889: the visit-log module. Addresses are documentation ranges (RFC 5737 / 3849); everything here is made up.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchSpy } from "../shared/recipients/fetch-spy";
import {
  FAIL_CLOSED, POLICY_TTL_MS, arrivalCountry, buildVisitLogRow, deviceClass, loadPolicy, recordPersonVisit, referrerHostPath, resetPolicyCache, ruleFor, shapeIp, utmFromUrl,
} from "./_visit-log";
import { onRequest } from "./_middleware";
import { workerRecipientContext } from "../shared/recipients/worker-ctx";

const env = { EDGE_CAPTURE_ENABLED: "1", SUPABASE_URL: "https://store.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
const POLICY = [
  { country: "*", ip_mode: "raw", enabled: true },
  { country: "HK", ip_mode: "raw", enabled: true },
  { country: "DE", ip_mode: "truncated", enabled: true },
  { country: "JP", ip_mode: "none", enabled: true },
  { country: "KR", ip_mode: "raw", enabled: false },
];
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const person = (url: string, extra: Record<string, string> = {}) => new Request(url, {
  headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36", accept: "text/html", "accept-language": "en", "cf-connecting-ip": "192.0.2.77", "cf-ipcountry": "HK", ...extra },
});
/** A fetch that answers the policy RPC with `policy` and records every other call. */
function store(policy: unknown = POLICY, recordStatus = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const spy = createFetchSpy({ respond: async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("mpt_visit_log_policy")) return policy === null ? new Response("no", { status: 500 }) : json(policy);
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("true", { status: recordStatus });
  } });
  return { spy, calls };
}

beforeEach(() => resetPolicyCache());

describe("shapeIp: IPv4 /24, IPv6 /48, none", () => {
  it("raw keeps the address (normalised), truncated cuts it, none drops it", () => {
    expect(shapeIp("192.0.2.77", "raw")).toBe("192.0.2.77");
    expect(shapeIp("192.0.2.77", "truncated")).toBe("192.0.2.0");
    expect(shapeIp("192.0.2.77", "none")).toBeNull();
  });
  it("IPv6: /48 keeps the first three groups; :: and mixed forms are handled", () => {
    expect(shapeIp("2001:db8:1234:5678:9abc:def0:1234:5678", "truncated")).toBe("2001:db8:1234::");
    expect(shapeIp("2001:db8::1", "truncated")).toBe("2001:db8:0::");
    expect(shapeIp("2001:0DB8:00ff:0:0:0:0:1", "truncated")).toBe("2001:db8:ff::");
    expect(shapeIp("::1", "truncated")).toBe("0:0:0::");
    expect(shapeIp("2001:db8::1", "raw")).toBe("2001:db8:0:0:0:0:0:1");
    expect(shapeIp("2001:db8:1234:5678::9", "none")).toBeNull();
  });
  it("IPv4-mapped IPv6 is the IPv4 address it carries", () => {
    expect(shapeIp("::ffff:192.0.2.77", "truncated")).toBe("192.0.2.0");
    expect(shapeIp("::ffff:c000:24d", "raw")).toBe("192.0.2.77");
  });
  it("the host part does not survive truncation", () => {
    expect(shapeIp("203.0.113.200", "truncated")).toBe("203.0.113.0");
    expect(shapeIp("2001:db8:1234:5678:9abc:def0:1234:5678", "truncated")).not.toMatch(/5678|9abc|def0|1234:5678/);
  });
  it("anything that is not an address becomes null, never text", () => {
    for (const bad of ["", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5", "2001:db8:::1", "gggg::1", null, undefined]) expect(shapeIp(bad as string, "raw")).toBeNull();
  });
});

describe("the other fields", () => {
  it("referrer is host + path only: no scheme, query, fragment; the dashboard link is redacted", () => {
    expect(referrerHostPath("https://news.example.org/a/b?q=secret#frag")).toBe("news.example.org/a/b");
    expect(referrerHostPath("https://myprivacytool.io/d/3f6c9f0e-5d0a")).toBe("myprivacytool.io/d/[redacted]");
    expect(referrerHostPath("garbage")).toBeNull();
    expect(referrerHostPath(null)).toBeNull();
  });
  it("utm: the four tags, capped, nothing else from the query string", () => {
    const u = new URL("https://x.test/?utm_source=li&utm_medium=social&utm_campaign=" + "c".repeat(300) + "&email=a@b.test&token=abc");
    const out = utmFromUrl(u);
    expect(out.utm_source).toBe("li");
    expect(out.utm_campaign).toHaveLength(128);
    expect(out.utm_content).toBeNull();
    expect(JSON.stringify(out)).not.toContain("a@b.test");
  });
  it("device is a class, not a user agent", () => {
    const h = (ua: string, extra: Record<string, string> = {}) => new Headers({ "user-agent": ua, ...extra });
    expect(deviceClass(h("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"))).toBe("mobile");
    expect(deviceClass(h("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36"))).toBe("mobile");
    expect(deviceClass(h("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"))).toBe("tablet");
    expect(deviceClass(h("Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/120 Safari/537.36"))).toBe("tablet");
    expect(deviceClass(h("Mozilla/5.0 (X11; Linux x86_64) Chrome/120"))).toBe("desktop");
    expect(deviceClass(new Headers())).toBe("unknown");
  });
  it("country: cf-ipcountry, else cf.country, else XX", () => {
    expect(arrivalCountry(person("https://x.test/", { "cf-ipcountry": "de" }))).toBe("DE");
    expect(arrivalCountry(new Request("https://x.test/"))).toBe("XX");
    expect(arrivalCountry(new Request("https://x.test/", { headers: { "cf-ipcountry": "T1" } }))).toBe("XX");
  });
});

describe("the row carries fields only", () => {
  it("exactly country, ip, referrer, four utm tags, device; no user agent, header, path, query, session or id", () => {
    const row = buildVisitLogRow(person("https://x.test/pricing?utm_source=li&email=a@b.test&session=s1", { referer: "https://news.example.org/a?x=1", cookie: "sid=1", "x-session-id": "s1" }), ruleFor(new Map(Object.entries({ "*": { ip_mode: "raw", enabled: true } })), "HK"));
    expect(Object.keys(row).sort()).toEqual(["p_country", "p_device", "p_ip", "p_referrer", "p_utm_campaign", "p_utm_content", "p_utm_medium", "p_utm_source"]);
    const text = JSON.stringify(row);
    for (const leak of ["Mozilla", "Chrome", "a@b.test", "sid=1", "s1", "/pricing", "x=1"]) expect(text, leak).not.toContain(leak);
    expect(row).toMatchObject({ p_country: "HK", p_ip: "192.0.2.77", p_referrer: "news.example.org/a", p_utm_source: "li", p_device: "desktop" });
  });
});

describe("policy: 60 s cache and fail closed", () => {
  it("reads the policy once inside 60 s and again after", async () => {
    const { spy } = store();
    const rctx = workerRecipientContext(env, { fetchImpl: spy.fetch });
    const t0 = 1_000_000;
    expect((await loadPolicy(env, rctx, t0))?.get("DE")?.ip_mode).toBe("truncated");
    await loadPolicy(env, rctx, t0 + POLICY_TTL_MS - 1);
    expect(spy.calls).toHaveLength(1);
    await loadPolicy(env, rctx, t0 + POLICY_TTL_MS);
    expect(spy.calls).toHaveLength(2);
  });
  it("a flipped row takes effect within the TTL and not before", async () => {
    let policy: unknown = POLICY;
    const spy = createFetchSpy({ respond: async () => json(policy) });
    const rctx = workerRecipientContext(env, { fetchImpl: spy.fetch });
    const t0 = 5_000_000;
    expect((await loadPolicy(env, rctx, t0))?.get("DE")?.ip_mode).toBe("truncated");
    policy = POLICY.map((r) => (r.country === "DE" ? { ...r, ip_mode: "none" } : r));
    expect((await loadPolicy(env, rctx, t0 + 30_000))?.get("DE")?.ip_mode).toBe("truncated");
    expect((await loadPolicy(env, rctx, t0 + POLICY_TTL_MS))?.get("DE")?.ip_mode).toBe("none");
  });
  it("an unreadable policy (500, network error, bad JSON, no DEFAULT row) fails closed to none, never raw", async () => {
    const bads: Array<typeof fetch> = [
      (async () => new Response("no", { status: 500 })) as typeof fetch,
      (async () => { throw new Error("down"); }) as typeof fetch,
      (async () => new Response("<html>", { status: 200 })) as typeof fetch,
      (async () => json([{ country: "HK", ip_mode: "raw", enabled: true }])) as typeof fetch,
    ];
    for (const bad of bads) {
      resetPolicyCache();
      const policy = await loadPolicy(env, workerRecipientContext(env, { fetchImpl: bad }), 1);
      expect(policy).toBeNull();
      expect(ruleFor(policy, "HK")).toEqual(FAIL_CLOSED);
      expect(FAIL_CLOSED.ip_mode).toBe("none");
    }
  });
  it("an unknown ip_mode value in the table is ignored, so it cannot widen anything", async () => {
    const spy = createFetchSpy({ respond: async () => json([...POLICY, { country: "FR", ip_mode: "full", enabled: true }]) });
    const policy = await loadPolicy(env, workerRecipientContext(env, { fetchImpl: spy.fetch }), 1);
    expect(policy?.has("FR")).toBe(false);
    expect(ruleFor(policy, "FR").ip_mode).toBe("raw");   // falls to the DEFAULT row, as the database does for a country without a row
  });
  it("ruleFor: own row, else DEFAULT", () => {
    const p = new Map(Object.entries({ "*": { ip_mode: "raw", enabled: true }, DE: { ip_mode: "truncated", enabled: true } })) as never;
    expect(ruleFor(p, "DE").ip_mode).toBe("truncated");
    expect(ruleFor(p, "BR").ip_mode).toBe("raw");
  });
});

describe("recordPersonVisit", () => {
  it("HK: full address; DE: /24 BEFORE it leaves the Worker; JP: no address; KR (switched off): no call at all", async () => {
    const { spy, calls } = store();
    const cases: Array<[string, string | null]> = [["HK", "192.0.2.77"], ["DE", "192.0.2.0"], ["JP", null]];
    for (const [country, ip] of cases) {
      expect(await recordPersonVisit(env, person("https://x.test/", { "cf-ipcountry": country }), spy.fetch)).toBe(true);
      expect(calls.at(-1)?.body.p_ip).toBe(ip);
      expect(calls.at(-1)?.body.p_country).toBe(country);
    }
    const before = calls.length;
    expect(await recordPersonVisit(env, person("https://x.test/", { "cf-ipcountry": "KR" }), spy.fetch)).toBe(false);
    expect(calls.length).toBe(before);
    expect(JSON.stringify(calls.filter((c) => c.body.p_country === "DE"))).not.toContain("192.0.2.77");
  });
  it("an unlisted country uses the DEFAULT row", async () => {
    const { spy, calls } = store();
    await recordPersonVisit(env, person("https://x.test/", { "cf-ipcountry": "BR" }), spy.fetch);
    expect(calls[0].body).toMatchObject({ p_country: "BR", p_ip: "192.0.2.77" });
  });
  it("policy unreadable: the row is still written, without an address", async () => {
    const { spy, calls } = store(null);
    expect(await recordPersonVisit(env, person("https://x.test/"), spy.fetch)).toBe(true);
    expect(calls[0].body.p_ip).toBeNull();
    expect(calls[0].body.p_country).toBe("HK");
  });
  it("every call is a registered call to the two RPCs, nothing else", async () => {
    const { spy } = store();
    await recordPersonVisit(env, person("https://x.test/"), spy.fetch);
    expect(spy.calls.map((c) => c.url.split("/").pop())).toEqual(["mpt_visit_log_policy", "mpt_visit_log_record"]);
    spy.assertAllRegistered();
  });
  it("store down, store 500, missing config: false and never throws", async () => {
    expect(await recordPersonVisit(env, person("https://x.test/"), (async () => { throw new Error("down"); }) as typeof fetch)).toBe(false);
    resetPolicyCache();
    expect(await recordPersonVisit(env, person("https://x.test/"), store(POLICY, 500).spy.fetch)).toBe(false);
    const f = vi.fn();
    expect(await recordPersonVisit({}, person("https://x.test/"), f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await recordPersonVisit(env, { url: "::bad::" } as unknown as Request, vi.fn())).toBe(false);
  });
});

describe("middleware wiring", () => {
  it("a person request through the middleware reaches the visit log, not edge_visits; a bot reaches edge_visits, not the visit log", async () => {
    const seen: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      seen.push(String(url).split("/").pop() as string);
      return String(url).endsWith("mpt_visit_log_policy") ? json(POLICY) : new Response("true", { status: 200 });
    }) as typeof fetch);
    const pending: Promise<unknown>[] = [];
    await onRequest({ request: person("https://x.test/"), env, next: async () => new Response("p"), waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    expect(seen).toEqual(["mpt_visit_log_policy", "mpt_visit_log_record"]);
    seen.length = 0; pending.length = 0;
    await onRequest({ request: new Request("https://x.test/", { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } }), env, next: async () => new Response("p"), waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    expect(seen).toEqual(["edge_visits"]);
    fetchSpy.mockRestore();
  });
});
