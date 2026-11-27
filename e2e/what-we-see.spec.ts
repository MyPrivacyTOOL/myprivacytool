import { test, expect, type Page } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

// Set MPC_9893_SHOTS_DIR to also write the screenshots used in the PR description.
const SHOTS = process.env.MPC_9893_SHOTS_DIR;
const shot = async (page: Page, name: string, el?: ReturnType<Page["locator"]>) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await (el ?? page).screenshot({ path: path.join(SHOTS, name), ...(el ? {} : { fullPage: true }) });
};

// MPC-9893 (Open Tracker design 1.6): /what-we-see and the per-scan "who saw what during this scan, and why" panel.
// Hermetic like the rest of the suite: fixtures.ts aborts every non-local request, so nothing here reaches an outside party.

async function completeScan(page: Page) {
  await page.goto("/?view=grid");
  await expect(page.getByTestId("confirmation-counter")).toBeVisible({ timeout: 30_000 });
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 500; i++) {
    if (await dialog.count()) return;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300);
  }
}

test("/what-we-see lists every live recipient with when it runs, an ended one with its date, and the registry fingerprint", async ({ page }) => {
  await page.goto("/what-we-see");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What we see");
  const rows = page.getByTestId("recipient-row");
  expect(await rows.count()).toBeGreaterThan(25);
  // Google Analytics only runs after Scan me; our own whoami call runs at page load.
  await expect(page.locator('[data-recipient="ga4"]').getByTestId("recipient-when")).toHaveText("only after you press Scan me");
  await expect(page.locator('[data-recipient="whoami"]').getByTestId("recipient-when")).toHaveText("when the page loads");
  // Google Fonts ended with MPC-9886: listed as removed, not as live.
  await expect(page.getByTestId("removed-row").filter({ hasText: "Google Fonts" })).toContainText("ended 2026-11-08");
  await expect(page.locator('[data-testid="recipient-row"][data-recipient="google-fonts"]')).toHaveCount(0);
  await expect(page.getByTestId("registry-hash")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("registry-date")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  // no horizontal scroll of the page itself (the table scrolls inside its own box)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await shot(page, "what-we-see-en.png");
});

test("/what-we-see renders in Japanese and in right-to-left Arabic", async ({ page }) => {
  await page.goto("/what-we-see?lang=ja");
  await expect(page.locator('[data-recipient="ga4"]').getByTestId("recipient-when")).toHaveText("「スキャン」を押した後のみ");
  await page.goto("/what-we-see?lang=ar");
  await expect(page.getByTestId("what-we-see")).toHaveAttribute("dir", "rtl");
  await shot(page, "what-we-see-ar-rtl.png");
});

test("a scan with Google Analytics off shows it as skipped in the who-saw-what panel", async ({ page }) => {
  test.setTimeout(240_000);
  await completeScan(page);
  const panel = page.getByTestId("scan-recipients-panel");
  await expect(panel).toBeAttached();
  await expect(panel.locator("h2")).toHaveText("Who saw what during this scan, and why");
  // No analytics choice was made (the default), so Google Analytics and the Cloudflare beacon were not contacted and the panel says so.
  for (const key of ["ga4", "cloudflare-web-analytics"]) {
    const row = panel.locator(`[data-testid="scan-recipient-row"][data-recipient="${key}"]`);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("scan-recipient-chip")).toHaveText("Skipped: not enabled");
    await expect(row.getByTestId("scan-recipient-items")).toHaveText("—");
  }
  // Nothing the browser did is hidden: every request the page made to an outside host was aborted by the fixture, so no outside recipient shows as having run.
  await expect(panel.locator('[data-testid="scan-recipient-row"][data-recipient="ga4"][data-status="ran"]')).toHaveCount(0);
  await page.keyboard.press("Escape");   // the completion dialog covers the page; close it to photograph the panel
  await panel.scrollIntoViewIfNeeded();
  await shot(page, "who-saw-what-panel.png", panel);
  await expect(panel.locator('a[href="/what-we-see"]')).toHaveCount(1);   // by selector: the completion dialog hides the page behind it from the accessibility tree
});
