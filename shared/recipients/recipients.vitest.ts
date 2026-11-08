/* eslint-disable @typescript-eslint/no-explicit-any -- negative tests mutate loosely typed JSON on purpose */
// @vitest-environment node
// MPC-9883: seed pins, schema validator and the seven pre-I/O checks of the outbound wrapper (one block per check).
import { describe, expect, it, vi } from "vitest";
import data from "./recipients.json";
import { canonicalJson, registryHash, sha256Hex } from "./canonical.js";
import { DATA_ITEMS, effectiveDataItems, enabledForCountry, flagIsOn, hostMatches, parseRegistry, validateRegistry, type Recipient, type RecipientRegistry } from "./registry";
import { RecipientError, callRecipient, checkRecipient, createPeerConnection, fetchRecipient, isPrivateOrInternalHost, loadRecipientScript, type RecipientLogEntry } from "./outbound";

const registry = parseRegistry(data);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const base = (over: Partial<Recipient> = {}): Recipient => ({
  key: "t", name: "T", hosts: ["api.example.test"], host_kind: "fixed", surface: "worker", data_items: ["email", "ip"], purpose: "test.", party: "third",
  retention: { days: null, text: "x" }, consent_basis: "scan_consent", phase: "post_click", enabled: true, flag: null, country_overrides: {}, dpa_listed: false,
  since: "2026-11-08", until: null, ...over,
});
const regOf = (...r: Recipient[]): RecipientRegistry => ({ schema_version: 1, recipients: r });
const ok = () => new Response("{}", { status: 200 });
const ctxOf = (r: Recipient, extra = {}) => ({ registry: regOf(r), consentId: "c-1", fetchImpl: vi.fn(async () => ok()) as unknown as typeof fetch, ...extra });
const codeOf = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return e instanceof RecipientError ? e.code : `other: ${e}`; } };

/** Recipients MPC-9885 added because a Worker already called their host (see each entry's note). The Map's 29 are pinned without them. */
const MPC_9885_ADDED = ["anthropic", "cloudflare-api", "ga4-data-api", "youtube-data-api", "meta-ads-insights", "firestore", "x-api", "make-webhooks", "github-issues", "github-extras", "internal-workers"];

describe("seed (MPC-9883, design 1.5)", () => {
  const live = registry.recipients.filter((r) => r.enabled && r.host_kind !== "user_supplied");
  it("pins 8 first-party and 23 third-party/processor/platform live recipients (the Map's 21, less hibp, switched off by MPC-9885 until MPC-9904, plus meta-graph and stripe, switched on by MPC-9885: WhatsApp replies are live and checkout is gated by CHECKOUT_ENABLED)", () => {
    expect(registry.recipients.find((r) => r.key === "hibp")).toMatchObject({ enabled: false });
    expect(live.filter((r) => r.party === "first" && !MPC_9885_ADDED.includes(r.key))).toHaveLength(8);
    expect(live.filter((r) => r.party !== "first" && !MPC_9885_ADDED.includes(r.key))).toHaveLength(23);
  });
  it("MPC-9885 added exactly these recipients, all enabled", () => {
    expect(registry.recipients.filter((r) => r.since === "2026-11-08" && r.note?.startsWith("Added by MPC-9885")).map((r) => r.key).sort()).toEqual([...MPC_9885_ADDED].sort());
    expect(MPC_9885_ADDED.every((k) => registry.recipients.find((r) => r.key === k)?.enabled === true)).toBe(true);
  });
  it("has the user-pasted-listing structural entry, 1 known-host disabled entry (platform-replies on like stripe now flag-gated by CHECKOUT_ENABLED, meta-graph switched on by MPC-9885: WhatsApp replies are live) and 6 planned disabled entries", () => {
    expect(registry.recipients.find((r) => r.key === "user-pasted-listing")?.host_kind).toBe("user_supplied");
    for (const k of ["pwned-passwords"]) expect(registry.recipients.find((r) => r.key === k)?.enabled).toBe(false);
    const planned = registry.recipients.filter((r) => r.planned);
    expect(planned).toHaveLength(6);
    expect(planned.every((r) => !r.enabled)).toBe(true);
    expect(registry.recipients).toHaveLength(51);
  });
  it("validates cleanly, and every live key from design 1.5 is present", () => {
    expect(validateRegistry(data)).toEqual([]);
    for (const k of ["whoami", "hk-geo", "visit-log", "machine-mirror", "scan-report", "leads", "learning-events", "channel-bot", "cloudflare-turnstile", "cloudflare-edge", "cloudflare-web-analytics", "ga4", "google-stun", "google-fonts", "supabase", "notion", "resend", "hubspot", "github-commit-search", "hunter", "hibp", "gravatar", "rdap", "cloudflare-doh", "dashscope", "telegram", "deep-scan-sites", "oauth-providers", "slack"]) {
      expect(registry.recipients.some((r) => r.key === k), k).toBe(true);
    }
  });
  it("keeps post-click as the default and pre_click only for first party or a named exception", () => {
    for (const r of live) if (r.phase === "pre_click" && r.party !== "first") expect(r.exception, r.key).toBeTruthy();
  });
});

describe("hash", () => {
  it("is canonical (key order does not matter) and 64 hex chars", async () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(await registryHash(data)).toMatch(/^[0-9a-f]{64}$/);
    expect(await registryHash({ schema_version: 1, recipients: clone(data.recipients) })).toBe(await registryHash(data));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("changes when any entry changes", async () => {
    const d = clone(data); d.recipients[0].purpose += "!";
    expect(await registryHash(d)).not.toBe(await registryHash(data));
  });
});

describe("validator", () => {
  const bad = (mutate: (d: any) => void): string[] => { const d = clone(data); mutate(d); return validateRegistry(d); };
  it("rejects duplicate keys", () => expect(bad((d) => { d.recipients[1].key = d.recipients[0].key; }).join()).toMatch(/duplicate key/));
  it("rejects an item outside the closed vocabulary", () => expect(bad((d) => { d.recipients[0].data_items.push("favourite_colour"); }).join()).toMatch(/closed vocabulary/));
  it("rejects empty hosts unless user_supplied or planned", () => expect(bad((d) => { d.recipients[0].hosts = []; }).join()).toMatch(/hosts may be empty only/));
  it("rejects hosts on a user_supplied entry", () => expect(bad((d) => { d.recipients.find((r: any) => r.key === "user-pasted-listing").hosts = ["x.example.com"]; }).join()).toMatch(/no hosts/));
  it("rejects a scheme or path in a host and a wildcard on a fixed entry", () => {
    expect(bad((d) => { d.recipients[0].hosts = ["https://x.example.com/a"]; }).join()).toMatch(/bare lowercase host/);
    expect(bad((d) => { d.recipients[0].hosts = ["*.example.com"]; }).join()).toMatch(/needs host_kind pattern/);
  });
  it("rejects pre_click for a third party without a named exception", () => expect(bad((d) => { delete d.recipients.find((r: any) => r.key === "cloudflare-turnstile").exception; }).join()).toMatch(/named exception/));
  it("rejects a disabled entry with no flag and no reason", () => expect(bad((d) => { const r = d.recipients.find((x: any) => x.key === "hibp"); delete r.reason; r.flag = null; }).join()).toMatch(/needs a reason/));
  it("rejects bad enums, dates, retention and country codes", () => {
    const msg = bad((d) => { const r = d.recipients[0]; r.party = "friend"; r.since = "yesterday"; r.retention = { days: -1, text: "" }; r.country_overrides = { hk: {} }; }).join("\n");
    expect(msg).toMatch(/party must be/); expect(msg).toMatch(/since must be/); expect(msg).toMatch(/retention must be/); expect(msg).toMatch(/upper-case ISO/);
  });
  it("parseRegistry throws listing every problem", () => expect(() => parseRegistry({ schema_version: 2, recipients: [] })).toThrow(/schema_version/));
  it("never throws on junk input", () => { for (const j of [null, 1, "x", [], {}, { schema_version: 1 }]) expect(validateRegistry(j).length).toBeGreaterThan(0); });
});

describe("helpers", () => {
  it("hostMatches: exact, *.suffix (sub-domains only), case and trailing dot", () => {
    expect(hostMatches("API.Example.test.", ["api.example.test"])).toBe(true);
    expect(hostMatches("a.supabase.co", ["*.supabase.co"])).toBe(true);
    expect(hostMatches("supabase.co", ["*.supabase.co"])).toBe(false);
    expect(hostMatches("evilsupabase.co", ["*.supabase.co"])).toBe(false);
    expect(hostMatches("supabase.co.evil.com", ["*.supabase.co"])).toBe(false);
  });
  it("flagIsOn", () => { for (const v of [true, "1", "on", "sk-abc"]) expect(flagIsOn(v)).toBe(true); for (const v of [false, "", "0", "false", "off", undefined, null]) expect(flagIsOn(v)).toBe(false); });
  it("country overrides: enabled and data_items_exclude, case-insensitive", () => {
    const r = base({ country_overrides: { DE: { enabled: false }, FR: { data_items_exclude: ["ip"] } } });
    expect(enabledForCountry(r, "de")).toBe(false); expect(enabledForCountry(r, "HK")).toBe(true); expect(enabledForCountry(r, null)).toBe(true);
    expect(effectiveDataItems(r, "fr")).toEqual(["email"]); expect(effectiveDataItems(r, "HK")).toEqual(["email", "ip"]);
  });
  it("vocabulary has the 18 design items", () => expect(DATA_ITEMS).toHaveLength(18));
});

describe("check 1: key exists", () => {
  it("refuses an unknown key before any I/O", async () => {
    const ctx = ctxOf(base());
    expect(await codeOf(callRecipient("nope", { url: "https://api.example.test/", sent: [] }, ctx))).toBe("UNKNOWN_KEY");
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("check 2: enabled and flag", () => {
  it("refuses a disabled entry", async () => {
    const ctx = ctxOf(base({ enabled: false, reason: "off" }));
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctx))).toBe("DISABLED");
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses while the flag is off and allows it once on (map and function forms)", async () => {
    const r = base({ flag: "HUNTER_API_KEY" });
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r)))).toBe("FLAG_OFF");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { flags: { HUNTER_API_KEY: "" } })))).toBe("FLAG_OFF");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { flags: { HUNTER_API_KEY: "k" } })))).toBe("no error");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { flags: (n: string) => (n === "HUNTER_API_KEY" ? "1" : undefined) })))).toBe("no error");
  });
});

describe("check 3: country override", () => {
  it("refuses in a disabled country, allows elsewhere", async () => {
    const r = base({ country_overrides: { DE: { enabled: false } } });
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { country: "DE" })))).toBe("COUNTRY_DISABLED");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { country: "HK" })))).toBe("no error");
  });
});

describe("check 4: consent for post_click", () => {
  const req = { url: "https://api.example.test/", sent: ["email"] as const };
  it("refuses post_click with no consent id", async () => {
    const ctx = ctxOf(base(), { consentId: undefined });
    expect(await codeOf(callRecipient("t", { ...req, sent: ["email"] }, ctx))).toBe("CONSENT_REQUIRED");
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });
  it("treats a blank consent id as missing", async () => expect(await codeOf(callRecipient("t", { ...req, sent: ["email"] }, ctxOf(base(), { consentId: "  " })))).toBe("CONSENT_REQUIRED"));
  it("asks the Worker verifier and refuses when it says no", async () => {
    const verify = vi.fn(async () => false);
    expect(await codeOf(callRecipient("t", { ...req, sent: ["email"] }, ctxOf(base(), { verifyConsent: verify, scanId: "s1" })))).toBe("CONSENT_INVALID");
    expect(verify).toHaveBeenCalledWith("c-1", "s1");
    expect(await codeOf(callRecipient("t", { ...req, sent: ["email"] }, ctxOf(base(), { verifyConsent: async () => true })))).toBe("no error");
  });
  it("does not ask for consent on a pre_click first-party entry", async () => {
    const r = base({ party: "first", phase: "pre_click" });
    expect(await codeOf(callRecipient("t", { ...req, sent: ["email"] }, ctxOf(r, { consentId: undefined })))).toBe("no error");
  });
});

describe("check 5: host matches", () => {
  it("refuses a host that is not listed, including look-alikes, and non-https", async () => {
    const r = base({ hosts: ["*.example.test"], host_kind: "pattern" });
    for (const url of ["https://api.evil.test/", "https://example.test/", "https://api.example.test.evil.com/", "https://evilexample.test/"]) {
      expect(await codeOf(callRecipient("t", { url, sent: ["email"] }, ctxOf(r))), url).toBe("HOST_MISMATCH");
    }
    expect(await codeOf(callRecipient("t", { url: "http://a.example.test/", sent: ["email"] }, ctxOf(r)))).toBe("BAD_URL");
    expect(await codeOf(callRecipient("t", { url: "not a url", sent: ["email"] }, ctxOf(r)))).toBe("BAD_URL");
    expect(await codeOf(callRecipient("t", { url: "https://a.example.test/x?y=1", sent: ["email"] }, ctxOf(r)))).toBe("no error");
  });
  it("accepts a host built at runtime from env (key static, host checked)", async () => {
    const r = base({ hosts: ["*.supabase.co"], host_kind: "pattern" });
    const env = { SUPABASE_URL: "https://abc.supabase.co" };
    expect(await codeOf(callRecipient("t", { url: `${env.SUPABASE_URL}/rest/v1/x`, sent: ["email"] }, ctxOf(r)))).toBe("no error");
    expect(await codeOf(callRecipient("t", { url: "https://abc.supabase.co.evil.com/rest/v1/x", sent: ["email"] }, ctxOf(r)))).toBe("HOST_MISMATCH");
  });
});

describe("check 6: sent is a subset of data_items", () => {
  it("refuses an undeclared item, an unknown item, and an item excluded for the country", async () => {
    const r = base({ country_overrides: { FR: { data_items_exclude: ["ip"] } } });
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["phone"] }, ctxOf(r)))).toBe("DATA_ITEM_NOT_ALLOWED");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["favourite_colour" as never] }, ctxOf(r)))).toBe("UNKNOWN_DATA_ITEM");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["ip"] }, ctxOf(r, { country: "FR" })))).toBe("DATA_ITEM_NOT_ALLOWED");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["ip"] }, ctxOf(r, { country: "HK" })))).toBe("no error");
    expect(await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: [] }, ctxOf(r)))).toBe("no error");
  });
});

describe("check 7: user_supplied", () => {
  const r = base({ key: "u", hosts: [], host_kind: "user_supplied" });
  const call = (url: string, extra = {}, fetchImpl?: typeof fetch) => callRecipient("u", { url, sent: ["email"] }, { registry: regOf(r), consentId: "c", fetchImpl: fetchImpl ?? (vi.fn(async () => ok()) as unknown as typeof fetch), ...extra });
  it("accepts any public https host", async () => expect(await codeOf(call("https://www.example.org/listing/1"))).toBe("no error"));
  it("refuses http, credentials, odd ports", async () => {
    for (const u of ["http://www.example.org/", "https://u:p@www.example.org/", "https://www.example.org:8443/"]) expect(await codeOf(call(u)), u).toBe("USER_SUPPLIED_REJECTED");
  });
  it("refuses private, loopback, link-local and internal hosts", async () => {
    for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "[::1]", "[fd00::1]", "[fe80::1]", "[::ffff:10.0.0.1]", "intranet", "printer.local", "db.internal", "2130706433"]) {
      expect(await codeOf(call(`https://${h}/`)), h).toBe("USER_SUPPLIED_REJECTED");
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "1.1.1.1"]) expect(isPrivateOrInternalHost(h), h).toBe(false);
  });
  it("blocks a redirect to a new host and follows same-host redirects", async () => {
    const cross = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.net/" } }));
    expect(await codeOf(call("https://www.example.org/a", {}, cross as unknown as typeof fetch))).toBe("REDIRECT_BLOCKED");
    expect(cross).toHaveBeenCalledTimes(1);
    const toPrivate = vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://169.254.169.254/" } }));
    expect(await codeOf(call("https://www.example.org/a", {}, toPrivate as unknown as typeof fetch))).toBe("REDIRECT_BLOCKED");
    let n = 0;
    const same = vi.fn(async () => (n++ === 0 ? new Response(null, { status: 302, headers: { location: "/b" } }) : ok()));
    expect(await codeOf(call("https://www.example.org/a", {}, same as unknown as typeof fetch))).toBe("no error");
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
    expect(await codeOf(call("https://www.example.org/a", {}, loop as unknown as typeof fetch))).toBe("REDIRECT_BLOCKED");
  });
  it("passes redirect: manual to fetch", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => { expect(init?.redirect).toBe("manual"); return ok(); });
    await call("https://www.example.org/a", {}, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalled();
  });
  it("caps response size (declared and streamed)", async () => {
    const declared = vi.fn(async () => new Response("x", { headers: { "content-length": "5000" } }));
    expect(await codeOf(call("https://www.example.org/a", { maxBytes: 1000 }, declared as unknown as typeof fetch))).toBe("RESPONSE_TOO_LARGE");
    const streamed = vi.fn(async () => new Response("y".repeat(5000)));
    expect(await codeOf(call("https://www.example.org/a", { maxBytes: 1000 }, streamed as unknown as typeof fetch))).toBe("RESPONSE_TOO_LARGE");
    const res = await call("https://www.example.org/a", { maxBytes: 1000 }, vi.fn(async () => new Response("hello")) as unknown as typeof fetch);
    expect(await res.text()).toBe("hello");
  });
  it("times out a slow response", async () => {
    const slow = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))));
    expect(await codeOf(call("https://www.example.org/a", { timeoutMs: 20 }, slow as unknown as typeof fetch))).toBe("TIMEOUT");
  });
});

describe("log shape", () => {
  it("logs {key, items, at, status} with names only, on success, failure, and refusal", async () => {
    const log: RecipientLogEntry[] = [];
    const now = () => new Date("2026-11-08T00:00:00Z");
    const r = base({ country_overrides: { DE: { enabled: false } } });
    await callRecipient("t", { url: "https://api.example.test/", init: { method: "POST", body: "secret@example.com" }, sent: ["email", "email"] }, ctxOf(r, { log: (e: RecipientLogEntry) => { log.push(e); }, now, scanId: "scan-1" }));
    expect(log[0]).toEqual({ key: "t", items: ["email"], at: "2026-11-08T00:00:00.000Z", status: "ran", http_status: 200, scan_id: "scan-1" });
    expect(JSON.stringify(log)).not.toContain("secret@example.com");
    await callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { log: (e: RecipientLogEntry) => { log.push(e); }, now, fetchImpl: (async () => new Response("no", { status: 500 })) as typeof fetch }));
    expect(log[1].status).toBe("failed");
    await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { log: (e: RecipientLogEntry) => { log.push(e); }, now, country: "DE" })));
    expect(log[2]).toMatchObject({ key: "t", status: "skipped_country", code: "COUNTRY_DISABLED", items: [] });
    await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["phone"] }, ctxOf(r, { log: (e: RecipientLogEntry) => { log.push(e); }, now })));
    expect(log[3]).toMatchObject({ status: "refused", code: "DATA_ITEM_NOT_ALLOWED" });
    await codeOf(callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(r, { log: (e: RecipientLogEntry) => { log.push(e); }, now, fetchImpl: (async () => { throw new TypeError("net"); }) as typeof fetch })));
    expect(log[4]).toMatchObject({ status: "failed", code: "NETWORK" });
  });
  it("a throwing log sink never breaks the call", async () => {
    const res = await callRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(base(), { log: () => { throw new Error("sink down"); } }));
    expect(res.status).toBe(200);
  });
  it("does not log an unknown key (no registry row to hang it on)", async () => {
    const log: RecipientLogEntry[] = [];
    await codeOf(callRecipient("ghost", { url: "https://api.example.test/", sent: [] }, ctxOf(base(), { log: (e: RecipientLogEntry) => { log.push(e); } })));
    expect(log).toEqual([]);
  });
});

describe("fetchRecipient / loadRecipientScript / createPeerConnection", () => {
  it("fetchRecipient runs the same checks and omits credentials by default", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => { expect(init?.credentials).toBe("omit"); return ok(); });
    expect(await codeOf(fetchRecipient("t", { url: "https://api.example.test/", sent: ["email"] }, ctxOf(base(), { fetchImpl: f as unknown as typeof fetch })))).toBe("no error");
    expect(await codeOf(fetchRecipient("t", { url: "https://api.evil.test/", sent: ["email"] }, ctxOf(base())))).toBe("HOST_MISMATCH");
  });
  const fakeDoc = () => {
    const el: any = { setAttribute: vi.fn() };
    const doc: any = { createElement: () => el, head: { appendChild: () => queueMicrotask(() => el.onload?.()) } };
    return { doc, el };
  };
  it("loadRecipientScript refuses a host outside the entry and consent-less loads, and loads a listed script", async () => {
    const r = base({ hosts: ["static.example.test"], data_items: ["page_load"] });
    const { doc, el } = fakeDoc();
    expect(await codeOf(loadRecipientScript("t", "https://evil.test/a.js", ctxOf(r), { document: doc }))).toBe("HOST_MISMATCH");
    expect(await codeOf(loadRecipientScript("t", "https://static.example.test/a.js", ctxOf(r, { consentId: "" }), { document: doc }))).toBe("CONSENT_REQUIRED");
    await loadRecipientScript("t", "https://static.example.test/a.js", ctxOf(r), { document: doc, attrs: { defer: "" } });
    expect(el.src).toBe("https://static.example.test/a.js");
  });
  const stun = base({ key: "s", hosts: ["stun.example.test"], host_kind: "stun", surface: "browser", data_items: ["ip"] });
  class FakePC { constructor(public config?: RTCConfiguration) {} }
  it("createPeerConnection: empty iceServers needs no consent and contacts nobody", async () => {
    const pc: any = await createPeerConnection("s", { iceServers: [] }, { registry: regOf(stun) }, { RTCPeerConnectionImpl: FakePC as never });
    expect(pc.config.iceServers).toEqual([]);
  });
  it("createPeerConnection: only listed stun hosts, only after consent", async () => {
    const o = { RTCPeerConnectionImpl: FakePC as never };
    const log: RecipientLogEntry[] = [];
    const ctx = { registry: regOf(stun), consentId: "c", log: (e: RecipientLogEntry) => { log.push(e); } };
    expect(await codeOf(createPeerConnection("s", { iceServers: [{ urls: "stun:stun.example.test:19302" }] }, { ...ctx, consentId: "" }, o))).toBe("CONSENT_REQUIRED");
    expect(await codeOf(createPeerConnection("s", { iceServers: [{ urls: "stun:other.example.test:19302" }] }, ctx, o))).toBe("HOST_MISMATCH");
    expect(await codeOf(createPeerConnection("s", { iceServers: [{ urls: "turn:stun.example.test:3478" }] }, ctx, o))).toBe("WRONG_HOST_KIND");
    expect(await codeOf(createPeerConnection("s", { iceServers: [{ urls: ["stun:stun.example.test:19302"] }] }, ctx, o))).toBe("no error");
    expect(log.at(-1)).toMatchObject({ key: "s", items: ["ip"], status: "ran" });
  });
  it("createPeerConnection refuses a non-stun registry entry", async () => {
    expect(await codeOf(createPeerConnection("t", { iceServers: [{ urls: "stun:api.example.test" }] }, ctxOf(base()), { RTCPeerConnectionImpl: FakePC as never }))).toBe("WRONG_HOST_KIND");
  });
  it("checkRecipient works on the bundled registry (default) for real keys", async () => {
    const c = await checkRecipient("google-stun", "stun://stun.l.google.com", ["ip"], { consentId: "c" });
    expect(c.recipient.key).toBe("google-stun");
    expect(await codeOf(checkRecipient("hunter", "https://api.hunter.io/v2/x", ["email"], { consentId: "c" }))).toBe("FLAG_OFF");
    expect(await codeOf(checkRecipient("pwned-passwords", "https://api.pwnedpasswords.com/", [], { consentId: "c" }))).toBe("DISABLED");
  });
});
