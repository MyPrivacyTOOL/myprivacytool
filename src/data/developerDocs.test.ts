// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BASES, ENDPOINTS, LANG_LABEL, PAPIT_LIMITS, PAPIT_SCHEMA, SNIPPETS, type Lang } from "./developerDocs";

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

  // MPC-9914 (EXT-03): the hash is a key, not authentication; consent and ownership are enforced before any write.
  it("lead-capture docs say consent is required and the email hash is not authentication", () => {
    const e = ENDPOINTS.find((x) => x.id === "lead-capture")!;
    const text = JSON.stringify(e);
    expect(text).toMatch(/Consent required/);
    expect(text).toMatch(/not authentication/);
    expect(text).not.toMatch(/auth":"None\. The Worker/);
    expect(e.request.fields.find((f) => f.name === "consent")?.required).toBe(true);
    const src = read(e.source);
    expect(src.indexOf("Consent required")).toBeLessThan(src.indexOf("const nr = await callRecipient('notion'"));
  });

  it("uses the hosts declared in each wrangler.toml (workers.dev, or a custom domain)", () => {
    expect(read("workers/mpt-leads/wrangler.toml")).toContain('name = "mpt-leads"');
    expect(read("workers/scan-report/wrangler.toml")).toContain('name = "mpt-scan-report"');
    expect(read("workers/github-channel/wrangler.toml")).toContain('name = "myprivacytool-github-channel"');
    expect(read("workers/oauth-poc/wrangler.toml")).toContain('name = "myprivacytool-oauth-poc"');
    // The GitHub channel is served from a subdomain of the site (same-site cookies); the others stay on workers.dev.
    expect(read("workers/github-channel/wrangler.toml")).toContain('pattern = "channels.myprivacytool.io"');
    // mpt-leads is served from api.myprivacytool.io (custom domain, MPC-8368); workers.dev still answers but is not the documented host.
    expect(read("workers/mpt-leads/wrangler.toml")).toContain('pattern = "api.myprivacytool.io"');
    for (const [name, base] of Object.entries(BASES)) {
      if (name === "github") expect(base).toBe("https://channels.myprivacytool.io");
      else if (name === "leads") expect(base).toBe("https://api.myprivacytool.io");
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

// MPC-9794 (CRYPTO-001, PRIVACY-023): the receipt is a checksum, not proof of origin, and the limits are published one by one.
describe("PaPIT limits wording", () => {
  it("says the receipt is a checksum that does not prove who produced the profile", () => {
    const d = SNIPPETS.find((s) => s.id === "papit-verify")!.description;
    expect(d).toMatch(/checksum, not a signature/);
    expect(d).toMatch(/does not prove who produced/);
    expect(d).not.toMatch(/detect any edit/i);
  });
  it("lists receipt, validity, cache, session, token and revocation, and says issued profiles cannot be recalled", () => {
    const names = PAPIT_LIMITS.map((l) => l.item);
    for (const n of ["Receipt", "Snapshot validity", "Cache", "Browser session", "Access token", "Revocation"]) expect(names).toContain(n);
    const text = PAPIT_LIMITS.map((l) => l.detail).join(" ");
    expect(text).toMatch(/cannot be recalled/);
    expect(text).toMatch(/24 hours/);
    expect(text).toMatch(/7 days/);
  });
  // MPC-10825: a person can remove a stored connection with no session; the route exists in the Worker and the pages say how long we keep it.
  it("documents revocation without a session, and the route exists in both Workers' source", () => {
    expect(PAPIT_LIMITS.map((l) => l.item)).toContain("Revocation without a session");
    const e = ENDPOINTS.find((x) => x.id === "github-remove")!;
    expect(e.path).toBe("/oauth/github/remove");
    expect(JSON.stringify(e)).toMatch(/intent=remove/);
    expect(read("workers/github-channel/index.js")).toContain("'/oauth/github/remove'");
    expect(read("workers/github-channel/lib/reddit-routes.js")).toContain("'/oauth/reddit/remove'");
  });
  it("person-facing copy says the connection is kept until you disconnect and never calls 30 days the validity of the connection", () => {
    const guide = read("src/content/guides/githubProfile.tsx");
    expect(guide).not.toMatch(/valid for 30 days|30 days of validity/);
    expect(guide).toMatch(/until you disconnect/);
    expect(guide).toMatch(/Remove my stored connection/);
    expect(read("src/components/ConnectGitHub.tsx")).not.toMatch(/data_retention_days/);
    expect(read("src/pages/Privacy.tsx")).toMatch(/If your 7-day session has ended, you can still remove the stored connection/);
  });
  it("the stated lifetimes match the Worker constants", () => {
    const idx = readFileSync(path.join(ROOT, "workers/github-channel/index.js"), "utf8");
    const cache = readFileSync(path.join(ROOT, "workers/github-channel/lib/cache.js"), "utf8");
    expect(idx).toMatch(/SESSION_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
    expect(cache).toMatch(/CACHE_TTL_SECONDS = 24 \* 60 \* 60/);
    const papit = readFileSync(path.join(ROOT, "workers/github-channel/lib/papit.js"), "utf8");
    expect(papit).toMatch(/PROFILE_VALIDITY_DAYS = 30;/);
    expect(papit).toMatch(/data_retention_days: PROFILE_VALIDITY_DAYS/);
  });
});

// MPC-9795 (TECH-011, TECH-012, COPY-017, DEV-006): window, caps, the 'skills' name and empty interests are published, and match the adapter.
describe("PaPIT sampling wording", () => {
  const text = PAPIT_LIMITS.map((l) => `${l.item} ${l.detail}`).join(" ");
  it("publishes the 300-event / 90-day window, the page caps, the skills caveat and the empty-interests states", () => {
    expect(text).toMatch(/at most 300 events from that window/);
    expect(text).toMatch(/300 of your own public repos/);
    expect(text).toMatch(/200 of your most recently starred/);
    expect(text).toMatch(/does not measure skill/);
    expect(text).toMatch(/no_stars/);
    expect(text).toMatch(/stars_without_topics/);
  });
  it("the page caps stated match MAX_PAGES in the adapter (100 per page)", () => {
    const m = /MAX_PAGES = \{ repos: (\d+), starred: (\d+), events: (\d+) \}/.exec(read("workers/github-channel/lib/adapter.js"))!;
    expect(m.slice(1).map(Number)).toEqual([3, 2, 3]);
    expect(PAPIT_SCHEMA).toContain("data_coverage");
  });
});

// MPC-10833: the profile carries expires_at and stale ones are refused; a token is not used 90 days after consent. The limits say so, and match the code.
describe("PaPIT expiry and re-consent wording", () => {
  const limit = (item: string) => PAPIT_LIMITS.find((l) => l.item === item)!.detail;
  it("says expires_at is 30 days after generated_at, what refuses a stale profile, and that nothing else checks it", () => {
    const v = limit("Snapshot validity");
    expect(v).toMatch(/expires_at, 30 days after generated_at/);
    expect(v).toMatch(/POST \/papit\/verify refuses a profile past it with 410 profile_expired/);
    expect(v).toMatch(/Nothing else checks it/);
    expect(v).toMatch(/unkeyed checksum/);
    expect(PAPIT_SCHEMA).toMatch(/expires_at: string/);
    expect(PAPIT_SCHEMA).not.toMatch(/not enforced/);
  });
  it("says the token is not used 90 days after connecting, a refresh does not restart that, and that nothing deletes it automatically", () => {
    const t = limit("Access token");
    expect(t).toMatch(/90 days after the user last connected/);
    expect(t).toMatch(/401 reconsent_required/);
    expect(t).toMatch(/refresh does not restart the 90 days/);
    expect(t).toMatch(/do not delete the stored token automatically/);
  });
  it("documents POST /papit/verify with 200, 410, 422, 400 and 413, and reconsent_required on the profile call", () => {
    const ep = ENDPOINTS.find((e) => e.path === "/papit/verify")!;
    expect(ep.method).toBe("POST");
    expect(ep.responses.map((r) => r.status)).toEqual(["200", "410", "422", "400", "413", "429"]);
    const profile = ENDPOINTS.find((e) => e.path === "/channels/github/profile")!;
    expect(profile.responses.some((r) => r.body?.includes("reconsent_required"))).toBe(true);
    expect(new Set(ENDPOINTS.map((e) => e.id)).size).toBe(ENDPOINTS.length);
  });
  it("the stated numbers match the Worker constants and routes", () => {
    const papit = read("workers/github-channel/lib/papit.js");
    expect(papit).toMatch(/PROFILE_VALIDITY_DAYS = 30;/);
    expect(papit).toMatch(/CONSENT_MAX_DAYS = 90;/);
    expect(papit).toMatch(/expires_at: profileExpiry\(now\)/);
    expect(read("workers/github-channel/lib/reddit-papit.js")).toMatch(/expires_at: profileExpiry\(now\)/);
    expect(read("workers/github-channel/index.js")).toMatch(/'\/papit\/verify' && request\.method === 'POST'/);
    const verify = read("workers/github-channel/lib/verify.js");
    expect(verify).toMatch(/MAX_VERIFY_BYTES = 32 \* 1024/);
    // The rate limit is a Cloudflare zone rule (docs/channels/github.md "Rate limits", #877), so the published numbers are checked against that doc.
    const gh = read("docs/channels/github.md");
    expect(gh).toMatch(/block after 5 requests per 10 seconds per IP and Cloudflare location, for\s+10 seconds/);
    const notes = ENDPOINTS.find((e) => e.path === "/papit/verify")!.notes!.join(" ");
    expect(notes).toMatch(/after about 5 POSTs in 10 seconds/);
    expect(notes).toMatch(/blocks an IP address for 10 seconds/);
    expect(read("workers/github-channel/index.js")).not.toMatch(/ratelimit|RATE_LIMITER|VERIFY_LIMITER/i); // the Worker has no limiter of its own
    for (const code of ["410", "422", "400", "413"]) expect(verify).toContain(code);
  });
});
