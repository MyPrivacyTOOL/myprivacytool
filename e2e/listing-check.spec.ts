// MPC-9813 (F1, Chris Decision 7): the whole path through the production build and the REAL Worker code, with a SYNTHETIC identity and a SYNTHETIC listing page.
//   /scan (the page that requests a scan; /start is a HubSpot-only waitlist form that never reaches the Worker) -> optional "page that lists you" fields
//   -> confirmation email is the click-to-confirm -> nothing is sent or read before the click -> the click -> the page is read -> "Listings you showed us" on screen
//   -> the report email carries the same block.
// Nothing leaves the machine: the Worker's own outbound calls are answered here, including the listing page (served from e2e/fixtures-data). No real person's listing is fetched.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import worker, { runReportJob } from "../workers/scan-report/index.js";
import { makeLiveLink } from "../workers/scan-report/lib/live.js";
import { fake } from "../workers/scan-report/test-support/fake-backend.mjs";

const ORIGIN = "https://myprivacytool.io";
const EMAIL = "zelda.quillfeather+mpc9813@example.test";
// A Spokeo-shaped address so the result maps to the Spokeo guide. The Worker's fetch is intercepted below: the request never leaves this process and Spokeo is never contacted.
const FIXTURE_URL = "https://www.spokeo.com/Zelda-Quillfeather/Texas/Austin/p0000000000-synthetic";
const FIXTURE_HTML = readFileSync(new URL("./fixtures-data/listing-page-synthetic.html", import.meta.url), "utf8");
const ENV = {
  EMAIL_DOMAIN_CHECK: "false", SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "stub", RESEND_API_KEY: "stub", HIBP_API_KEY: "p", HIBP_MIN_INTERVAL_MS: "0",
  RECIPIENT_ALLOWLIST: "", UNSUBSCRIBE_SECRET: "e2e-secret", WEB_SCAN_SAVE_ENABLED: "true", EMAIL_CONFIRM_GATE_ENABLED: "true", LISTING_CHECK_ENABLED: "true",
  ALLOW_PARTIAL_REPORT: "true",   // as in production (wrangler.toml): HIBP is switched off in the registry since MPC-9885, so breaches read "not checked" and the report still goes out
};

function backend() {
  const F = fake();
  const fixtureReads: string[] = [];
  const fetchImpl = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (url === FIXTURE_URL) {
      fixtureReads.push(url);
      return { status: 200, headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) }, body: null, text: async () => FIXTURE_HTML };
    }
    return F.f(url, init as never);
  };
  return { F, fixtureReads, fetchImpl };
}

async function wireWorker(page: Page) {
  const be = backend();
  await page.route(/mpt-scan-report\.[^/]+\/api\/scan(\/live|\/confirm)?(\?.*)?$/, async (route) => {
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
      return route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: await out.text() });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  return be;
}

test("F1: nothing is read before the click; after it, the pasted page is verified and shown with its evidence and guide", async ({ page }) => {
  const be = await wireWorker(page);
  // a finished scan held by this browser, as after the home-page scan: it is what the "save my scan" box and the listing fields hang off
  await page.addInitScript(() => sessionStorage.setItem("mpt_pending_scan", JSON.stringify([{ id: "ip", label: "IP address", value: "203.0.113.9" }])));
  await page.goto("/scan");
  await page.getByLabel("Email address").first().fill(EMAIL);

  // the fields are optional, say why they are asked, and promise nothing is searched
  const details = page.getByTestId("listing-fields").first();
  await details.locator("summary").click();
  await expect(details).toContainText(/we check only pages you show us/i);
  await expect(details).toContainText(/do not search broker sites for you/i);
  await details.getByLabel(/your full name/i).fill("Zelda Quillfeather");
  await details.getByLabel(/city and region/i).fill("Austin, TX");
  await details.getByLabel(/^country/i).fill("us");
  await details.getByLabel(/address of a page that lists you/i).fill(FIXTURE_URL);

  // typed details without the save box are refused in plain words (they live with the saved scan)
  const checks = page.getByRole("checkbox");
  await checks.first().check();
  await page.getByRole("button", { name: /check my exposure/i }).first().click();
  await expect(page.getByRole("alert")).toContainText(/tick .save my scan/i);
  expect(be.F.db.scans).toHaveLength(0);

  await checks.nth(1).check();   // "save my scan"
  await page.getByRole("button", { name: /check my exposure/i }).first().click();
  await expect(page.getByRole("status").first()).toContainText(/we have your email/i);

  // the scan waits for the click: marked, details stored with the saved scan, NOTHING read, NO report
  const scan = be.F.db.scans[0];
  expect(scan.email_confirm_required).toBe(true);
  expect(scan.email_confirmed_at).toBeUndefined();
  expect(be.F.db.web_scan_listing_checks).toHaveLength(1);
  expect(be.F.db.web_scan_listing_checks[0].web_scan_id).toBe(be.F.db.web_scans[0].id);
  const confirmMail = JSON.parse(be.F.calls.find((c: { url: string }) => c.url.includes("resend"))!.body);
  expect(confirmMail.text).toContain("We only check details you’ve confirmed are yours.");
  const live = page.getByTestId("live-scan");
  await expect(live).toBeVisible();
  await expect(live.getByTestId("confirm-note")).toContainText(/only check details you've confirmed are yours/i);
  // MPC-9814: the /scan on-screen result already carries the broker section: all nine shortlist brokers, each Not checked, none read yet
  const early = live.getByTestId("broker-panel");
  await expect(early).toBeVisible({ timeout: 20_000 });
  await expect(early.locator("li")).toHaveCount(9);
  await expect(early.locator("li[data-state='not_checked']")).toHaveCount(9);
  await expect(early).toContainText("We don't search broker sites for you. Paste a page that lists you, or paid coverage (coming) will check for you.");
  await expect(early.locator("li[data-broker='spokeo'] a[href='/opt-out-guides/spokeo']")).toBeVisible();
  await runReportJob({ ...ENV }, be.fetchImpl);
  expect(be.F.db.scans[0].report_status).toBe("pending");
  expect(be.fixtureReads).toHaveLength(0);

  // the email button: a page with a confirm button, not a silent GET
  const link = await makeLiveLink({ ...ENV }, String(scan.id));
  await page.goto(`/scan/live${new URL(link as string).hash}`);
  const box = page.getByTestId("confirm-box");
  await expect(box).toBeVisible({ timeout: 20_000 });
  await expect(box).toContainText(/only check details you've confirmed are yours/i);
  expect(be.fixtureReads).toHaveLength(0);                       // opening the link read nothing
  await box.getByRole("button", { name: /yes, this is my email/i }).click();

  // after the click: the page is read once and the polished broker section shows it: state, match level, confidence word + bar, evidence, guide
  const block = page.getByTestId("broker-panel");
  await expect(block).toBeVisible({ timeout: 30_000 });
  const spokeo = block.locator("li[data-broker='spokeo']");
  await expect(spokeo).toHaveAttribute("data-state", "listed", { timeout: 30_000 });
  await expect(spokeo).toContainText(/We found a listing that matches what you told us \(an exact match/);
  await expect(spokeo.getByTestId("confidence")).toContainText("Confidence: High");
  await expect(spokeo.locator("[data-testid='confidence'] span span.bg-foreground")).toHaveCount(3);
  await expect(spokeo.getByRole("link", { name: "Evidence: the page" })).toHaveAttribute("href", FIXTURE_URL);
  await expect(spokeo.getByRole("link", { name: /how to remove it/i })).toHaveAttribute("href", "/opt-out-guides/spokeo");
  await expect(block.locator("li")).toHaveCount(9);                                   // still all nine, registry order
  await expect(block.locator("li[data-state='not_checked']")).toHaveCount(8);          // the other eight stay honest
  await expect(block.getByTestId("broker-region-note")).toContainText(/Hong Kong and Singapore/);
  expect(be.fixtureReads).toEqual([FIXTURE_URL]);

  // the report now goes out and carries the same block
  await runReportJob({ ...ENV }, be.fetchImpl);
  expect(be.F.db.scans[0].report_status).toBe("sent");
  const report = JSON.parse(be.F.calls.filter((c: { url: string }) => c.url.includes("resend")).pop()!.body);
  expect(report.text).toContain("BROKER SITES");
  expect(report.text).toMatch(/Spokeo \(US\): LISTED\n {2}We found a listing that matches what you told us/);
  expect(report.text).toContain("Confidence: High");
  expect(report.text).toContain(FIXTURE_URL);
  expect(report.text.match(/How to remove it:/g)).toHaveLength(9);                  // all nine guides, pasted or not
  expect(report.html).toContain("Broker sites");
  expect(Buffer.byteLength(report.html)).toBeLessThan(100_000);                     // the 100 KB rule
  expect(be.fixtureReads).toHaveLength(1);                       // the report reused the stored result
  // the stored result holds result fields only, not the page and not the name
  // (the evidence address is the visitor's own pasted URL and may carry the name; everything else must be free of page text)
  const stored = (be.F.db.web_scan_listing_checks[0].results as { evidence_url?: string }[]).map((r) => ({ ...r, evidence_url: undefined }));
  expect(JSON.stringify(stored)).not.toMatch(/Quillfeather|Austin|78701|555/);
});

test("/start states the honest sentence with its In build marker", async ({ page }) => {
  await page.goto("/start");
  const intro = page.locator("p", { hasText: /We don't search broker sites for you yet/ }).first();
  await expect(intro).toContainText("paste any page that lists you and we'll verify it. Paid plans will add coverage.");
  // the marker follows src/config/featureStatus.ts: shown while F1 is in build, gone once it is live
  const live = readFileSync(new URL("../src/config/featureStatus.ts", import.meta.url), "utf8").includes('F1: "live"');
  await expect(intro.locator("[data-feature='F1'][data-feature-status='in_build']")).toHaveCount(live ? 0 : 1);
  await expect(page.getByText(/No data broker search is included yet/)).toHaveCount(0);
});

test("/ai-access-check: the broker section says what runs, marks paid coverage Planned and links the nine guides", async ({ page }) => {
  await page.goto("/ai-access-check");
  const sec = page.getByTestId("ai-check-brokers");
  await expect(sec).toContainText(/We do not search any broker site for you/);
  await expect(sec.locator("[data-feature-status='planned']")).toHaveText("Planned");
  await expect(page.getByTestId("ai-check-broker-guides").locator("a")).toHaveCount(9);
  await expect(page.getByTestId("ai-check-broker-guides").locator("a").first()).toHaveAttribute("href", "/opt-out-guides/spokeo");
});
