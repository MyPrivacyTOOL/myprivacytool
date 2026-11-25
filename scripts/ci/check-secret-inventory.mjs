// MPC-10736 (R3): keep the secrets inventory from drifting. Every secret-looking name a Worker reads as `env.NAME`
// must be listed in that Worker's EXPECTED_SECRETS.txt or documented (in backticks) in SECRETS.md. Names only; no
// values are read. Run: node scripts/ci/check-secret-inventory.mjs   (also enforced by check-secret-inventory.vitest.mjs)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_NAME = /\benv\.([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|SID|PASSWORD|PEPPER|JSON))\b/g;
const SKIP_DIR = new Set(["node_modules", ".wrangler", "coverage", "dist"]);
const NOT_A_WORKER = new Set(["lib", "d1"]); // shared helpers and SQL, not deployed Workers
const isTest = (f) => /\.(test|vitest)\.[cm]?[jt]s$/.test(f) || /\.d\.ts$/.test(f);

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(name) && name !== "test" && name !== "tests") yield* sourceFiles(p);
    } else if (/\.[cm]?[jt]s$/.test(name) && !isTest(name)) yield p;
  }
}

export function findUndocumented(repoRoot) {
  const secretsMd = readFileSync(path.join(repoRoot, "SECRETS.md"), "utf8");
  const documented = new Set([...secretsMd.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]));
  const problems = [];
  const workersDir = path.join(repoRoot, "workers");
  for (const worker of readdirSync(workersDir)) {
    const dir = path.join(workersDir, worker);
    if (!statSync(dir).isDirectory() || NOT_A_WORKER.has(worker)) continue;
    const listFile = path.join(dir, "EXPECTED_SECRETS.txt");
    const expected = new Set(existsSync(listFile) ? readFileSync(listFile, "utf8").split(/\s+/).filter(Boolean) : []);
    const used = new Set();
    for (const f of sourceFiles(dir)) for (const m of readFileSync(f, "utf8").matchAll(SECRET_NAME)) used.add(m[1]);
    for (const name of [...used].sort()) if (!expected.has(name) && !documented.has(name)) problems.push({ worker, name });
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const problems = findUndocumented(root);
  if (problems.length) {
    console.error("Secret names read in Worker code but not in EXPECTED_SECRETS.txt or SECRETS.md:");
    for (const p of problems) console.error(`  ${p.worker}: ${p.name}`);
    process.exit(1);
  }
  console.log("OK: every secret name read in Worker code is in EXPECTED_SECRETS.txt or SECRETS.md");
}
