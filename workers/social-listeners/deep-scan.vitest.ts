// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { DETECTOR_VERSION, SITES, parseDeepCommand, runChecks, summarise } from "./src/deep-scan";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000002; // synthetic, never a real account
const NAME = "synthetic_user";
interface Call { url: string; method: string; body: any }
const msg = (text: string, updateId: number, over: Record<string, unknown> = {}) => ({
  update_id: updateId,
  message: { message_id: 7, date: 1700000000, text, from: { id: ID, is_bot: false, first_name: "T", username: NAME }, chat: { id: ID, type: "private" }, ...over },
});

interface Opts { siteStatus?: Record<string, number>; hang?: string[]; jobs?: any[]; dedupe?: boolean; resultsFail?: boolean; patchEmpty?: boolean; recent?: number }
function setup(envOver: Record<string, unknown> = {}, o: Opts = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const jobs: any[] = o.jobs ?? [];
  vi.spyOn(console, "log").mockImplementation((m) => { logs.push(String(m)); });
  vi.spyOn(console, "warn").mockImplementation((m) => { logs.push(String(m)); });
  vi.spyOn(console, "error").mockImplementation((m) => { logs.push(String(m)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.includes("api.telegram.org")) return Response.json({ ok: true });
    if (url.includes("sb.test/rest/v1/deep_jobs")) {
      if (method === "POST") { if (o.dedupe) return Response.json([]); const row = { id: "11111111-2222-3333-4444-555555555555", created_at: new Date().toISOString(), ...body }; jobs.unshift(row); return Response.json([row], { status: 201 }); }
      if (method === "PATCH") { if (o.patchEmpty) return Response.json([]); const j = jobs[0]; if (j) Object.assign(j, body); return Response.json(j ? [j] : []); }
      if (url.includes("select=id")) return Response.json(Array.from({ length: o.recent ?? 0 }, (_, i) => ({ id: i })));
      return Response.json(jobs.slice(0, 1));
    }
    if (url.includes("sb.test/rest/v1/deep_osint_results")) return o.resultsFail ? new Response("", { status: 500 }) : new Response("", { status: 201 });
    // a checked site
    const host = new URL(url).host;
    const site = SITES.find((s) => s.host === host)!;
    if (o.hang?.includes(site.id)) throw Object.assign(new Error("t"), { name: "TimeoutError" });
    const status = o.siteStatus?.[site.id] ?? 200;
    const json = site.id === "gitlab" ? [{ id: 1 }] : site.id === "keybase" ? { them: [{ id: "x" }] } : site.id === "hackernews" ? { id: NAME } : { login: NAME };
    return new Response(status === 200 ? JSON.stringify(json) : "{}", { status });
  }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: vi.fn(async () => Response.json({ ok: true })) }, TELEGRAM_DEEP_SCAN: "on", PROBE_TELEGRAM_IDS: String(ID), ...envOver } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  const sent = () => calls.filter((c) => c.url.includes("/sendMessage")).map((c) => String(c.body.text));
  const sites = () => calls.filter((c) => !c.url.includes("api.telegram.org") && !c.url.includes("sb.test"));
  return { calls, logs, jobs, post, sent, sites, env, brain: (env as any).CORE_BRAIN.fetch as ReturnType<typeof vi.fn> };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("command parsing: only explicit commands", () => {
  it("accepts the four exact commands", () => {
    expect([parseDeepCommand("DEEP"), parseDeepCommand(" deep  yes "), parseDeepCommand("Deep Cancel"), parseDeepCommand("deep status")]).toEqual(["start", "yes", "cancel", "status"]);
  });
  it("ignores HELP, links, sentences and other text", () => {
    for (const t of ["HELP", "/start deep", "https://myprivacytool.io/deep", "deep please", "do a DEEP scan of @someone", "deep yes @other", "", undefined, 5]) expect(parseDeepCommand(t)).toBeNull();
  });
});

describe("gating", () => {
  it("HELP and link text produce no scan, no job, no site request, and still reach core-brain", async () => {
    for (const t of ["HELP", "/start deep_abc", "https://myprivacytool.io/scan?deep=1"]) {
      const s = setup();
      await s.post(msg(t, 1));
      expect(s.sites()).toHaveLength(0);
      expect(s.calls.filter((c) => c.url.includes("deep_jobs"))).toHaveLength(0);
      expect(s.brain).toHaveBeenCalledTimes(1);
    }
  });
  it("is off by default and for non-allow-listed senders (flows continue to core-brain unchanged)", async () => {
    for (const over of [{ TELEGRAM_DEEP_SCAN: undefined }, { PROBE_TELEGRAM_IDS: "999" }, { PROBE_TELEGRAM_IDS: undefined }]) {
      const s = setup(over);
      await s.post(msg("DEEP", 1));
      expect(s.calls.filter((c) => c.url.includes("deep_jobs"))).toHaveLength(0);
      expect(s.brain).toHaveBeenCalledTimes(1);
    }
  });
  it("groups and bots are ignored", async () => {
    const g = setup(); await g.post(msg("DEEP", 1, { chat: { id: -5, type: "group" } })); expect(g.calls.filter((c) => c.url.includes("deep_jobs"))).toHaveLength(0);
    const b = setup(); await b.post(msg("DEEP", 1, { from: { id: ID, is_bot: true, username: NAME } })); expect(b.calls.filter((c) => c.url.includes("deep_jobs"))).toHaveLength(0);
  });
});

describe("consent flow", () => {
  it("DEEP only asks for consent: explains checks/data/destinations and sends nothing to any site", async () => {
    const s = setup();
    await s.post(msg("DEEP", 1));
    expect(s.sites()).toHaveLength(0);
    expect(s.jobs[0]).toMatchObject({ status: "awaiting_consent", query_username: NAME, idempotency_key: `telegram:${ID}:1`, sender_id: String(ID) });
    const text = s.sent()[0];
    for (const site of SITES) expect(text).toContain(site.name);
    expect(text).toMatch(/only your username/);
    expect(text).toMatch(/does not prove/);
    expect(s.brain).not.toHaveBeenCalled();
  });
  it("DEEP YES runs the sender's own username only, stores results with provenance, and reports honestly", async () => {
    const s = setup();
    await s.post(msg("DEEP", 1));
    await s.post(msg("DEEP YES", 2));
    expect(s.sites()).toHaveLength(SITES.length);
    for (const c of s.sites()) { expect(c.url.startsWith("https://")).toBe(true); expect(c.url).toContain(NAME); }
    const rows = s.calls.find((c) => c.url.includes("deep_osint_results"))!.body;
    expect(rows).toHaveLength(SITES.length);
    expect(rows[0]).toMatchObject({ detector_version: DETECTOR_VERSION, status: "found", schema_version: 1 });
    expect(rows[0].observed_at).toBeTruthy();
    expect(rows[0].limitation).toMatch(/not proof/);
    expect(s.jobs[0].consent).toMatchObject({ text_version: "deep-consent-1", confirming_update_id: 2, photo_sent: false });
    expect(s.jobs[0].status).toBe("complete");
    expect(s.sent().at(-1)).toMatch(/not proof it is you/);
    expect(s.sent().at(-1)).toMatch(/Reverse-image check: not available/);
  });
  it("DEEP YES without a pending request, or after the window, runs nothing", async () => {
    const none = setup(); await none.post(msg("DEEP YES", 2)); expect(none.sites()).toHaveLength(0); expect(none.sent()[0]).toMatch(/No pending/);
    const old = setup({}, { jobs: [{ id: "a", status: "awaiting_consent", created_at: new Date(Date.now() - 16 * 60_000).toISOString(), query_username: NAME }] });
    await old.post(msg("DEEP YES", 2)); expect(old.sites()).toHaveLength(0); expect(old.jobs[0].status).toBe("expired");
  });
  it("a duplicate YES (job already claimed) and a replayed DEEP update do nothing twice", async () => {
    const s = setup({}, { patchEmpty: true, jobs: [{ id: "a", status: "awaiting_consent", created_at: new Date().toISOString(), query_username: NAME }] });
    await s.post(msg("DEEP YES", 2)); expect(s.sites()).toHaveLength(0); expect(s.sent()).toHaveLength(0);
    const d = setup({}, { dedupe: true }); await d.post(msg("DEEP", 1)); expect(d.sent()).toHaveLength(0);
  });
  it("an account without a username is not scanned; arbitrary targets in text are never used", async () => {
    const s = setup(); await s.post(msg("DEEP", 1, { from: { id: ID, is_bot: false, first_name: "T" } }));
    expect(s.jobs).toHaveLength(0); expect(s.sent()[0]).toMatch(/has none/);
    const t = setup(); await t.post(msg("DEEP YES @victim_account", 2)); expect(t.sites()).toHaveLength(0);
  });
  it("daily job limit stops a new job", async () => {
    const s = setup({ DEEP_JOBS_PER_DAY: "2" }, { recent: 2 });
    await s.post(msg("DEEP", 1)); expect(s.jobs).toHaveLength(0); expect(s.sent()[0]).toMatch(/limit/);
  });
  it("DEEP CANCEL cancels a pending or running job; a job cancelled mid-run sends no completion message", async () => {
    const s = setup({}, { jobs: [{ id: "a", status: "awaiting_consent", created_at: new Date().toISOString(), query_username: NAME }] });
    await s.post(msg("DEEP CANCEL", 3)); expect(s.jobs[0].status).toBe("cancelled");
    const r = setup({}, { jobs: [] }); await r.post(msg("DEEP", 1));
    let patches = 0; const f = globalThis.fetch as any; const orig = f.getMockImplementation();
    f.mockImplementation(async (i: any, init: any) => (String(i).includes("deep_jobs") && init?.method === "PATCH" && ++patches === 2 ? Response.json([]) : orig(i, init)));
    await r.post(msg("DEEP YES", 2)); expect(r.sent().some((t) => /finished|ended early/.test(t))).toBe(false);
  });
});

describe("check engine", () => {
  it("separates found, not_found, blocked, unavailable and timeout/error; never calls blocked or timeout 'no exposure'", async () => {
    setup({}, { siteStatus: { github: 404, codeberg: 429, lichess: 500 }, hang: ["devto"] });
    const r = await runChecks(NAME);
    const st = (id: string) => r.find((x) => x.source === id)!.status;
    expect([st("github"), st("codeberg"), st("lichess"), st("devto"), st("chesscom")]).toEqual(["not_found", "blocked", "unavailable", "unavailable", "found"]);
    expect(r.find((x) => x.source === "devto")!.evidence).toMatchObject({ reason: "timeout" });
    const text = summarise("abcdefgh-1", NAME, r, false);
    expect(text).toMatch(/NOT an all-clear/);
    expect(text).toMatch(/ended early/);
  });
  it("refuses redirects and never follows them (SSRF containment)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: any, init: any) => { calls.push(String(input)); expect(init.redirect).toBe("manual"); return new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }); }));
    const r = await runChecks(NAME);
    expect(r.every((x) => x.status === "unavailable" && x.http_status === 302)).toBe(true);
    expect(calls.every((u) => u.startsWith("https://") && !u.includes("169.254"))).toBe(true);
  });
  it("only fixed hosts are contacted and a hostile username cannot change the host or path", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: any) => { urls.push(String(input)); return new Response("{}", { status: 404 }); }));
    await runChecks("a/../@evil.com?x=1#");
    const hosts = new Set(SITES.map((s) => s.host));
    expect(urls.every((u) => hosts.has(new URL(u).host))).toBe(true);
    expect(urls.every((u) => !u.includes("evil.com/") && !u.includes("@evil"))).toBe(true);
  });
});

describe("failure handling and data protection", () => {
  it("storage failure: result is not reported as a conclusion and the job is failed", async () => {
    const s = setup({}, { resultsFail: true });
    await s.post(msg("DEEP", 1)); await s.post(msg("DEEP YES", 2));
    expect(s.jobs[0].status).toBe("failed");
    expect(s.sent().at(-1)).toMatch(/could not store/);
  });
  it("partial provider failure marks the job partial, not complete", async () => {
    const s = setup({}, { siteStatus: { github: 500 } });
    await s.post(msg("DEEP", 1)); await s.post(msg("DEEP YES", 2));
    expect(s.jobs[0].status).toBe("partial");
  });
  it("a stale running job is reported as interrupted, not as a result", async () => {
    const s = setup({}, { jobs: [{ id: "a", status: "running", created_at: new Date(Date.now() - 600_000).toISOString(), heartbeat_at: new Date(Date.now() - 600_000).toISOString(), query_username: NAME }] });
    await s.post(msg("DEEP STATUS", 5));
    expect(s.jobs[0].status).toBe("interrupted"); expect(s.sent()[0]).toMatch(/interrupted/);
  });
  it("storage down at start gives an honest 'not available' and never fails the webhook; logs hold no token or username", async () => {
    const s = setup({ SUPABASE_URL: undefined });
    expect((await s.post(msg("DEEP", 1))).status).toBe(200);
    const t = setup(); await t.post(msg("DEEP", 1)); await t.post(msg("DEEP YES", 2));
    expect(t.logs.join("\n")).not.toMatch(new RegExp(`SECRET|${NAME}`));
  });
});
