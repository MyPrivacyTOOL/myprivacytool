// MPC-9889: the isolation check finds a reference in any code file outside the module and the purge job, and passes on the real repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findViolations, isAllowed, main } from "./check-visit-log-isolation.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
function tmpRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-iso-"));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  return root;
}

describe("visit-log isolation", () => {
  it("the real repo is clean", () => {
    expect(findViolations(repoRoot)).toEqual([]);
    expect(main(repoRoot, () => {})).toBe(0);
  });
  it("allows the module, its migration, its database test", () => {
    for (const ok of ["functions/_visit-log.ts", "functions/_visit-log.vitest.ts", "supabase/migrations/20261108160000_mpc_9889_visit_log.sql", "supabase/tests/visit-log.test.sql"]) expect(isAllowed(ok), ok).toBe(true);
    for (const no of ["functions/_middleware.ts", "supabase/migrations/20261108999999_other.sql", "workers/mpt-leads/worker.js", "shared/edge-capture/capture.ts"]) expect(isAllowed(no), no).toBe(false);
  });
  it("fails on a Worker, a view, a migration, a test SQL file and a workflow that name the schema", () => {
    const root = tmpRepo({
      "workers/mpt-leads/worker.js": "const t = 'visit_log.visits';\n",
      "supabase/migrations/20261109000000_join.sql": "create view public.v as select * from visit_log.visits v join public.scans s on true;\n",
      "supabase/sql/x.sql": "select 1 from visit_log.country_policy;\n",
      "src/lib/a.ts": "// ok\nconst q = `select * from visit_log.visits`;\n",
      ".github/workflows/x.yml": "run: psql -c 'select 1 from visit_log.visits'\n",
      "functions/_visit-log.ts": "const allowed = 'mpt_visit_log_record'; // visit_log schema is private here\n",
    });
    const v = findViolations(root);
    expect(v.map((x) => x.file).sort()).toEqual([".github/workflows/x.yml", "src/lib/a.ts", "supabase/migrations/20261109000000_join.sql", "supabase/sql/x.sql", "workers/mpt-leads/worker.js"]);
    expect(v.find((x) => x.file === "src/lib/a.ts")?.line).toBe(2);
    expect(main(root, () => {})).toBe(1);
  });
  it("does not trip on the public RPC names or the registry key, which are different words", () => {
    const root = tmpRepo({ "shared/a.ts": "const k = 'visit-log'; const f = 'mpt_visit_log_record'; const g = 'mpt_visit_log_policy';\n" });
    expect(findViolations(root)).toEqual([]);
  });
});
