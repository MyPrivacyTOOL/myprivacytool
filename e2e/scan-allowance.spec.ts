// MPC-9818: a Free address's SECOND scan in a month is declined with an honest upgrade message, in a real browser. The production build is driven on /scan; its
// POST /api/scan goes to the REAL Worker code (workers/scan-report/index.js) with SCAN_ALLOWANCE_ENABLED on, in this test process, with the shared in-memory backend behind it
// (it applies the same allowance rules as the SQL; the SQL is proved in supabase/tests/mpc-9818-entitlements.test.sql). SYNTHETIC address (example.com) only.
import { test, expect } from "./fixtures";
import worker from "../workers/scan-report/index.js";
import { fake } from "../workers/scan-report/test-support/fake-backend.mjs";

const EMAIL = "e2e-allowance+mpc9818@example.com";
const ORIGIN = "https://myprivacytool.io";   // the Worker only accepts the production origins
const ENV = { SUPABASE_URL: "https://stub.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "stub", RESEND_API_KEY: "stub", RECIPIENT_ALLOWLIST: "", EMAIL_DOMAIN_CHECK: "false", SCAN_ALLOWANCE_ENABLED: "true" };

test.describe("scan allowance (Free: 1 a month)", () => {
  async function wireWorker(page: import("@playwright/test").Page) {
    const F = fake();
    const seen: { status: number; body: Record<string, unknown> | null }[] = [];
    await page.route(/mpt-scan-report\.[^/]+\/api\/scan$/, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      const realFetch = globalThis.fetch;
      const pending: Promise<unknown>[] = [];
      globalThis.fetch = F.f as unknown as typeof fetch;
      try {
        const workerReq = new Request("https://mpt-scan-report.example.workers.dev/api/scan", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: req.postData() ?? "" });
        const out = await worker.fetch(workerReq, ENV, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
        await Promise.all(pending);
        const text = await out.text();
        seen.push({ status: out.status, body: text ? JSON.parse(text) : null });
        return route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: text });
      } finally { globalThis.fetch = realFetch; }
    });
    return { F, seen };
  }
  const press = async (page: import("@playwright/test").Page) => page.getByRole("button", { name: /check my exposure/i }).first().click();

  test("the second scan in a month is declined with the upgrade message; nothing is created or sent for it", async ({ page }, info) => {
    const { F, seen } = await wireWorker(page);
    await page.goto("/scan");
    await page.getByLabel("Email address").first().fill(EMAIL);
    await page.getByRole("checkbox").first().check();
    await press(page);
    await expect(page.getByRole("status")).toContainText(/we have your email/i);
    expect(seen[0].status).toBe(200);
    expect(F.db.ent.consumption).toHaveLength(1);

    // a later day of the same month (past the one-report-per-24h rule): the same address scans again
    F.db.scans.forEach((s: { created_at: string }) => { s.created_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(); });
    const mailsBefore = F.calls.filter((c: { url: string }) => c.url.includes("api.resend.com")).length;
    await page.goto("/scan");
    await page.getByLabel("Email address").first().fill(EMAIL);
    await page.getByRole("checkbox").first().check();
    await press(page);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("You've used this month's free scan.");
    await expect(alert).toContainText("Sign up for 5 a month on Basic.");
    await expect(alert).toContainText(/Your allowance comes back on 1 [A-Z][a-z]+\./);
    await expect(alert).toContainText("myprivacytool.io/pricing");
    await expect(page.getByRole("status")).toHaveCount(0);                 // no thank-you screen promising a report that was never requested
    await expect(page.getByLabel("Email address").first()).toHaveValue(EMAIL);
    await page.screenshot({ path: info.outputPath("scan-allowance-free-exhausted.png") });
    expect(seen[1].status).toBe(429);
    expect(seen[1].body).toMatchObject({ code: "scan_allowance_exhausted", plan: "free", limit: 1 });
    expect(F.db.scans).toHaveLength(1);                                     // the refused request created no scan row
    expect(F.calls.filter((c: { url: string }) => c.url.includes("api.resend.com")).length).toBe(mailsBefore);   // and sent no email
    expect(F.db.ent.consumption).toHaveLength(1);                           // and used nothing
    const text = (await alert.textContent()) ?? "";
    expect(text).not.toMatch(/hurry|last chance|limited time|act now|fair.use|\$/i);   // no pressure, no fair-use text, no price in the message
  });
});
