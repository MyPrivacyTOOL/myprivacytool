// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { RISK_VERSION, SCAN_VERSION, hexagonStates } from "./src/baseline-scan";
import { GUIDES, listedGuides } from "./src/fix-guides";
import { COMPARABLE_IDS, issueOutcome, recheckFrom, summarise } from "./src/fix-recheck";
import { parseFixUpdate } from "./src/fix-wizard";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000003; // synthetic, never a real account
const OTHER = 6000000004;
const BASE_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const B8 = "aaaaaaaa";
const fromUser = { id: ID, is_bot: false, first_name: "T", username: "synthetic_user" };
const cmd = (text: string, uid = 1, from: any = fromUser) => ({ update_id: uid, message: { message_id: 7, date: 1700000000, text, from, chat: { id: from.id, type: "private" } } });
const cb = (data: string, uid: number, from: any = fromUser, chatType = "private") => ({ update_id: uid, callback_query: { id: `cbq${uid}`, from, data, message: { message_id: 55, chat: { id: from.id, type: chatType } } } });

const BASE_CHAT = { id: ID, first_name: "T", username: "synthetic_user", bio: "my bio", birthdate: { day: 1, month: 2 }, photo: { small_file_id: "x" } };
const PHOTOS = { total_count: 1, photos: [[{ file_unique_id: "u1", width: 1, height: 1 }]] };
const baselineHexagons = () => hexagonStates({ update_id: 1, message: { from: fromUser, date: 1, text: "Y" } }, BASE_CHAT, PHOTOS.photos);
const baselineRow = (over: Record<string, unknown> = {}) => ({ id: BASE_ID, created_at: "2026-10-26T14:24:10Z", scan_version: SCAN_VERSION, risk_version: RISK_VERSION, report: { channel: "TG", hexagons: baselineHexagons() }, ...over });

interface Opts { baseline?: any | null; items?: any[]; chat?: any; chatStatus?: number; photos?: any; photosStatus?: number; sbFail?: boolean; recentRechecks?: number; dupe?: boolean; editFails?: boolean; consent?: string | null; consentFail?: boolean; rpcFail?: boolean }
function setup(envOver: Record<string, unknown> = {}, o: Opts = {}) {
  const calls: { url: string; method: string; body: any }[] = [];
  const logs: string[] = [];
  const items: any[] = o.items ?? [];
  const stored: any[] = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((m) => { logs.push(String(m)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.includes("api.telegram.org")) {
      if (url.endsWith("/getChat")) return Response.json({ ok: true, result: o.chat ?? { ...BASE_CHAT, bio: undefined } }, { status: o.chatStatus ?? 200 });
      if (url.endsWith("/getUserProfilePhotos")) return Response.json({ ok: true, result: o.photos ?? PHOTOS }, { status: o.photosStatus ?? 200 });
      if (url.endsWith("/editMessageText") && o.editFails) return Response.json({ ok: false }, { status: 400 });
      return Response.json({ ok: true, result: {} });
    }
    if (url.includes("/rest/v1/conversation_states")) return o.consentFail ? new Response("", { status: 500 }) : Response.json(o.consent === null ? [] : [{ state: o.consent ?? "confirmed" }]);
    if (url.includes("/rest/v1/rpc/")) return o.rpcFail ? new Response("", { status: 500 }) : Response.json(1);
    if (o.sbFail) return new Response("", { status: 500 });
    if (url.includes("/rest/v1/profile_snapshots")) {
      if (method === "GET") {
        if (url.includes(`scan_version=eq.${SCAN_VERSION}`)) return Response.json(o.baseline === null ? [] : [o.baseline ?? baselineRow()]);
        return Response.json(Array.from({ length: o.recentRechecks ?? 0 }, (_, i) => ({ id: i })));
      }
      if (o.dupe) return Response.json([]);
      stored.push(body);
      return Response.json([{ id: "rrrrrrrr-0000-0000-0000-000000000000" }], { status: 201 });
    }
    if (url.includes("/rest/v1/fix_wizard_items")) {
      if (method === "GET") return Response.json(items);
      const i = items.findIndex((x) => x.issue_id === body.issue_id);
      if (i >= 0) Object.assign(items[i], body); else items.push({ ...body });
      return new Response("", { status: 201 });
    }
    return new Response("{}", { status: 404 });
  }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc",
    CORE_BRAIN: { fetch: vi.fn(async () => Response.json({ ok: true, ignored: true })) }, TELEGRAM_FIX_WIZARD: "on", PROBE_TELEGRAM_IDS: String(ID), ...envOver } as unknown as Env;
  const post = (u: unknown) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(u) }), env);
  const tg = (m: string) => calls.filter((c) => c.url.endsWith(`/${m}`));
  const shown = () => [...tg("sendMessage"), ...tg("editMessageText")].map((c) => String(c.body.text)).join("\n---\n");
  return { post, calls, logs, items, stored, tg, shown, env };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("gating", () => {
  it("is off by default and for non-allow-listed senders; core-brain handles /fix then", async () => {
    const off = setup({ TELEGRAM_FIX_WIZARD: undefined });
    await off.post(cmd("/fix"));
    expect(off.tg("sendMessage")).toHaveLength(0);
    expect((off.env as any).CORE_BRAIN.fetch).toHaveBeenCalled();
    const other = setup();
    await other.post(cmd("/fix", 2, { ...fromUser, id: OTHER }));
    expect(other.tg("sendMessage")).toHaveLength(0);
    expect(other.calls.filter((c) => c.url.includes("sb.test"))).toHaveLength(0);
  });
  it("ignores /fix and buttons outside a private chat and from bots", () => {
    expect(parseFixUpdate({ update_id: 1, message: { text: "/fix", from: fromUser, chat: { id: -5, type: "group" } } })).toBeNull();
    expect(parseFixUpdate(cb(`fw|${B8}|l`, 2, fromUser, "supergroup"))).toBeNull();
    expect(parseFixUpdate(cb(`fw|${B8}|l`, 3, { ...fromUser, is_bot: true }))).toBeNull();
    expect(parseFixUpdate(cmd("/fix now"))).toBeNull();
    expect(parseFixUpdate(cb("other|x", 4))).toBeNull();
  });
  it("reads only the clicking user's snapshot (query is bound to callback_query.from)", async () => {
    const t = setup();
    await t.post(cb(`fw|${B8}|l`, 5));
    const q = t.calls.find((c) => c.url.includes("profile_snapshots?"))!.url;
    expect(q).toContain(`sender_id=eq.${ID}`);
  });
});

describe("release scope (TELEGRAM_SCAN_SCOPE)", () => {
  const stranger = { ...fromUser, id: OTHER };
  it("is test-accounts-only by default, even with the wizard on", async () => {
    const t = setup();
    await t.post(cmd("/fix", 200, stranger));
    await t.post(cb(`fw|${B8}|l`, 201, stranger));
    expect(t.tg("sendMessage").concat(t.tg("editMessageText"))).toHaveLength(0);
    expect(t.calls.some((c) => c.url.includes("sb.test"))).toBe(false);
  });
  it("ignores any value other than exactly \"all\"", async () => {
    for (const v of ["ALL", "on", "true", "1", ""]) {
      const t = setup({ TELEGRAM_SCAN_SCOPE: v });
      await t.post(cmd("/fix", 202, stranger));
      expect(t.tg("sendMessage")).toHaveLength(0);
    }
  });
  it("opens /fix to a non-allow-listed private sender only when scope is all, and still reads only that sender's snapshot", async () => {
    const t = setup({ TELEGRAM_SCAN_SCOPE: "all" });
    await t.post(cmd("/fix", 203, stranger));
    expect(t.tg("sendMessage")).toHaveLength(1);
    expect(t.calls.find((c) => c.url.includes("profile_snapshots?"))!.url).toContain(`sender_id=eq.${OTHER}`);
    const g = setup({ TELEGRAM_SCAN_SCOPE: "all" });
    await g.post({ update_id: 204, message: { message_id: 1, date: 1, text: "/fix", from: stranger, chat: { id: -100, type: "group" } } });
    expect(g.tg("sendMessage")).toHaveLength(0);
  });
  it("opens the baseline scan sender check the same way", async () => {
    const { baselineSender } = await import("./src/baseline-scan");
    const u = cmd("Y", 205, stranger);
    expect(baselineSender({ PROBE_TELEGRAM_IDS: String(ID) } as unknown as Env, u)).toBeNull();
    expect(baselineSender({ PROBE_TELEGRAM_IDS: String(ID), TELEGRAM_SCAN_SCOPE: "all" } as unknown as Env, u)).toMatchObject({ id: String(OTHER) });
  });
});

describe("journey", () => {
  it("lists issues with an inline keyboard, hides the unverifiable People Nearby, and says the user changes their own settings", async () => {
    const t = setup();
    await t.post(cmd("/fix"));
    const msg = t.tg("sendMessage")[0].body;
    expect(msg.text).toMatch(/You change your own Telegram settings/);
    const labels = msg.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["Username", "Bio", "Birthday", "Profile photo", "Phone number", "Last seen", "Forwarded messages", "Groups", "Auto-download", "Scan again"]));
    expect(labels).not.toContain("People Nearby");
    expect(GUIDES.find((g) => g.code === "nb")!.conflict).toMatch(/Decision needed/);
    for (const b of msg.reply_markup.inline_keyboard.flat()) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
  });
  it("asks the contextual question first and the answer changes the advice", async () => {
    const t = setup();
    await t.post(cb(`fw|${B8}|o|un`, 10));
    expect(t.shown()).toMatch(/Do you need a public @username/);
    await t.post(cb(`fw|${B8}|qa|un`, 11));
    expect(t.shown()).toMatch(/You can keep it/);
    expect(t.items.find((i) => i.issue_id === "un").context_answer).toBe("a");
    const t2 = setup();
    await t2.post(cb(`fw|${B8}|qb|un`, 12));
    expect(t2.shown()).toMatch(/Removing it means/);
    expect(t2.shown()).not.toMatch(/You can keep it/);
  });
  it("shows the draft banner only for guides with no review evidence", async () => {
    const reviewed = listedGuides();
    expect(reviewed).toHaveLength(9);
    for (const g of reviewed) expect(g.evidence).toMatchObject({ client: expect.any(String), platform: expect.any(String), version: expect.any(String), reviewedOn: "27th October 2026" });
    const t = setup();
    await t.post(cb(`fw|${B8}|qa|bi`, 13));
    expect(t.shown()).not.toMatch(/Draft guide/);
    const bi = GUIDES.find((g) => g.code === "bi")!;
    const saved = bi.evidence;
    bi.evidence = null;
    try {
      const u = setup();
      await u.post(cb(`fw|${B8}|qa|bi`, 14));
      expect(u.shown()).toMatch(/Draft guide/);
    } finally { bi.evidence = saved; }
  });
  it("skip and keep are recorded as intentions, never as completion or self-confirmation", async () => {
    const t = setup();
    await t.post(cb(`fw|${B8}|s|un`, 20));
    await t.post(cb(`fw|${B8}|k|bi`, 21));
    expect(t.items.find((i) => i.issue_id === "un")).toMatchObject({ intention: "skip" });
    expect(t.items.find((i) => i.issue_id === "bi")).toMatchObject({ intention: "keep" });
    expect(t.items.every((i) => !i.self_confirmed_at && !i.recheck_outcome)).toBe(true);
    expect(t.calls.some((c) => c.url.endsWith("/getChat"))).toBe(false);
    expect(t.shown()).toMatch(/Username: skipped/);
  });
  it("resumes: /fix shows saved progress", async () => {
    const t = setup({}, { items: [{ issue_id: "ph", intention: "skip" }, { issue_id: "pn", self_confirmed_at: "2026-10-26T15:00:00Z" }] });
    await t.post(cmd("/fix", 30));
    expect(t.shown()).toMatch(/Profile photo: skipped/);
    expect(t.shown()).toMatch(/Phone number: SELF-CONFIRMED \(not checked\)/);
  });
});

describe("Delete my scan data button", () => {
  const rpcs = (t: ReturnType<typeof setup>) => t.calls.filter((c) => c.url.includes("/rpc/")).map((c) => c.url.split("/rpc/")[1]);
  it("is on the list and asks for confirmation first, deleting nothing", async () => {
    const t = setup();
    await t.post(cmd("/fix"));
    const list = JSON.stringify(t.tg("sendMessage")[0].body.reply_markup);
    expect(list).toContain(`fw|${B8}|dd`);
    await t.post(cb(`fw|${B8}|dd`, 60));
    expect(t.shown()).toMatch(/cannot be undone/);
    expect(JSON.stringify(t.tg("editMessageText")[0].body.reply_markup)).toContain(`fw|${B8}|dy`);
    expect(rpcs(t)).toHaveLength(0);
  });
  it("on confirm erases consent, scan data and DEEP data for the tapping user only, then says Done", async () => {
    const t = setup();
    await t.post(cb(`fw|${B8}|dy`, 61));
    expect(rpcs(t)).toEqual(["mpt_erase_chat_sender", "mpt_delete_profile_snapshots", "mpt_delete_deep_data"]);
    expect(t.calls.filter((c) => c.url.includes("/rpc/")).every((c) => Object.values(c.body).some((v) => v === String(ID) || v === "telegram"))).toBe(true);
    expect(t.shown()).toMatch(/Done\. I deleted/);
  });
  it("still deletes when the scan is already gone, and never says Done on a failure", async () => {
    const gone = setup({}, { baseline: null });
    await gone.post(cb("fw|zzzzzzzz|dy", 62));
    expect(rpcs(gone)).toHaveLength(3);
    const bad = setup({}, { rpcFail: true });
    await bad.post(cb(`fw|${B8}|dy`, 63));
    expect(bad.shown()).toMatch(/could not finish deleting/);
    expect(bad.shown()).not.toMatch(/Done\./);
  });
  it("is not offered to or run for a non-allow-listed sender", async () => {
    const t = setup({}, {});
    await t.post(cb(`fw|${B8}|dy`, 64, { id: OTHER, is_bot: false }));
    expect(rpcs(t)).toHaveLength(0);
  });
});

describe("stale, missing and failing state", () => {
  it("rejects a callback built for another snapshot", async () => {
    const t = setup();
    await t.post(cb("fw|deadbeef|o|un", 40));
    expect(t.shown()).toMatch(/out of date/);
    expect(t.items).toHaveLength(0);
  });
  it("says so when there is no scan, and when storage fails", async () => {
    const none = setup({}, { baseline: null });
    await none.post(cmd("/fix"));
    expect(none.shown()).toMatch(/no current scan/);
    const err = setup({}, { sbFail: true });
    await err.post(cmd("/fix"));
    expect(err.shown()).toMatch(/could not load your saved scan/);
    expect(err.calls.some((c) => c.url.endsWith("/getChat"))).toBe(false);
  });
  it("answers the callback and falls back to a new message when the edit fails", async () => {
    const t = setup({}, { editFails: true });
    await t.post(cb(`fw|${B8}|l`, 41));
    expect(t.tg("answerCallbackQuery")).toHaveLength(1);
    expect(t.tg("sendMessage")).toHaveLength(1);
  });
});

describe("re-check: honest outcomes", () => {
  it("VERIFIED only for an API-visible field that was returned and no longer is; baseline row is never written", async () => {
    const t = setup(); // recheck chat has no bio
    await t.post(cb(`fw|${B8}|f|bi`, 50));
    const it = t.items.find((i) => i.issue_id === "bi");
    expect(it.recheck_outcome).toBe("verified_change");
    expect(it.self_confirmed_at).toBeTruthy(); // self-report kept in its own column
    expect(t.shown()).toMatch(/VERIFIED \(observed by the bot\)/);
    expect(t.shown()).toMatch(/does not prove who else/);
    expect(t.stored).toHaveLength(1);
    expect(t.stored[0]).toMatchObject({ scan_version: "telegram-recheck-1", update_id: 50, risk_version: RISK_VERSION });
    expect(t.stored[0].report.baseline_snapshot_id).toBe(BASE_ID);
    expect(t.calls.filter((c) => c.method === "PATCH" || c.method === "DELETE")).toHaveLength(0);
    expect(t.calls.filter((c) => c.method === "POST" && c.url.includes("profile_snapshots")).every((c) => c.body.scan_version === "telegram-recheck-1")).toBe(true);
  });
  it("reports no change when the field is still returned", async () => {
    const t = setup({}, { chat: BASE_CHAT });
    await t.post(cb(`fw|${B8}|f|bi`, 51));
    expect(t.items.find((i) => i.issue_id === "bi").recheck_outcome).toBe("no_change");
    expect(t.shown()).toMatch(/No change observed/);
  });
  it("phone, last seen, forwarded, groups and auto-download stay SELF-CONFIRMED and never call the API", async () => {
    const t = setup();
    for (const [i, c] of ["pn", "ls", "fw", "gp", "ad"].entries()) await t.post(cb(`fw|${B8}|f|${c}`, 60 + i));
    expect(t.items.map((i) => i.issue_id).sort()).toEqual(["ad", "fw", "gp", "ls", "pn"]);
    expect(t.items.every((i) => i.self_confirmed_at && !i.recheck_outcome)).toBe(true);
    expect(t.calls.some((c) => c.url.endsWith("/getChat"))).toBe(false);
    expect(t.stored).toHaveLength(0);
    expect(t.shown()).toMatch(/SELF-CONFIRMED/);
    expect(t.shown()).not.toMatch(/VERIFIED/);
  });
  it("treats a failed getChat as unavailable (no score, no verified)", async () => {
    const t = setup({}, { chatStatus: 500 });
    await t.post(cb(`fw|${B8}|f|bi`, 70));
    expect(t.items.find((i) => i.issue_id === "bi")).toMatchObject({ recheck_outcome: "unavailable" });
    expect(t.shown()).toMatch(/could not re-check/);
  });
  it("treats a failed photos call as partial for photo, not as a removed photo", async () => {
    const t = setup({}, { chat: { ...BASE_CHAT, photo: undefined }, photosStatus: 500 });
    await t.post(cb(`fw|${B8}|f|ph`, 71));
    expect(t.items.find((i) => i.issue_id === "ph").recheck_outcome).toBe("partial");
    expect(t.shown()).not.toMatch(/VERIFIED \(observed/);
  });
  it("treats contradictory photo fields as partial", () => {
    const r = recheckFrom(fromUser, 1, { status: 200, response: { ok: true, result: { ...BASE_CHAT, photo: { x: 1 } } } }, { status: 200, response: { ok: true, result: { total_count: 0, photos: [] } } });
    expect(r.completeness).toBe("partial");
    expect(issueOutcome(baselineRow() as any, r, "tg.photo_current")).toBe("partial");
  });
  it("is incomparable when the baseline used another scan/risk version", async () => {
    const t = setup({}, { baseline: undefined });
    expect(issueOutcome(baselineRow({ risk_version: "risk-rank-1" }) as any, { completeness: "complete", hexagons: [], notes: [] }, "tg.bio")).toBe("incomparable");
    expect(summarise(baselineRow({ scan_version: "telegram-baseline-0" }) as any, { completeness: "complete", hexagons: [], notes: [] })).toBeNull();
    void t;
  });
  it("flags newly returned and not-in-baseline fields neutrally", () => {
    const base = baselineRow({ report: { channel: "TG", hexagons: hexagonStates({ update_id: 1, message: { from: fromUser } }, { id: ID }, []) } }) as any;
    const r = recheckFrom(fromUser, 2, { status: 200, response: { ok: true, result: { ...BASE_CHAT } } }, { status: 200, response: { ok: true, result: PHOTOS } });
    expect(issueOutcome(base, r, "tg.bio")).toBe("new_exposure");
    expect(issueOutcome(base, r, "tg.premium")).toBe("not_in_baseline");
  });
  it("never compares message-derived hexagons", () => {
    const r = recheckFrom(fromUser, 2, { status: 200, response: { ok: true, result: BASE_CHAT } }, { status: 200, response: { ok: true, result: PHOTOS } });
    for (const h of r.hexagons) if (!COMPARABLE_IDS.has(h.id)) expect(h.state).toBe("not_checked");
  });
  it("a replayed update id is processed once, and re-checks are rate limited", async () => {
    const d = setup({}, { dupe: true });
    await d.post(cb(`fw|${B8}|f|bi`, 80));
    expect(d.shown()).toMatch(/already processed/);
    expect(d.items.find((i) => i.issue_id === "bi")?.recheck_outcome).toBeUndefined();
    const r = setup({}, { recentRechecks: 5 });
    await r.post(cb(`fw|${B8}|f|bi`, 81));
    expect(r.calls.some((c) => c.url.endsWith("/getChat"))).toBe(false);
    expect(r.shown()).toMatch(/SELF-CONFIRMED/);
    expect(r.items.find((i) => i.issue_id === "bi").recheck_outcome).toBeUndefined();
  });
});

describe("consent at re-check time", () => {
  for (const [name, o, text] of [["declined", { consent: "declined" }, /not confirmed now/], ["no state row", { consent: null }, /not confirmed now/], ["lookup failure", { consentFail: true }, /could not confirm your consent/]] as const) {
    it(`does not look anything up when consent is ${name}, and keeps the self-report separate`, async () => {
      const t = setup({}, o as any);
      await t.post(cb(`fw|${B8}|f|bi`, 120));
      expect(t.calls.some((c) => c.url.endsWith("/getChat") || c.url.endsWith("/getUserProfilePhotos"))).toBe(false);
      expect(t.stored).toHaveLength(0);
      expect(t.shown()).toMatch(text);
      expect(t.items.find((i) => i.issue_id === "bi")).toMatchObject({ intention: "change" });
      expect(t.items.find((i) => i.issue_id === "bi").recheck_outcome).toBeUndefined();
      const s = setup({}, o as any);
      await s.post(cb(`fw|${B8}|r`, 121));
      expect(s.calls.some((c) => c.url.endsWith("/getChat"))).toBe(false);
      expect(s.shown()).toMatch(/did not re-check/);
    });
  }
  it("self-confirmed-only items never need the consent lookup", async () => {
    const t = setup({}, { consent: "declined" });
    await t.post(cb(`fw|${B8}|f|pn`, 122));
    expect(t.shown()).toMatch(/recorded as SELF-CONFIRMED/);
  });
});

describe("Scan again and sharing", () => {
  it("shows comparable before/after counts separately from self-confirmed, with limits, real links and no purchase", async () => {
    const t = setup({}, { items: [{ issue_id: "pn", self_confirmed_at: "2026-10-26T15:00:00Z" }] });
    await t.post(cb(`fw|${B8}|r`, 90));
    const text = t.shown();
    expect(text).toMatch(/OBSERVED by the bot, same fields both times/);
    expect(text).toMatch(/Before \(26th October 2026\): \d+ of \d+ returned/);
    expect(text).toMatch(/SELF-CONFIRMED by you \(not checked, kept separate\): 1 of 5/);
    expect(text).toMatch(/not proof that you are safer/);
    expect(text).toContain("https://myprivacytool.io/scan?");
    expect(text).toContain("https://myprivacytool.io/pricing?");
    expect(t.calls.filter((c) => !c.url.includes("api.telegram.org") && !c.url.includes("sb.test"))).toHaveLength(0);
    expect(text).not.toMatch(/guarantee|automatic(ally)? remov|broker/i);
  });
  it("share is an optional URL button with generic content only", async () => {
    const t = setup();
    await t.post(cb(`fw|${B8}|r`, 91));
    const kb = t.tg("editMessageText")[0].body.reply_markup.inline_keyboard.flat();
    const share = kb.find((b: any) => b.url);
    expect(share.text).toMatch(/optional/i);
    const url = decodeURIComponent(share.url);
    expect(url.startsWith("https://t.me/share/url")).toBe(true);
    for (const secret of [String(ID), "synthetic_user", BASE_ID, TOKEN, "bio", "token"]) expect(url).not.toContain(secret);
    expect(t.tg("sendMessage").concat(t.tg("forwardMessage")).filter((c) => String(c.body.chat_id) !== String(ID))).toHaveLength(0);
  });
  it("says so honestly when the re-check fails", async () => {
    const t = setup({}, { chatStatus: 500 });
    await t.post(cb(`fw|${B8}|r`, 92));
    expect(t.shown()).toMatch(/could not re-check/);
    expect(t.shown()).not.toMatch(/Before \(/);
  });
});

describe("dates", () => {
  it("shows Hong Kong time in 29th October 2026 format", async () => {
    const { day } = await import("./src/fix-wizard");
    expect(day("2026-10-28T17:00:00Z")).toBe("29th October 2026"); // 01:00 on the 29th in Hong Kong
    expect(day("2026-10-26T14:24:10Z")).toBe("26th October 2026");
    expect(day("2026-11-01T00:00:00Z")).toBe("1st November 2026");
    expect(day("2026-11-12T00:00:00Z")).toBe("12th November 2026");
    expect(day("2026-11-22T00:00:00Z")).toBe("22nd November 2026");
    expect(day("2026-11-23T00:00:00Z")).toBe("23rd November 2026");
  });
});

describe("privacy of logs", () => {
  it("never logs the token, ids, or Telegram data", async () => {
    const t = setup();
    await t.post(cb(`fw|${B8}|f|bi`, 95));
    const all = t.logs.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(String(ID));
    expect(all).not.toContain("my bio");
  });
});
