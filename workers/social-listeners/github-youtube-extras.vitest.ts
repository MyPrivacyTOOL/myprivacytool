// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689 pilot: GitHub and YouTube extras. Synthetic payloads, made-up secrets, stubbed fetch: nothing here reaches GitHub or Google.
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_EXTRA_HEXAGONS, githubStates, handleGithubExtras, verifyGithubSignature } from "./src/github-extras";
import { YOUTUBE_EXTRA_HEXAGONS, commentAuthorChannelId, handleYoutubeExtras, lookupChannel, youtubeStates } from "./src/youtube-extras";
import { GITHUB_EXTRA_IDS, YOUTUBE_EXTRA_IDS } from "../../shared/hexagon-registry/channels.js";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";
import type { Env } from "./src/shared";

afterEach(() => { vi.restoreAllMocks(); });
const st = (l: { id: string; state: string }[]) => Object.fromEntries(l.map((x) => [x.id, x.state]));

describe("catalogue", () => {
  it("GitHub 6 and YouTube 6 are catalogue items marked OK and still 'new'; the lists match the registry", () => {
    expect(GITHUB_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(GITHUB_EXTRA_IDS);
    expect(YOUTUBE_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(YOUTUBE_EXTRA_IDS);
    for (const d of [...GITHUB_EXTRA_HEXAGONS, ...YOUTUBE_EXTRA_HEXAGONS]) {
      const item = HEXAGON_CATALOGUE.find((h) => h.id === d.id);
      expect(item, d.id).toBeTruthy();
      expect([item!.status, item!.access, item!.arrival]).toEqual(["new", "OK", d.arrival]);
    }
  });
});

describe("GitHub", () => {
  const SECRET = "gh-test-secret";
  const env = (over: Record<string, unknown> = {}) => ({ GITHUB_EXTRAS: "on", GITHUB_WEBHOOK_SECRET: SECRET, GITHUB_PROBE_LOGINS: "octo-test", ...over }) as unknown as Env;
  const payload = (over: Record<string, unknown> = {}) => ({ action: "created", sender: { login: "octo-test", id: 7 }, comment: { body: "secret words" }, ...over });
  const USER = { login: "octo-test", name: "Octo", company: "Acme", location: "London", email: "octo@example.com", created_at: "2012-01-01T00:00:00Z", public_repos: 4, followers: 2 };
  const EVENTS = [{ id: "1", type: "PushEvent", created_at: "2026-10-20T09:00:00Z" }];
  const post = (body: unknown, e: Env, f?: typeof fetch, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify(body);
    return handleGithubExtras(new Request("https://x/webhook/github-extras", { method: "POST", body: raw, headers: { "X-Hub-Signature-256": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"), "X-GitHub-Event": "issue_comment", ...headers } }), e, f);
  };
  const lookups = (user: unknown, events: unknown) => (async (u: string) => (String(u).endsWith("/events/public") ? (events === null ? new Response("no", { status: 403 }) : Response.json(events)) : user === null ? new Response("no", { status: 404 }) : Response.json(user))) as unknown as typeof fetch;

  it("reads the payload and the two public lookups; a failed lookup is 'not checked', an empty one 'not returned'", () => {
    expect(st(githubStates(payload(), USER, EVENTS))).toEqual({ "gh.sender": "returned", "gh.content": "returned", "gh.profile": "returned", "gh.account_age": "returned", "gh.public_email": "returned", "gh.activity_times": "returned" });
    expect(st(githubStates(payload({ comment: undefined }), { login: "x", email: null, name: null, created_at: "2020" }, []))).toMatchObject({ "gh.content": "not_returned", "gh.profile": "not_returned", "gh.public_email": "not_returned", "gh.activity_times": "not_returned" });
    expect(st(githubStates(payload(), null, null))).toMatchObject({ "gh.profile": "not_checked", "gh.account_age": "not_checked", "gh.public_email": "not_checked", "gh.activity_times": "not_checked", "gh.sender": "returned" });
    expect(st(githubStates(payload({ comment: undefined, issue: { body: "x" } }), USER, EVENTS))["gh.content"]).toBe("returned");
  });
  it("verifies X-Hub-Signature-256 and fails closed", async () => {
    const sig = "sha256=" + createHmac("sha256", SECRET).update("{}").digest("hex");
    expect(await verifyGithubSignature(sig, "{}", env())).toBe(true);
    expect(await verifyGithubSignature(sig, "{ }", env())).toBe(false);
    expect(await verifyGithubSignature(null, "{}", env())).toBe(false);
    expect(await verifyGithubSignature(sig, "{}", env({ GITHUB_WEBHOOK_SECRET: undefined }))).toBe(false);
  });
  it("is off by default, POST only and 401 on a bad signature; answers ping", async () => {
    expect((await post(payload(), env({ GITHUB_EXTRAS: undefined }))).status).toBe(404);
    expect((await handleGithubExtras(new Request("https://x/webhook/github-extras"), env())).status).toBe(405);
    expect((await post(payload(), env(), undefined, { "X-Hub-Signature-256": "sha256=00" })).status).toBe(401);
    expect(await (await post({ zen: "x" }, env(), undefined, { "X-GitHub-Event": "ping" })).json()).toEqual({ ok: true });
  });
  it("looks up only an allow-listed login, from the two public endpoints, and answers with states and counts, never a value", async () => {
    const urls: string[] = [];
    const f = ((u: string, i: any) => { urls.push(String(u)); expect(i.headers["user-agent"]).toBeTruthy(); return lookups(USER, EVENTS)(u, i); }) as unknown as typeof fetch;
    const res = await post(payload(), env(), f);
    const body: any = await res.json();
    expect(urls.sort()).toEqual(["https://api.github.com/users/octo-test", "https://api.github.com/users/octo-test/events/public"]);
    expect(body).toMatchObject({ ok: true, checked: true, seen: 6, total: 6 });
    const text = JSON.stringify(body);
    for (const secret of ["secret words", "octo@example.com", "Acme", "London", "2012"]) expect(text).not.toContain(secret);
    const none = vi.fn();
    expect(await (await post(payload({ sender: { login: "other", id: 1 } }), env(), none as any)).json()).toEqual({ ok: true, checked: false });
    await post(payload(), env({ GITHUB_PROBE_LOGINS: undefined }), none as any);
    await post(payload({ sender: { login: "../evil", id: 1 } }), env({ GITHUB_PROBE_LOGINS: "../evil" }), none as any);
    expect(none).not.toHaveBeenCalled();
  });
  it("a lookup that fails says 'not checked' and the endpoint still answers", async () => {
    const body: any = await (await post(payload(), env(), lookups(null, null))).json();
    expect(body.states.find((s: any) => s.id === "gh.profile").state).toBe("not_checked");
    expect(body.seen).toBe(2);
  });
});

describe("YouTube", () => {
  const CH = "UC" + "a".repeat(22);
  const env = (over: Record<string, unknown> = {}) => ({ YOUTUBE_EXTRAS: "on", YOUTUBE_EXTRAS_SECRET: "op-secret", YOUTUBE_API_KEY: "key1", YOUTUBE_PROBE_CHANNEL_IDS: CH, ...over }) as unknown as Env;
  const comment = (over: Record<string, unknown> = {}) => ({ snippet: { authorDisplayName: "Nelly", authorProfileImageUrl: "https://a", authorChannelId: { value: CH }, textDisplay: "great video", publishedAt: "2026-10-20T00:00:00Z", likeCount: 3, ...over } });
  const CHANNEL = { snippet: { publishedAt: "2015-01-01T00:00:00Z", country: "GB", customUrl: "@nelly", description: "about me" }, statistics: { subscriberCount: "120", hiddenSubscriberCount: false, videoCount: "9" }, topicDetails: { topicCategories: ["https://en.wikipedia.org/wiki/Music"] }, brandingSettings: { channel: { keywords: "a b" } } };
  const post = (body: unknown, e: Env, f?: typeof fetch, headers: Record<string, string> = { "X-Extras-Secret": "op-secret" }) => handleYoutubeExtras(new Request("https://x/youtube/check", { method: "POST", body: JSON.stringify(body), headers }), e, f);
  const channels = (item: unknown, status = 200) => (async () => new Response(JSON.stringify({ items: item ? [item] : [] }), { status })) as unknown as typeof fetch;

  it("reads the comment and the channel; a missing channel lookup is 'not checked'; missing fields are 'not returned'", () => {
    expect(st(youtubeStates(comment(), CHANNEL as any))).toEqual({ "yt.comment": "returned", "yt.channel_age": "returned", "yt.country": "returned", "yt.channel_about": "returned", "yt.stats": "returned", "yt.topics": "returned" });
    expect(st(youtubeStates(comment(), { snippet: { publishedAt: "2020" } } as any))).toMatchObject({ "yt.channel_age": "returned", "yt.country": "not_returned", "yt.topics": "not_returned", "yt.stats": "not_returned" });
    expect(st(youtubeStates(comment(), null))).toMatchObject({ "yt.comment": "returned", "yt.channel_age": "not_checked", "yt.stats": "not_checked" });
    expect(st(youtubeStates({}, null))["yt.comment"]).toBe("not_returned");
  });
  it("accepts only a well-formed channel id from the comment", () => {
    expect(commentAuthorChannelId(comment())).toBe(CH);
    for (const bad of [{}, comment({ authorChannelId: { value: "x" } }), comment({ authorChannelId: { value: "UC../evil" } })]) expect(commentAuthorChannelId(bad)).toBeNull();
  });
  it("channel lookup: one channels.list call with the key; any failure is null", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify({ items: [CHANNEL] })); }) as unknown as typeof fetch;
    expect((await lookupChannel(CH, "key1", f))?.snippet).toBeTruthy();
    expect(urls[0]).toBe(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,topicDetails,brandingSettings&id=${CH}&key=key1`);
    expect(await lookupChannel(CH, undefined, f)).toBeNull();
    expect(await lookupChannel(CH, "k", channels(null))).toBeNull();
    expect(await lookupChannel(CH, "k", channels(CHANNEL, 403))).toBeNull();
    expect(await lookupChannel(CH, "k", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
  it("is off by default, needs the operator secret, POST only, and 400 without a comment", async () => {
    expect((await post({ comment: comment() }, env({ YOUTUBE_EXTRAS: undefined }))).status).toBe(404);
    expect((await handleYoutubeExtras(new Request("https://x/youtube/check"), env())).status).toBe(405);
    expect((await post({ comment: comment() }, env(), undefined, { "X-Extras-Secret": "nope" })).status).toBe(401);
    expect((await post({ comment: comment() }, env(), undefined, {})).status).toBe(401);
    expect((await post({ comment: comment() }, env({ YOUTUBE_EXTRAS_SECRET: undefined }))).status).toBe(401);
    expect((await post({}, env())).status).toBe(400);
  });
  it("checks only an allow-listed channel, answers with states and counts and no value, and says 'not checked' when the lookup fails", async () => {
    const body: any = await (await post({ comment: comment() }, env(), channels(CHANNEL))).json();
    expect(body).toMatchObject({ ok: true, checked: true, seen: 6, total: 6 });
    const text = JSON.stringify(body);
    for (const v of ["Nelly", "great video", "GB", "@nelly", "about me", CH]) expect(text).not.toContain(v);
    const failed: any = await (await post({ comment: comment() }, env(), channels(null, 403))).json();
    expect(failed.states.find((s: any) => s.id === "yt.country").state).toBe("not_checked");
    const none = vi.fn();
    expect(await (await post({ comment: comment({ authorChannelId: { value: "UC" + "b".repeat(22) } }) }, env(), none as any)).json()).toEqual({ ok: true, checked: false });
    await post({ comment: comment() }, env({ YOUTUBE_PROBE_CHANNEL_IDS: undefined }), none as any);
    expect(none).not.toHaveBeenCalled();
  });
});
