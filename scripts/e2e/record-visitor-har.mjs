// MPC-8538: records the REAL visitor-lookup responses from production into HAR files for e2e replay.
//
//   node scripts/e2e/record-visitor-har.mjs            # record from https://www.myprivacytool.io
//   SITE=https://preview.example.pages.dev node ...    # record from a preview deploy
//
// Read-only by construction: the browser only loads the home page; every non-GET request is aborted before it
// leaves the machine, so no lead, subscriber, scan report or analytics hit is created.
// Privacy: the recording machine's IP is replaced with a documentation address (RFC 5737), and the hk-geo
// entry is rewritten to the local `vite preview` origin the e2e suite runs on.
//
// Output (commit both):
//   e2e/hars/visitor-recorded.har  - exactly what production returned (IP scrubbed)
//   e2e/hars/visitor-hk.har        - same shape, Hong Kong values (CI runners are never in HK, so this is derived)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.SITE ?? "https://www.myprivacytool.io").replace(/\/+$/, "");
const WORKER = (process.env.WORKER ?? "https://api.myprivacytool.io").replace(/\/+$/, "");
const LOCAL = process.env.LOCAL_ORIGIN ?? "http://127.0.0.1:4173";
const OUT = path.resolve("e2e/hars");
const DOC_IP = "203.0.113.10";
const raw = path.join(OUT, ".raw.har");

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const context = await browser.newContext({
  recordHar: { path: raw, content: "embed", mode: "minimal", urlFilter: /\/whoami(\?|$)|\/api\/hk-geo(\?|$)/ },
});
await context.route("**/*", (route) => (["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.fallback() : route.abort()));
const page = await context.newPage();
const seen = new Set();
page.on("response", (r) => { if (/\/whoami|\/api\/hk-geo/.test(r.url())) seen.add(new URL(r.url()).pathname); });
// whoami fires after first paint of the scan; hk-geo on HK-aware pages. Read each body so the HAR embeds it.
const whoami = page.waitForResponse((r) => r.url().startsWith(`${WORKER}/whoami`), { timeout: 30_000 });
await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
await (await whoami).body();
const geo = page.waitForResponse((r) => r.url().includes("/api/hk-geo"), { timeout: 30_000 });
await page.goto(`${SITE}/HongKongSpam`, { waitUntil: "domcontentloaded" });
await (await geo.catch(() => null))?.body();
await page.waitForTimeout(500);
await context.close();
await browser.close();

const har = JSON.parse(fs.readFileSync(raw, "utf8"));
fs.unlinkSync(raw);
const keep = [];
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.pathname === "/api/hk-geo") e.request.url = `${LOCAL}/api/hk-geo`;
  else if (u.pathname !== "/whoami") continue;
  if (keep.some((k) => k.request.url === e.request.url)) continue; // one entry per endpoint
  const c = e.response.content;
  if (typeof c.text !== "string") continue; // body not captured (request superseded); a later entry will have it
  if (c.encoding === "base64") { c.text = Buffer.from(c.text, "base64").toString("utf8"); delete c.encoding; }
  if (u.pathname === "/whoami") c.text = JSON.stringify({ ...JSON.parse(c.text), ip: DOC_IP });
  c.size = Buffer.byteLength(c.text);
  e.request.headers = e.request.headers.filter((h) => !/cookie|authorization/i.test(h.name));
  // Body is stored decoded, so drop transfer headers. CORS is pinned to www.myprivacytool.io in production; the
  // replay runs on the local preview origin, so the allow-origin is re-pointed there (the live drift check in
  // e2e-live/ asserts the real production value separately).
  e.response.headers = e.response.headers
    .filter((h) => !/^(set-cookie|cf-ray|report-to|nel|content-encoding|content-length|alt-svc|date)$/i.test(h.name))
    .map((h) => (/^access-control-allow-origin$/i.test(h.name) ? { ...h, value: LOCAL } : h));
  delete e._securityDetails; e.serverIPAddress = "";
  keep.push(e);
}
const paths = keep.map((e) => new URL(e.request.url).pathname);
if (!paths.includes("/whoami")) throw new Error(`whoami was not captured (saw: ${[...seen].join(", ") || "nothing"})`);
har.log.entries = keep;
har.log.pages = [];
fs.writeFileSync(path.join(OUT, "visitor-recorded.har"), JSON.stringify(har, null, 2) + "\n");

const hk = structuredClone(har);
for (const e of hk.log.entries) {
  const c = e.response.content;
  const body = JSON.parse(c.text);
  if (e.request.url.endsWith("/whoami")) Object.assign(body, { ip: "203.0.113.20", city: "Kwai Chung", region: "Kwai Tsing", country_name: "Hong Kong", latitude: 22.3567, longitude: 114.1286, org: "Hong Kong Broadband Network" });
  else body.country = "HK";
  c.text = JSON.stringify(body); c.size = Buffer.byteLength(c.text);
}
if (!hk.log.entries.some((e) => e.request.url.endsWith("/api/hk-geo"))) {
  const tpl = structuredClone(hk.log.entries[0]);
  tpl.request.url = `${LOCAL}/api/hk-geo`;
  tpl.response.content.text = JSON.stringify({ country: "HK" }); tpl.response.content.size = 16;
  hk.log.entries.push(tpl);
}
fs.writeFileSync(path.join(OUT, "visitor-hk.har"), JSON.stringify(hk, null, 2) + "\n");
console.log(`recorded ${paths.join(", ")} from ${SITE} -> e2e/hars/visitor-recorded.har, visitor-hk.har`);
