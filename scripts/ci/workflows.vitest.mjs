// @vitest-environment node
// MPC-7300: guards for the CI/CD pipeline itself. If someone edits a workflow and breaks a safety property
// (merge gate, pre-deploy check, post-deploy smoke test, rollback coverage) this fails in CI.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { DEFAULTS, targets } from "./smoke-test.mjs";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const wfDir = path.join(repo, ".github/workflows");
const load = (f) => parse(readFileSync(path.join(wfDir, f), "utf8"));
const raw = (f) => readFileSync(path.join(wfDir, f), "utf8");
const steps = (wf, job) => wf.jobs[job].steps;
const runs = (wf, job) => steps(wf, job).map((s) => `${s.run ?? ""}${s.with?.command ?? ""}`);
const idx = (arr, re) => arr.findIndex((x) => re.test(x));

describe("every workflow is valid YAML with triggers and jobs", () => {
  for (const f of readdirSync(wfDir).filter((x) => x.endsWith(".yml"))) {
    it(f, () => {
      const wf = load(f);
      expect(wf.name).toBeTruthy();
      expect(wf.on).toBeTruthy();
      expect(Object.keys(wf.jobs).length).toBeGreaterThan(0);
      expect(raw(f)).not.toMatch(/\t/);
    });
  }
});

describe("ci.yml (merge blocking)", () => {
  const wf = load("ci.yml");
  it("runs on every pull request and on pushes to main", () => {
    expect(wf.on).toHaveProperty("pull_request");
    expect(wf.on.pull_request).toBeNull(); // no path/branch filter: a PR can never skip CI
    expect(wf.on.push.branches).toContain("main");
  });
  it("has a CI gate that needs every other job and runs even when they fail", () => {
    const gate = wf.jobs["ci-gate"];
    expect(gate.name).toBe("CI gate");
    expect(gate.if).toBe("always()");
    expect([...gate.needs].sort()).toEqual(Object.keys(wf.jobs).filter((j) => j !== "ci-gate").sort());
  });
  it("covers unit+coverage, db integration, e2e, build and lint", () => {
    const all = Object.keys(wf.jobs).flatMap((j) => runs(wf, j)).join("\n");
    for (const needle of ["test:coverage", "test:workers:node", "supabase/tests/run.sh", "test:e2e", "npm run build", "tsc -p tsconfig.app.json", "lint:tests"]) {
      expect(all).toContain(needle);
    }
  });
  it("never uses repository secrets (fork PRs must be able to run it)", () => {
    expect(raw("ci.yml")).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
  });
  it("e2e depends on build and the db job uses a disposable Postgres service", () => {
    expect(wf.jobs.e2e.needs).toBe("build");
    expect(wf.jobs.db.services.postgres.image).toMatch(/^postgres:/);
  });
});

describe("deploy workflows: pre-deploy checks, smoke test, rollback", () => {
  const DEPLOYS = { "deploy-mpt-leads.yml": "mpt-leads", "deploy-oauth-poc.yml": "oauth-poc" };
  for (const [file, worker] of Object.entries(DEPLOYS)) {
    describe(file, () => {
      const wf = load(file);
      const all = runs(wf, "deploy");
      it("runs check-env before the Deploy step", () => {
        const check = idx(all, /scripts\/ci\/check-env\.mjs/);
        const deploy = steps(wf, "deploy").findIndex((s) => s.name === "Deploy");
        expect(check).toBeGreaterThanOrEqual(0);
        expect(check).toBeLessThan(deploy);
        expect(all[check]).toContain(`--worker workers/${worker}`);
        expect(all[check]).toMatch(/CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID/);
      });
      it("smoke-tests the live Worker after Deploy", () => {
        const deploy = steps(wf, "deploy").findIndex((s) => s.name === "Deploy");
        const smoke = idx(all, new RegExp(`smoke-test\\.mjs ${worker}`));
        expect(smoke).toBeGreaterThan(deploy);
      });
      it("rolls back only when the smoke test failed, then re-checks", () => {
        const s = steps(wf, "deploy");
        const smokeStep = s.find((x) => x.id === "smoke");
        expect(smokeStep).toBeTruthy();
        const rollback = s.find((x) => /rollback --yes/.test(x.with?.command ?? ""));
        expect(rollback.if).toContain("steps.smoke.outcome == 'failure'");
        expect(rollback.with.workingDirectory).toBe(`workers/${worker}`);
        expect(s.indexOf(rollback)).toBeGreaterThan(s.indexOf(smokeStep));
      });
      it("keeps the secret-names-survive-deploy verification", () => {
        expect(all.join("\n")).toContain("EXPECTED_SECRETS.txt");
      });
    });
  }
  it("scan-report runs the pre-deploy check too", () => {
    expect(runs(load("deploy-scan-report.yml"), "deploy").join("\n")).toContain("check-env.mjs --require CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID --worker workers/scan-report");
  });
});

describe("rollback.yml", () => {
  const wf = load("rollback.yml");
  it("offers every Worker that has a deploy workflow", () => {
    const options = wf.on.workflow_dispatch.inputs.worker.options;
    const deployed = readdirSync(wfDir).filter((f) => /^deploy-(mpt-leads|oauth-poc|scan-report)\.yml$/.test(f)).map((f) => f.replace(/^deploy-|\.yml$/g, ""));
    expect(options.sort()).toEqual(deployed.sort());
    for (const w of options) expect(existsSync(path.join(repo, "workers", w, "wrangler.toml")), w).toBe(true);
  });
  it("defaults to a dry run and drills weekly on a schedule", () => {
    expect(wf.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
    expect(wf.on.schedule[0].cron).toMatch(/\* \* 1$/);
    expect(raw("rollback.yml")).toContain("github.event_name == 'schedule' || github.event.inputs.dry_run == 'true'");
  });
  it("only rolls back for real when not a dry run, and verifies secrets + smoke afterwards", () => {
    const s = wf.jobs.rollback.steps;
    expect(s.find((x) => /rollback/.test(x.with?.command ?? "") && !/list/.test(x.with.command)).if).toBe("env.DRY_RUN != 'true'");
    expect(s.some((x) => /secret names changed across rollback/.test(x.run ?? ""))).toBe(true);
    expect(s.some((x) => /smoke-test\.mjs/.test(x.run ?? ""))).toBe(true);
  });
});

describe("smoke-site.yml", () => {
  const wf = load("smoke-site.yml");
  it("covers every smoke target on push, schedule and demand", () => {
    expect(wf.jobs.smoke.strategy.matrix.target.sort()).toEqual(Object.keys(targets).sort());
    expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(["push", "schedule", "workflow_dispatch"]));
  });
  it("targets production hostnames", () => {
    expect(DEFAULTS.site).toBe("https://www.myprivacytool.io");
    expect(DEFAULTS["mpt-leads"]).toMatch(/^https:\/\/mpt-leads\./);
  });
});

describe("documentation", () => {
  it("docs/ci-cd-testing.md documents the rollback for every deployable component", () => {
    const doc = readFileSync(path.join(repo, "docs/ci-cd-testing.md"), "utf8");
    for (const needle of ["Rollback Worker", "mpt-leads", "oauth-poc", "scan-report", "Cloudflare Pages", "Supabase", "CI gate", "dry_run"]) {
      expect(doc, needle).toContain(needle);
    }
  });
});
