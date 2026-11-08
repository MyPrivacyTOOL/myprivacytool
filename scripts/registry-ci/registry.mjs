// MPC-9884 (Open Tracker design 1.4): shared helpers for the registry CI check. Loads the registry (the one data file) and answers
// "is this host registered?". Host matching is the SAME function the wrapper uses (shared/recipients/registry.ts), imported, not copied.
// Node 22.18+ strips the types of a .ts import natively, so this runs with plain `node` in CI with no build step.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostMatches, validateRegistry } from "../../shared/recipients/registry.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REGISTRY_FILE = join(ROOT, "shared", "recipients", "recipients.json");
export const NON_OUTBOUND_FILE = join(ROOT, "shared", "recipients", "non-outbound.json");
export const ALLOWLIST_FILE = join(ROOT, "shared", "recipients", "ci-allowlist.json");

export const loadJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const loadRegistry = (path = REGISTRY_FILE) => loadJson(path);
export const loadNonOutbound = (path = NON_OUTBOUND_FILE) => loadJson(path);
export { hostMatches, validateRegistry };

/** Every host pattern in the registry, with the entry that owns it. Disabled and planned entries are included: CI RECOGNISES them (design 1.4 layer 2). */
export function hostIndex(registry) {
  const out = [];
  for (const r of registry.recipients) for (const h of r.hosts) out.push({ pattern: h, entry: r });
  return out;
}

/** The registry entries whose hosts match `host`. Empty = unregistered. */
export function entriesForHost(registry, host) {
  return registry.recipients.filter((r) => r.hosts.length && hostMatches(host, r.hosts));
}

export function isNonOutbound(host, nonOutbound) {
  return hostMatches(host, nonOutbound.hosts.map((h) => h.host));
}

/** Hosts we never treat as outbound: loopback, and RFC 2606 / 6761 reserved names that cannot reach a real party. */
export function isLocalHost(host) {
  return host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host) || host === "[::1]" || host === "0.0.0.0" || /\.(test|invalid|example|localhost)$/.test(host);
}

/** Keys of the registry, for the "wrapper call must pass a literal key that exists" rule. */
export const registryKeys = (registry) => new Set(registry.recipients.map((r) => r.key));
