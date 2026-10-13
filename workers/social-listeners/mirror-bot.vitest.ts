// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { resetTokenCache } from "./src/x-oauth";
import { classifyTheme } from "./src/funnel";
import { CONSENT_MESSAGE, INTENT_REPLIES, WELCOME_BODY, WELCOME_MESSAGE, branded, greeting, buildMirrorMessage, describeShape, extractMirrorDms, parseBareReply, parseMirrorCommand } from "./src/mirror-bot";

const sig = (body: string) => "sha256=" + createHmac("sha256", "xs").update(body).digest("base64");
const dm = (sender: string, text: string, forUser = "999") =>
  JSON.stringify({ for_user_id: forUser, direct_message_events: [{ type: "message_create", message_create: { sender_id: sender, message_data: { text } } }] });
const brain = () => ({ fetch: vi.fn(async () => new Response("ok")) });
const env = (b = brain()) => ({ MEDIA_VIDEO_URL: "off", X_CONSUMER_SECRET: "xs", X_BEARER_TOKEN: "bearer", X_USER_ACCESS_TOKEN: "user", CORE_BRAIN: b });
const post = (body: string, e: object) =>
  worker.fetch(new Request("https://w/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig(body) } }), e as never, { waitUntil: () => {} } as never);

/** The fetch calls a test cares about: the greeting's @handle lookup is incidental. */
const calls = (f: { mock: { calls: any[][] } }) => f.mock.calls.filter((c) => !String(c[0]).includes("user.fields=username"));
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
    expect(calls(f)).toHaveLength(1);
    const [url, init] = calls(f)[0] as [string, RequestInit];
    expect(url).toContain("/dm_conversations/with/42/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user");
    expect(JSON.parse(init.body as string).text).toContain("reply Y");
    expect(b.fetch).not.toHaveBeenCalled();
  });

  it("MIRROR YES scans the public profile and DMs the mirror", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).includes("/users/42") ? Response.json({ data: { description: "hello world", protected: false } }) : new Response("{}"),
    );
    const r = await post(dm("42", "MIRROR YES"), env());
    expect(r.status).toBe(200);
    await new Promise((x) => setTimeout(x, 0));
    const urls = calls(f).map((c) => String(c[0]));
    expect(urls[0]).toContain("/users/42?user.fields=");
    expect(urls[1]).toContain("/dm_conversations/with/42/messages");
    expect(JSON.parse((calls(f)[1][1] as RequestInit).body as string).text).toContain("hello world");
  });

  it("MIRROR NO scans nothing", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await post(dm("42", "mirror no"), env());
    await new Promise((x) => setTimeout(x, 0));
    expect(calls(f).map((c) => String(c[0])).some((u) => u.includes("/users/"))).toBe(false);
  });

  it("sends an apology DM when the scan fails", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).includes("/users/42") ? new Response("no", { status: 500 }) : new Response("{}"),
    );
    await post(dm("42", "MIRROR YES"), env());
    await new Promise((x) => setTimeout(x, 0));
    expect(JSON.parse((calls(f)[1][1] as RequestInit).body as string).text).toContain("couldn't complete");
  });

  it("welcomes the sender straight away and leaves counting to the funnel (core-brain would log it twice)", async () => {
    const b = brain();
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const r = await post(dm("42", "hello"), env(b));
    expect(r.status).toBe(200);
    await new Promise((x) => setTimeout(x, 0));
    expect(b.fetch).not.toHaveBeenCalled();
    expect(calls(f)).toHaveLength(1);
    expect(String(calls(f)[0][0])).toContain("/dm_conversations/with/42/messages");
    expect(JSON.parse((calls(f)[0][1] as RequestInit).body as string).text).toBe(WELCOME_MESSAGE);
  });
  it("never answers our own messages, or any DM when our own id is unknown", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await post(dm("999", "hello"), env());
    await post(JSON.stringify({ direct_message_events: [{ type: "message_create", message_create: { sender_id: "42", message_data: { text: "hello" } } }] }), env());
    await new Promise((x) => setTimeout(x, 0));
    expect(calls(f)).toHaveLength(0);
  });
  it("welcomes a dm.received DM that is not a command", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const body = JSON.stringify({ data: { event_type: "dm.received", filter: { user_id: "999" }, payload: { sender_id: "42", text: "hi there" } } });
    expect((await post(body, env())).status).toBe(200);
    await new Promise((x) => setTimeout(x, 0));
    expect(String(calls(f)[0][0])).toContain("/dm_conversations/with/42/messages");
  });
  it("the welcome offers the Mirror and a tagged scan link", () => {
    expect(WELCOME_MESSAGE).toContain("Mirror");
    expect(WELCOME_MESSAGE).toContain("utm_source=x&utm_medium=channel_osint");
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
    expect(String(calls(f)[0][0])).toContain("/dm_conversations/with/42/messages");
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
    expect(calls(f)).toHaveLength(0);
  });
  it("fails open when the limiter throws", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await post(dm("42", "MIRROR"), { ...env(), RATE_LIMITER: { limit: vi.fn(async () => { throw new Error("down"); }) } });
    await new Promise((x) => setTimeout(x, 0));
    expect(calls(f)).toHaveLength(1);
  });
  it("retries the DM once with a refreshed token after a 401", async () => {
    let first = true;
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      if (String(u).startsWith("https://sb.test")) return Response.json([]);
      if (String(u).includes("oauth2/token")) return Response.json({ access_token: "fresh", refresh_token: "r2", expires_in: 7200 });
      if (first && String(u).includes("/dm_conversations/")) { first = false; return new Response("expired", { status: 401 }); }
      return new Response("{}");
    });
    const e = { ...env(), SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "k", X_CLIENT_ID: "c", X_CLIENT_SECRET: "s", X_REFRESH_TOKEN: "boot" };
    await post(dm("77", "MIRROR"), e);
    await new Promise((x) => setTimeout(x, 20));
    const dms = calls(f).filter((c) => String(c[0]).includes("/dm_conversations/"));
    expect(dms).toHaveLength(2);
    expect((dms[1][1]!.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });
  it("tags the scan link for channel analytics", () => {
    expect(buildMirrorMessage({ protected: false })).toContain("utm_source=x&utm_medium=channel_osint&utm_campaign=bot_reply");
  });
});

describe("bare Y / N answers (MPC-7628)", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  /** Fake X: DM history for sender 42 (newest first), a profile lookup, and DM sends. */
  function x(history: { sender_id: string; text: string; created_at: string }[]) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      const url = String(u);
      if (url.includes("/dm_events")) return Response.json({ data: history });
      if (url.includes("/users/42")) return Response.json({ data: { description: "hello world", protected: false } });
      return new Response("{}");
    });
  }
  const urls = (f: ReturnType<typeof x>) => calls(f).map((c) => String(c[0]));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const asked = (ms = 60_000) => [{ sender_id: "999", text: CONSENT_MESSAGE, created_at: ago(ms) }, { sender_id: "42", text: "MIRROR", created_at: ago(ms + 5000) }];

  it("parses Y / YES / N / NO in any case and nothing else", () => {
    for (const t of ["Y", "y", "Yes", "YES", " yes! ", "yeah", "Yep", "yup", "YESS"]) expect(parseBareReply(t)).toBe("consent");
    for (const t of ["N", "n", "No", "NO", "nope"]) expect(parseBareReply(t)).toBe("decline");
    for (const t of ["yes please", "maybe", "", "yy", "you", "yo", "yesterday", undefined]) expect(parseBareReply(t)).toBeNull();
  });
  it("marks bare replies so they can be checked first", () => {
    expect(extractMirrorDms(JSON.parse(dm("42", "y")))).toEqual([{ senderId: "42", text: "y", command: "consent", bare: true }]);
  });
  it("a bare Y right after the consent request runs the scan and sends the mirror", async () => {
    const b = brain(); const f = x(asked());
    expect((await post(dm("42", "y"), env(b))).status).toBe(200);
    await settle();
    const u = urls(f);
    expect(u[0]).toContain("/dm_conversations/with/42/dm_events");
    expect(u[1]).toContain("/users/42");
    expect(u[2]).toContain("/dm_conversations/with/42/messages");
    expect(JSON.parse((calls(f)[2][1] as RequestInit).body as string).text).toContain("hello world");
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("a quiet N right after the request still declines and scans nothing", async () => {
    const f = x(asked());
    await post(dm("42", "N"), env());
    await settle();
    expect(urls(f).some((u) => u.includes("/users/42"))).toBe(false);
    expect(JSON.parse((calls(f)[1][1] as RequestInit).body as string).text).toContain("Nothing was scanned");
  });
  it("a bare Y with no consent request behind it is an ordinary message: welcomed, no scan", async () => {
    const b = brain(); const f = x([{ sender_id: "42", text: "hi", created_at: ago(1000) }]);
    await post(dm("42", "y"), env(b));
    await settle();
    expect(urls(f).some((u) => u.includes("/users/"))).toBe(false);
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("a bare Y after the mirror result (our last message was not the request) does not scan again", async () => {
    const b = brain(); const f = x([{ sender_id: "999", text: "🪞 Your Mirror (public information only)", created_at: ago(1000) }]);
    await post(dm("42", "yes"), env(b));
    await settle();
    expect(urls(f).some((u) => u.includes("/users/"))).toBe(false);
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("a consent request older than 15 minutes has expired", async () => {
    const b = brain(); const f = x(asked(16 * 60_000));
    await post(dm("42", "y"), env(b));
    await settle();
    expect(urls(f).some((u) => u.includes("/users/"))).toBe(false);
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("is rate limited like any Mirror command and then gets nothing", async () => {
    const b = brain(); const f = x(asked());
    const limited = { limit: vi.fn(async () => ({ success: false })) };
    await post(dm("42", "y"), { ...env(b), RATE_LIMITER: limited });
    await settle();
    expect(calls(f)).toHaveLength(0);
    expect(b.fetch).not.toHaveBeenCalled();
  });
});

describe("consent wording (MPC-7628)", () => {
  it("asks only for a Y and does not ask for a no", () => {
    expect(CONSENT_MESSAGE).toContain("just reply Y");
    expect(CONSENT_MESSAGE).not.toMatch(/reply N|MIRROR NO|cancel/i);
  });
});

describe("Alice clip on DMs (MPC-7628)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));
  /** Fake X + site: the clip, the chunked upload, DM sends. `upload` decides how INIT answers. */
  function fake(upload: "ok" | "forbidden" = "ok", dmWithVideoOk = true) {
    const sent: any[] = [];
    const steps: string[] = [];
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init?: any) => {
      const url = String(u);
      if (url.endsWith("/media/alice-curtain.mp4")) return new Response(new Uint8Array(2_500_000));
      if (url.includes("/media/upload")) {
        if (init?.method === "GET") return Response.json({ data: { processing_info: { state: "succeeded" } } });
        const cmd = (init.body as FormData).get("command") as string;
        steps.push(cmd);
        if (upload === "forbidden") return new Response("{}", { status: 403 });
        if (cmd === "INIT") return Response.json({ data: { id: "777" } });
        if (cmd === "FINALIZE") return Response.json({ data: { id: "777" } });
        return new Response(null, { status: 204 });
      }
      if (url.includes("/messages")) {
        const body = JSON.parse(init.body);
        sent.push(body);
        return new Response("{}", { status: body.attachments && !dmWithVideoOk ? 400 : 200 });
      }
      return new Response("{}");
    });
    return { f, sent, steps };
  }
  const e = () => ({ ...env(), MEDIA_VIDEO_URL: undefined });

  it("uploads in 1 MB chunks and attaches the clip to the welcome", async () => {
    const x = fake();
    await post(dm("42", "hello"), e());
    await settle();
    expect(x.steps).toEqual(["INIT", "APPEND", "APPEND", "APPEND", "FINALIZE"]);
    expect(x.sent).toHaveLength(1);
    expect(x.sent[0]).toEqual({ text: WELCOME_MESSAGE, attachments: [{ media_id: "777" }] });
  });
  it("sends the welcome as text alone when the upload is refused (e.g. no media.write scope)", async () => {
    const x = fake("forbidden");
    await post(dm("42", "hello"), e());
    await settle();
    expect(x.sent).toEqual([{ text: WELCOME_MESSAGE }]);
  });
  it("retries as text alone when X refuses the attachment", async () => {
    const x = fake("ok", false);
    await post(dm("42", "hello"), e());
    await settle();
    expect(x.sent).toEqual([{ text: WELCOME_MESSAGE, attachments: [{ media_id: "777" }] }, { text: WELCOME_MESSAGE }]);
  });
  it("MEDIA_VIDEO_URL=off means text only and no upload", async () => {
    const x = fake();
    await post(dm("42", "hello"), env());
    await settle();
    expect(x.steps).toEqual([]);
    expect(x.sent).toEqual([{ text: WELCOME_MESSAGE }]);
  });
});

describe("branding, welcome and simple Y (MPC-7628)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const sentText = (f: ReturnType<typeof vi.spyOn>) =>
    calls(f as never).filter((c) => String(c[0]).includes("/messages")).map((c) => JSON.parse((c[1] as RequestInit).body as string).text as string);
  /** Fake X: handle lookup, DM history for sender 42 (newest first) and DM sends. */
  const x = (history: { sender_id: string; text: string; created_at: string }[] = []) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      const url = String(u);
      if (url.includes("/dm_events")) return Response.json({ data: history });
      if (url.includes("user.fields=username")) return Response.json({ data: { username: "alice_99" } });
      if (url.includes("/users/42")) return Response.json({ data: { username: "alice_99", description: "hello", protected: false } });
      return new Response("{}");
    });

  it("every message opens with who we are, using the person's @handle, and ends with the signature", async () => {
    const f = x();
    await post(dm("42", "hi"), env());
    await settle();
    const [text] = sentText(f);
    expect(text.startsWith("Hello @alice_99, this is @MyPrivacyTOOL")).toBe(true);
    expect(text.endsWith("— @MyPrivacyTOOL · myprivacytool.io")).toBe(true);
  });
  it("leaves the handle out when it cannot be looked up", () => {
    expect(greeting()).toBe("Hello, this is @MyPrivacyTOOL 👋");
    expect(greeting("bob")).toBe("Hello @bob, this is @MyPrivacyTOOL 👋");
  });
  it("the welcome asks for a simple Y, says what is read, and no longer asks for the word MIRROR", () => {
    expect(WELCOME_BODY).toMatch(/reply Y/);
    expect(WELCOME_BODY).toContain("PUBLIC X profile");
    expect(WELCOME_BODY).not.toMatch(/reply MIRROR/i);
  });
  it("asks what brought them here", () => expect(WELCOME_BODY).toContain("What brought you here?"));
  it("a Y straight after the welcome runs the Mirror, with thanks and the handle", async () => {
    const f = x([{ sender_id: "999", text: branded("alice_99", WELCOME_BODY), created_at: new Date(Date.now() - 30_000).toISOString() }]);
    await post(dm("42", "y"), env());
    await settle();
    const [text] = sentText(f);
    expect(text).toContain("Thank you for saying yes.");
    expect(text).toContain("Your Mirror");
    expect(text.startsWith("Hello @alice_99")).toBe(true);
  });
  it("answers 1, 2 and 3 with a tailored next step that still takes a Y, and logs only the number", async () => {
    for (const n of ["1", "2", "3"]) {
      const f = x();
      await post(dm("42", n), env());
      await settle();
      const [text] = sentText(f);
      expect(text).toContain(INTENT_REPLIES[n].split("\n")[0]);
      expect(text).toMatch(/reply Y/);
      vi.restoreAllMocks();
    }
  });
  it("does not treat object keys like 'constructor' as a choice", async () => {
    const f = x();
    await post(dm("42", "constructor"), env());
    await settle();
    expect(sentText(f)[0]).toContain("What brought you here?");
  });
});

describe("Channel OSINT funnel counting (MPC-7628)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const e = () => ({ ...env(), SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "k" });
  /** Fake X + Supabase: the RPC bodies are what we assert on. */
  function fake(history: { sender_id: string; text: string; created_at: string }[] = []) {
    const rpc: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init?: any) => {
      const url = String(u);
      if (url.includes("/rpc/mpt_brain_record")) { rpc.push(JSON.parse(init.body)); return new Response("{}"); }
      if (url.includes("/dm_events")) return Response.json({ data: history });
      if (url.includes("/users/42")) return Response.json({ data: { username: "alice_99", description: "secret bio words", protected: false } });
      return new Response("{}");
    });
    return rpc;
  }
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("counts a welcomed DM once, by theme, with no sender id and no text", async () => {
    const rpc = fake();
    await post(dm("42", "someone is stalking me and I am scared"), e());
    await settle();
    expect(rpc).toHaveLength(1);
    expect(rpc[0]).toMatchObject({ p_channel: "x", p_sender_id: null, p_intent: "help", p_intent_source: "rules", p_response_key: "x.welcome.safety" });
    expect(JSON.stringify(rpc)).not.toMatch(/stalking|scared|42/);
  });
  it("counts a 1/2/3 choice by number", async () => {
    const rpc = fake();
    await post(dm("42", "2"), e());
    await settle();
    expect(rpc.map((r) => r.p_response_key)).toEqual(["x.intent.2"]);
  });
  it("counts MIRROR as a request and the consent as a scan request", async () => {
    const rpc = fake();
    await post(dm("42", "MIRROR"), e());
    await post(dm("42", "MIRROR YES"), e());
    await settle();
    expect(rpc.map((r) => [r.p_intent, r.p_response_key])).toEqual([["help", "x.mirror.request"], ["scan", "x.mirror.consent"]]);
    expect(rpc.every((r) => r.p_sender_id === null)).toBe(true);
    expect(JSON.stringify(rpc)).not.toMatch(/secret bio|alice_99/);
  });
  it("a bare Y after the welcome counts as the consent (scan) and nothing else", async () => {
    const rpc = fake([{ sender_id: "999", text: branded("alice_99", WELCOME_BODY), created_at: ago(20_000) }]);
    await post(dm("42", "y"), e());
    await settle();
    expect(rpc.map((r) => r.p_response_key)).toEqual(["x.mirror.consent"]);
  });
  it("a DM we answer is not also forwarded to core-brain (no double count)", async () => {
    fake();
    const b = brain();
    await post(dm("42", "hello"), { ...e(), CORE_BRAIN: b });
    await settle();
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("a failing funnel write never blocks the reply", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      if (String(u).includes("/rpc/")) throw new Error("down");
      return new Response("{}");
    });
    await post(dm("42", "hello"), e());
    await settle();
    expect(calls(f).some((c) => String(c[0]).includes("/messages"))).toBe(true);
  });
  it("classifies themes by keyword and records only the word", () => {
    expect(classifyTheme("I got a scam text")).toBe("scam");
    expect(classifyTheme("my passwords were leaked")).toBe("exposure");
    expect(classifyTheme("we are a company looking at your API")).toBe("business");
    expect(classifyTheme("just curious what is out there about me")).toBe("curious");
    expect(classifyTheme("hello")).toBe("other");
  });
});
