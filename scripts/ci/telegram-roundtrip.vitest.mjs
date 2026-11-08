// @vitest-environment node
// MPC-9850: the verdict logic of the synthetic Telegram round-trip.
import { describe, it, expect } from "vitest";
import { evaluate, run } from "./telegram-roundtrip.mjs";

const rows = (over = {}) => [
  { direction: "in", kind: "message", created_at: "t1", payload: {} },
  { direction: "brain", kind: "core-brain", created_at: "t2", payload: { outcome: "ok" } },
  { direction: "out", kind: "sendMessage", created_at: "t3", payload: { status: 200, response: { ok: true }, request: { text: "hi" } }, ...over },
];

describe("telegram round-trip verdict", () => {
  it("passes only with in + brain + an ok sendMessage", () => expect(evaluate(rows()).pass).toBe(true));
  it("fails when Telegram refuses the reply", () => expect(evaluate(rows({ payload: { status: 400, response: { ok: false, description: "chat not found" } } })).pass).toBe(false));
  it("fails with no reply row", () => expect(evaluate(rows().slice(0, 2)).pass).toBe(false));
  it("fails when the update was never logged", () => expect(evaluate([]).problems[0]).toMatch(/no inbound row/));
});

describe("telegram round-trip run", () => {
  it("is NOT CONFIGURED (2), never a pass, without secrets", async () => expect(await run({ env: {}, log: () => {} })).toBe(2));
  it("is NOT CONFIGURED when no synthetic id can be resolved", async () => expect(await run({ env: { TELEGRAM_WEBHOOK_SECRET: "s", SUPABASE_SERVICE_ROLE_KEY: "k" }, log: () => {} })).toBe(2));
});
