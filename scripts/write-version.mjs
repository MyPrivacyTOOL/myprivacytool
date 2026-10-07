// Writes dist/version.json at build time (npm "postbuild") so a deploy can be matched to a commit (MPC-7505).
// Cloudflare Pages exposes the commit as CF_PAGES_COMMIT_SHA; GitHub Actions builds use GITHUB_SHA.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveSha(env = process.env, git = () => execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()) {
  const fromEnv = env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA;
  if (fromEnv) return fromEnv.trim();
  try { return git(); } catch { return "unknown"; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, "dist", "version.json");
  mkdirSync(path.dirname(out), { recursive: true });
  const body = { sha: resolveSha(), builtAt: new Date().toISOString() };
  writeFileSync(out, JSON.stringify(body) + "\n");
  console.log(`version.json: ${body.sha}`);
}
