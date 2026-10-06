/* eslint-disable @typescript-eslint/no-explicit-any -- untyped snoowrap/test payloads */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedditAdapter, createRedditClient, type RedditClientLike } from "../reddit";
import { createBehaviorHandler } from "@/app/api/channels/reddit/behavior/route";
import { generateKeyBase64, importKey, encrypt, decrypt } from "@/modules/storage/encryption";
import { saveChannelTokens } from "@/modules/channels/token-store";

vi.mock("@/modules/channels/middleware/rate-limiter", () => ({ withRateLimit: <T>(fn: () => Promise<T>) => fn() }));

const NOW = Math.floor(Date.now() / 1000);
const mockClient = (): RedditClientLike => ({
  getMe: async () => ({ name: "tester", created_utc: NOW - 86400 * 100, total_karma: 50, verified: true }),
  getUser: () => ({
    getComments: async () => [{ subreddit: { display_name: "privacy" }, body: "RAW_COMMENT encryption rocks", score: 4, controversiality: 0 }],
    getSubmissions: async () => [{ subreddit: { display_name: "privacy" }, title: "RAW_TITLE tracking", score: 2, created_utc: NOW - 86400 }],
  }),
});

describe("RedditAdapter", () => {
  it("normalizes Reddit API responses", async () => {
    const a = await new RedditAdapter(mockClient()).fetchActivity();
    expect(a.username).toBe("tester");
    expect(a.comments[0].subreddit).toBe("privacy");
    expect(a.submissions).toHaveLength(1);
  });
});

describe("GET /api/channels/reddit/behavior", () => {
  const req = new Request("http://localhost/api/channels/reddit/behavior");
  it("401 when unauthenticated", async () => {
    const res = await createBehaviorHandler({ getUserId: async () => null, getClient: async () => mockClient() })(req);
    expect(res.status).toBe(401);
  });
  it("404 when not connected", async () => {
    const res = await createBehaviorHandler({ getUserId: async () => "u1", getClient: async () => null })(req);
    expect(res.status).toBe(404);
  });
  it("200 with sanitized PaPIT JSON", async () => {
    const res = await createBehaviorHandler({ getUserId: async () => "u1", getClient: async () => mockClient() })(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source_channel).toBe("reddit");
    expect(JSON.stringify(body)).not.toMatch(/RAW_COMMENT|RAW_TITLE/);
  });
  it("502 without leaking upstream error text", async () => {
    const bad: RedditClientLike = { ...mockClient(), getMe: async () => { throw new Error("token abc123 invalid"); } };
    const res = await createBehaviorHandler({ getUserId: async () => "u1", getClient: async () => bad })(req);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("abc123");
  });
});

describe("token encryption + storage", () => {
  it("round-trips and stores only ciphertext", async () => {
    const key = await importKey(generateKeyBase64());
    const ct = await encrypt("secret-token", key);
    expect(ct).not.toContain("secret-token");
    expect(await decrypt(ct, key)).toBe("secret-token");

    let row: any;
    const db: any = { from: () => ({ upsert: async (r: any) => { row = r; return { error: null }; } }) };
    await saveChannelTokens(db, key, "u1", "reddit", { accessToken: "ACCESS_PLAIN", refreshToken: "REFRESH_PLAIN", scopes: ["identity", "read", "history"] });
    expect(JSON.stringify(row)).not.toMatch(/ACCESS_PLAIN|REFRESH_PLAIN/);
    expect(row.platform).toBe("reddit");
    expect(await decrypt(row.access_token_enc, key)).toBe("ACCESS_PLAIN");
  });
  it("rejects tampered ciphertext and bad keys", async () => {
    const key = await importKey(generateKeyBase64());
    const ct = await encrypt("x", key);
    await expect(decrypt(ct.slice(0, -3) + "AAA", key)).rejects.toBeDefined();
    await expect(importKey(btoa("short"))).rejects.toThrow();
  });
});

describe("createRedditClient", () => {
  it("calls the Reddit API with bearer auth and user agent, unwrapping listings", async () => {
    const calls: Array<[string, any]> = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ data: { children: [{ data: { subreddit: "privacy", body: "x" } }] } }), { status: 200 });
    });
    const c = createRedditClient({ userAgent: "UA/1.0", accessToken: "tok" });
    const comments = await c.getUser("a b").getComments({ limit: 100 });
    expect(comments).toEqual([{ subreddit: "privacy", body: "x" }]);
    expect(calls[0][0]).toBe("https://oauth.reddit.com/user/a%20b/comments?limit=100&raw_json=1");
    expect(calls[0][1].headers).toEqual({ Authorization: "Bearer tok", "User-Agent": "UA/1.0" });
    vi.unstubAllGlobals();
  });
  it("throws a sanitized error on failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("secret body", { status: 429 }));
    const c = createRedditClient({ userAgent: "UA", accessToken: "tok" });
    await expect(c.getMe()).rejects.toThrow("Reddit API request failed (429)");
    vi.unstubAllGlobals();
  });
});
