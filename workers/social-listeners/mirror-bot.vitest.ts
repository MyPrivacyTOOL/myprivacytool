// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { buildMirrorMessage, CONSENT_DM, handleMirrorDm, oauth1Header, parseDm, type MirrorStore } from "./src/mirror-bot";

const sig = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("base64");
const dmEvent = (text: string, sender = "111", forUser = "999") =>
  ({ for_user_id: forUser, direct_message_events: [{ type: "message_create", message_create: { sender_id: sender, message_data: { text } } }] });
const memStore = () => {
  const m = new Map<string, { v: string; ttl: number }>();
  const s: MirrorStore = {
    get: async (k) => m.get(k)?.v ?? null,
    put: async (k, v, ttl) => { m.set(k, { v, ttl }); },
    delete: async (k) => { m.delete(k); },
  };
  return { s, m };
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const env = { X_CONSUMER_SECRET: "cs", X_BEARER_TOKEN: "bt", X_API_KEY: "ak", X_ACCESS_TOKEN: "at", X_ACCESS_TOKEN_SECRET: "ats" };
const profile = { data: { name: "Ada", username: "ada", description: "mail me ada@example.com", location: "London", url: "https://ada.dev", created_at: "2015-03-02T10:00:00.000Z", protected: false, public_metrics: { followers_count: 5, following_count: 6, tweet_count: 7 } } };

function stubX(profileRes: Response = Response.json(profile)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
    calls.push({ url: String(u), init });
    return String(u).includes("/dm_conversations/") ? Response.json({ data: {} }, { status: 201 }) : profileRes;
  });
  return { calls, spy };
}
afterEach(() => { vi.restoreAllMocks(); log.info.mockClear(); log.warn.mockClear(); log.error.mockClear(); });

describe("parseDm", () => {
  it("reads a DM and ignores our own echoes and empty events", () => {
    expect(parseDm(dmEvent("MIRROR"))).toEqual({ senderId: "111", text: "MIRROR" });
    expect(parseDm(dmEvent("hi", "999", "999"))).toBeNull();
    expect(parseDm({ tweet_create_events: [{}] })).toBeNull();
  });
});

describe("Mirror flow", () => {
  it("MIRROR asks for consent first and looks nothing up", async () => {
    const { s, m } = memStore(); const { calls } = stubX();
    expect(await handleMirrorDm(dmEvent(" mirror! "), env, log, s)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/dm_conversations/with/111/messages");
    expect(JSON.parse(String(calls[0].init!.body)).text).toBe(CONSENT_DM);
    expect([...m.values()].map((x) => x.v)).toEqual(["pending"]);
    expect([...m.keys()].join()).not.toContain("111"); // sender id is never stored raw
  });
  it("YES after consent scans the sender's own public profile and DMs the mirror", async () => {
    const { s, m } = memStore(); const { calls } = stubX();
    await handleMirrorDm(dmEvent("MIRROR"), env, log, s);
    calls.length = 0;
    expect(await handleMirrorDm(dmEvent("Yes"), env, log, s)).toBe(true);
    expect(calls[0].url).toContain("/users/111?user.fields=");
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer bt");
    const text = JSON.parse(String(calls[1].init!.body)).text as string;
    expect(text).toContain("@ada");
    expect(text).toContain("email or phone");
    expect(text).toContain("NOT VISIBLE");
    expect(text).toContain("I did not store any of this");
    expect([...m.values()].map((x) => x.v)).toEqual(["cooldown"]); // consent consumed, nothing about the profile kept
    expect(JSON.stringify([...m.entries()])).not.toContain("ada");
  });
  it("NO cancels without any lookup", async () => {
    const { s, m } = memStore(); const { calls } = stubX();
    await handleMirrorDm(dmEvent("MIRROR"), env, log, s); calls.length = 0;
    expect(await handleMirrorDm(dmEvent("no"), env, log, s)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/dm_conversations/");
    expect(m.size).toBe(0);
  });
  it("a bare YES with nothing pending is not ours and is left for core-brain; so is any other text", async () => {
    const { s } = memStore(); const { calls } = stubX();
    expect(await handleMirrorDm(dmEvent("yes"), env, log, s)).toBe(false);
    expect(await handleMirrorDm(dmEvent("what is this?"), env, log, s)).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("consent is single-use and a second MIRROR inside the cooldown does not scan", async () => {
    const { s } = memStore(); const { calls } = stubX();
    await handleMirrorDm(dmEvent("MIRROR"), env, log, s);
    await handleMirrorDm(dmEvent("YES"), env, log, s);
    calls.length = 0;
    expect(await handleMirrorDm(dmEvent("YES"), env, log, s)).toBe(false);
    expect(await handleMirrorDm(dmEvent("MIRROR"), env, log, s)).toBe(true);
    expect(calls.filter((c) => c.url.includes("/users/"))).toHaveLength(0);
  });
  it("tells the user, and keeps nothing, when the profile cannot be read", async () => {
    const { s } = memStore(); const { calls } = stubX(new Response("no", { status: 429 }));
    await handleMirrorDm(dmEvent("MIRROR"), env, log, s);
    await handleMirrorDm(dmEvent("YES"), env, log, s);
    expect(JSON.parse(String(calls.at(-1)!.init!.body)).text).toContain("could not read");
  });
  it("is off (and forwards everything) when any credential is missing", async () => {
    const { s } = memStore(); const { calls } = stubX();
    expect(await handleMirrorDm(dmEvent("MIRROR"), { ...env, X_BEARER_TOKEN: undefined }, log, s)).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("logs event names only: no ids, handles or text", async () => {
    const { s } = memStore(); stubX();
    await handleMirrorDm(dmEvent("MIRROR"), env, log, s);
    await handleMirrorDm(dmEvent("YES"), env, log, s);
    const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(logged).not.toMatch(/111|ada|London|MIRROR/);
  });
  it("defers the X API calls so the webhook can answer first", async () => {
    const { s } = memStore(); stubX(); const deferred: Promise<unknown>[] = [];
    await handleMirrorDm(dmEvent("MIRROR"), env, log, s, async (w) => { deferred.push(w); });
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
  });
});

describe("buildMirrorMessage", () => {
  it("handles an almost empty profile and a protected account", () => {
    expect(buildMirrorMessage({ username: "x" })).toContain("@x");
    const t = buildMirrorMessage({ username: "x", protected: true });
    expect(t).toContain("posts are protected");
  });
});

describe("oauth1Header", () => {
  it("matches the RFC 5849 HMAC-SHA1 construction", async () => {
    const h = await oauth1Header("POST", "https://api.x.com/2/dm_conversations/with/1/messages",
      { key: "ck", secret: "cs", token: "tk", tokenSecret: "ts" }, "nonce123", "1700000000");
    const base = ["POST", encodeURIComponent("https://api.x.com/2/dm_conversations/with/1/messages"),
      encodeURIComponent("oauth_consumer_key=ck&oauth_nonce=nonce123&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1700000000&oauth_token=tk&oauth_version=1.0")].join("&");
    const expected = createHmac("sha1", "cs&ts").update(base).digest("base64");
    expect(h).toContain(`oauth_signature="${encodeURIComponent(expected)}"`);
    expect(h.startsWith("OAuth ")).toBe(true);
  });
});

describe("X webhook integration", () => {
  const post = (body: object, e: object, ctx?: ExecutionContext) => {
    const raw = JSON.stringify(body);
    return worker.fetch(new Request("https://w/webhook/x", { method: "POST", body: raw, headers: { "X-Twitter-Webhooks-Signature": sig("cs", raw) } }), e as never, ctx);
  };
  it("does not forward a MIRROR DM to core-brain and answers X before the DM is sent", async () => {
    const { calls } = stubX(); const brain = { fetch: vi.fn(async () => new Response("ok")) };
    const pending: Promise<unknown>[] = [];
    const r = await post(dmEvent("MIRROR", "321"), { ...env, CORE_BRAIN: brain }, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as never);
    expect(r.status).toBe(200);
    expect(brain.fetch).not.toHaveBeenCalled();
    await Promise.all(pending);
    expect(calls.some((c) => c.url.includes("/dm_conversations/with/321/"))).toBe(true);
  });
  it("still forwards other DMs to core-brain", async () => {
    stubX(); const brain = { fetch: vi.fn(async () => new Response("ok")) };
    const r = await post(dmEvent("scan me", "321"), { ...env, CORE_BRAIN: brain });
    expect(r.status).toBe(200);
    expect(brain.fetch).toHaveBeenCalledTimes(1);
  });
});
