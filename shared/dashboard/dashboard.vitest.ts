// @vitest-environment node
// MPC-7893: one-time link, session and the three honest views. Synthetic senders and an in-memory store only; nothing here talks to Supabase.
import { describe, expect, it } from "vitest";
import { handleData, handleLanding, handleRedeem } from "./handlers";
import { sha256Hex, SESSION_COOKIE } from "./crypto";
import type { DashboardStore, DeepJobRow, DeepResultRow, Read, SessionRow, SnapshotRow } from "./store";
import { baselineView, enhancedView, finalView } from "./view";

const ENV = { DASHBOARD_ENABLED: "1", SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_KEY: "svc" };
const TOKEN = "3f6c9f0e-5d0a-4c1e-9b0e-0a1b2c3d4e5f";
const ORIGIN = "https://myprivacytool.io";
const hex = (states: Record<string, string>) => Object.entries(states).map(([id, state]) => ({ id, state }));
const risk = (returned: number) => ({ returned, possible: 30, notChecked: 5, percent: Math.round((returned / 30) * 100), band: "medium", label: "Medium exposure" });
const snap = (over: Partial<SnapshotRow> & { id: string; sender_id: string }): SnapshotRow => ({
  created_at: "2026-10-26T14:00:00Z", status: "complete", scan_version: "telegram-baseline-1", risk_version: "risk-count-1", schema_version: 1, expires_at: "2027-01-01T00:00:00Z",
  report: { risk: risk(2), hexagons: hex({ "tg.username": "returned", "tg.bio": "returned", "tg.birthday": "not_returned", "tg.premium": "not_checked" }), insights: ["synthetic insight"], never_sent: ["last seen"], disabled: {} },
  ...over,
});

/** In-memory store with the same rules as the SQL: a link is consumed once, expires after 15 minutes, and every read is filtered by sender. */
function memoryStore(init: { snaps?: SnapshotRow[]; job?: DeepJobRow | null; results?: DeepResultRow[]; links?: Record<string, { sender: string; snapshot: string; expires: number; used?: boolean }>; fail?: Set<string> } = {}) {
  const snaps = init.snaps ?? [];
  const links = init.links ?? {};
  const sessions = new Map<string, SessionRow & { expires: number }>();
  const fail = init.fail ?? new Set<string>();
  const calls = { redeem: 0, reads: [] as string[] };
  const ok = <T,>(v: T): Read<T> => ({ ok: true, value: v });
  const store: DashboardStore = {
    async redeem(th, sh) {
      calls.redeem += 1;
      if (fail.has("redeem")) return { ok: false };
      const l = links[th];
      if (!l || l.used || l.expires < Date.now() || !snaps.some((s) => s.id === l.snapshot)) return ok(false);
      l.used = true; // synchronous check-and-set: the in-memory equivalent of the single UPDATE ... WHERE redeemed_at IS NULL
      sessions.set(sh, { sender_id: l.sender, snapshot_id: l.snapshot, expires: Date.now() + 30 * 60_000 });
      return ok(true);
    },
    async session(sh) { const s = sessions.get(sh); return ok(s && s.expires > Date.now() ? { sender_id: s.sender_id, snapshot_id: s.snapshot_id } : null); },
    async snapshot(id, sender) { calls.reads.push(`snapshot:${sender}`); return fail.has("snapshot") ? { ok: false } : ok(snaps.find((s) => s.id === id && s.sender_id === sender) ?? null); },
    async laterSnapshot(sender, after) {
      calls.reads.push(`later:${sender}`);
      if (fail.has("later")) return { ok: false };
      return ok(snaps.filter((s) => s.sender_id === sender && s.status === "complete" && s.created_at > after).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null);
    },
    async latestDeepJob(sender) { calls.reads.push(`job:${sender}`); return fail.has("job") ? { ok: false } : ok(init.job ?? null); },
    async deepResults() { return ok(init.results ?? []); },
  };
  return { store, links, calls, sessions };
}

async function seedLink(token = TOKEN, sender = "111", snapshot = "s1", expires = Date.now() + 15 * 60_000) {
  return { [await sha256Hex(token)]: { sender, snapshot, expires } };
}
const post = (token = TOKEN, headers: Record<string, string> = { origin: ORIGIN }) => new Request(`${ORIGIN}/d/${token}`, { method: "POST", headers });
const cookieOf = (res: Response) => /__Host-mpt_dash=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
const dataReq = (cookie?: string) => new Request(`${ORIGIN}/api/dashboard`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

describe("landing page (GET)", () => {
  it("is identical for any token and has no state change, no third-party resources, no cache", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const a = handleLanding(new Request(`${ORIGIN}/d/${TOKEN}`), ENV);
    const b = handleLanding(new Request(`${ORIGIN}/d/not-a-uuid`), ENV);
    expect(a.status).toBe(200);
    expect(await a.text()).toBe(await b.text());
    expect(mem.calls.redeem).toBe(0);
    expect(a.headers.get("cache-control")).toContain("no-store");
    expect(a.headers.get("referrer-policy")).toBe("no-referrer");
    expect(a.headers.get("x-robots-tag")).toContain("noindex");
    const html = await handleLanding(new Request(`${ORIGIN}/d/${TOKEN}`), ENV).text();
    expect(html).not.toMatch(/<script|<link|src=|http/i);
    expect(html).not.toContain(TOKEN);
  });
  it("HEAD (a link preview) does not redeem; only POST does", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    expect(handleLanding(new Request(`${ORIGIN}/d/${TOKEN}`, { method: "HEAD" }), ENV).status).toBe(200);
    expect(mem.calls.redeem).toBe(0);
    expect(handleLanding(new Request(`${ORIGIN}/d/${TOKEN}`, { method: "PUT" }), ENV).status).toBe(405);
  });
  it("answers 503 when the feature is off", () => {
    expect(handleLanding(new Request(`${ORIGIN}/d/${TOKEN}`), {}).status).toBe(503);
  });
});

describe("redeem (POST)", () => {
  it("valid link: 303 to /dashboard with an HttpOnly Secure SameSite=Strict cookie, and no token in the redirect", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const res = await handleRedeem(post(), ENV, TOKEN, { store: mem.store });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dashboard");
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/^__Host-mpt_dash=/);
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/Secure/); expect(sc).toMatch(/SameSite=Strict/); expect(sc).toMatch(/Path=\//); expect(sc).not.toMatch(/Domain=/);
    expect(sc).not.toContain(TOKEN);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it("the second redeem of the same link fails, and so do 20 concurrent ones except exactly one", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const results = await Promise.all(Array.from({ length: 20 }, () => handleRedeem(post(), ENV, TOKEN, { store: mem.store })));
    expect(results.filter((r) => r.status === 303)).toHaveLength(1);
    expect(results.filter((r) => r.status === 410)).toHaveLength(19);
    expect(mem.sessions.size).toBe(1);
    expect((await handleRedeem(post(), ENV, TOKEN, { store: mem.store })).status).toBe(410);
  });
  it("expired, unknown and malformed tokens get the same 410 and no cookie", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink(TOKEN, "111", "s1", Date.now() - 1000) });
    for (const t of [TOKEN, "7b1d2c3e-1111-4222-8333-444455556666", "not-a-uuid", "", "../../etc/passwd", TOKEN + "x"]) {
      const res = await handleRedeem(post(t), ENV, t, { store: mem.store });
      expect(res.status).toBe(410);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(mem.sessions.size).toBe(0);
  });
  it("a link for a deleted or expired scan redeems nothing", async () => {
    const mem = memoryStore({ snaps: [], links: await seedLink() });
    expect((await handleRedeem(post(), ENV, TOKEN, { store: mem.store })).status).toBe(410);
  });
  it("rejects cross-site and header-less POSTs before touching the store", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    expect((await handleRedeem(post(TOKEN, { origin: "https://evil.example" }), ENV, TOKEN, { store: mem.store })).status).toBe(403);
    expect((await handleRedeem(post(TOKEN, {}), ENV, TOKEN, { store: mem.store })).status).toBe(403);
    expect((await handleRedeem(post(TOKEN, { "sec-fetch-site": "same-origin" }), ENV, TOKEN, { store: mem.store })).status).toBe(303);
    expect(mem.calls.redeem).toBe(1);
  });
  it("database failure answers 503 and does not claim the link was used", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink(), fail: new Set(["redeem"]) });
    const res = await handleRedeem(post(), ENV, TOKEN, { store: mem.store });
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("is off unless DASHBOARD_ENABLED=1, and without storage config", async () => {
    expect((await handleRedeem(post(), {}, TOKEN, { store: memoryStore().store })).status).toBe(503);
    expect((await handleRedeem(post(), { DASHBOARD_ENABLED: "1" }, TOKEN)).status).toBe(503);
  });
});

describe("data (GET /api/dashboard)", () => {
  async function session(mem: ReturnType<typeof memoryStore>) {
    const res = await handleRedeem(post(), ENV, TOKEN, { store: mem.store });
    return cookieOf(res);
  }
  it("a session survives refresh and navigation (many reads), unlike the link", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const c = await session(mem);
    for (let i = 0; i < 3; i++) expect((await handleData(dataReq(c), ENV, { store: mem.store })).status).toBe(200);
    expect((await handleRedeem(post(), ENV, TOKEN, { store: mem.store })).status).toBe(410);
  });
  it("no cookie, wrong cookie and expired session are 401; the response is never cacheable and carries no token or key", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const c = await session(mem);
    expect((await handleData(dataReq(), ENV, { store: mem.store })).status).toBe(401);
    expect((await handleData(dataReq("x".repeat(43)), ENV, { store: mem.store })).status).toBe(401);
    for (const s of mem.sessions.values()) s.expires = Date.now() - 1;
    expect((await handleData(dataReq(c), ENV, { store: mem.store })).status).toBe(401);
    const live = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const res = await handleData(dataReq(await session(live)), ENV, { store: live.store });
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = await res.text();
    expect(text).not.toContain(TOKEN); expect(text).not.toContain("svc"); expect(text).not.toContain("get_chat");
  });
  it("wrong-user access: a session only ever reads its own sender's rows", async () => {
    const mem = memoryStore({
      snaps: [snap({ id: "s1", sender_id: "111" }), snap({ id: "s2", sender_id: "222", report: { risk: risk(9), hexagons: hex({ "tg.username": "returned" }), insights: ["OTHER PERSON"], never_sent: [], disabled: {} } })],
      links: await seedLink(), job: null,
    });
    const body = await (await handleData(dataReq(await session(mem)), ENV, { store: mem.store })).text();
    expect(body).not.toContain("OTHER PERSON");
    expect(mem.calls.reads.every((r) => r.endsWith(":111"))).toBe(true);
  });
  it("a deleted or expired scan after login answers 410 scan_gone", async () => {
    const snaps = [snap({ id: "s1", sender_id: "111" })];
    const mem = memoryStore({ snaps, links: await seedLink() });
    const c = await session(mem);
    snaps.length = 0;
    const res = await handleData(dataReq(c), ENV, { store: mem.store });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "scan_gone" });
  });
  it("missing DEEP and missing re-check give honest not_run states, not example data", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const body = await (await handleData(dataReq(await session(mem)), ENV, { store: mem.store })).json();
    expect(body.baseline.state).toBe("available");
    expect(body.enhanced.state).toBe("not_run");
    expect(body.enhanced.note).toMatch(/type DEEP/);
    expect(body.final.state).toBe("not_run");
    expect(body.cta.href).toBe("/scan");
    expect(body.deep_reminder).toMatch(/does not run it/);
    expect(JSON.stringify(body.cta)).not.toMatch(/111|username|bio/);
  });
  it("partial failures: each view degrades on its own", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink(), fail: new Set(["job", "later"]) });
    const body = await (await handleData(dataReq(await session(mem)), ENV, { store: mem.store })).json();
    expect(body.baseline.state).toBe("available");
    expect(body.enhanced.state).toBe("unavailable");
    expect(body.final.state).toBe("unavailable");
  });
  it("snapshot read failure: baseline unavailable, not a missing-scan 410", async () => {
    const mem = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], links: await seedLink() });
    const c = await session(mem);
    const failing = memoryStore({ snaps: [snap({ id: "s1", sender_id: "111" })], fail: new Set(["snapshot"]) });
    failing.sessions.set(await sha256Hex(c), { sender_id: "111", snapshot_id: "s1", expires: Date.now() + 60_000 });
    const res = await handleData(dataReq(c), ENV, { store: failing.store });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseline.state).toBe("unavailable");
    expect(body.final.state).toBe("unavailable");
  });
});

describe("views", () => {
  const base = snap({ id: "s1", sender_id: "111" });
  it("baseline keeps versions and timestamp and never exposes the raw payload", () => {
    const v = baselineView({ ...base, get_chat: { secret: "raw" } } as SnapshotRow) as Record<string, unknown>;
    expect(v).toMatchObject({ state: "available", scan_version: "telegram-baseline-1", risk_version: "risk-count-1", schema_version: 1, taken_at: base.created_at });
    expect(JSON.stringify(v)).not.toContain("raw");
    expect(baselineView(snap({ id: "x", sender_id: "1", status: "failed", report: null })).state).toBe("unavailable");
  });
  it("enhanced distinguishes pending, partial, failed, complete and never states identity", () => {
    const job = (status: string): Read<DeepJobRow | null> => ({ ok: true, value: { id: "j", created_at: "2026-10-26T15:00:00Z", status, detector_version: "deep-1", finished_at: null, expires_at: "2027-01-01T00:00:00Z" } });
    const res: Read<DeepResultRow[]> = { ok: true, value: [{ source: "gh", site_name: "GitHub", status: "found", observed_at: "2026-10-26T15:00:01Z", detector_version: "deep-1", limitation: "A username match is not identity." }] };
    expect(enhancedView(job("running"), res).state).toBe("pending");
    expect(enhancedView(job("partial"), res).state).toBe("partial");
    expect(enhancedView(job("interrupted"), res).state).toBe("failed");
    expect(enhancedView(job("complete"), res).state).toBe("complete");
    const complete = enhancedView(job("complete"), res) as { results: unknown[]; limits: string[] };
    expect(complete.results).toHaveLength(1);
    expect(complete.limits.join(" ")).toMatch(/does not prove the account is yours/);
    expect(enhancedView({ ok: true, value: null }, null).state).toBe("not_run");
    expect(enhancedView({ ok: false }, null).state).toBe("unavailable");
    expect((enhancedView(job("complete"), { ok: false }) as { results_unavailable?: boolean }).results_unavailable).toBe(true);
  });
  it("final: closed only when the bot received it before and does not now; inconclusive stays inconclusive; self-reported is separate", () => {
    const later = snap({ id: "s3", sender_id: "111", created_at: "2026-10-27T10:00:00Z", report: { risk: risk(1), hexagons: hex({ "tg.username": "returned", "tg.bio": "not_returned", "tg.birthday": "returned", "tg.premium": "not_checked" }), insights: [], never_sent: [], disabled: {} } });
    const f = finalView(base, { ok: true, value: later }) as { state: string; summary: Record<string, number>; changes: { id: string; kind: string }[]; self_reported: { recorded: boolean } };
    expect(f.state).toBe("comparable");
    expect(f.summary).toEqual({ no_longer_returned: 1, newly_returned: 1, unchanged: 1, inconclusive: 1 });
    expect(f.changes.find((c) => c.id === "tg.bio")?.kind).toBe("no_longer_returned");
    expect(f.changes.find((c) => c.id === "tg.birthday")?.kind).toBe("newly_returned");
    expect(f.changes.find((c) => c.id === "tg.premium")?.kind).toBe("inconclusive");
    expect(f.self_reported.recorded).toBe(false);
  });
  it("final: a not-checked field is never counted as closed", () => {
    const before = snap({ id: "a", sender_id: "1", report: { risk: risk(1), hexagons: hex({ "tg.bio": "returned" }), insights: [], never_sent: [], disabled: {} } });
    const after = snap({ id: "b", sender_id: "1", created_at: "2026-10-27T10:00:00Z", report: { risk: risk(0), hexagons: hex({ "tg.bio": "check_failed" }), insights: [], never_sent: [], disabled: {} } });
    const f = finalView(before, { ok: true, value: after }) as { summary: Record<string, number> };
    expect(f.summary.no_longer_returned).toBe(0);
    expect(f.summary.inconclusive).toBe(1);
  });
  it("final: different risk/scan/schema versions are incomparable and keep both timestamps", () => {
    const later = snap({ id: "s3", sender_id: "111", created_at: "2026-10-27T10:00:00Z", risk_version: "risk-rank-1" });
    const f = finalView(base, { ok: true, value: later }) as { state: string; reasons: string[]; baseline_at: string; recheck_at: string };
    expect(f.state).toBe("incomparable");
    expect(f.reasons[0]).toMatch(/risk version risk-count-1 vs risk-rank-1/);
    expect([f.baseline_at, f.recheck_at]).toEqual([base.created_at, later.created_at]);
    expect((finalView(base, { ok: true, value: snap({ id: "s4", sender_id: "111", created_at: "2026-10-27T10:00:00Z", schema_version: 2 }) }) as { state: string }).state).toBe("incomparable");
  });
});
