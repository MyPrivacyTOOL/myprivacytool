// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689: the two records-about-a-person extras. Synthetic page addresses and a stubbed fetch only; nothing here reaches a real site, Telegram or Supabase.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { checkPage, classify, containsTerm, pageText, parseRecordsCommand, recordsReply, safeUrl, statedRoute, termVariants } from "./src/records-check";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000011;
const URL1 = "https://people.example/profile/jane-smith";
const BIG = "<p>" + "lorem ipsum dolor sit amet ".repeat(30) + "</p>";
const page = (inner: string, init: ResponseInit = {}) => new Response(`<html><body>${BIG}${inner}</body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const req = (term = "Jane Smith", kind: "people_search" | "news_archive" = "people_search", url = URL1) => ({ kind, url, term });

describe("command and address rules", () => {
  it("parses only the exact commands, with an https address and a term of 3 to 100 characters", () => {
    expect(parseRecordsCommand(`/listing ${URL1} Jane Smith`)).toEqual({ kind: "people_search", url: URL1, term: "Jane Smith" });
    expect(parseRecordsCommand(`/archive@MyBot ${URL1} jane@example.com`)).toEqual({ kind: "news_archive", url: URL1, term: "jane@example.com" });
    expect(parseRecordsCommand("hello /listing")).toBeNull();
    expect(parseRecordsCommand(`/listing`)).toEqual({ kind: "people_search", error: "address" });
    expect(parseRecordsCommand(`/listing http://people.example/x Jane`)).toEqual({ kind: "people_search", error: "address" });
    expect(parseRecordsCommand(`/archive ${URL1} ab`)).toEqual({ kind: "news_archive", error: "term" });
    expect(parseRecordsCommand(`/archive ${URL1} ${"x".repeat(101)}`)).toEqual({ kind: "news_archive", error: "term" });
    expect(parseRecordsCommand(undefined)).toBeNull();
  });
  it("refuses addresses that are not a public https page", () => {
    for (const bad of ["http://a.example/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://printer.local/x", "https://intranet/x",
      "https://user:pw@a.example/x", "https://a.example:8443/x", "https://a.internal/x", `https://a.example/${"x".repeat(500)}`, "not a url", "ftp://a.example/x"]) expect(safeUrl(bad), bad).toBeNull();
    expect(safeUrl("https://a.example/x?y=1")).not.toBeNull();
    expect(safeUrl("https://a.example:443/x")).not.toBeNull();
  });
  it("matches whole words only, ignores case, and also finds 'Last, First'", () => {
    expect(containsTerm("profile of jane smith, 41", "Jane Smith")).toBe(true);
    expect(containsTerm("smith, jane lives in", "Jane Smith")).toBe(true);
    expect(containsTerm("joanne smithson", "Ann Smith")).toBe(false);
    expect(containsTerm("contact: jane@example.com.", "JANE@example.com")).toBe(true);
    expect(containsTerm("xjane@example.com", "jane@example.com")).toBe(false);
    expect(termVariants("jane@example.com")).toEqual(["jane@example.com"]);
    expect(pageText("<script>var n='jane smith'</script><p>Hello&nbsp;&amp; <b>World</b></p>")).toBe("hello & world");
  });
});

describe("result rules: found, clear, not checked", () => {
  const ok = (body: string, over: Partial<Parameters<typeof classify>[0]> = {}) => classify({ status: 200, contentType: "text/html", body, truncated: false, ...over }, "Jane Smith");
  it("found when the name or email is on the page, even if the page is large or truncated", () => {
    expect(ok(`<html>${BIG}<h1>Jane Smith</h1></html>`)).toEqual({ status: "found", reason: "on_page" });
    expect(ok(`<html>${BIG}<a href="mailto:jane@example.com">mail</a></html>`.replace("Jane Smith", ""))).toEqual({ status: "clear", reason: "absent" });
    expect(classify({ status: 200, contentType: "text/html", body: `<html>${BIG}<a href="mailto:jane@example.com">x</a></html>`, truncated: true }, "jane@example.com").status).toBe("found");
  });
  it("clear only when the page loaded normally and it is absent, or the site says the page is gone (404, 410)", () => {
    expect(ok(`<html>${BIG}</html>`)).toEqual({ status: "clear", reason: "absent" });
    expect(classify({ status: 404, contentType: "text/html", body: "", truncated: false }, "x y z")).toEqual({ status: "clear", reason: "gone" });
    expect(classify({ status: 410, contentType: "", body: "", truncated: false }, "x y z")).toEqual({ status: "clear", reason: "gone" });
  });
  it("a blocked, failed, challenged, partial or non-page fetch is not_checked, never clear", () => {
    for (const status of [401, 403, 429, 451]) expect(classify({ status, contentType: "text/html", body: BIG, truncated: false }, "Jane Smith")).toEqual({ status: "not_checked", reason: "blocked" });
    expect(classify({ status: 503, contentType: "text/html", body: BIG, truncated: false }, "Jane Smith")).toEqual({ status: "not_checked", reason: "http_5xx" });
    expect(classify({ status: 302, contentType: "", body: "", truncated: false }, "Jane Smith").status).toBe("not_checked");
    expect(ok(`<html>${BIG}</html>`, { truncated: true })).toEqual({ status: "not_checked", reason: "too_big_to_read_in_full" });
    expect(ok("<html><body>Please verify you are human. Just a moment...</body></html>").status).toBe("not_checked");
    expect(ok("<html><body><div id=app></div><script>boot()</script></body></html>")).toEqual({ status: "not_checked", reason: "page_did_not_show_content" });
    expect(ok(`<html>${BIG}</html>`, { contentType: "application/pdf" })).toEqual({ status: "not_checked", reason: "not_a_web_page" });
  });
});

describe("checkPage: one address, no extras", () => {
  it("fetches once, with no cookie, referrer or identifying detail, and reads the result", async () => {
    const f = vi.fn(async () => page("<h1>Jane Smith</h1>"));
    expect(await checkPage(req(), f as any)).toEqual({ status: "found", reason: "on_page" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL1);
    expect(init.redirect).toBe("manual");
    const h = JSON.stringify(init.headers).toLowerCase();
    expect(h).not.toContain("cookie");
    expect(h).not.toContain("referer");
    expect(h).not.toContain("jane");
    expect(init.body).toBeUndefined();
    expect(url).not.toContain("jane@");
  });
  it("a 404 is clear (gone); a 403 (Whitepages-style block) is not_checked", async () => {
    expect(await checkPage(req(), (async () => new Response("nope", { status: 404 })) as any)).toEqual({ status: "clear", reason: "gone" });
    expect(await checkPage(req(), (async () => new Response("Forbidden", { status: 403 })) as any)).toEqual({ status: "not_checked", reason: "blocked" });
  });
  it("follows at most 3 redirects, only to public https addresses", async () => {
    const hops = ["https://b.example/1", "https://c.example/2", "https://d.example/3"];
    let n = 0;
    const chain = vi.fn(async () => (n < 3 ? new Response(null, { status: 301, headers: { location: hops[n++] } }) : page("<p>Jane Smith</p>")));
    expect((await checkPage(req(), chain as any)).status).toBe("found");
    expect(chain).toHaveBeenCalledTimes(4);
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://a.example/again" } }));
    expect(await checkPage(req(), loop as any)).toEqual({ status: "not_checked", reason: "too_many_redirects" });
    expect(loop).toHaveBeenCalledTimes(4);
    for (const to of ["http://b.example/x", "https://127.0.0.1/x", "https://localhost/x"]) {
      expect(await checkPage(req(), (async () => new Response(null, { status: 302, headers: { location: to } })) as any)).toEqual({ status: "not_checked", reason: "redirect_to_unsafe_address" });
    }
    expect(await checkPage(req(), (async () => new Response(null, { status: 302 })) as any)).toEqual({ status: "not_checked", reason: "too_many_redirects" });
  });
  it("a network error is not_checked, a slow site times out, an unsafe address is never fetched", async () => {
    expect(await checkPage(req(), (async () => { throw new TypeError("boom"); }) as any)).toEqual({ status: "not_checked", reason: "could_not_fetch" });
    vi.useFakeTimers();
    const slow = checkPage(req(), ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as any);
    await vi.advanceTimersByTimeAsync(8500);
    expect(await slow).toEqual({ status: "not_checked", reason: "timed_out" });
    vi.useRealTimers();
    const never = vi.fn();
    expect(await checkPage(req("Jane Smith", "people_search", "http://a.example/x"), never as any)).toEqual({ status: "not_checked", reason: "unsafe_address" });
    expect(never).not.toHaveBeenCalled();
  });
  it("stops reading a huge page at the cap; a name inside the part read is still found, otherwise not_checked", async () => {
    const huge = (inner: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`<html>${inner}`)); const chunk = new TextEncoder().encode("x ".repeat(100_000)); for (let i = 0; i < 20; i++) c.enqueue(chunk); c.close(); } }), { status: 200, headers: { "content-type": "text/html" } });
    expect(await checkPage(req(), (async () => huge("<p>Jane Smith</p>")) as any)).toEqual({ status: "found", reason: "on_page" });
    expect(await checkPage(req(), (async () => huge("<p>nobody</p>")) as any)).toEqual({ status: "not_checked", reason: "too_big_to_read_in_full" });
  });
});

describe("replies", () => {
  it("found shows the service's stated route (labelled) only for a host we have read, submits nothing, and says nothing was stored", () => {
    const t = recordsReply(req(), { status: "found", reason: "on_page" }, "www.spokeo.com");
    expect(t).toContain("stated by the service");
    expect(t).toContain("https://www.spokeo.com/optout");
    expect(t).toContain("I submit nothing for you");
    expect(t).toContain("Nothing from this check was stored");
    expect(t).not.toContain("Jane");
    expect(recordsReply(req(), { status: "found", reason: "on_page" }, "people.example")).toContain("do not have a verified removal route");
    expect(recordsReply(req("x", "news_archive"), { status: "found", reason: "on_page" }, "www.spokeo.com")).not.toContain("optout");
    expect(statedRoute("evilspokeo.com")).toBeNull();
    expect(statedRoute("www.spokeo.com")).not.toBeNull();
  });
  it("not_checked says it is NOT a clear result; clear is about one page only", () => {
    expect(recordsReply(req(), { status: "not_checked", reason: "blocked" }, "x.example")).toContain("NOT a clear result");
    const c = recordsReply(req(), { status: "clear", reason: "absent" }, "x.example");
    expect(c).toContain("Clear");
    expect(c).toContain("this one page only");
    expect(recordsReply(req(), { status: "clear", reason: "gone" }, "x.example")).toContain("no longer exists");
  });
});

describe("webhook: /listing and /archive", () => {
  function setup(envOver: Record<string, unknown> = {}, pageResponse: () => Response = () => page("<h1>Jane Smith</h1>"), sender = ID) {
    const calls: { url: string; body: any }[] = [];
    const logs: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith("https://people.example")) return pageResponse();
      return Response.json({ ok: true });
    }));
    const brain = vi.fn(async () => Response.json({ ignored: true }));
    const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, PROBE_TELEGRAM_IDS: String(sender), RECORDS_CHECK: "on", CORE_BRAIN: { fetch: brain }, ...envOver } as unknown as Env;
    const post = (text: string, id = sender) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" },
      body: JSON.stringify({ update_id: 5, message: { message_id: 1, date: 1, text, from: { id, is_bot: false, first_name: "T" }, chat: { id, type: "private" } } }) }), env);
    return { calls, logs, post, brain, sent: () => calls.filter((c) => c.url.includes("/sendMessage")), pageFetches: () => calls.filter((c) => c.url.startsWith("https://people.example")) };
  }
  it("fetches the one address, replies in chat, stores nothing, logs counts only, and core-brain never sees it", async () => {
    const t = setup();
    expect((await t.post(`/listing ${URL1} Jane Smith`)).status).toBe(200);
    expect(t.pageFetches()).toHaveLength(1);
    expect(t.sent()).toHaveLength(1);
    expect(t.sent()[0].body.text).toContain("Found: the page at people.example shows what you typed");
    expect(t.calls.some((c) => c.url.includes("supabase") || c.url.includes("/rest/v1/"))).toBe(false);
    expect(t.brain).not.toHaveBeenCalled();
    const log = t.logs.join("\n");
    for (const secret of ["Jane", "people.example", "profile", TOKEN]) expect(log, secret).not.toContain(secret);
    expect(log).toContain("records_check");
  });
  it("a gone page is clear, a blocked page is not checked", async () => {
    const gone = setup({}, () => new Response("gone", { status: 404 }), 6000000012);
    await gone.post(`/archive ${URL1} Jane Smith`, 6000000012);
    expect(gone.sent()[0].body.text).toContain("no longer exists");
    const blocked = setup({}, () => new Response("Forbidden", { status: 403 }), 6000000013);
    await blocked.post(`/listing ${URL1} Jane Smith`, 6000000013);
    expect(blocked.sent()[0].body.text).toContain("NOT a clear result");
    expect(blocked.sent()[0].body.text).not.toMatch(/Clear:/);
  });
  it("a bad address or term gets usage help and no fetch", async () => {
    const t = setup({}, undefined, 6000000014);
    await t.post(`/listing http://people.example/x Jane Smith`, 6000000014);
    expect(t.sent()[0].body.text).toContain("full https:// address");
    expect(t.pageFetches()).toHaveLength(0);
  });
  it("one check at a time per sender", async () => {
    const t = setup({}, undefined, 6000000015);
    await t.post(`/listing ${URL1} Jane Smith`, 6000000015);
    await t.post(`/listing ${URL1} Jane Smith`, 6000000015);
    expect(t.pageFetches()).toHaveLength(1);
    expect(t.sent()[1].body.text).toContain("One check at a time");
  });
  it("does nothing when the flag is off or the sender is not on the allow-list (and the message goes on to core-brain as before)", async () => {
    for (const [over, id] of [[{ RECORDS_CHECK: "off" }, 6000000016], [{}, 6000000017]] as const) {
      const t = setup({ ...over, ...(id === 6000000017 ? { PROBE_TELEGRAM_IDS: "1" } : {}) }, undefined, id);
      await t.post(`/listing ${URL1} Jane Smith`, id);
      expect(t.pageFetches()).toHaveLength(0);
      expect(t.sent().every((c) => !String(c.body?.text).includes("Records") && !String(c.body?.text).includes("Extra check"))).toBe(true);
    }
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
