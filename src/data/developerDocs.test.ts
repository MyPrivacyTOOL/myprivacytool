// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BASES, ENDPOINTS, LANG_LABEL, SNIPPETS, type Lang } from "./developerDocs";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("developer docs match the Workers", () => {
  it("documents each route that the Worker source actually contains", () => {
    for (const e of ENDPOINTS) {
      const src = read(e.source);
      if (e.id === "lead-capture") {
        // mpt-leads answers any path; the site posts to /webhook/leads (README.md documents it).
        expect(read("workers/mpt-leads/README.md")).toContain(e.path);
        expect(src).toContain("request.method !== 'POST'");
      } else {
        expect(src, `${e.method} ${e.path} not found in ${e.source}`).toContain(e.path);
      }
    }
  });

  it("uses the workers.dev hosts declared in each wrangler.toml", () => {
    expect(read("workers/mpt-leads/wrangler.toml")).toContain('name = "mpt-leads"');
    expect(read("workers/scan-report/wrangler.toml")).toContain('name = "mpt-scan-report"');
    expect(read("workers/github-channel/wrangler.toml")).toContain('name = "myprivacytool-github-channel"');
    expect(read("workers/oauth-poc/wrangler.toml")).toContain('name = "myprivacytool-oauth-poc"');
    // The GitHub channel is served from a subdomain of the site (same-site cookies); the others stay on workers.dev.
    expect(read("workers/github-channel/wrangler.toml")).toContain('pattern = "channels.myprivacytool.io"');
    for (const [name, base] of Object.entries(BASES)) {
      if (name === "github") expect(base).toBe("https://channels.myprivacytool.io");
      else expect(base).toMatch(/^https:\/\/[a-z-]+\.myprivacytool\.workers\.dev$/);
    }
  });

  it("has unique endpoint ids and a response for every endpoint", () => {
    const ids = ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENDPOINTS) expect(e.responses.length).toBeGreaterThan(0);
  });

  it("keeps error strings in the docs identical to the code", () => {
    const scan = read("workers/scan-report/index.js");
    for (const msg of ["Valid email required", "Consent required", "Could not record your scan request"]) {
      expect(scan).toContain(msg);
    }
    expect(read("workers/mpt-leads/worker.js")).toContain("Email required");
    const gh = read("workers/github-channel/index.js");
    for (const code of ["unauthenticated", "reauthorize", "not_connected", "upstream_error", "forbidden_origin"]) {
      expect(gh).toContain(code);
    }
  });
});

describe("snippets", () => {
  it("cover every language for every snippet", () => {
    for (const s of SNIPPETS) {
      for (const l of Object.keys(LANG_LABEL) as Lang[]) expect(s.code[l].trim().length).toBeGreaterThan(0);
    }
  });

  it("the scan snippets target the scan Worker and always send consent: true", () => {
    const scan = SNIPPETS.find((s) => s.id === "scan")!;
    for (const code of Object.values(scan.code)) {
      expect(code).toContain(`${BASES.scan}/api/scan`);
      expect(code.toLowerCase()).toMatch(/consent/);
    }
  });

  it("the TypeScript receipt verifier agrees with the Worker's PaPIT receipt", async () => {
    const { githubToPapit } = await import(path.join(ROOT, "workers/github-channel/lib/papit.js"));
    const papit = await githubToPapit(
      {
        profile: { public_repos: 3, bio: "backend engineer" },
        repos: [{ fork: false, private: false, language: "Go" }, { fork: false, private: false, language: "TypeScript" }],
        starred: [{ topics: ["privacy", "cloudflare-workers"] }],
        events: [],
      },
      { now: new Date("2026-10-06T00:00:00Z") },
    );

    const snippet = SNIPPETS.find((s) => s.id === "papit-verify")!.code.typescript;
    const js = ts.transpileModule(snippet, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod: { exports: { verifyReceipt?: (p: unknown) => Promise<boolean> } } = { exports: {} };
    new Function("exports", "module", js)(mod.exports, mod);
    const verify = mod.exports.verifyReceipt!;

    expect(await verify(papit)).toBe(true);
    const tampered = JSON.parse(JSON.stringify(papit));
    tampered.behavioral.activity_level = "high";
    expect(await verify(tampered)).toBe(false);
  });
});
