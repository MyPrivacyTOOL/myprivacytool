// MPC-9884 layer 2, the pure half: turns what the Playwright crawl OBSERVED (request hosts, WebRTC iceServers) into findings.
// The browser half is e2e-registry/crawl.spec.ts. Kept apart so the rules are unit-tested without a browser.
//   crawl-unregistered-host     a host contacted that is in no registry entry (any phase)
//   crawl-preclick-third-party  a registered host contacted BEFORE the click whose entries are not pre_click (first party or a named exception)
//   crawl-disabled-host         a host contacted whose every registry entry is enabled:false
//   crawl-after-until           a host contacted on or after the `until` date of every entry that owns it (MPC-9886: the self-hosted-fonts guard)
// ICE servers are observed as `stun:host` / `turn:host`; they go through the same three rules (this is how the 2026-11-08 trace missed STUN).
import { entriesForHost, isLocalHost, isNonOutbound } from "./registry.mjs";

export const CRAWL_FILE = "(crawl)";

/** @param {{phase: "pre_click"|"post_click", host: string, url?: string, route?: string, kind?: "request"|"ice"}} o */
export function classifyObservation(o, registry, nonOutbound, today = new Date().toISOString().slice(0, 10)) {
  const host = o.host.toLowerCase();
  if (!host || isLocalHost(host) || isNonOutbound(host, nonOutbound)) return null;
  const label = o.kind === "ice" ? `${o.scheme ?? "stun"}:${host}` : host;
  const where = `${o.phase} on ${o.route ?? "?"}${o.url ? ` (${o.url.slice(0, 120)})` : ""}`;
  const owners = entriesForHost(registry, host);
  if (!owners.length) return { rule: "crawl-unregistered-host", file: CRAWL_FILE, line: 0, detail: label, message: `${label} contacted ${where} is not in the registry` };
  if (owners.every((r) => !r.enabled)) return { rule: "crawl-disabled-host", file: CRAWL_FILE, line: 0, detail: label, message: `${label} contacted ${where}, but its recipient (${owners.map((r) => r.key).join(", ")}) is enabled:false` };
  if (owners.every((r) => r.until && r.until <= today)) return { rule: "crawl-after-until", file: CRAWL_FILE, line: 0, detail: label, message: `${label} contacted ${where}, but its recipient (${owners.map((r) => `${r.key} until ${r.until}`).join(", ")}) has ended` };
  if (o.phase === "pre_click" && !owners.some((r) => r.enabled && r.phase === "pre_click")) {
    return { rule: "crawl-preclick-third-party", file: CRAWL_FILE, line: 0, detail: label, message: `${label} (${owners.map((r) => r.key).join(", ")}) contacted before the click ${where}; only first-party or a named exception may run pre-click` };
  }
  return null;
}

/** One finding per (rule, detail): the first observation wins. Deterministic order. */
export function classifyAll(observations, registry, nonOutbound, today) {
  const seen = new Map();
  for (const o of observations) {
    const f = classifyObservation(o, registry, nonOutbound, today);
    if (f && !seen.has(`${f.rule}|${f.detail}`)) seen.set(`${f.rule}|${f.detail}`, f);
  }
  return [...seen.values()].sort((a, b) => a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail));
}

/** ICE server URL list from a recorded RTCConfiguration.iceServers into observations. */
export function iceObservations(iceServers, base) {
  const out = [];
  for (const s of iceServers ?? []) {
    for (const u of [].concat(s?.urls ?? [])) {
      const m = /^(stuns?|turns?):([^:/?]+)/i.exec(String(u));
      if (m) out.push({ ...base, kind: "ice", scheme: m[1].toLowerCase(), host: m[2] });
    }
  }
  return out;
}

/** Routes from sitemap.xml text, as paths. */
export function routesFromSitemap(xml) {
  const paths = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => { try { return new URL(m[1]).pathname || "/"; } catch { return null; } }).filter(Boolean);
  return [...new Set(paths)].sort();
}
