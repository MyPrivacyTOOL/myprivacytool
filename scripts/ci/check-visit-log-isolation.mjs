// MPC-9889 (Open Tracker design 3.1, rule 3): the visit log is kept apart from every scan, account and lead by privilege and by lint.
// Fails when anything other than the visit-log module and its purge job names the visit_log schema. Run in CI (ci.yml) and by `npm run check:visit-log`.
//
// Allowed to name the schema:
//   functions/_visit-log.*                      the module (and its test)
//   supabase/migrations/*visit_log*.sql         the schema, the policy and the purge job
//   supabase/tests/visit-log.test.sql           the database test
//   this script and its test
// Everything else in code (src, functions, workers, shared, scripts, supabase, e2e, .github) fails. Prose in docs/ is not code and is not scanned.
// The match is the whole word `visit_log`: the public RPC names (mpt_visit_log_record ...) and the registry key (visit-log) are different words.
// The converse rule, that no visit_log object reads schema public, is asserted against the real function bodies in supabase/tests/visit-log.test.sql.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCAN_DIRS = ["src", "functions", "workers", "shared", "scripts", "supabase", "e2e", "e2e-live", "e2e-registry", "tests", "tools", ".github"];
export const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|sh|json|ya?ml|toml)$/i;
export const SKIP_DIR = /(^|\/)(node_modules|dist|\.git|\.wrangler)(\/|$)/;
export const PATTERN = /\bvisit_log\b/;

export const ALLOWED = [
  /^functions\/_visit-log\.[a-z.]+$/,
  /^supabase\/migrations\/[^/]*visit_log[^/]*\.sql$/,
  /^supabase\/tests\/visit-log\.test\.sql$/,
  /^scripts\/ci\/check-visit-log-isolation(\.[a-z]+)*\.mjs$/,
];

export const isAllowed = (rel) => ALLOWED.some((re) => re.test(rel));

function* walk(root, rel = "") {
  const abs = path.join(root, rel);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_DIR.test(r)) continue;
    if (e.isDirectory()) yield* walk(root, r);
    else if (SCAN_EXT.test(e.name)) yield r;
  }
}

/** Returns [{file, line, text}] for every reference outside the allowed files. */
export function findViolations(root) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(root, dir)) {
      if (isAllowed(rel)) continue;
      const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
      lines.forEach((text, i) => { if (PATTERN.test(text)) out.push({ file: rel, line: i + 1, text: text.trim().slice(0, 160) }); });
    }
  }
  return out;
}

export function main(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), log = console.log) {
  const v = findViolations(root);
  if (v.length === 0) { log("visit-log isolation: OK (no reference to the visit_log schema outside the module and the purge job)"); return 0; }
  for (const x of v) log(`::error file=${x.file},line=${x.line}::visit_log may only be named by functions/_visit-log.ts and the purge job migration (MPC-9889): ${x.text}`);
  log(`visit-log isolation: FAIL, ${v.length} reference(s) outside the module`);
  return 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.exit(main());
