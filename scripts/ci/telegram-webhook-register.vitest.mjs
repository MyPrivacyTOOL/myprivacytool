// @vitest-environment node
// MPC-7251: the Telegram webhook registration script, with Telegram and the Worker faked.
import { describe, expect, it, vi } from "vitest";
import { run, WEBHOOK_URL } from "./telegram-webhook-register.mjs";

const TOKEN = "123456:SECRET-token";
const SECRET = "abcDEF_123-xyz";
const baseEnv = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET };

function fakeFetch({ workerRight = 200, workerWrong = 401, info = {}, setOk = true, getMeOk = true } = {}) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    if (u.endsWith("/getMe")) return Response.json(getMeOk ? { ok: true, result: { username: "TestBot" } } : { ok: false }, { status: getMeOk ? 200 : 401 });
    if (u.endsWith("/setWebhook")) return Response.json(setOk ? { ok: true, result: true } : { ok: false, description: `bad ${TOKEN}` });
    if (u.endsWith("/getWebhookInfo")) return Response.json({ ok: true, result: { url: WEBHOOK_URL, pending_update_count: 0, ...info } });
    if (u === WEBHOOK_URL) {
      const header = new Headers(init.headers).get("X-Telegram-Bot-Api-Secret-Token");
      return new Response("x", { status: header === SECRET ? workerRight : workerWrong });
    }
    throw new Error(`unexpected ${u}`);
  });
}
const go = async (env, f) => {
  const lines = [];
  const ok = await run({ env, fetchImpl: f, log: (l) => lines.push(l) });
  return { ok, out: lines.join("\n") };
};

describe("telegram webhook register script", () => {
  it("passes when Telegram accepts the webhook and the Worker accepts the real secret only", async () => {
    const f = fakeFetch();
    const { ok, out } = await go(baseEnv, f);
    expect(ok).toBe(true);
    expect(out).toContain("PASS");
    const set = f.mock.calls.find(([u]) => String(u).endsWith("/setWebhook"));
    expect(JSON.parse(set[1].body)).toMatchObject({ url: WEBHOOK_URL, secret_token: SECRET, drop_pending_updates: true });
    // MPC-7894: button taps (callback_query) must be delivered or the /fix wizard buttons only pulse.
    expect(JSON.parse(set[1].body).allowed_updates).toEqual(["message", "callback_query"]);
  });
  it("never prints the token or the secret", async () => {
    const { out } = await go(baseEnv, fakeFetch({ setOk: false }));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(SECRET);
  });
  it("fails with the secret name when a secret is missing or malformed", async () => {
    expect((await go({ TELEGRAM_WEBHOOK_SECRET: SECRET }, fakeFetch())).out).toContain("TELEGRAM_BOT_TOKEN is not set");
    expect((await go({ TELEGRAM_BOT_TOKEN: TOKEN }, fakeFetch())).out).toContain("TELEGRAM_WEBHOOK_SECRET is not set");
    const bad = await go({ ...baseEnv, TELEGRAM_WEBHOOK_SECRET: "has space" }, fakeFetch());
    expect(bad.ok).toBe(false);
    expect(bad.out).toContain("letters, digits");
  });
  it("fails on a bad bot token and on a rejected setWebhook", async () => {
    expect((await go(baseEnv, fakeFetch({ getMeOk: false }))).ok).toBe(false);
    expect((await go(baseEnv, fakeFetch({ setOk: false }))).ok).toBe(false);
  });
  it("fails when Telegram still reports a delivery error", async () => {
    const r = await go(baseEnv, fakeFetch({ info: { last_error_message: "Wrong response from the webhook: 401 Unauthorized" } }));
    expect(r.ok).toBe(false);
    expect(r.out).toContain("delivery error");
  });
  it("fails with a redeploy hint when the Worker rejects the real secret", async () => {
    const r = await go(baseEnv, fakeFetch({ workerRight: 401 }));
    expect(r.ok).toBe(false);
    expect(r.out).toContain("re-run 'Deploy core-brain & social-listeners'");
  });
  it("fails when the Worker does not fail closed", async () => {
    expect((await go(baseEnv, fakeFetch({ workerWrong: 200 }))).ok).toBe(false);
  });
  it("fails when the Worker errors on a valid update", async () => {
    expect((await go(baseEnv, fakeFetch({ workerRight: 502 }))).ok).toBe(false);
  });
});
