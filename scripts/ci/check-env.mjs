#!/usr/bin/env node
// MPC-7300: pre-deployment configuration checks, run by the deploy workflows BEFORE anything ships.
//
//   node scripts/ci/check-env.mjs --require CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID --worker workers/mpt-leads
//
// --require   comma-separated env var names that must be set and non-blank (GitHub secrets are mapped to
//             env by the workflow; the VALUES are never printed, only the names).
// --worker    a Worker directory: wrangler.toml must exist, declare `name` and `main`, contain no REPLACE_*
//             placeholders, and EXPECTED_SECRETS.txt (if present) must be a list of UPPER_SNAKE names only.
// Exits 1 with one `::error::` line per problem (GitHub annotation format).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkRequiredEnv(names, env = process.env) {
  return names
    .filter((n) => !String(env[n] ?? "").trim())
    .map((n) => `required environment variable / secret ${n} is not set`);
}

export function checkWorkerDir(dir, readFile = (p) => readFileSync(p, "utf8"), exists = existsSync) {
  const problems = [];
  const toml = path.join(dir, "wrangler.toml");
  if (!exists(toml)) return [`${toml} not found`];
  const text = readFile(toml);
  if (/REPLACE_/.test(text)) problems.push(`${toml} still contains REPLACE_* placeholders`);
  if (!/^name\s*=\s*"[^"]+"/m.test(text)) problems.push(`${toml} has no name`);
  if (!/^main\s*=\s*"[^"]+"/m.test(text)) problems.push(`${toml} has no main entry`);
  const main = /^main\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  if (main && !exists(path.join(dir, main))) problems.push(`${toml} main "${main}" does not exist`);

  const secrets = path.join(dir, "EXPECTED_SECRETS.txt");
  if (exists(secrets)) {
    for (const [i, raw] of readFile(secrets).split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (line && !/^[A-Z][A-Z0-9_]*$/.test(line)) problems.push(`${secrets}:${i + 1} is not a bare secret NAME (never put values here)`);
    }
  }
  return problems;
}

export function parseArgs(argv) {
  const out = { require: [], workers: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--require") out.require.push(...String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (argv[i] === "--worker") out.workers.push(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

export function run(argv, env = process.env) {
  const { require: req, workers } = parseArgs(argv);
  return [...checkRequiredEnv(req, env), ...workers.flatMap((w) => checkWorkerDir(w))];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let problems;
  try { problems = run(process.argv.slice(2)); } catch (e) { problems = [e.message]; }
  for (const p of problems) console.log(`::error::${p}`);
  if (problems.length) process.exit(1);
  console.log("OK: pre-deployment checks passed");
}
