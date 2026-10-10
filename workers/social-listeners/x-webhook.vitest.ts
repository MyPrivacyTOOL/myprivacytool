// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "./src/index";

const sig = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("base64");
const brain = () => ({ fetch: vi.fn(async () => new Response("ok")) });
const env = (b = brain()) => ({ X_CONSUMER_SECRET: "xs", TELEGRAM_WEBHOOK_SECRET: "tg", CORE_BRAIN: b });
const call = (path: string, init: RequestInit, e: object) => worker.fetch(new Request("https://w" + path, init), e as never);

describe("X webhook", () => {
  it("answers the CRC challenge", async () => {
    const r = await call("/webhook/x?crc_token=abc", {}, env());
    expect((await r.json()).response_token).toBe(sig("xs", "abc"));
  });
  it("rejects missing/bad signature and unset secret, without forwarding", async () => {
    const b = brain(); const body = '{"direct_message_events":[]}';
    expect((await call("/webhook/x", { method: "POST", body }, env(b))).status).toBe(401);
    expect((await call("/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig("bad", body) } }, env(b))).status).toBe(401);
    expect((await call("/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig("xs", body) } }, {})).status).toBe(401);
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("forwards a verified payload untouched", async () => {
    const b = brain(); const body = '{"tweet_create_events":[{"text":"hi"}]}';
    const r = await call("/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig("xs", body) } }, env(b));
    expect(r.status).toBe(200);
    const sent = await (b.fetch.mock.calls[0][0] as Request).json();
    expect(sent).toMatchObject({ source: "x", payload: { tweet_create_events: [{ text: "hi" }] } });
  });
  it("returns 502 when core-brain fails so X retries", async () => {
    const b = { fetch: vi.fn(async () => new Response("no", { status: 500 })) }; const body = "{}";
    const r = await call("/webhook/x", { method: "POST", body, headers: { "X-Twitter-Webhooks-Signature": sig("xs", body) } }, env(b));
    expect(r.status).toBe(502);
  });
});

describe("Telegram webhook", () => {
  const h = (s: string) => ({ "X-Telegram-Bot-Api-Secret-Token": s });
  it("requires the secret token and fails closed when unset", async () => {
    const b = brain();
    expect((await call("/webhook/telegram", { method: "POST", body: "{}" }, env(b))).status).toBe(401);
    expect((await call("/webhook/telegram", { method: "POST", body: "{}", headers: h("nope") }, env(b))).status).toBe(401);
    expect((await call("/webhook/telegram", { method: "POST", body: "{}", headers: h("tg") }, {})).status).toBe(401);
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("forwards a verified update and rejects malformed JSON", async () => {
    const b = brain();
    const r = await call("/webhook/telegram", { method: "POST", body: '{"update_id":1}', headers: h("tg") }, env(b));
    expect(r.status).toBe(200);
    expect(await (b.fetch.mock.calls[0][0] as Request).json()).toMatchObject({ source: "telegram", payload: { update_id: 1 } });
    expect((await call("/webhook/telegram", { method: "POST", body: "nope", headers: h("tg") }, env())).status).toBe(400);
  });
});

describe("core-brain auth (MPC-8601)", () => {
  it("sends CORE_BRAIN_TOKEN as a bearer token on the service-binding path, and omits it when unset", async () => {
    const h = { "X-Telegram-Bot-Api-Secret-Token": "tg" };
    const b = brain();
    await call("/webhook/telegram", { method: "POST", body: '{"update_id":1}', headers: h }, { ...env(b), CORE_BRAIN_TOKEN: "tok" });
    expect((b.fetch.mock.calls[0][0] as Request).headers.get("authorization")).toBe("Bearer tok");
    expect((b.fetch.mock.calls[0][0] as Request).url).toBe("https://core-brain/ingest/social");
    const b2 = brain();
    await call("/webhook/telegram", { method: "POST", body: '{"update_id":1}', headers: h }, env(b2));
    expect((b2.fetch.mock.calls[0][0] as Request).headers.get("authorization")).toBeNull();
  });
});
