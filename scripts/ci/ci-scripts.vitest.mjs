// @vitest-environment node
// MPC-7300: tests for the deploy-safety scripts themselves.
import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkRequiredEnv, checkWorkerDir, parseArgs as parseEnvArgs, run } from "./check-env.mjs";
import { smoke, targets, parseArgs as parseSmokeArgs, DEFAULTS } from "./smoke-test.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");

describe("check-env", () => {
  it("flags missing and blank variables but never prints values", () => {
    const p = checkRequiredEnv(["A", "B", "C"], { A: "secret-value", B: "   " });
    expect(p).toEqual(["required environment variable / secret B is not set", "required environment variable / secret C is not set"]);
    expect(JSON.stringify(p)).not.toContain("secret-value");
  });
  it("accepts every real Worker directory in the repo", () => {
    for (const w of ["mpt-leads", "oauth-poc", "scan-report"]) {
      expect(checkWorkerDir(path.join(repo, "workers", w)), w).toEqual([]);
    }
  });
  it("detects placeholders, a missing name/main, a missing entry file and value-bearing secret files", () => {
    const files = {
      "d/wrangler.toml": 'compatibility_date = "2024-01-01"\nfoo = "REPLACE_ME"',
      "d/EXPECTED_SECRETS.txt": "GOOD_NAME\nbad=value\n\nlower\n",
    };
    const p = checkWorkerDir("d", (f) => files[f], (f) => f in files);
    expect(p.some((x) => x.includes("REPLACE_"))).toBe(true);
    expect(p.some((x) => x.includes("no name"))).toBe(true);
    expect(p.some((x) => x.includes("no main"))).toBe(true);
    expect(p.filter((x) => x.includes("EXPECTED_SECRETS.txt"))).toHaveLength(2);
    const p2 = checkWorkerDir("d", () => 'name = "x"\nmain = "index.js"', (f) => f.endsWith("wrangler.toml"));
    expect(p2).toEqual(['d/wrangler.toml main "index.js" does not exist']);
    expect(checkWorkerDir("nowhere", () => "", () => false)).toEqual(["nowhere/wrangler.toml not found"]);
  });
  it("parses args and rejects unknown flags", () => {
    expect(parseEnvArgs(["--require", "A,B", "--worker", "w1", "--require", "C"])).toEqual({ require: ["A", "B", "C"], workers: ["w1"] });
    expect(() => parseEnvArgs(["--bogus"])).toThrow("unknown argument");
    expect(run(["--require", "ZZ_UNSET_FOR_TEST"], {})).toHaveLength(1);
  });
  it("CLI exits non-zero with ::error:: annotations, and zero when clean", () => {
    const bad = spawnSync("node", [path.join(here, "check-env.mjs"), "--require", "ZZ_UNSET_FOR_TEST"], { encoding: "utf8", env: { PATH: process.env.PATH } });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("::error::required environment variable / secret ZZ_UNSET_FOR_TEST is not set");
    const unknown = spawnSync("node", [path.join(here, "check-env.mjs"), "--nope"], { encoding: "utf8" });
    expect(unknown.status).toBe(1);
    const good = execFileSync("node", [path.join(here, "check-env.mjs"), "--require", "ZZ_SET", "--worker", path.join(repo, "workers/mpt-leads")], { encoding: "utf8", env: { PATH: process.env.PATH, ZZ_SET: "x" } });
    expect(good).toContain("OK:");
  });
});

// ---- smoke-test ---------------------------------------------------------
const hdr = (h = {}) => ({ get: (k) => h[k.toLowerCase()] ?? null });
const resp = (status, { body = "", json, headers } = {}) => ({
  ok: status >= 200 && status < 300, status, headers: hdr(headers),
  text: async () => body, json: async () => (json !== undefined ? json : JSON.parse(body)),
});
const shell = '<html><head><title>MPT</title></head><body><div id="root"></div></body></html>';

const leadsOk = async (u, o = {}) =>
  o.method === "OPTIONS" ? resp(204, { headers: { "access-control-allow-origin": "https://myprivacytool.io" } })
    : o.method === "POST" ? resp(200, { json: { success: true, note: "healthcheck" } }) : resp(404);

describe("smoke-test targets", () => {
  it("site: passes when every route serves the SPA shell and the sitemap exists", async () => {
    const f = async (u) => (u.endsWith("sitemap.xml") ? resp(200, { body: "<urlset></urlset>" }) : resp(200, { body: shell }));
    const r = await targets.site("https://s", f);
    expect(r.every((x) => x.ok)).toBe(true);
  });
  it("site: fails on a 404 route, a blank shell and a missing sitemap", async () => {
    const f = async (u) => (u.endsWith("/contact") ? resp(404) : u.endsWith("/start") ? resp(200, { body: "<html></html>" }) : u.endsWith("sitemap.xml") ? resp(500) : resp(200, { body: shell }));
    const failed = (await targets.site("https://s", f)).filter((x) => !x.ok).map((x) => x.name);
    expect(failed).toEqual(expect.arrayContaining(["GET /contact -> 200", "GET /start serves the SPA shell", "GET /sitemap.xml -> 200 XML"]));
  });
  it("site: with expectSha, passes only when /version.json serves that commit", async () => {
    const mk = (sha) => async (u) => (u.endsWith("sitemap.xml") ? resp(200, { body: "<urlset></urlset>" }) : u.endsWith("version.json") ? resp(200, { json: { sha } }) : resp(200, { body: shell }));
    const ok = await targets.site("https://s", mk("abc1234"), { expectSha: "abc1234" });
    expect(ok.every((x) => x.ok)).toBe(true);
    const stale = (await targets.site("https://s", mk("old9999"), { expectSha: "abc1234" })).filter((x) => !x.ok);
    expect(stale.map((x) => x.name)).toEqual(["/version.json serves commit abc1234"]);
  });
  it("mpt-leads: passes against a healthy Worker and only POSTs the healthcheck address", async () => {
    const seen = [];
    const r = await targets["mpt-leads"]("https://w", async (u, o) => { seen.push(o); return leadsOk(u, o); });
    expect(r.every((x) => x.ok)).toBe(true);
    expect(JSON.parse(seen.find((o) => o?.method === "POST").body)).toEqual({ email: "watchdog@healthcheck.io" });
  });
  it("mpt-leads: fails when CORS is wrong or the healthcheck is not short-circuited", async () => {
    const r = await targets["mpt-leads"]("https://w", async (u, o = {}) =>
      o.method === "OPTIONS" ? resp(204, { headers: { "access-control-allow-origin": "*" } }) : o.method === "POST" ? resp(500, { body: "nope" }) : resp(200));
    expect(r.filter((x) => !x.ok).map((x) => x.name)).toEqual(["CORS allows the production origin", "healthcheck POST -> 200 {success, note:healthcheck}", "GET -> 404 (POST-only)"]);
  });
  it("oauth-poc: passes against a healthy Worker", async () => {
    const f = async (u) => u.endsWith("/health") ? resp(200, { json: { status: "ok" } })
      : u.endsWith("/start") ? resp(302, { headers: { location: "https://accounts.google.com/o/oauth2/v2/auth?x", "set-cookie": "mpt_oauth=a; HttpOnly" } }) : resp(404);
    expect((await targets["oauth-poc"]("https://o", f)).every((x) => x.ok)).toBe(true);
  });
  it("oauth-poc: fails on a non-JSON health body", async () => {
    const f = async (u) => (u.endsWith("/health") ? { ...resp(502), json: async () => { throw new Error("html"); } } : resp(404, { headers: {} }));
    expect((await targets["oauth-poc"]("https://o", f)).some((x) => !x.ok)).toBe(true);
  });
});

describe("smoke() runner", () => {
  const noLog = () => {};
  it("rejects unknown targets", async () => { await expect(smoke("nope")).rejects.toThrow("unknown target"); });
  it("retries until the deployment propagates, then passes", async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const f = async (u, o = {}) => (++n <= 3 ? resp(404) : leadsOk(u, o));
    const out = await smoke("mpt-leads", { fetchFn: f, retries: 3, delayMs: 1, sleep, log: noLog });
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it("fails after exhausting retries and reports a network error as a failed check", async () => {
    const out = await smoke("mpt-leads", { fetchFn: async () => { throw new Error("ECONNRESET"); }, retries: 2, delayMs: 1, sleep: async () => {}, log: noLog });
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(2);
    expect(out.results[0].detail).toBe("ECONNRESET");
  });
  it("uses the default URL for the target and trims a trailing slash from overrides", async () => {
    const urls = [];
    await smoke("oauth-poc", { fetchFn: async (u) => { urls.push(u); return resp(200, { json: {} }); }, retries: 1, log: noLog });
    expect(urls[0]).toBe(`${DEFAULTS["oauth-poc"]}/health`);
    urls.length = 0;
    await smoke("oauth-poc", { baseUrl: "https://x.test/", fetchFn: async (u) => { urls.push(u); return resp(200, { json: {} }); }, retries: 1, log: noLog });
    expect(urls[0]).toBe("https://x.test/health");
  });
  it("parses CLI args", () => {
    expect(parseSmokeArgs(["site", "--base-url", "https://x", "--retries", "2", "--delay-ms", "5"])).toEqual({ target: "site", baseUrl: "https://x", retries: 2, delayMs: 5 });
    expect(parseSmokeArgs(["site", "--expect-sha", "abc"])).toEqual({ target: "site", expectSha: "abc" });
    expect(() => parseSmokeArgs(["site", "--x"])).toThrow("unknown argument");
  });
  it("CLI exits 1 with ::error:: for a failing target and for bad args", () => {
    const bad = spawnSync("node", [path.join(here, "smoke-test.mjs"), "mpt-leads", "--base-url", "http://127.0.0.1:9", "--retries", "1"], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("::error::smoke test failed (mpt-leads)");
    expect(spawnSync("node", [path.join(here, "smoke-test.mjs"), "bogus"], { encoding: "utf8" }).status).toBe(1);
  });
});
