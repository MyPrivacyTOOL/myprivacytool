// MPC-9884 layer 4: registry hygiene (design 1.4). FAILURES block; WARNINGS print as ::warning:: and do not.
//   fail  schema invalid (validateRegistry: unique keys, vocabulary, pre_click only first-party or a named exception, disabled needs a flag or reason)
//   fail  registry hash does not reproduce: the Supabase seed is generated from the file, so the rows must all carry the file's hash and parse back to it
//   fail  an allowlist entry is older than 14 days (the list must shrink; see allowlist.mjs)
//   warn  an allowlist entry is 10 or more days old (MPC-10621: a heads-up before it fails)
//   FAIL  a dpa_listed entry is missing from the generated DPA list (MPC-9894: the DPA is generated from the registry)
//   warn  an enabled entry has no call site the scan can find (a host literal or a wrapper call with its key)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, registryHash } from "../../shared/recipients/canonical.js";
import { buildRows, diffMirror, moduleInSync, toSql } from "../sync-recipients.mjs";
import { MAX_AGE_DAYS, entryAgeDays, validateAllowlist } from "./allowlist.mjs";
const EXPIRY_WARN_DAYS = 4;
import { hostMatches, validateRegistry } from "./registry.mjs";

const norm = (s) => s.toLowerCase();

export function dpaCheck(registry, dpaText) {
  const text = norm(dpaText);
  return registry.recipients.filter((r) => r.dpa_listed && r.enabled).filter((r) => {
    const words = [r.name.split(/[\s(/]/)[0], r.key.split("-")[0]].map(norm).filter((w) => w.length > 2);
    return !words.some((w) => text.includes(w));
  }).map((r) => r.key);
}

export function callSiteCheck(registry, seenHosts, seenKeys) {
  return registry.recipients.filter((r) => r.enabled && r.host_kind !== "user_supplied").filter((r) => {
    if (seenKeys.has(r.key)) return false;
    return ![...seenHosts].some((h) => hostMatches(h, r.hosts));
  }).map((r) => r.key);
}

/** Does the Supabase seed reproduce from the file? Offline (CI has no credentials); the live table compare is the nightly sync workflow. */
export async function seedCheck(registry, liveRows = null) {
  const problems = [];
  const hash = await registryHash(registry);
  if (!/^[0-9a-f]{64}$/.test(hash)) problems.push("registry hash is not 64 hex chars");
  const { hash: h2, rows } = await buildRows(registry, new Date(0));
  if (h2 !== hash) problems.push("buildRows hash differs from registryHash");
  if (rows.length !== registry.recipients.length) problems.push(`seed has ${rows.length} rows for ${registry.recipients.length} entries`);
  for (const r of rows) {
    if (r.registry_hash !== hash) problems.push(`seed row ${r.key} carries a different hash`);
    if (!toSql(r).includes(canonicalJson(r.body).replace(/'/g, "''"))) problems.push(`seed SQL for ${r.key} does not embed its canonical body`);
  }
  try {
    if (!moduleInSync(registry, readFileSync(join(import.meta.dirname, "..", "..", "shared", "recipients", "recipients.data.js"), "utf8"))) problems.push("shared/recipients/recipients.data.js is out of date: run `npm run recipients:module`");
  } catch { problems.push("shared/recipients/recipients.data.js is missing: run `npm run recipients:module`"); }
  if (liveRows) problems.push(...(await diffMirror(registry, liveRows)));
  return { hash, rows: rows.length, problems };
}

export async function runHygiene({ registry, allowlist, today, root, seenHosts, seenKeys, liveRows = null }) {
  const failures = [];
  const warnings = [];
  failures.push(...validateRegistry(registry).map((e) => `registry: ${e}`));
  failures.push(...validateAllowlist(allowlist).map((e) => `allowlist: ${e}`));
  const seed = await seedCheck(registry, liveRows);
  failures.push(...seed.problems.map((e) => `seed: ${e}`));
  for (const e of allowlist.entries ?? []) {
    const age = entryAgeDays(e, today);
    if (age > MAX_AGE_DAYS) failures.push(`allowlist entry older than ${MAX_AGE_DAYS} days (${age}d, added ${e.added}): ${e.rule} ${e.file} ${e.detail} (${e.note})`);
    // MPC-10621: a heads-up before the calendar expiry turns every PR red (it did on 2026-11-22). Warns from day 10; still fails only after day 14.
    else if (age >= MAX_AGE_DAYS - EXPIRY_WARN_DAYS) warnings.push(`allowlist entry expires in ${MAX_AGE_DAYS - age + 1} day(s) (${age}d old, added ${e.added}): ${e.rule} ${e.file} ${e.detail} (${e.note})`);
  }
  // MPC-9894: the DPA sub-processor list is generated (scripts/render-privacy-from-registry.mjs), so a dpa_listed entry missing from it is a stale file, not a copy gap.
  try {
    const listed = new Set(JSON.parse(readFileSync(join(root, "src", "data", "legalBlocks.generated.json"), "utf8")).blocks.en.dpa.sub_processors.map((x) => x.key));
    for (const r of registry.recipients) {
      if (r.dpa_listed && r.party !== "first" && r.enabled && !r.until && !r.planned && !listed.has(r.key)) failures.push(`legal blocks: dpa_listed recipient "${r.key}" is not in src/data/legalBlocks.generated.json: run node scripts/render-privacy-from-registry.mjs`);
    }
  } catch { failures.push("src/data/legalBlocks.generated.json is missing: run node scripts/render-privacy-from-registry.mjs"); }
  for (const k of callSiteCheck(registry, seenHosts, seenKeys)) warnings.push(`enabled recipient "${k}" has no call site the static scan can find (host literal or wrapper call)`);
  return { failures, warnings, seed };
}
