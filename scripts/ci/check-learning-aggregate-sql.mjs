// MPC-9892 (Open Tracker design 4.5, proof 3): lint for the anonymised learning aggregate.
// Fails when any SQL file writes public.learning_aggregate_daily in a way that could hold a per-scan row:
//   - every INSERT into the table must be a `values (...)` insert (never `insert ... select`, which copies rows from a scan table), and
//   - it must carry `on conflict (day, dimension, key) do update set n = <alias or table>.n + ...`, i.e. it can only ever add to a counter, and
//   - the only function allowed to contain such an INSERT is mpt_learning_count (the single door) or a test file under supabase/tests.
// Also fails when the table gains a column other than day, dimension, key, n, or when a per-scan identifier is named in a statement touching it.
// Run in CI (ci.yml) and by `node scripts/ci/check-learning-aggregate-sql.mjs`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SQL_DIRS = ["supabase/migrations", "supabase/proposed", "supabase/sql", "supabase/backfill", "scripts"];
const TABLE = /learning_aggregate_daily/;
const FORBIDDEN_COLUMN = /\b(scan_id|web_scan_id|scan_number|email|email_hash|ip|ip_address|user_agent|person_key|fingerprint|uuid|session_id)\b/i;

function* walk(root, rel) {
  const abs = path.join(root, rel);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (/node_modules|\.git$/.test(r)) continue;
    if (e.isDirectory()) yield* walk(root, r);
    else if (/\.sql$/i.test(e.name)) yield r;
  }
}

/** Splits SQL into statements on ';' outside dollar-quoted bodies and strips -- comments. A statement inside a $$ body is checked as part of that body. */
export function statements(sql) {
  const noComments = sql.replace(/--[^\n]*/g, "");
  const out = [];
  let cur = "", tag = null;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(noComments.slice(i));
      if (m) { if (tag === null) tag = m[0]; else if (tag === m[0]) tag = null; cur += m[0]; i += m[0].length - 1; continue; }
    }
    if (ch === ";" && tag === null) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Violations in one SQL text. `isTest` files may create rows to prove the table rejects them, so INSERTs are not policed there (the schema test pins the columns). */
export function lintSql(rel, sql, isTest = false) {
  const bad = [];
  for (const st of statements(sql)) {
    if (!TABLE.test(st)) continue;
    const flat = st.replace(/\s+/g, " ").trim();
    // inserts, wherever they sit (top level or inside a function body)
    for (const m of flat.matchAll(/insert into (?:public\.)?learning_aggregate_daily\b(.*?)(?=insert into |$)/gi)) {
      if (isTest) continue;
      const body = m[1];
      if (/\bselect\b/i.test(body.split(/\bon conflict\b/i)[0])) bad.push(`${rel}: INSERT ... SELECT into learning_aggregate_daily (a per-scan row could be copied in): ${flat.slice(0, 120)}`);
      if (!/\bvalues\s*\(/i.test(body)) bad.push(`${rel}: INSERT into learning_aggregate_daily without a VALUES list: ${flat.slice(0, 120)}`);
      if (!/\bon conflict \(\s*day\s*,\s*dimension\s*,\s*key\s*\) do update set n\s*=\s*[a-z_.]*\bn\s*\+/i.test(body)) bad.push(`${rel}: INSERT into learning_aggregate_daily is not "ON CONFLICT (day, dimension, key) DO UPDATE SET n = ... n + ...": ${flat.slice(0, 120)}`);
      if (!isTest && !/mpt_learning_count/i.test(flat)) bad.push(`${rel}: only mpt_learning_count may insert into learning_aggregate_daily: ${flat.slice(0, 120)}`);
      if (FORBIDDEN_COLUMN.test(body.split(/\bvalues\b/i)[0] ?? "")) bad.push(`${rel}: INSERT column list names a per-scan identifier: ${flat.slice(0, 120)}`);
    }
    // the table definition and any later ALTER
    if (/create table (?:if not exists )?(?:public\.)?learning_aggregate_daily\b/i.test(flat)) {
      const cols = [...flat.replace(/^[^(]*\(/, "").split(/,(?![^()]*\))/)].map((c) => c.trim().split(" ")[0].toLowerCase()).filter((c) => c && !/^(primary|check|constraint|unique|foreign)$/.test(c));
      const want = ["day", "dimension", "key", "n"];
      if (JSON.stringify(cols) !== JSON.stringify(want)) bad.push(`${rel}: learning_aggregate_daily columns are [${cols.join(", ")}], must be exactly [${want.join(", ")}]`);
    }
    if (/alter table (?:only )?(?:public\.)?learning_aggregate_daily\b.*\badd (?:column\b)?/i.test(flat)) bad.push(`${rel}: ALTER TABLE ... ADD COLUMN on learning_aggregate_daily (the column list is fixed)`);
  }
  return bad;
}

export function findViolations(root) {
  const bad = [];
  for (const dir of SQL_DIRS) for (const rel of walk(root, dir)) bad.push(...lintSql(rel, fs.readFileSync(path.join(root, rel), "utf8")));
  for (const rel of walk(root, "supabase/tests")) bad.push(...lintSql(rel, fs.readFileSync(path.join(root, rel), "utf8"), true));
  return bad;
}

export function main(root = process.cwd(), log = console.error) {
  const bad = findViolations(root);
  if (bad.length) { for (const b of bad) log(`::error::${b}`); return 1; }
  console.log("learning aggregate SQL lint: OK");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
