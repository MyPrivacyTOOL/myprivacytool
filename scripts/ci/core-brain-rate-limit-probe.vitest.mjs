// @vitest-environment node
// MPC-7257: the on-demand rate-limit probe must never leak the secret, must fail closed, and must judge the 429 correctly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { probe, parseArgs, BASE, LIMIT, SLACK } from "./core-brain-rate-limit-probe.mjs";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SECRET = "s3cr3t-value-for-test";
const resp = (status, json, headers = {}) => ({ status, ok: status < 400, json: async () => json ?? {}, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });

// Fake core-brain: allows `max` requests per sender, then answers 429 like the real Worker.
const brain = ({ max = LIMIT, retryAfter = "60", code = "rate_limited", health = { sender: true, global: true } } = {}) => {
  const seen = new Map(); const senders = [];
  const f = async (u, o) => {
    if (String(u).endsWith("/health")) return resp(200, health === null ? { ok: true } : { ok: true, rate_limit: health });
    const sender = JSON.parse(o.body).sender_id; senders.push(sender);
    const n = (seen.get(sender) ?? 0) + 1; seen.set(sender, n);
    return n <= max ? resp(200, { intent: "scan" }) : resp(429, { error: { code } }, { "retry-after": retryAfter });
  };
  return { f, senders };
};
const names = (rs) => rs.filter((r) => !r.ok).map((r) => r.name);

describe("core-brain-rate-limit-probe", () => {
  it("defaults to the production custom domain and a limit of 10", () => { expect(BASE).toBe("https://brain.myprivacytool.io"); expect(LIMIT).toBe(10); });
  it("passes when request 11 is the first 429 and another sender is unaffected", async () => {
    const b = brain();
    const rs = await probe("https://b", SECRET, { f: b.f, now: () => 111 });
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(b.senders.filter((s) => s === "rl-probe-111")).toHaveLength(30);
    expect(b.senders.at(-1)).toBe("rl-probe-111-other");
  });
  it("names a missing binding: health says the sender limiter is not attached", async () => {
    const b = brain({ max: 999, health: { sender: false, global: false } });
    expect(names(await probe("https://b", SECRET, { f: b.f }))).toContain("RATE_LIMITER binding is attached on the live Worker");
  });
  it("does not fail the binding check on an older Worker whose health has no rate_limit field", async () => {
    expect(names(await probe("https://b", SECRET, { f: brain({ health: null }).f }))).toEqual([]);
  });
  it("tolerates a limiter that trips a request or two late (live run: first 429 at request 12)", async () => {
    for (const max of [10, 11, 12, 13, 14]) expect(names(await probe("https://b", SECRET, { f: brain({ max }).f }))).toEqual([]);
    expect(SLACK).toBe(4);
  });
  it("fails when the limit is much looser (first 429 after the slack)", async () => {
    expect(names(await probe("https://b", SECRET, { f: brain({ max: 15 }).f }))).toContain("first 429 arrives by request 15 (spec: 11th, limiter is approximate)");
  });
  it("fails when no request is ever limited", async () => {
    expect(names(await probe("https://b", SECRET, { f: brain({ max: 999 }).f }))).toContain("first 429 arrives by request 15 (spec: 11th, limiter is approximate)");
  });
  it("fails when the limit is tighter (an early request is refused)", async () => {
    expect(names(await probe("https://b", SECRET, { f: brain({ max: 5 }).f }))).toContain("first 10 requests for one sender -> 200");
  });
  it("fails on a wrong error code or Retry-After", async () => {
    expect(names(await probe("https://b", SECRET, { f: brain({ code: "other" }).f }))).toEqual(["429 carries error.code rate_limited"]);
    expect(names(await probe("https://b", SECRET, { f: brain({ retryAfter: "5" }).f }))).toEqual(["429 carries Retry-After: 60"]);
  });
  it("fails closed when the secret is missing, without sending any request", async () => {
    let sent = 0;
    const rs = await probe("https://b", "  ", { f: async () => { sent++; return resp(200); } });
    expect(rs.map((r) => r.ok)).toEqual([false]);
    expect(sent).toBe(0);
  });
  it("never puts the secret in its results", async () => {
    expect(JSON.stringify(await probe("https://b", SECRET, { f: brain().f }))).not.toContain(SECRET);
  });
  it("validates arguments", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown argument");
    expect(() => parseArgs(["--count", "5"])).toThrow("--count must be");
    expect(parseArgs(["--count", "12"]).count).toBe(12);
  });
});

describe("core-brain-rate-limit.yml", () => {
  const wf = parse(readFileSync(path.join(repo, ".github/workflows/core-brain-rate-limit.yml"), "utf8"));
  it("is manual only and read-only", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({ contents: "read" });
  });
  it("passes WEBHOOK_SECRET via env, never inline in a command", () => {
    const step = wf.jobs.probe.steps.find((s) => /rate-limit-probe\.mjs/.test(s.run ?? ""));
    expect(step.env.WEBHOOK_SECRET).toBe("${{ secrets.WEBHOOK_SECRET }}");
    expect(step.run).not.toContain("secrets.");
  });
});
