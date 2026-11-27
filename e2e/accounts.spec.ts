// MPC-9817: sign in by email link -> /account -> see your scan -> delete everything. The production build, the REAL Worker code, a SYNTHETIC identity (example.test).
// Supabase Auth, the database and the mail provider are the shared stub (workers/scan-report/test-support/fake-accounts.mjs), answered inside this process.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import worker from "../workers/scan-report/index.js";
import { stub, ME, SCAN_ME } from "../workers/scan-report/test-support/fake-accounts.mjs";

const ENV = { ACCOUNTS_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_API_KEY: "r", RECIPIENT_ALLOWLIST: "", UNSUBSCRIBE_SECRET: "e2e-secret" };

async function wireWorker(page: Page) {
  const S = stub();
  await page.route(/mpt-scan-report\.[^/]+\/api\/account\/[a-z-]+(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fallback();
    const u = new URL(req.url());
    const realFetch = globalThis.fetch;
    const pending: Promise<unknown>[] = [];
    globalThis.fetch = S.f as unknown as typeof fetch;
    try {
      const headers: Record<string, string> = { Origin: "https://myprivacytool.io", "Content-Type": "application/json" };
      const auth = req.headers()["authorization"];
      if (auth) headers.Authorization = auth;
      const out = await worker.fetch(new Request(`https://mpt-scan-report.example.workers.dev${u.pathname}`, { method: req.method(), headers, body: req.method() === "POST" ? req.postData() ?? "" : undefined }), { ...ENV }, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
      await Promise.all(pending);
      return route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: await out.text() });
    } finally { globalThis.fetch = realFetch; }
  });
  return S;
}

test("sign in with an emailed link, see your scan, delete the account and every scan", async ({ page }) => {
  const S = await wireWorker(page);
  await page.addInitScript((n) => localStorage.setItem("mpt_web_scan_number", n), SCAN_ME);

  await page.goto("/account");
  await page.getByLabel("Email address").fill(ME);
  expect(await page.locator('input[type="password"]').count()).toBe(0);
  await page.getByRole("button", { name: /email me a sign-in link/i }).click();
  await expect(page.getByTestId("sent")).toBeVisible();

  // the email: one message to that address, the link carries the token in the fragment
  expect(S.st.emails).toHaveLength(1);
  const mail = S.st.emails[0];
  expect(mail.to).toEqual([ME]);
  const link = mail.text.match(/https:\/\/myprivacytool\.io(\/account\/verify#t=[A-Za-z0-9_-]+&n=[0-9a-f-]+)/)![1];

  // opening the page alone signs nobody in (a mail scanner would do exactly this)
  await page.goto(link);
  await expect(page.getByTestId("signin-button")).toBeVisible();
  expect(S.st.accounts).toHaveLength(0);
  await page.getByTestId("signin-button").click();

  // /account: email, plan, the scan attached at sign-in
  await expect(page.getByTestId("account-email")).toHaveText(ME);
  await expect(page.getByTestId("account-plan")).toContainText("Free");
  await expect(page.getByTestId("scan-row")).toContainText(SCAN_ME);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("scan-results")).toContainText("IP address");
  expect(S.st.accounts).toHaveLength(1);
  expect(S.st.scanExpiry.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();   // left the free 7-day deletion path

  // it survives a reload (session kept in this browser)
  await page.reload();
  await expect(page.getByTestId("account-email")).toHaveText(ME);

  // delete: two presses, then everything is gone
  await page.getByRole("button", { name: /delete my account and all scans/i }).click();
  expect(S.st.accounts).toHaveLength(1);
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByTestId("deleted")).toBeVisible();
  expect(S.st.accounts).toHaveLength(0);
  expect(S.st.webScans.has(SCAN_ME)).toBe(false);
  expect(S.st.authUsers.some((u: { email: string }) => u.email === ME)).toBe(false);
  await page.reload();
  await expect(page.getByTestId("signin-form")).toBeVisible();
});
