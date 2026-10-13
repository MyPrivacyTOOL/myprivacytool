// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { resetTokenCache } from "./src/x-oauth";
import { buildMirrorMessage, describeShape, extractMirrorDms, parseMirrorCommand } from "./src/mirror-bot";

const sig = (body: string) => "sha256=" + createHmac("sha256", "xs").update(body).digest("base64");
const dm = (sender: string, text: string, forUser = "999") =>
  JSON.stringify({ for_user_id: forUser, direct_message_events: [{ type: "message_create", message_create: { sender_id: sender, message_data: { text } } }] });
const brain = () => ({ fetch: vi.fn(async () => new Response("ok")) });
const env = (b = brain()) => ({ X_CONSUMER_SECRET: "xs", X_BEARER_TOKEN: "bearer", X_USER_ACCESS_TOKEN: "user", CORE_BRAIN: b });
const post = (body: string, e: object) =>
  worker.fetch(new Request("https://w/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig(body) } }), e as never, { waitUntil: () => {} } as never);

afterEach(() => { vi.restoreAllMocks(); resetTokenCache(); });

describe("parseMirrorCommand", () => {
  it("recognises the three commands, tolerant of case and punctuation", () => {
    expect(parseMirrorCommand("MIRROR")).toBe("request");
    expect(parseMirrorCommand(" mirror! ")).toBe("request");
    expect(parseMirrorCommand("Mirror yes")).toBe("consent");
    expect(parseMirrorCommand("MIRROR NO.")).toBe("decline");
  });
  it("ignores anything else", () => {
    for (const t of ["hello", "mirror me please now", "yes", "mirror maybe", "", undefined, 5]) expect(parseMirrorCommand(t)).toBeNull();
  });
});

describe("extractMirrorDms", () => {
  it("skips our own echoes and non-commands", () => {
    expect(extractMirrorDms(JSON.parse(dm("999", "MIRROR")))).toEqual([]);
    expect(extractMirrorDms(JSON.parse(dm("1", "hi")))).toEqual([]);
    expect(extractMirrorDms(JSON.parse(dm("1", "MIRROR")))).toHaveLength(1);
  });
});

describe("buildMirrorMessage", () => {
  it("separates visible from protected data and promises no retention", () => {
    const m = buildMirrorMessage({ description: "dev in Berlin", location: "Berlin", protected: false, created_at: "2015-03-02T00:00:00Z", public_metrics: { followers_count: 5, following_count: 6, tweet_count: 7 } });
    expect(m).toContain("What anyone can see");
    expect(m).toContain("dev in Berlin");
    expect(m).toContain("2015-03-02");
    expect(m).toContain("What stays protected");
    expect(m).toContain("stored nothing");
    expect(m).toContain("PUBLIC");
  });
  it("notes protected accounts", () => expect(buildMirrorMessage({ protected: true })).toContain("PROTECTED"));
});

describe("MIRROR flow over the X webhook", () => {
  it("MIRROR asks for consent, does not scan, and is not forwarded to core-brain", async () => {
    const b = brain();
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const r = await post(dm("42", "MIRROR"), env(b));
    expect(r.status).toBe(200);
    await new Promise((x) => setTimeout(x, 0));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/dm_conversations/with/42/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user");
    expect(JSON.parse(init.body as string).text).toContain("MIRROR YES");
    expect(b.fetch).not.toHaveBeenCalled();
  });

  it("MIRROR YES scans the public profile and DMs the mirror", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).includes("/users/42") ? Response.json({ data: { description: "hello world", protected: false } }) : new Response("{}"),
    );
    const r = await post(dm("42", "MIRROR YES"), env());
    expect(r.status).toBe(200);
    await new Promise((x) => setTimeout(x, 0));
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("/users/42?user.fields=");
    expect(urls[1]).toContain("/dm_conversations/with/42/messages");
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string).text).toContain("hello world");
  });

  it("MIRROR NO scans nothing", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await post(dm("42", "mirror no"), env());
    await new Promise((x) => setTimeout(x, 0));
    expect(f.mock.calls.map((c) => String(c[0])).some((u) => u.includes("/users/"))).toBe(false);
  });

  it("sends an apology DM when the scan fails", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).includes("/users/42") ? new Response("no", { status: 500 }) : new Response("{}"),
    );
    await post(dm("42", "MIRROR YES"), env());
    await new Promise((x) => setTimeout(x, 0));
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string).text).toContain("couldn't complete");
  });

  it("still forwards ordinary DMs to core-brain", async () => {
    const b = brain();
    const f = vi.spyOn(globalThis, "fetch");
    const r = await post(dm("42", "hello"), env(b));
    expect(r.status).toBe(200);
    expect(b.fetch).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("new dm.received event shape (MPC-7628)", () => {
  const evt = (sender: string, text: string, self = "999") =>
    ({ data: { event_type: "dm.received", filter: { user_id: self }, payload: { sender_id: sender, text } } });
  it("understands a dm.received payload and skips our own echo", () => {
    expect(extractMirrorDms(evt("42", "MIRROR YES"))).toEqual([{ senderId: "42", text: "MIRROR YES", command: "consent" }]);
    expect(extractMirrorDms(evt("999", "MIRROR"))).toEqual([]);
  });
  it("does not treat a post that merely says mirror as a DM", () => {
    expect(extractMirrorDms({ tweet_create_events: [{ text: "MIRROR", user: { id: "5" }, author_id: "5" }] })).toEqual([]);
  });
  it("answers a dm.received MIRROR and does not forward it to core-brain", async () => {
    const b = brain();
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const body = JSON.stringify(evt("42", "MIRROR"));
    const r = await post(body, env(b));
    expect(r.status).toBe(200);
    await new Promise((x) => setTimeout(x, 0));
    expect(String(f.mock.calls[0][0])).toContain("/dm_conversations/with/42/messages");
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("describeShape reports names only", () => {
    expect(describeShape({ data: { event_type: "dm.read", payload: { text: "secret words" } }, secret_value: "x y" })).toEqual({ event_type: "dm.read", keys: ["data", "secret_value"] });
  });
});

describe("rate limit, retry and tagging (MPC-7628)", () => {
  it("drops a command silently when the per-sender limit is hit", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const limited = { limit: vi.fn(async () => ({ success: false })) };
    await post(dm("42", "MIRROR YES"), { ...env(), RATE_LIMITER: limited });
    await new Promise((x) => setTimeout(x, 0));
    expect(limited.limit).toHaveBeenCalledWith({ key: "x:42" });
    expect(f).not.toHaveBeenCalled();
  });
  it("fails open when the limiter throws", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await post(dm("42", "MIRROR"), { ...env(), RATE_LIMITER: { limit: vi.fn(async () => { throw new Error("down"); }) } });
    await new Promise((x) => setTimeout(x, 0));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("retries the DM once with a refreshed token after a 401", async () => {
    let first = true;
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      if (String(u).startsWith("https://sb.test")) return Response.json([]);
      if (String(u).includes("oauth2/token")) return Response.json({ access_token: "fresh", refresh_token: "r2", expires_in: 7200 });
      if (first) { first = false; return new Response("expired", { status: 401 }); }
      return new Response("{}");
    });
    const e = { ...env(), SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "k", X_CLIENT_ID: "c", X_CLIENT_SECRET: "s", X_REFRESH_TOKEN: "boot" };
    await post(dm("77", "MIRROR"), e);
    await new Promise((x) => setTimeout(x, 20));
    const dms = f.mock.calls.filter((c) => String(c[0]).includes("/dm_conversations/"));
    expect(dms).toHaveLength(2);
    expect((dms[1][1]!.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });
  it("tags the scan link for channel analytics", () => {
    expect(buildMirrorMessage({ protected: false })).toContain("utm_source=x&utm_medium=channel_osint&utm_campaign=bot_reply");
  });
});
