// MPC-8452 / MPC-8587: the live thank-you on a PHONE, with and without reduced motion. This is the automated version of "run /scan on a real phone",
// because Cloudflare Turnstile blocks every automated browser on the real site. The production build is driven at 375px; its POST /api/scan and
// the polling of GET /api/scan/live are handed to the REAL Worker code (workers/scan-report) running in this test process with an in-memory
// Supabase/Resend/HubSpot behind it and the outside lookups (DNS, Gravatar, Libravatar, RDAP, GitHub) answered by stubs. What it cannot prove:
// that Turnstile lets a real person through, that the real outside services answer, and that an email arrives. Those need a person.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import worker from "../workers/scan-report/index.js";
import { makeLiveLink } from "../workers/scan-report/lib/live.js";

const EMAIL = "e2e-live+mpc8452@example.com";
const ORIGIN = "https://myprivacytool.io";   // the Worker only accepts the production origins
const ENV = {
  SUPABASE_URL: "https://stub.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "stub", RESEND_API_KEY: "stub", RECIPIENT_ALLOWLIST: "",
  UNSUBSCRIBE_SECRET: "e2e-secret", EMAIL_GITHUB_COMMITS_ENABLED: "true",
  EMAIL_DOMAIN_CHECK: "false",   // MPC-8453: the stubbed DNS answers nothing, so the new domain check would refuse the test address; popup-report.spec.ts switches it off the same way
};

type Row = Record<string, unknown>;
function fakeBackends() {
  const tables: Record<string, Row[]> = {};
  const res = (status: number, body?: unknown) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? "" : JSON.stringify(body)), json: async () => body });
  const fetchImpl = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    // outside services behind the email checks
    if (url.includes("cloudflare-dns.com")) return res(200, { Status: 0, Answer: [] });
    if (/gravatar\.com|libravatar\.org|rdap\.org/.test(url)) return res(404);
    if (url.includes("api.github.com/search/commits")) return res(200, { total_count: 2, incomplete_results: false, items: [{ repository: { full_name: "jane-example/dotfiles" } }] });
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/);
    if (!m) return res(200, {});   // Resend, HubSpot...
    const [, table, qs] = m;
    const q = new URLSearchParams(qs ?? "");
    const rows = (tables[table] ??= []);
    if (init.method === "POST") {
      const added = ([] as Row[]).concat(JSON.parse(String(init.body))).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
      rows.push(...added);
      return res(201, added);
    }
    if (init.method === "PATCH") return res(200, rows);
    let found = rows;
    const email = q.get("email")?.replace(/^eq\./, "");
    if (email) found = found.filter((r) => r.email === decodeURIComponent(email));
    const userId = q.get("user_id")?.replace(/^eq\./, "");
    if (userId) found = found.filter((r) => r.user_id === userId);
    const scanId = q.get("scan_id")?.replace(/^eq\./, "");
    if (scanId) found = found.filter((r) => r.scan_id === scanId);
    return res(200, found);
  };
  return { tables, fetchImpl };
}

async function wireWorker(page: Page) {
  const be = fakeBackends();
  const calls: { method: string; path: string; status: number }[] = [];
  await page.route(/mpt-scan-report\.[^/]+\/api\/scan(\/live)?(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fallback();
    const u = new URL(req.url());
    const realFetch = globalThis.fetch;
    const pending: Promise<unknown>[] = [];
    globalThis.fetch = be.fetchImpl as unknown as typeof fetch;
    try {
      const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
      const auth = req.headers()["authorization"];
      if (auth) headers.Authorization = auth;
      const workerReq = new Request(`https://mpt-scan-report.example.workers.dev${u.pathname}${u.search}`, { method: req.method(), headers, body: req.method() === "POST" ? req.postData() ?? "" : undefined });
      const out = await worker.fetch(workerReq, { ...ENV }, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
      await Promise.all(pending);
      const text = await out.text();
      calls.push({ method: req.method(), path: u.pathname, status: out.status });
      return route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: text });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  return { be, calls };
}

async function submit(page: Page) {
  await page.goto("/scan");
  await page.getByLabel("Email address").first().fill(EMAIL);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /check my exposure/i }).first().click();
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const motion of ["no-preference", "reduce"] as const) {
  test.describe(`live thank-you on a 375px phone, motion: ${motion}`, () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, contextOptions: { reducedMotion: motion } });

    test("the thank-you stays, Alice's curtain and the checks appear, nothing shows a value, no sideways scroll", async ({ page }) => {
      const { be, calls } = await wireWorker(page);
      await submit(page);
      // guard: the browser really is in the motion mode this test claims (a silently ignored setting would make the reduced-motion run meaningless)
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(motion === "reduce");
      await expect(page.getByText(/we have your email/i)).toBeVisible();                       // the existing thank-you box is untouched
      const live = page.getByTestId("live-scan");
      await expect(live).toBeVisible();
      await expect(live.getByRole("img", { name: /alice/i })).toBeVisible();                   // her picture, with alt text
      // the six checks arrive (5 email checks plus the GitHub one) and the page says it is done
      await expect(live.getByRole("listitem")).toHaveCount(6, { timeout: 20_000 });
      await expect(live.getByRole("status")).toContainText(/that is what i can see from the outside/i, { timeout: 20_000 });
      // what each check says, in words (colour is never the only clue)
      const text = await live.innerText();
      expect(text).toMatch(/Public code changes\s*Found something/);
      expect(text).toMatch(/Nothing seen in the places we looked|Could not check this one/);
      expect(text).not.toMatch(/%|score/i);                                                    // no score or percentage, ever
      // the first view never shows a value or a repository name
      expect(text).not.toContain("jane-example");
      expect(text).not.toMatch(/at least 2/);
      // the curtain cover: slides off for most people, absent for reduced motion
      const cover = await live.locator('[aria-hidden="true"]').first().evaluate((el) => ({ display: getComputedStyle(el).display }));
      if (motion === "reduce") expect(cover.display).toBe("none");
      else expect(cover.display).not.toBe("none");
      // one polite announcement area for the list
      await expect(live.locator('[aria-live="polite"]')).toHaveCount(1);
      expect(await noSidewaysScroll(page)).toBe(true);
      // the report request really reached the Worker and the live view was served by it
      expect(calls.some((c) => c.method === "POST" && c.path === "/api/scan" && c.status === 200)).toBe(true);
      expect(calls.some((c) => c.method === "GET" && c.path === "/api/scan/live" && c.status === 200)).toBe(true);
      expect(be.tables.signals.filter((s) => String(s.signal_type).startsWith("email-"))).toHaveLength(6);
    });

    test("the email button page proves inbox ownership: details show, still no sideways scroll", async ({ page }) => {
      const { be } = await wireWorker(page);
      await submit(page);
      await expect(page.getByTestId("live-scan").getByRole("listitem")).toHaveCount(6, { timeout: 20_000 });
      const scanId = String(be.tables.scans[0].id);
      const link = await makeLiveLink({ ...ENV }, scanId);
      expect(link).toBeTruthy();
      await page.goto(`/scan/live${new URL(link as string).hash}`);
      const live = page.getByTestId("live-scan");
      await expect(live.getByRole("listitem")).toHaveCount(6, { timeout: 20_000 });
      await expect(live).toContainText(/jane-example\/dotfiles/);                              // the detail is shown only here
      expect(page.url()).not.toContain("#v=");                                                  // the key is removed from the address bar
      expect(await noSidewaysScroll(page)).toBe(true);
    });
  });
}

test("a visitor who leaves loses nothing: with no live token the page still thanks them and shows no live panel", async ({ page }) => {
  await page.route(/mpt-scan-report\.[^/]+\/api\/scan$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ success: true }) })
      : route.fallback());
  await submit(page);
  await expect(page.getByText(/we have your email/i)).toBeVisible();
  await expect(page.getByTestId("live-scan")).toHaveCount(0);
});
