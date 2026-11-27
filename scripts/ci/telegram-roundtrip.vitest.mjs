import { describe, expect, it, vi } from "vitest";
import { run } from "./telegram-roundtrip.mjs";

const answer = (status, body) => async () => new Response(JSON.stringify(body), { status });
const go = (env, fetchImpl) => { const lines = []; return run({ env, fetchImpl, log: (l) => lines.push(l) }).then((code) => ({ code, out: lines.join("\n") })); };

describe("telegram-roundtrip (Worker-side sender)", () => {
  it("is NOT CONFIGURED without the webhook secret and never calls out", async () => {
    const f = vi.fn();
    expect((await go({}, f)).code).toBe(2);
    expect(f).not.toHaveBeenCalled();
  });
  it("is NOT CONFIGURED when the Worker has no SYNTHETIC_IDS", async () => {
    const r = await go({ TELEGRAM_WEBHOOK_SECRET: "s" }, answer(503, { error: "SYNTHETIC_IDS is not set" }));
    expect(r.code).toBe(2);
    expect(r.out).toContain("SYNTHETIC_IDS");
  });
  it("sends only the secret header and no id", async () => {
    const f = vi.fn(answer(200, { pass: true, ms: 1200, sent_at: "t0", in_at: "t1", brain_at: "t2", out_at: "t3", update_id: 1 }));
    const r = await go({ TELEGRAM_WEBHOOK_SECRET: "s" }, f);
    expect(r.code).toBe(0);
    expect(r.out).toContain("PASS");
    expect(f.mock.calls[0][1].headers).toEqual({ "X-Telegram-Bot-Api-Secret-Token": "s" });
    expect(f.mock.calls[0][1].body).toBeUndefined();
  });
  it("FAILs and prints the problems when a row is missing", async () => {
    const r = await go({ TELEGRAM_WEBHOOK_SECRET: "s" }, answer(200, { pass: false, problems: ["no sendMessage row: no reply was sent"], ms: null }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("no sendMessage row");
  });
  it("FAILs on 401", async () => {
    expect((await go({ TELEGRAM_WEBHOOK_SECRET: "s" }, answer(401, {}))).code).toBe(1);
  });
});
