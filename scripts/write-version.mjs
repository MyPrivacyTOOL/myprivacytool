// MPC-7505: writes dist/version.json so the live smoke test can prove WHICH commit is being served.
// Cloudflare Pages exposes the commit as CF_PAGES_COMMIT_SHA; GITHUB_SHA covers CI builds.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || "unknown";
mkdirSync(path.join(ROOT, "dist"), { recursive: true });
writeFileSync(path.join(ROOT, "dist", "version.json"), JSON.stringify({ sha, builtAt: new Date().toISOString() }) + "\n");
console.log(`version.json written (sha ${sha.slice(0, 7)})`);
