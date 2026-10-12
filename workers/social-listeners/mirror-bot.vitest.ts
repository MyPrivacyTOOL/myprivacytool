// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { buildMirrorMessage, extractMirrorDms, parseMirrorCommand } from "./src/mirror-bot";

const sig = (body: string) => "sha256=" + createHmac("sha256", "xs").update(body).digest("base64");
const dm = (sender: string, text: string, forUser = "999") =>
  JSON.stringify({ for_user_id: forUser, direct_message_events: [{ type: "message_create", message_create: { sender_id: sender, message_data: { text } } }] });
const brain = () => ({ fetch: vi.fn(async () => new Response("ok")) });
const env = (b = brain()) => ({ X_CONSUMER_SECRET: "xs", X_BEARER_TOKEN: "bearer", X_USER_ACCESS_TOKEN: "user", CORE_BRAIN: b });
const post = (body: string, e: object) =>
  worker.fetch(new Request("https://w/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig(body) } }), e as never, { waitUntil: () => {} } as never);

afterEach(() => vi.restoreAllMocks());

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
