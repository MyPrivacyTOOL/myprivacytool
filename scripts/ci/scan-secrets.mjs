#!/usr/bin/env node
// MPT (MyPrivacyTOOL) local secret scan (MPT-1004). Scans git-tracked + untracked-not-ignored files for
// hardcoded credentials. Prints file:line and the pattern name only, never the matched value.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = {
  "private key block": /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  "AWS access key": /\bAKIA[0-9A-Z]{16}\b/,
  "GitHub token": /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  "Slack token": /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  "Twilio SID": /\bAC[0-9a-f]{32}\b/,
  "API-style secret (sk-...)": /\bsk-[A-Za-z0-9_-]{20,}\b/,
  "JWT": /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  "named secret assignment": /\b(?:SUPABASE_KEY|QWEN_API_KEY|TWILIO_AUTH_TOKEN|TWILIO_SID|META_APP_SECRET)\s*[=:]\s*["']?(?!your-|<|\$|["']|\s|$)[A-Za-z0-9_\-./+]{16,}/,
};

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !/(^|\/)(package-lock\.json|bun\.lockb)$|\.(png|jpe?g|gif|webp|ico|woff2?|pdf|svg)$/i.test(f) && f !== "scripts/ci/scan-secrets.mjs");

// GitHub's public docs example token, used as a fake fixture in a test (not a real credential).
const ALLOW = [/gho_16C7e42F292c6912E7710c838347Ae178B4a/];

let hits = 0;
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    if (ALLOW.some((a) => a.test(line))) return;
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (re.test(line)) { console.log(`${f}:${i + 1}: possible ${name}`); hits++; }
    }
  });
}
console.log(hits ? `FAIL: ${hits} possible secret(s)` : `OK: scanned ${files.length} files, no hardcoded secrets found`);
process.exit(hits ? 1 : 0);
