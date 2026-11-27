#!/usr/bin/env node
// MPC-9883: mirrors shared/recipients/recipients.json into public.recipients_registry (key, body, registry_hash, synced_at).
// The FILE is the source of truth; the table is a mirror so scan_recipient_log.recipient_key can take a foreign key to it and the app can read
// the live list. Entries are never deleted from the table (history renders from `until`), so a removed key stays and shows as drift in --check.
//
//   node scripts/sync-recipients.mjs              upsert every entry (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//   node scripts/sync-recipients.mjs --check      compare table to file, exit 1 on drift (the nightly drift check)
//   node scripts/sync-recipients.mjs --hash       print the registry_hash of the file and exit
//   node scripts/sync-recipients.mjs --emit-module regenerate shared/recipients/recipients.data.js (the bundler-safe copy the wrapper imports)
//   node scripts/sync-recipients.mjs --emit-sql   print one INSERT .. ON CONFLICT statement per entry (for the Supabase connector, small statements)
//
// Runs on merge to main and nightly from .github/workflows/sync-recipients.yml. Never prints a key or any secret.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalJson, registryHash } from "../shared/recipients/canonical.js";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "recipients", "recipients.json");
const TABLE = "recipients_registry";

const MODULE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "recipients", "recipients.data.js");
/** The registry as an ES module. Workers are bundled by wrangler 3.x (esbuild without JSON import attributes) and plain Node 22 needs the attribute, so the wrapper imports THIS file;
 *  recipients.json stays the single edited source and `npm run recipients:module` regenerates it. CI (registry hygiene) fails when they differ. */
export function moduleText(file) {
  return `// GENERATED from shared/recipients/recipients.json by scripts/sync-recipients.mjs --emit-module. DO NOT EDIT: edit the JSON, then run \`npm run recipients:module\`.\nexport default ${JSON.stringify(file, null, 2)};\n`;
}
export const moduleInSync = (file, current) => current === moduleText(file);

export function loadFile(path = FILE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function buildRows(file, now = new Date()) {
  const hash = await registryHash(file);
  return { hash, rows: file.recipients.map((r) => ({ key: r.key, body: r, registry_hash: hash, synced_at: now.toISOString() })) };
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
export function toSql(row) {
  return `insert into public.${TABLE} (key, body, registry_hash, synced_at) values (${q(row.key)}, ${q(canonicalJson(row.body))}::jsonb, ${q(row.registry_hash)}, now()) ` +
    `on conflict (key) do update set body = excluded.body, registry_hash = excluded.registry_hash, synced_at = excluded.synced_at;`;
}

/** Pure drift comparison: table rows vs file. Returns a list of problems (empty = in sync). */
export async function diffMirror(file, tableRows) {
  const hash = await registryHash(file);
  const problems = [];
  const byKey = new Map(tableRows.map((r) => [r.key, r]));
  for (const entry of file.recipients) {
    const row = byKey.get(entry.key);
    if (!row) { problems.push(`missing in table: ${entry.key}`); continue; }
    if (row.registry_hash !== hash) problems.push(`stale registry_hash on ${entry.key}`);
    if (canonicalJson(row.body) !== canonicalJson(entry)) problems.push(`body differs: ${entry.key}`);
  }
  const fileKeys = new Set(file.recipients.map((r) => r.key));
  for (const k of byKey.keys()) if (!fileKeys.has(k)) problems.push(`in table but not in file (entries are never deleted): ${k}`);
  return problems;
}

async function rest(path, init) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const res = await fetch(`${base.replace(/\/$/, "")}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`Supabase ${init?.method ?? "GET"} ${path.split("?")[0]} -> HTTP ${res.status}`);
  return res;
}

async function main(argv) {
  const file = loadFile();
  const { hash, rows } = await buildRows(file);
  if (argv.includes("--hash")) { console.log(hash); return 0; }
  if (argv.includes("--emit-module")) { writeFileSync(MODULE_FILE, moduleText(file)); console.log(`wrote ${MODULE_FILE}`); return 0; }
  if (argv.includes("--emit-sql")) { for (const r of rows) console.log(toSql(r)); return 0; }
  if (argv.includes("--check")) {
    const tableRows = await (await rest(`${TABLE}?select=key,body,registry_hash&limit=1000`)).json();
    const problems = await diffMirror(file, tableRows);
    if (problems.length) { console.error(`recipients mirror DRIFT (file hash ${hash}):\n- ${problems.join("\n- ")}`); return 1; }
    console.log(`recipients mirror in sync: ${rows.length} entries, registry_hash ${hash}`);
    return 0;
  }
  await rest(`${TABLE}?on_conflict=key`, { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  console.log(`synced ${rows.length} recipients, registry_hash ${hash}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`sync-recipients failed: ${e.message}`); process.exit(2); });
}
