// MPC-9884 layer 4: registry hygiene (design 1.4). FAILURES block; WARNINGS print as ::warning:: and do not.
//   fail  schema invalid (validateRegistry: unique keys, vocabulary, pre_click only first-party or a named exception, disabled needs a flag or reason)
//   fail  registry hash does not reproduce: the Supabase seed is generated from the file, so the rows must all carry the file's hash and parse back to it
//   fail  an allowlist entry is older than 14 days (the list must shrink; see allowlist.mjs)
//   warn  DPA.tsx does not list a dpa_listed entry (warning until the copy task MPC-9894 lands)
//   warn  an enabled entry has no call site the scan can find (a host literal or a wrapper call with its key)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, registryHash } from "../../shared/recipients/canonical.js";
import { buildRows, diffMirror, toSql } from "../sync-recipients.mjs";
import { MAX_AGE_DAYS, entryAgeDays, validateAllowlist } from "./allowlist.mjs";
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
  }
  let dpaText = "";
  try { dpaText = readFileSync(join(root, "src", "pages", "DPA.tsx"), "utf8"); } catch { failures.push("src/pages/DPA.tsx is missing"); }
  for (const k of dpaCheck(registry, dpaText)) warnings.push(`DPA.tsx does not list dpa_listed recipient "${k}" (warning until MPC-9894)`);
  for (const k of callSiteCheck(registry, seenHosts, seenKeys)) warnings.push(`enabled recipient "${k}" has no call site the static scan can find (host literal or wrapper call)`);
  return { failures, warnings, seed };
}
