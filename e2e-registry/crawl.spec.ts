// MPC-9884 layer 2 (design 1.4): the built-site crawl. Serves dist/ (vite preview), visits EVERY sitemap route as a cold visitor (pre-click), then performs
// the scan action with a stub consent (post-click) and records every request host. A patched RTCPeerConnection records iceServers, which is how the
// 2026-11-08 trace missed STUN. All external requests are aborted (hermetic, nothing leaves the runner) but still recorded first.
// Fails on: an unregistered host, a non-first-party host pre-click (Turnstile exception excepted), contact with an enabled:false host. Existing findings are in
// shared/recipients/ci-allowlist.json (rule crawl-*), which MPC-9886 empties. Output: test-results/registry-crawl.json.
//
// "Scan me": the consent gate (MPC-9888) does not exist yet, so the post-click action today is the scan form (/scan, /start): fill the email, tick every
// consent box, press submit. When MPC-9888 lands, CRAWL_CLICK_SELECTOR points at the real button; the stub consent is the localStorage record below.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { applyAllowlist } from "../scripts/registry-ci/allowlist.mjs";
import { classifyAll, iceObservations, routesFromSitemap } from "../scripts/registry-ci/crawl-core.mjs";
import { ALLOWLIST_FILE, loadJson, loadNonOutbound, loadRegistry } from "../scripts/registry-ci/registry.mjs";

const registry = loadRegistry();
const nonOutbound = loadNonOutbound();
const POST_CLICK_ROUTES = (process.env.CRAWL_POST_CLICK_ROUTES ?? "/,/scan,/start").split(",");
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 6);
const LIMIT = Number(process.env.CRAWL_LIMIT ?? 0);
// Routes where the app runs its own on-load work (device scan, STUN, Turnstile): given time to finish so a delayed call is not missed.
const DEEP_ROUTES = new Set((process.env.CRAWL_DEEP_ROUTES ?? "/,/scan,/start,/footprint,/pricing,/contact,/newsletter,/privacy").split(","));
// MPC-9888: the real consent button on the home page.
const CLICK_SELECTOR = process.env.CRAWL_CLICK_SELECTOR ?? '[data-testid="scan-me"]';
// Pages where NOTHING third-party may run before the click, the Turnstile exception included (it loads at the click here).
const ZERO_THIRD_PARTY_PRECLICK = ["/", "/scan"];

type Obs = { phase: "pre_click" | "post_click"; host: string; url?: string; route?: string; kind?: "request" | "ice"; scheme?: string };

const RTC_PATCH = `(() => {
  window.__mptIce = [];
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
    const Real = window[name];
    if (!Real) continue;
    const Patched = function (config, ...rest) { try { window.__mptIce.push(...((config && config.iceServers) || [])); } catch (e) {} return new Real(config, ...rest); };
    Patched.prototype = Real.prototype;
    Object.setPrototypeOf(Patched, Real);
    window[name] = Patched;
  }
})();`;

async function newRecordingContext(browser: import("@playwright/test").Browser, obs: Obs[], phase: () => "pre_click" | "post_click", route: () => string, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(RTC_PATCH);
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const req = r.request();
    let host = "";
    try { host = new URL(req.url()).hostname; } catch { /* ignore */ }
    obs.push({ phase: phase(), host, url: req.url(), route: route(), kind: "request" });
    return r.abort("blockedbyclient");
  });
  return context;
}

async function collectIce(page: Page, obs: Obs[], phase: "pre_click" | "post_click", route: string) {
  const ice = await page.evaluate(() => (window as unknown as { __mptIce?: unknown[] }).__mptIce ?? []).catch(() => []);
  obs.push(...(iceObservations(ice as { urls?: string | string[] }[], { phase, route, url: "iceServers" }) as Obs[]));
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it); }));
}

test("every sitemap route pre-click, then the scan action post-click, contacts only registered hosts", async ({ browser, baseURL }) => {
  test.setTimeout(20 * 60_000);
  const sitemap = readFileSync("dist/sitemap.xml", "utf8");
  let routes = routesFromSitemap(sitemap);
  if (LIMIT > 0) routes = routes.slice(0, LIMIT);
  expect(routes.length, "dist/sitemap.xml has routes").toBeGreaterThan(10);
  const obs: Obs[] = [];
  const log: string[] = [];

  // ---- pre-click: a cold visitor, no stored consent, nothing pressed ----
  const queue = [...routes];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    let current = "";
    const ctx: BrowserContext = await newRecordingContext(browser, obs, () => "pre_click", () => current, baseURL!);
    const page = await ctx.newPage();
    for (let r = queue.shift(); r !== undefined; r = queue.shift()) {
      current = r;
      await page.goto(r, { waitUntil: "load", timeout: 30_000 }).catch((e) => log.push(`pre_click ${r}: ${String(e.message).split("\n")[0]}`));
      await page.waitForTimeout(DEEP_ROUTES.has(r.replace(/(.)\/$/, "$1")) ? 4000 : 300);
      await collectIce(page, obs, "pre_click", r);
    }
    await ctx.close();
  }));

  // ---- post-click: stub consent, then the scan action ----
  let current = "";
  const ctx = await newRecordingContext(browser, obs, () => "post_click", () => current, baseURL!);
  await ctx.addInitScript(() => {
    try { localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: true, at: "2026-01-01T00:00:00.000Z" })); } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  for (const r of POST_CLICK_ROUTES) {
    current = r;
    await page.goto(r, { waitUntil: "load", timeout: 30_000 }).catch((e) => log.push(`post_click ${r}: ${String(e.message).split("\n")[0]}`));
    let action = "none (page scans on load)";
    const email = page.locator('input[type="email"]').first();
    await email.waitFor({ timeout: 4000 }).catch(() => {});
    if (await email.count()) {
      await email.fill("crawl-check@example.com").catch(() => {});
      for (const box of await page.locator('input[type="checkbox"], [role="checkbox"]').all()) await box.check({ force: true, timeout: 1000 }).catch(() => box.click({ force: true, timeout: 1000 }).catch(() => {}));
      const button = page.locator('form button[type="submit"]').first();
      if (await button.count()) { await button.click({ force: true, timeout: 3000 }).catch(() => {}); action = "clicked form submit"; }
    } else if (CLICK_SELECTOR && (await page.locator(CLICK_SELECTOR).count())) {
      await page.locator(CLICK_SELECTOR).first().click({ force: true, timeout: 3000 }).catch(() => {}); action = `clicked ${CLICK_SELECTOR}`;
    }
    await page.waitForTimeout(2500);
    await collectIce(page, obs, "post_click", r);
    log.push(`post_click ${r}: ${action}`);
  }
  await ctx.close();

  const findings = classifyAll(obs, registry, nonOutbound);
  const hosts = [...new Set(obs.map((o) => `${o.phase}:${o.kind === "ice" ? `${o.scheme}:` : ""}${o.host}`))].sort();
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/registry-crawl.json", JSON.stringify({ routes: routes.length, postClickRoutes: POST_CLICK_ROUTES, log, hosts, findings }, null, 2));
  console.log(`[crawl] ${routes.length} routes pre-click, ${POST_CLICK_ROUTES.length} post-click; ${hosts.length} (phase,host) pairs; ${findings.length} findings`);
  for (const l of log) console.log(`[crawl] ${l}`);

  let allow = { schema_version: 1, entries: [] as unknown[] };
  try { allow = loadJson(ALLOWLIST_FILE); } catch { /* none */ }
  const crawlList = { ...allow, entries: (allow.entries as { rule: string }[]).filter((e) => e.rule.startsWith("crawl-")) };
  const today = new Date().toISOString().slice(0, 10);
  const r = applyAllowlist(findings, crawlList as never, today);
  // MPC-9888 (5): zero non-first-party hosts before the click on the scan pages. Turnstile (a registered pre_click exception elsewhere) must not appear here.
  const firstPartyKeys = new Set(registry.recipients.filter((r: { party: string }) => r.party === "first").map((r: { key: string }) => r.key));
  const thirdPartyPre = obs.filter((o) => o.phase === "pre_click" && ZERO_THIRD_PARTY_PRECLICK.includes((o.route ?? "").replace(/(.)\/$/, "$1")) && o.host && !/^(127\.0\.0\.1|localhost)$/.test(o.host)
    && !registry.recipients.some((r: { key: string; hosts: string[] }) => firstPartyKeys.has(r.key) && r.hosts.some((h) => h === o.host)));
  const zeroProblems = thirdPartyPre.map((o) => `PRE-CLICK third-party host on ${o.route}: ${o.kind === "ice" ? `${o.scheme}:` : ""}${o.host}`);
  const problems = [
    ...zeroProblems,
    ...r.violations.map((f: { message: string }) => `NEW: ${f.message}`),
    ...r.stale.map((e: { rule: string; detail: string; note: string }) => `STALE allowlist entry (no longer contacted), delete it: ${e.rule} ${e.detail} (${e.note})`),
  ];
  expect(problems, problems.join("\n")).toEqual([]);
});
