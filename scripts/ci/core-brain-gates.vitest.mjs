// @vitest-environment node
// CK-7318: the on-demand Core Brain production gates must never leak the secret and must fail closed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { gates, parseArgs, BASE } from "./core-brain-gates.mjs";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SECRET = "s3cr3t-value-for-test";
const resp = (status, json) => ({ status, ok: status < 400, json: async () => json ?? {} });

const brain = ({ source = "qwen", authed = 200 } = {}) => async (u, o = {}) => {
  if (u.endsWith("/health")) return resp(200, { ok: true, worker: "core-brain", configured: true });
  if (u.endsWith("/webhook") && o.method === "POST") {
    return o.headers?.["X-MPT-Webhook-Secret"] === SECRET ? resp(authed, { intent: "scan", intent_source: source }) : resp(401);
  }
  return resp(404);
};

describe("core-brain-gates", () => {
  it("defaults to the production custom domain", () => { expect(BASE).toBe("https://brain.myprivacytool.io"); });
  it("passes when Qwen classifies the test message", async () => {
    expect((await gates("https://b", SECRET, brain())).every((r) => r.ok)).toBe(true);
  });
  it('fails when intent_source is "rules" (Qwen not reached)', async () => {
    const failed = (await gates("https://b", SECRET, brain({ source: "rules" }))).filter((r) => !r.ok);
    expect(failed.map((r) => r.name)).toEqual(['3b live Qwen gate: intent_source is "qwen"']);
  });
  it("fails closed when the secret is missing, without sending an authenticated request", async () => {
    let authed = 0;
    const f = async (u, o = {}) => { if (o.headers?.["X-MPT-Webhook-Secret"]) authed++; return brain()(u, o); };
    const failed = (await gates("https://b", "  ", f)).filter((r) => !r.ok);
    expect(failed.map((r) => r.name)).toEqual(["3b live Qwen gate"]);
    expect(authed).toBe(0);
  });
  it("fails if /webhook accepts an unauthenticated POST", async () => {
    const f = async (u, o = {}) => (u.endsWith("/webhook") && o.method === "POST" ? resp(200, { intent_source: "qwen" }) : brain()(u, o));
    expect((await gates("https://b", SECRET, f)).filter((r) => !r.ok).map((r) => r.name)).toContain("3a POST /webhook without the secret -> 401");
  });
  it("never puts the secret or a response body in its results", async () => {
    expect(JSON.stringify(await gates("https://b", SECRET, brain()))).not.toContain(SECRET);
  });
  it("rejects unknown arguments", () => { expect(() => parseArgs(["--nope"])).toThrow("unknown argument"); });
});

describe("core-brain-gates.yml", () => {
  const text = readFileSync(path.join(repo, ".github/workflows/core-brain-gates.yml"), "utf8");
  const wf = parse(text);
  it("is manual only and read-only", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({ contents: "read" });
  });
  it("passes WEBHOOK_SECRET via env, never inline in a command", () => {
    const step = wf.jobs.gates.steps.find((s) => /core-brain-gates\.mjs/.test(s.run ?? ""));
    expect(step.env.WEBHOOK_SECRET).toBe("${{ secrets.WEBHOOK_SECRET }}");
    expect(step.run).not.toContain("secrets.");
  });
});
