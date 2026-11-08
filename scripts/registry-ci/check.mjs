#!/usr/bin/env node
// MPC-9884: registry CI check. Layers 1 (static scan) and 4 (hygiene). Layer 2 is e2e-registry/crawl.spec.ts, layer 3 is shared/recipients/fetch-spy.ts.
//   node scripts/registry-ci/check.mjs                 run static scan + hygiene against the allowlist; exit 1 on any failure
//   node scripts/registry-ci/check.mjs static          layer 1 only
//   node scripts/registry-ci/check.mjs hygiene         layer 4 only
//   node scripts/registry-ci/check.mjs --report        print every finding (the first-run map) as markdown, exit 0
//   node scripts/registry-ci/check.mjs --update-allowlist   rewrite the allowlist from current findings: can ADD (first seed) with --seed, otherwise only shrinks
//   --today YYYY-MM-DD   override the date (tests)
import { readFileSync, writeFileSync } from "node:fs";
import { ALLOWLIST_FILE, ROOT, loadJson, loadNonOutbound, loadRegistry } from "./registry.mjs";
import { applyAllowlist, buildAllowlist, formatAllowlist } from "./allowlist.mjs";
import { runHygiene } from "./hygiene.mjs";
import { scanRepo } from "./static-scan.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const todayArg = args.indexOf("--today");
const today = todayArg >= 0 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);
const mode = args.find((a) => !a.startsWith("--") && a !== args[todayArg + 1]) ?? "all";

const registry = loadRegistry();
const nonOutbound = loadNonOutbound();
let allowlist = { schema_version: 1, entries: [] };
try { allowlist = loadJson(ALLOWLIST_FILE); } catch { /* no allowlist yet */ }

const scan = scanRepo(ROOT, registry, nonOutbound);
const gh = (level, msg) => console.log(process.env.GITHUB_ACTIONS ? `::${level}::${msg.replace(/\n/g, "%0A")}` : `${level.toUpperCase()}: ${msg}`);
let failed = false;

if (flag("--report")) {
  const by = {};
  for (const f of scan.findings) (by[f.rule] ??= []).push(f);
  console.log(`# Static scan: ${scan.findings.length} findings in ${scan.filesScanned} files\n`);
  for (const [rule, fs] of Object.entries(by)) { console.log(`## ${rule} (${fs.length})`); for (const f of fs) console.log(`- ${f.file}:${f.line}  ${f.detail}`); console.log(""); }
  process.exit(0);
}

if (flag("--seed-crawl")) {
  // Merge the crawl's findings (written by e2e-registry/crawl.spec.ts) into the allowlist. Only for the initial seed.
  const crawl = loadJson(args[args.indexOf("--seed-crawl") + 1]).findings;
  const kept = (allowlist.entries ?? []).filter((e) => !e.rule.startsWith("crawl-"));
  const next = buildAllowlist(crawl, { entries: (allowlist.entries ?? []).filter((e) => e.rule.startsWith("crawl-")) }, today);
  writeFileSync(ALLOWLIST_FILE, formatAllowlist({ schema_version: 1, entries: [...kept, ...next.entries] }));
  console.log(`allowlist: ${kept.length} static + ${next.entries.length} crawl entries`);
  process.exit(0);
}

if (flag("--update-allowlist")) {
  const next = buildAllowlist(scan.findings, { entries: (allowlist.entries ?? []).filter((e) => !e.rule.startsWith("crawl-")) }, today);
  next.entries.push(...(allowlist.entries ?? []).filter((e) => e.rule.startsWith("crawl-")));
  if (!flag("--seed") && next.entries.length > allowlist.entries.length) { console.error(`refusing to GROW the allowlist (${allowlist.entries.length} -> ${next.entries.length}); fix the new violations, or pass --seed once for the initial file`); process.exit(1); }
  writeFileSync(ALLOWLIST_FILE, formatAllowlist(next));
  console.log(`allowlist written: ${next.entries.length} entries (was ${allowlist.entries.length})`);
  process.exit(0);
}

const isCrawl = (e) => e.rule.startsWith("crawl-");
const staticList = { ...allowlist, entries: (allowlist.entries ?? []).filter((e) => !isCrawl(e)) };

if (mode === "all" || mode === "static") {
  const r = applyAllowlist(scan.findings, staticList, today);
  console.log(`[static] scanned ${scan.filesScanned} files: ${scan.findings.length} findings, ${r.allowed.length} allowlisted, ${r.violations.length} new, ${r.stale.length} stale allowlist entries`);
  for (const f of r.violations) { gh("error", `${f.file}:${f.line} [${f.rule}] ${f.message}. Register the recipient in shared/recipients/recipients.json and go through the wrapper (shared/recipients/outbound.ts).`); failed = true; }
  for (const e of r.stale) { gh("error", `allowlist entry no longer matches any finding, delete it: ${e.rule} ${e.file} ${e.detail} (${e.note})`); failed = true; }
  for (const p of r.problems) { gh("error", `allowlist: ${p}`); failed = true; }
}

if (mode === "all" || mode === "hygiene") {
  const h = await runHygiene({ registry, allowlist, today, root: ROOT, seenHosts: scan.seenHosts, seenKeys: scan.seenKeys });
  console.log(`[hygiene] registry_hash ${h.seed.hash} (${h.seed.rows} seed rows), ${h.failures.length} failures, ${h.warnings.length} warnings`);
  for (const m of h.failures) { gh("error", m); failed = true; }
  for (const m of h.warnings) gh("warning", m);
}

process.exit(failed ? 1 : 0);
