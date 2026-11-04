// @vitest-environment node
// MPC-7257: the deploy action installs wrangler 3.90.0, which silently IGNORES a [[ratelimits]] table (it only warns
// 'Unexpected fields found in top-level field: "ratelimits"'). A Worker declared that way goes live with no limiter and
// fails open, which is exactly how core-brain shipped without its rate limit. Rate limits must be declared as
// [[unsafe.bindings]] type = "ratelimit".
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const workers = readdirSync(path.join(repo, "workers")).filter((d) => existsSync(path.join(repo, "workers", d, "wrangler.toml")));
const toml = (w) => readFileSync(path.join(repo, "workers", w, "wrangler.toml"), "utf8");

describe("wrangler rate-limit binding syntax", () => {
  it("finds the Workers", () => { expect(workers).toEqual(expect.arrayContaining(["core-brain", "mpt-leads", "scan-report"])); });
  it.each(workers)("%s does not use the [[ratelimits]] table (ignored by wrangler 3.90.0)", (w) => {
    expect(toml(w)).not.toMatch(/^\s*\[\[\s*ratelimits\s*\]\]/m);
  });
  it.each(["core-brain", "mpt-leads", "scan-report"])("%s declares RATE_LIMITER as an unsafe ratelimit binding", (w) => {
    const t = toml(w);
    expect(t).toMatch(/^\s*\[\[unsafe\.bindings\]\]/m);
    expect(t).toMatch(/type\s*=\s*"ratelimit"/);
    expect(t).toMatch(/name\s*=\s*"RATE_LIMITER"/);
  });
  it("core-brain also declares the global backstop with its own namespace id", () => {
    const t = toml("core-brain");
    expect(t).toMatch(/name\s*=\s*"RATE_LIMITER_GLOBAL"/);
    const ids = [...t.matchAll(/^namespace_id\s*=\s*"(\d+)"/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
