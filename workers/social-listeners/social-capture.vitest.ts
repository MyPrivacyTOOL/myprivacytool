// @vitest-environment node
// CK-8502: signed synthetic X events -> persisted attributed record, with duplicates, reordering, replays, unsupported events, erase and the
// anti-loop / no-public-reply rules. No network: global fetch is an in-memory stand-in for Supabase (mpt_social_record semantics) and HubSpot.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { EVENT_MAX_AGE_MS, extractEngagement, stageOf } from "./src/social";

const SELF = "9000";
const sign = (body: string) => "sha256=" + createHmac("sha256", "xs").update(body).digest("base64");
const NOW = Date.now();

interface Row { key: string | null; type: string; at: number | null; ref: string | null }
function backend(opts: { noRecord?: boolean } = {}) {
  const contacts = new Map<string, { handle?: string; follows?: boolean; count: number; last: number; events: Row[] }>();
  const hubspot = new Map<string, Record<string, string>>();
  const calls: { url: string; body: string }[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = String(init?.body ?? "");
    calls.push({ url, body });
    if (url.includes("/rest/v1/rpc/mpt_social_record") || url.includes("/rest/v1/rpc/mpt_social_touch")) {
      const record = url.endsWith("mpt_social_record");
      if (record && opts.noRecord) return new Response("{}", { status: 404 });   // PostgREST: unknown function
      const a = JSON.parse(body);
      const c = contacts.get(a.p_user_id) ?? { count: 0, last: 0, events: [] };
      const key: string | null = record ? a.p_event_key ?? null : null;
      if (key && c.events.some((e) => e.key === key)) return Response.json({ duplicate: true });
      const at = record && a.p_occurred_at ? Date.parse(a.p_occurred_at) : Date.now();
      c.events.push({ key, type: a.p_event, at: record && a.p_occurred_at ? at : null, ref: record ? a.p_source_ref ?? null : null });
      c.count++; c.last = Math.max(c.last, at); c.handle = a.p_handle ?? c.handle; c.follows = a.p_follows_us ?? c.follows;
      contacts.set(a.p_user_id, c);
      return Response.json({ duplicate: false });
    }
    if (url.includes("/rest/v1/rpc/mpt_erase_social_contact")) { const a = JSON.parse(body); return Response.json(contacts.delete(a.p_user_id) ? 1 : 0); }
    if (url.includes("/rest/v1/social_contacts")) return new Response(null, { status: 204 });
    if (url.includes("api.hubapi.com/crm/v3/properties")) return new Response("{}", { status: 409 });
    if (url.includes("api.hubapi.com/crm/v3/objects/contacts/search")) {
      const id = JSON.parse(body).filterGroups[0].filters[0].value;
      return Response.json({ results: hubspot.has(id) ? [{ id: `hs-${id}` }] : [] });
    }
    if (url.includes("api.hubapi.com/crm/v3/objects/contacts") && init?.method === "POST") { const p = JSON.parse(body).properties; hubspot.set(p.x_user_id, p); return Response.json({ id: `hs-${p.x_user_id}` }, { status: 201 }); }
    if (url.includes("api.hubapi.com/crm/v3/objects/contacts/") && init?.method === "PATCH") { const id = url.split("/").pop()!.replace("hs-", ""); Object.assign(hubspot.get(id)!, JSON.parse(body).properties); return Response.json({}); }
    if (url.includes("api.hubapi.com/crm/v3/objects/contacts/") && init?.method === "DELETE") { hubspot.delete(url.split("/").pop()!.replace("hs-", "")); return new Response(null, { status: 204 }); }
    if (url.includes("api.x.com") || url.includes("api.twitter.com")) return Response.json({ data: {} });
    return new Response("{}", { status: 200 });
  });
  return { contacts, hubspot, calls, fetchStub };
}

const env = () => ({
  X_CONSUMER_SECRET: "xs", SUPABASE_URL: "https://db.test", SUPABASE_KEY: "k", HUBSPOT_SOCIAL_TOKEN: "hs",
  X_USER_ACCESS_TOKEN: "ut", X_BEARER_TOKEN: "bt", CORE_BRAIN: { fetch: vi.fn(async () => new Response("ok")) },
});
const post = (payload: object, e: object, over: Partial<{ body: string; sig: string | null }> = {}) => {
  const body = over.body ?? JSON.stringify(payload);
  const headers: Record<string, string> = {};
  if (over.sig !== null) headers["X-Twitter-Webhooks-Signature"] = over.sig ?? sign(body);
  return worker.fetch(new Request("https://w/webhook/x", { method: "POST", body, headers }), e as never);
};

const follow = (who: string, at = NOW) => ({ type: "follow", created_timestamp: String(at), target: { id: SELF }, source: { id: who, screen_name: `u${who}` } });
const mention = (who: string, tid: string, at = NOW) => ({ id_str: tid, timestamp_ms: String(at), text: "SECRET-MESSAGE-TEXT @MyPrivacyTOOL", user: { id: who, screen_name: `u${who}` }, entities: { user_mentions: [{ id: SELF }] }, in_reply_to_status_id_str: "5555" });
const like = (who: string, id: string, at = NOW) => ({ id, timestamp_ms: String(at), favorited_status: { id_str: "5555" }, user: { id: who, screen_name: `u${who}` } });

let be: ReturnType<typeof backend>;
beforeEach(() => { be = backend(); vi.stubGlobal("fetch", be.fetchStub); });
afterEach(() => vi.unstubAllGlobals());

describe("CK-8502 signed synthetic inbound X events", () => {
  it("persists a signed follow with platform id, timestamp and creates one CRM contact", async () => {
    const r = await post({ for_user_id: SELF, follow_events: [follow("111")] }, env());
    expect(r.status).toBe(200);
    const c = be.contacts.get("111")!;
    expect(c.count).toBe(1); expect(c.follows).toBe(true); expect(c.events[0]).toMatchObject({ type: "follow", key: `follow:111:${NOW}`, at: NOW });
    expect(be.hubspot.get("111")).toMatchObject({ x_user_id: "111", x_last_event: "follow", x_follows_us: "true", x_handle: "u111" });
  });

  it("a redelivered event (X retry, same body) changes nothing: one row, count 1, no second CRM write", async () => {
    const payload = { for_user_id: SELF, follow_events: [follow("112")], tweet_create_events: [mention("112", "t1")] };
    await post(payload, env());
    const crmWrites = () => be.calls.filter((c) => c.url.includes("hubapi.com/crm/v3/objects/contacts") && !c.url.includes("search")).length;
    const before = crmWrites();
    await post(payload, env());
    expect(be.contacts.get("112")!.count).toBe(2);   // follow + mention, each once
    expect(be.contacts.get("112")!.events.map((e) => e.type).sort()).toEqual(["follow", "mention"]);
    expect(crmWrites()).toBe(before);
  });

  it("correlates a mention and a like to the public post by id, and never stores the text", async () => {
    await post({ for_user_id: SELF, tweet_create_events: [mention("113", "t2")], favorite_events: [like("113", "fav-1")] }, env());
    const c = be.contacts.get("113")!;
    expect(c.events.find((e) => e.type === "mention")!.ref).toBe("5555");
    expect(c.events.find((e) => e.type === "like")!.ref).toBe("5555");
    expect(be.calls.every((x) => !x.body.includes("SECRET-MESSAGE-TEXT"))).toBe(true);
  });

  it("reordered delivery: an older event arriving later is counted but does not move last-seen back", async () => {
    await post({ for_user_id: SELF, tweet_create_events: [mention("114", "t9", NOW)] }, env());
    await post({ for_user_id: SELF, favorite_events: [like("114", "fav-old", NOW - 3600_000)] }, env());
    const c = be.contacts.get("114")!;
    expect(c.count).toBe(2); expect(c.last).toBe(NOW);
  });

  it("replay window: an event older than 72 h is ignored (no row, no CRM write)", async () => {
    await post({ for_user_id: SELF, follow_events: [follow("115", NOW - EVENT_MAX_AGE_MS - 60_000)] }, env());
    expect(be.contacts.has("115")).toBe(false); expect(be.hubspot.has("115")).toBe(false);
  });

  it("unsupported events create nothing: own actions, other targets, unknown event families", async () => {
    await post({ for_user_id: SELF, follow_events: [follow(SELF), { ...follow("116"), target: { id: "42" } }], tweet_delete_events: [{ status: { id: "1" } }], direct_message_indicate_typing_events: [{ sender_id: "117" }], user_event: [{ revoke: {} }] }, env());
    expect(be.contacts.size).toBe(0); expect(be.hubspot.size).toBe(0);
  });

  it("an unsigned, wrongly signed, replayed-with-edited-body or oversized delivery is refused and persists nothing", async () => {
    const payload = { for_user_id: SELF, follow_events: [follow("118")] };
    expect((await post(payload, env(), { sig: null })).status).toBe(401);
    expect((await post(payload, env(), { sig: sign("other body") })).status).toBe(401);
    expect((await post(payload, env(), { body: JSON.stringify(payload) + " ", sig: sign(JSON.stringify(payload)) })).status).toBe(401);
    expect((await post(payload, env(), { body: JSON.stringify({ pad: "x".repeat(1_100_000) }) })).status).toBe(413);
    expect((await post(payload, { ...env(), X_CONSUMER_SECRET: undefined })).status).toBe(401);
    expect(be.contacts.size).toBe(0);
  });

  it("migration not applied (404): falls back to the old function, so capture keeps working", async () => {
    be = backend({ noRecord: true }); vi.stubGlobal("fetch", be.fetchStub);
    await post({ for_user_id: SELF, follow_events: [follow("119")] }, env());
    expect(be.contacts.get("119")!.count).toBe(1);
  });

  it("a mention or like never triggers a public reply or any outbound post; no DM goes to someone who only followed", async () => {
    await post({ for_user_id: SELF, follow_events: [follow("120")], tweet_create_events: [mention("120", "t3")], favorite_events: [like("120", "fav-3")] }, env());
    const out = be.calls.filter((c) => /api\.(x|twitter)\.com/.test(c.url));
    expect(out.filter((c) => /\/tweets|statuses\/update|dm_conversations/.test(c.url))).toEqual([]);
  });

  it("anti-loop: our own DM echo is never answered", async () => {
    const own = { for_user_id: SELF, direct_message_events: [{ type: "message_create", message_create: { sender_id: SELF, target: { recipient_id: "121" }, message_data: { text: "welcome" } } }] };
    await post(own, env());
    expect(be.calls.filter((c) => c.url.includes("dm_conversations"))).toEqual([]);
  });

  it("consent withdrawal: a DELETE DM erases the contact and the CRM copy", async () => {
    await post({ for_user_id: SELF, follow_events: [follow("122")] }, env());
    expect(be.contacts.has("122") && be.hubspot.has("122")).toBe(true);
    await post({ for_user_id: SELF, direct_message_events: [{ type: "message_create", message_create: { sender_id: "122", target: { recipient_id: SELF }, message_data: { text: "delete my data" } } }] }, env());
    expect(be.contacts.has("122")).toBe(false); expect(be.hubspot.has("122")).toBe(false);
  });
});

describe("CK-8502 stages and extraction", () => {
  it("keeps the funnel stages apart: clicks/aggregate follows are never a contact; only what a platform identity did is recorded", () => {
    expect(stageOf("follow")).toBe("engagement"); expect(stageOf("like")).toBe("engagement"); expect(stageOf("mention")).toBe("engagement"); expect(stageOf("share")).toBe("engagement");
    expect(stageOf("dm")).toBe("prospect"); expect(stageOf("mirror_consent")).toBe("scan_request");
  });
  it("never guesses identity: a non-numeric or missing platform id yields no event", () => {
    expect(extractEngagement({ follow_events: [{ type: "follow", target: { id: SELF }, source: { screen_name: "x" } }, { type: "follow", target: { id: SELF }, source: { id: "abc" } }] }, SELF)).toEqual([]);
  });
  it("builds a stable key from the platform id, so two different tweets by one person are two events", () => {
    const e = extractEngagement({ tweet_create_events: [mention("5", "a"), mention("5", "b")] }, SELF);
    expect(e.map((x) => x.eventKey)).toEqual(["mention:a", "mention:b"]);
  });
});
