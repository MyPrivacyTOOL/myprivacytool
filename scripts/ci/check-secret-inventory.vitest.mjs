// @vitest-environment node
// MPC-10736 (R3): fails CI when Worker code reads a secret name that is in neither that Worker's
// EXPECTED_SECRETS.txt nor SECRETS.md, so the inventory cannot drift silently.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findUndocumented } from "./check-secret-inventory.mjs";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

describe("secret inventory", () => {
  it("every secret name read in Worker code is documented", () => {
    expect(findUndocumented(repo)).toEqual([]);
  });

  it("flags an undocumented name and accepts documented ones", () => {
    const root = mkdtempSync(path.join(tmpdir(), "inv-"));
    mkdirSync(path.join(root, "workers/demo"), { recursive: true });
    writeFileSync(path.join(root, "SECRETS.md"), "`DOCUMENTED_TOKEN`\n");
    writeFileSync(path.join(root, "workers/demo/EXPECTED_SECRETS.txt"), "LISTED_API_KEY\n");
    writeFileSync(
      path.join(root, "workers/demo/index.js"),
      "export default { f(env) { return [env.LISTED_API_KEY, env.DOCUMENTED_TOKEN, env.NEW_SIGNING_SECRET, env.SUPABASE_URL]; } };\n",
    );
    expect(findUndocumented(root)).toEqual([{ worker: "demo", name: "NEW_SIGNING_SECRET" }]);
  });
});
