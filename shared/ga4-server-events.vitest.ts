// @vitest-environment node
// MPC-11111: the server-side GA4 flow events ship switched off and carry nothing identifying.
import { describe, expect, it } from "vitest";
import recipientsData from "./recipients/recipients.data.js";
import { parseRegistry } from "./recipients/registry.ts";
import { anonymousClientId, ga4ServerEventsOn, sendGa4ServerEvent, DEFAULT_MEASUREMENT_ID } from "./ga4-server-events.ts";

const ON = { GA4_SERVER_EVENTS_ENABLED: "true", GA4_API_SECRET: "test-secret-not-real" };
const registryWith = (enabled: boolean) => {
  const reg = parseRegistry(JSON.parse(JSON.stringify(recipientsData)));
  const r = reg.recipients.find((x) => x.key === "ga4-measurement-protocol")!;
  r.enabled = enabled;
  return reg;
};
const spy = (ok = true) => {
  const calls: { url: string; body: { client_id: string; events: { name: string; params: Record<string, unknown> }[] } }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(null, { status: ok ? 204 : 500 }); }) as typeof fetch;
  return { calls, fetchImpl };
};
const ctx = (fetchImpl: typeof fetch, enabled = true) => ({ fetchImpl, registry: registryWith(enabled), flags: { GA4_SERVER_EVENTS_ENABLED: "true" }, consentGate: "none" as const });

describe("registry entry", () => {
  it("is ENABLED for the MPC-11111 DebugView run (this PR); the revert PR flips it back to the shipped DISABLED state", () => {
    const r = parseRegistry(JSON.parse(JSON.stringify(recipientsData))).recipients.find((x) => x.key === "ga4-measurement-protocol")!;
    expect(r.enabled).toBe(true);
    expect(r.hosts).toEqual(["www.google-analytics.com"]);
    expect(r.data_items).toEqual([]);
  });
});

describe("gates", () => {
  it("is off without the switch or without the secret", async () => {
    const s = spy();
    expect(ga4ServerEventsOn({})).toBe(false);
    expect(ga4ServerEventsOn({ GA4_SERVER_EVENTS_ENABLED: "true" })).toBe(false);
    expect(ga4ServerEventsOn({ GA4_API_SECRET: "x" })).toBe(false);
    expect(ga4ServerEventsOn({ GA4_SERVER_EVENTS_ENABLED: "TRUE", GA4_API_SECRET: "x" })).toBe(false);   // exact string "true" only
    expect(await sendGa4ServerEvent({}, "email_confirmed", { rctx: ctx(s.fetchImpl) })).toBe(false);
    expect(await sendGa4ServerEvent({ GA4_SERVER_EVENTS_ENABLED: "true" }, "email_confirmed", { rctx: ctx(s.fetchImpl) })).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
  it("sends nothing while the registry entry is disabled, even with the env switch and secret set (the shipped state)", async () => {
    const s = spy();
    expect(await sendGa4ServerEvent(ON, "report_delivered", { rctx: ctx(s.fetchImpl, false) })).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
  it("ignores an event name that is not one of the three", async () => {
    const s = spy();
    expect(await sendGa4ServerEvent(ON, "purchase" as never, { rctx: ctx(s.fetchImpl) })).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe("when every gate is open", () => {
  it("posts one event to the Measurement Protocol with only its name and an anonymous id", async () => {
    const s = spy();
    expect(await sendGa4ServerEvent(ON, "email_confirmed", { flowId: "11111111-2222-3333-4444-555555555555", rctx: ctx(s.fetchImpl) })).toBe(true);
    expect(s.calls).toHaveLength(1);
    const u = new URL(s.calls[0].url);
    expect(u.origin + u.pathname).toBe("https://www.google-analytics.com/mp/collect");
    expect(u.searchParams.get("measurement_id")).toBe(DEFAULT_MEASUREMENT_ID);
    const body = s.calls[0].body;
    expect(body.events).toEqual([{ name: "email_confirmed", params: {} }]);
    expect(body.client_id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(body)).not.toContain("11111111-2222");   // the scan id is never in the body
    expect(JSON.stringify(body)).not.toContain("test-secret-not-real");
  });
  it("dm_received carries the channel only; anything else a caller passes is dropped", async () => {
    const s = spy();
    await sendGa4ServerEvent(ON, "dm_received", { params: { channel: "telegram", sender: "12345", text: "hello", email: "a@b.co" }, rctx: ctx(s.fetchImpl) });
    expect(s.calls[0].body.events[0]).toEqual({ name: "dm_received", params: { channel: "telegram" } });
    await sendGa4ServerEvent(ON, "dm_received", { params: { channel: "not a channel!" }, rctx: ctx(s.fetchImpl) });
    expect(s.calls[1].body.events[0].params).toEqual({});
    await sendGa4ServerEvent(ON, "report_delivered", { params: { channel: "x", email: "a@b.co" }, rctx: ctx(s.fetchImpl) });
    expect(s.calls[2].body.events[0].params).toEqual({});
  });
  it("the same flow id gives the same client id (stages can be matched), different flows differ, and none can be read back", async () => {
    const a = await anonymousClientId("scan-1"), b = await anonymousClientId("scan-1"), c = await anonymousClientId("scan-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("scan-1");
    expect(await anonymousClientId()).not.toBe(await anonymousClientId());   // no id: random each time
  });
  it("uses a staging stream and debug mode when configured, so a staging run shows in DebugView", async () => {
    const s = spy();
    await sendGa4ServerEvent({ ...ON, GA4_MEASUREMENT_ID: "G-STAGING01", GA4_DEBUG_MODE: "true" }, "email_confirmed", { rctx: ctx(s.fetchImpl) });
    expect(new URL(s.calls[0].url).searchParams.get("measurement_id")).toBe("G-STAGING01");
    expect(s.calls[0].body.events[0].params).toEqual({ debug_mode: 1 });
  });
  it("never throws: a GA4 error status or a network failure just returns false", async () => {
    expect(await sendGa4ServerEvent(ON, "email_confirmed", { rctx: ctx(spy(false).fetchImpl) })).toBe(false);
    const boom = (async () => { throw new Error("network down"); }) as typeof fetch;
    expect(await sendGa4ServerEvent(ON, "email_confirmed", { rctx: ctx(boom) })).toBe(false);
  });
});
