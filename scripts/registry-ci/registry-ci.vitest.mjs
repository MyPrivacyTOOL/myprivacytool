// @vitest-environment node
// MPC-9884: tests for the scanner itself (layer 1), the allowlist ratchet and the hygiene checks (layer 4). Each rule has a case that must FAIL and one that must PASS.
import { describe, expect, it } from "vitest";
import { applyAllowlist, buildAllowlist, entryAgeDays, formatAllowlist, ownerTask, validateAllowlist } from "./allowlist.mjs";
import { callSiteCheck, dpaCheck, runHygiene, seedCheck } from "./hygiene.mjs";
import { loadNonOutbound, loadRegistry } from "./registry.mjs";
import { scanMarkup, scanScript, urlsIn } from "./static-scan.mjs";

const registry = loadRegistry();
const nonOutbound = loadNonOutbound();
const ts = (rel, code) => scanScript(rel, code, registry, nonOutbound);
const rules = (fs) => fs.map((f) => `${f.rule}:${f.detail}`);

describe("static scan: URL literals", () => {
  it("passes registered hosts, including a wildcard sub-domain", () => {
    expect(ts("src/a.ts", `const a = "https://api.resend.com/emails"; const b = "https://xyz.supabase.co/rest/v1/x"; const c = "wss://stun.l.google.com";`)).toEqual([]);
  });
  it("fails an unregistered https host", () => expect(rules(ts("src/a.ts", `const u = "https://tracker.evil-example.net/p";`))).toEqual(["url-literal:https://tracker.evil-example.net"]));
  it("fails stun: and turn: schemes that are not registered, passes registered stun", () => {
    expect(rules(ts("src/a.ts", `const s = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.other-host.org:3478" }, "turn:relay.bad-host.io"];`)))
      .toEqual(["url-literal:stun://stun.other-host.org", "url-literal:turn://relay.bad-host.io"]);
  });
  it("fails a wss: host", () => expect(rules(ts("src/a.ts", `new Foo("wss://socket.bad-host.io/x")`))).toEqual(["url-literal:wss://socket.bad-host.io"]));
  it("ignores relative URLs, mailto, localhost, template-built hosts and the non-outbound list", () => {
    expect(ts("src/a.ts", "const a = '/api/x'; const b = 'mailto:a@b.co'; const c = 'http://localhost:3000'; const d = `https://${host}/p`; const e = 'http://www.w3.org/2000/svg';")).toEqual([]);
  });
  it("flags the literal part of a template whose host is fixed", () => expect(rules(ts("src/a.ts", "const u = `https://api.unknown-vendor.com/v1/${id}`;"))).toEqual(["url-literal:https://api.unknown-vendor.com"]));
  it("exempts a JSX <a href> (navigation) but not an <img src>", () => {
    expect(rules(ts("src/a.tsx", `const A = () => <div><a href="https://news.example-site.org/x">x</a><img src="https://cdn.bad-host.io/p.png" /></div>;`))).toEqual(["url-literal:https://cdn.bad-host.io"]);
  });
  it("exempts a documentation-link property value but not the same URL in a call", () => {
    expect(ts("shared/a.js", `export const x = { source: "https://docs.vendor-site.com/api" };`)).toEqual([]);
    expect(rules(ts("shared/a.js", `export const x = get("https://docs.vendor-site.com/api");`))).toEqual(["url-literal:https://docs.vendor-site.com"]);
  });
  it("extracts hosts from a string with userinfo and port", () => expect(urlsIn("see https://user:pw@host.example-site.io:8443/p?q=1")).toEqual([{ scheme: "https", host: "host.example-site.io" }]));
});

describe("static scan: forbidden APIs", () => {
  const bad = {
    "fetch()": [`fetch("/x")`, "fetch"], "fetch passed as a value": [`const f = fetch;`, "fetch"], "fetch handed to a function": [`run(fetch)`, "fetch"],
    "fetch with ??": [`const f = opts.fetchImpl ?? fetch;`, "fetch"], "globalThis.fetch": [`globalThis.fetch("/x")`, "fetch"], 'window["fetch"]': [`window["fetch"]("/x")`, "fetch"],
    "new XMLHttpRequest": [`const x = new XMLHttpRequest();`, "XMLHttpRequest"], "new WebSocket": [`new WebSocket("/s")`, "WebSocket"], "new EventSource": [`new EventSource("/s")`, "EventSource"],
    "navigator.sendBeacon": [`navigator.sendBeacon("/b", d)`, "sendBeacon"], "new RTCPeerConnection": [`new RTCPeerConnection({ iceServers: [] })`, "RTCPeerConnection"],
    "webkitRTCPeerConnection": [`const C = window.webkitRTCPeerConnection;`, "RTCPeerConnection"], "importScripts": [`importScripts("a.js")`, "importScripts"],
    "import(http)": [`import("https://cdn.x.io/m.js")`, "import(http)"], "import(computed)": [`import(spec)`, "import(dynamic)"],
  };
  for (const [name, [code, detail]] of Object.entries(bad)) it(`fails ${name}`, () => expect(rules(ts("src/a.ts", code))).toContain(`forbidden-api:${detail}`));

  it("passes a Worker's own fetch handler and method/property NAMED fetch", () => {
    expect(ts("workers/w/index.js", `export default { async fetch(request, env) { return new Response("ok"); } }; class C { fetch() {} } const o = { fetch: 1 }; o.fetch;`)).toEqual([]);
  });
  it("passes a type-only reference and a typeof feature test", () => {
    expect(ts("src/a.ts", `let c: RTCPeerConnection | null = null; const ok = typeof RTCPeerConnection !== "undefined"; interface X { fetch: typeof fetch }`)).toEqual([]);
  });
  it("exempts shared/recipients/outbound.* and nothing else in that folder", () => {
    expect(ts("shared/recipients/outbound.ts", `fetch("https://api.unknown-vendor.com"); new RTCPeerConnection({})`)).toEqual([]);
    expect(ts("shared/recipients/other.ts", `fetch("/x")`).length).toBe(1);
  });
});

describe("static scan: wrapper calls need a literal registry key", () => {
  it("passes a literal key that exists", () => expect(ts("src/a.ts", `await callRecipient("resend", { url: "https://api.resend.com/emails", sent: ["email"] }); createPeerConnection("google-stun", {});`)).toEqual([]));
  it("fails a key that is not in the registry", () => expect(rules(ts("src/a.ts", `callRecipient("no-such-recipient", req)`))).toEqual(['wrapper-key:callRecipient("no-such-recipient")']));
  it("fails a computed key", () => expect(rules(ts("src/a.ts", `callRecipient(key, req); fetchRecipient(\`r-\${n}\`, req)`))).toEqual(["wrapper-key:callRecipient(<non-literal>)", "wrapper-key:fetchRecipient(<non-literal>)"]));
  it("fails a call with no arguments", () => expect(rules(ts("src/a.ts", `loadRecipientScript()`))).toEqual(["wrapper-key:loadRecipientScript(<non-literal>)"]));
});

describe("static scan: HTML and CSS", () => {
  const html = (code) => scanMarkup("public/x/index.html", code, registry, nonOutbound);
  it("flags a third-party stylesheet and script but not an anchor", () => {
    const fs = html(`<link rel="stylesheet" href="https://fonts.bad-host.io/css"><script src="https://cdn.bad-host.io/a.js"></script><a href="https://www.eff.org/x">eff</a>`);
    expect(rules(fs).sort()).toEqual(["url-literal:https://cdn.bad-host.io", "url-literal:https://fonts.bad-host.io"]);
  });
  it("passes Google Fonts only while the registry still lists it (the unregistering is MPC-9886's removal)", () => expect(html(`<link href="https://fonts.googleapis.com/css2?family=Inter">`)).toEqual([]));
  it("scans an inline script for forbidden APIs", () => expect(rules(html(`<p></p>\n<script>\n fetch("/x");\n</script>`))).toEqual(["forbidden-api:fetch"]));
  it("flags a CSS @import and url() on an unregistered host", () => {
    expect(rules(scanMarkup("src/a.css", `@import url("https://fonts.bad-host.io/a.css");\n.x{background:url(https://img.bad-host.io/a.png)}`, registry, nonOutbound))).toEqual(["url-literal:https://fonts.bad-host.io", "url-literal:https://img.bad-host.io"]);
  });
});

describe("allowlist ratchet", () => {
  const f = (over = {}) => ({ rule: "forbidden-api", file: "src/a.ts", line: 3, detail: "fetch", message: "m", ...over });
  const list = (entries) => ({ schema_version: 1, entries });
  const e = (over = {}) => ({ rule: "forbidden-api", file: "src/a.ts", line: 1, detail: "fetch", added: "2026-11-08", note: "pending MPC-9886", ...over });

  it("allows a matching finding regardless of line number", () => expect(applyAllowlist([f({ line: 99 })], list([e()]), "2026-11-09").violations).toEqual([]));
  it("reports a finding with no entry as a violation", () => expect(applyAllowlist([f()], list([]), "2026-11-09").violations.length).toBe(1));
  it("one entry covers one finding: a second identical finding is new", () => expect(applyAllowlist([f(), f({ line: 9 })], list([e()]), "2026-11-09").violations.length).toBe(1));
  it("reports an entry whose call site is gone as stale (the list must shrink)", () => expect(applyAllowlist([], list([e()]), "2026-11-09").stale.length).toBe(1));
  it("reports an entry older than 14 days as expired, and exactly 14 days old as fine", () => {
    expect(applyAllowlist([f()], list([e()]), "2026-11-23").expired.length).toBe(1);
    expect(applyAllowlist([f()], list([e()]), "2026-11-22").expired.length).toBe(0);
    expect(entryAgeDays(e(), "2026-11-22")).toBe(14);
  });
  it("rejects an entry without a pending MPC-9885/9886 note", () => {
    expect(validateAllowlist(list([e({ note: "ok" })])).join()).toMatch(/pending MPC-9885/);
    expect(validateAllowlist(list([e({ added: "yesterday" })])).join()).toMatch(/YYYY-MM-DD/);
    expect(validateAllowlist(list([e()]))).toEqual([]);
  });
  it("assigns the owner task by side: browser = MPC-9886, Workers/Functions/shared = MPC-9885", () => {
    expect(ownerTask({ file: "src/lib/x.ts" })).toBe("MPC-9886");
    expect(ownerTask({ file: "public/footprint/index.html" })).toBe("MPC-9886");
    expect(ownerTask({ file: "workers/mpt-leads/worker.js" })).toBe("MPC-9885");
    expect(ownerTask({ file: "functions/api/x.ts" })).toBe("MPC-9885");
    expect(ownerTask({ file: "shared/support/x.ts" })).toBe("MPC-9885");
  });
  it("a rebuild keeps the original added date, so pruning never resets the 14-day clock", () => {
    const next = buildAllowlist([f()], list([e({ added: "2026-11-01" })]), "2026-11-08");
    expect(next.entries[0].added).toBe("2026-11-01");
    expect(buildAllowlist([f()], list([]), "2026-11-08").entries[0]).toMatchObject({ added: "2026-11-08", note: "pending MPC-9886" });
  });
  it("formats one entry per line", () => expect(formatAllowlist(list([e(), e({ file: "src/b.ts" })])).split("\n").filter((l) => l.includes('"rule"')).length).toBe(2));
});

describe("hygiene", () => {
  it("the real registry passes the seed check and the hash is 64 hex", async () => {
    const r = await seedCheck(registry);
    expect(r.problems).toEqual([]);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.rows).toBe(registry.recipients.length);
  });
  it("seed check fails when a live mirror row carries another hash or is missing", async () => {
    const r = await seedCheck(registry, [{ key: "resend", body: registry.recipients.find((x) => x.key === "resend"), registry_hash: "0".repeat(64) }]);
    expect(r.problems.join("\n")).toMatch(/stale registry_hash on resend/);
    expect(r.problems.join("\n")).toMatch(/missing in table: whoami/);
  });
  it("DPA check lists a dpa_listed recipient the page does not name", () => {
    expect(dpaCheck(registry, "Supabase HubSpot Resend Notion Slack Cloudflare Google Alibaba")).toContain("machine-mirror");
    expect(dpaCheck(registry, "Supabase HubSpot Resend Notion Slack Cloudflare Google Alibaba")).not.toContain("hubspot");
  });
  it("call-site check flags an enabled entry nothing references, and accepts a host literal or a wrapper key", () => {
    expect(callSiteCheck(registry, new Set(), new Set())).toContain("resend");
    expect(callSiteCheck(registry, new Set(["api.resend.com"]), new Set())).not.toContain("resend");
    expect(callSiteCheck(registry, new Set(), new Set(["resend"]))).not.toContain("resend");
  });
  it("hygiene FAILS on an invalid registry and on an allowlist entry older than 14 days; DPA/call-site only warn", async () => {
    const broken = { ...registry, recipients: [...registry.recipients, { ...registry.recipients[0] }] };
    const old = { schema_version: 1, entries: [{ rule: "forbidden-api", file: "src/a.ts", line: 1, detail: "fetch", added: "2026-10-01", note: "pending MPC-9886" }] };
    const bad = await runHygiene({ registry: broken, allowlist: old, today: "2026-11-08", root: process.cwd(), seenHosts: new Set(), seenKeys: new Set() });
    expect(bad.failures.join("\n")).toMatch(/duplicate key/);
    expect(bad.failures.join("\n")).toMatch(/older than 14 days/);
    const ok = await runHygiene({ registry, allowlist: { schema_version: 1, entries: [] }, today: "2026-11-08", root: process.cwd(), seenHosts: new Set(), seenKeys: new Set() });
    expect(ok.failures).toEqual([]);
    expect(ok.warnings.length).toBeGreaterThan(0);
  });
});
