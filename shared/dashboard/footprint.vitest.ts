// @vitest-environment node
// MPC-8689: the Telegram to Web footprint handoff. One-time /f/<uuid> link, its own cookie and scope, and a data endpoint that returns hexagon ids only.
// Synthetic senders and an in-memory store; nothing here talks to Supabase.
import { describe, expect, it } from "vitest";
import { handleData, handleFootprintData, handleFootprintLanding, handleFootprintRedeem, handleRedeem } from "./handlers";
import { FOOTPRINT_COOKIE, SESSION_COOKIE, sha256Hex } from "./crypto";
import { supabaseStore } from "./store";
import type { DashboardStore, Read, SessionRow, SnapshotRow } from "./store";

const ENV = { DASHBOARD_ENABLED: "1", FOOTPRINT_HANDOFF: "1", SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_KEY: "svc" };
const TOKEN = "3f6c9f0e-5d0a-4c1e-9b0e-0a1b2c3d4e5f";
const ORIGIN = "https://myprivacytool.io";
const hexes = [
  { id: "tg.username", state: "returned" }, { id: "tg.bio", state: "not_returned" }, { id: "tg.premium", state: "not_checked" },
  { id: "tg.phone_shared", state: "not_checked" }, { id: "location", state: "returned" }, { id: "tg.not_in_catalogue", state: "returned" },
];
const snap = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  id: "s1", sender_id: "111", created_at: "2026-10-28T10:00:00Z", status: "complete", scan_version: "telegram-baseline-1", risk_version: "risk-count-1", schema_version: 1,
  expires_at: "2027-01-01T00:00:00Z", report: { hexagons: hexes, risk: {}, insights: ["a private value must never leave"] }, get_chat: { bio: "secret bio" }, ...over,
});

type Scope = "dashboard" | "footprint";
function memoryStore(links: Record<string, { sender: string; snapshot: string; scope: Scope; used?: boolean }>, snaps: SnapshotRow[] = [snap()], flags?: Read<string[]>) {
  const sessions = new Map<string, SessionRow & { scope: Scope }>();
  const ok = <T,>(v: T): Read<T> => ({ ok: true, value: v });
  const store: DashboardStore = {
    async redeem(th, sh, scope = "dashboard") {
      const l = links[th];
      if (!l || l.used || l.scope !== scope) return ok(false); // a link only redeems under its own scope, as in SQL
      l.used = true;
      sessions.set(sh, { sender_id: l.sender, snapshot_id: l.snapshot, scope });
      return ok(true);
    },
    async session(sh, scope = "dashboard") {
      const s = sessions.get(sh);
      if (!s || (scope === "footprint" && s.scope !== "footprint")) return ok(null);
      return ok(s);
    },
    async snapshot(id, sender) { return ok(snaps.find((x) => x.id === id && x.sender_id === sender) ?? null); },
    async laterSnapshot() { return ok(null); },
    async latestDeepJob() { return ok(null); },
    async deepResults() { return ok([]); },
    ...(flags ? { async eventFlags() { return flags; } } : {}),
  };
  return { store, sessions };
}
const link = async (scope: Scope, sender = "111") => ({ [await sha256Hex(TOKEN)]: { sender, snapshot: "s1", scope } });
const post = (path = "f") => new Request(`${ORIGIN}/${path}/${TOKEN}`, { method: "POST", headers: { origin: ORIGIN } });
const cookieOf = (res: Response, name: string) => new RegExp(`${name}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
const footprintReq = (cookie?: string) => new Request(`${ORIGIN}/api/footprint`, { headers: cookie ? { cookie: `${FOOTPRINT_COOKIE}=${cookie}` } : {} });

describe("landing and redeem", () => {
  it("GET shows its own page, redeems nothing, and is off unless FOOTPRINT_HANDOFF=1", async () => {
    const res = handleFootprintLanding(new Request(`${ORIGIN}/f/${TOKEN}`), ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("not your values");
    expect(html).not.toContain(TOKEN);
    expect(handleFootprintLanding(new Request(`${ORIGIN}/f/${TOKEN}`), { ...ENV, FOOTPRINT_HANDOFF: "0" }).status).toBe(503);
    expect(handleFootprintLanding(new Request(`${ORIGIN}/f/${TOKEN}`, { method: "POST" }), ENV).status).toBe(405);
  });
  it("POST redeems a footprint link: 303 to /scan?handoff=1 with the footprint cookie only, and no token in the redirect", async () => {
    const mem = memoryStore(await link("footprint"));
    const res = await handleFootprintRedeem(post(), ENV, TOKEN, { store: mem.store });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/scan?handoff=1");
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/^__Host-mpt_fp=/);
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/Secure/); expect(sc).toMatch(/SameSite=Strict/);
    expect(sc).not.toContain(TOKEN);
    expect(sc).not.toContain(SESSION_COOKIE);
  });
  it("is single use, and refused when the switch is off or the origin is foreign", async () => {
    const mem = memoryStore(await link("footprint"));
    expect((await handleFootprintRedeem(post(), ENV, TOKEN, { store: mem.store })).status).toBe(303);
    expect((await handleFootprintRedeem(post(), ENV, TOKEN, { store: mem.store })).status).toBe(410);
    const off = memoryStore(await link("footprint"));
    expect((await handleFootprintRedeem(post(), { ...ENV, FOOTPRINT_HANDOFF: undefined }, TOKEN, { store: off.store })).status).toBe(503);
    const foreign = new Request(`${ORIGIN}/f/${TOKEN}`, { method: "POST", headers: { origin: "https://evil.test" } });
    expect((await handleFootprintRedeem(foreign, ENV, TOKEN, { store: off.store })).status).toBe(403);
  });
  it("a link only redeems under its own scope: a dashboard link at /f/ and a footprint link at /d/ both fail", async () => {
    const dash = memoryStore(await link("dashboard"));
    expect((await handleFootprintRedeem(post(), ENV, TOKEN, { store: dash.store })).status).toBe(410);
    const fp = memoryStore(await link("footprint"));
    expect((await handleRedeem(post("d"), ENV, TOKEN, { store: fp.store })).status).toBe(410);
  });
});

describe("GET /api/footprint", () => {
  async function session() {
    const mem = memoryStore(await link("footprint"));
    const res = await handleFootprintRedeem(post(), ENV, TOKEN, { store: mem.store });
    return { mem, cookie: cookieOf(res, FOOTPRINT_COOKIE) };
  }
  it("returns ids only: checked Telegram hexagons, never a value, a not-checked one, a web one or an unknown one", async () => {
    const { mem, cookie } = await session();
    const res = await handleFootprintData(footprintReq(cookie), ENV, { store: mem.store });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ channels: [{ channel: "telegram", checked_ids: ["tg.username", "tg.bio"], scan_at: "2026-10-28T10:00:00Z", scan_version: "telegram-baseline-1" }] });
    expect(text).not.toContain("secret bio");
    expect(text).not.toContain("private value");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("adds the event-driven extras that really happened (edits, blocked or unblocked); a failed read or an unknown flag adds nothing", async () => {
    const ids = async (flags?: Read<string[]>) => {
      const mem = memoryStore(await link("footprint"), [snap()], flags);
      const c = cookieOf(await handleFootprintRedeem(post(), ENV, TOKEN, { store: mem.store }), FOOTPRINT_COOKIE);
      return (await (await handleFootprintData(footprintReq(c), ENV, { store: mem.store })).json()).channels[0].checked_ids;
    };
    expect(await ids({ ok: true, value: ["tg.edits", "tg.blocked_bot", "tg.message_text", "location"] })).toEqual(["tg.username", "tg.bio", "tg.edits", "tg.blocked_bot"]);
    expect(await ids({ ok: false })).toEqual(["tg.username", "tg.bio"]);
    expect(await ids({ ok: true, value: [] })).toEqual(["tg.username", "tg.bio"]);
    expect(await ids()).toEqual(["tg.username", "tg.bio"]);
  });
  it("no cookie, a wrong cookie, or a dashboard cookie is 401; 503 when off; the scan being deleted is 410", async () => {
    const { mem, cookie } = await session();
    expect((await handleFootprintData(footprintReq(), ENV, { store: mem.store })).status).toBe(401);
    expect((await handleFootprintData(footprintReq("x".repeat(43)), ENV, { store: mem.store })).status).toBe(401);
    const asDashboard = new Request(`${ORIGIN}/api/footprint`, { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect((await handleFootprintData(asDashboard, ENV, { store: mem.store })).status).toBe(401);
    expect((await handleFootprintData(footprintReq(cookie), { ...ENV, FOOTPRINT_HANDOFF: "0" }, { store: mem.store })).status).toBe(503);
    expect((await handleFootprintData(new Request(`${ORIGIN}/api/footprint`, { method: "POST" }), ENV, { store: mem.store })).status).toBe(405);
    const gone = memoryStore(await link("footprint"), []);
    const c2 = cookieOf(await handleFootprintRedeem(post(), ENV, TOKEN, { store: gone.store }), FOOTPRINT_COOKIE);
    expect((await handleFootprintData(footprintReq(c2), ENV, { store: gone.store })).status).toBe(410);
  });
  it("a footprint session cannot read /api/dashboard (403), even if its value is presented as a dashboard cookie", async () => {
    const { mem, cookie } = await session();
    const res = await handleData(new Request(`${ORIGIN}/api/dashboard`, { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }), ENV, { store: mem.store });
    expect(res.status).toBe(403);
  });
  it("a session never reads another sender's scan", async () => {
    const other = memoryStore(await link("footprint", "222"), [snap({ sender_id: "111" })]);
    const c = cookieOf(await handleFootprintRedeem(post(), ENV, TOKEN, { store: other.store }), FOOTPRINT_COOKIE);
    expect((await handleFootprintData(footprintReq(c), ENV, { store: other.store })).status).toBe(410);
  });
});

describe("GET /api/footprint with the pilot extras", () => {
  it("counts a built extra as checked, but never an unbuilt candidate or a not-checked extra", async () => {
    const report = { hexagons: hexes, extras: [{ id: "tg.via_bot", state: "returned" }, { id: "tg.forward_origin", state: "not_returned" }, { id: "tg.story_reply", state: "not_checked" }, { id: "tg.miniapp_photo", state: "returned" }], insights: [] };
    const mem = memoryStore(await link("footprint"), [snap({ report })]);
    const cookie = cookieOf(await handleFootprintRedeem(post(), ENV, TOKEN, { store: mem.store }), FOOTPRINT_COOKIE);
    const body = await (await handleFootprintData(footprintReq(cookie), ENV, { store: mem.store })).json();
    expect(body.channels[0].checked_ids).toEqual(["tg.username", "tg.bio", "tg.via_bot", "tg.forward_origin"]);
  });
});

describe("Supabase store", () => {
  it("passes p_scope only for a footprint link, so dashboard calls are unchanged before the migration", async () => {
    const bodies: string[] = [];
    const urls: string[] = [];
    const fake = (async (url: string, init?: { body?: string }) => { urls.push(String(url)); if (init?.body) bodies.push(init.body); return new Response("true"); }) as unknown as typeof fetch;
    const store = supabaseStore({ SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_KEY: "k" }, fake)!;
    await store.redeem("a".repeat(64), "b".repeat(64));
    await store.redeem("a".repeat(64), "b".repeat(64), "footprint");
    expect(JSON.parse(bodies[0])).not.toHaveProperty("p_scope");
    expect(JSON.parse(bodies[1]).p_scope).toBe("footprint");
    await store.session("c".repeat(64), "footprint");
    await store.session("c".repeat(64));
    expect(urls[2]).toContain("scope=eq.footprint");
    expect(urls[3]).toContain("select=*");
    expect(urls[3]).not.toContain("scope=eq");
  });
});
