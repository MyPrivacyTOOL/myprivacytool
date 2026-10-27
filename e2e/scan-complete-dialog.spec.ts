import { test, expect, type Page } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

// MPC-7471-F1: one scan-complete dialog (congratulations + result + email form), not two.
// Hermetic: fixtures.ts aborts every non-local request, so the Worker call can never leave the machine and nothing is sent or saved.
// Screenshot timing reference: T0 = the moment the dialog first becomes visible (not a fixed sleep from the last tap).
const SHOTS = process.env.MPC_7471_SHOTS_DIR || path.join("test-results", "mpc-7471-f1");

async function completeScan(page: Page) {
  await page.goto("/?view=grid");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 30_000 });
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 500; i++) {
    if (await dialog.count()) return;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300); // next reveal wave still animating in
  }
}

test("completion opens exactly one dialog that stays open; score matches the page; focus is managed", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const kind = testInfo.project.name; // desktop | mobile
  await completeScan(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const t0 = await page.evaluate(() => performance.now());

  // Exactly one popup: no second dialog, and no separate congratulations banner.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByText("Complete Digital Shadow Revealed!")).toHaveCount(0);
  await expect(dialog).toHaveAccessibleName("You finished your scan");

  // The score and label in the dialog are the page's.
  const result = (await page.getByTestId("scan-complete-result").textContent()) ?? "";
  const label = /(High|Medium|Low) exposure/.exec(result)?.[0];
  const score = /(\d+)\/100/.exec(result)?.[1];
  expect(label && score).toBeTruthy();
  await expect(page.getByTestId("scan-complete-dialog")).toBeFocused();
  // The page's own risk card (behind the overlay, so read its text rather than click it) shows the same number and label.
  const pageCard = page.getByText(score!, { exact: true }).first();
  await expect(pageCard).toBeAttached();
  await expect(page.getByText(label!, { exact: true }).first()).toBeAttached();

  // No horizontal scrolling inside or around the dialog; the form is reachable.
  const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  await page.getByPlaceholder("your@email.com").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /send my report/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /no thanks/i })).toBeVisible();
  // MPC-7471-F3: two separate boxes (report, and the optional save box), both unticked.
  for (const box of await page.getByRole("checkbox").all()) await expect(box).not.toBeChecked();

  const shotAt = async (ms: number) => {
    await page.waitForFunction(([start, wait]) => performance.now() - (start as number) >= (wait as number), [t0, ms] as const);
    // State, not just time: still exactly one dialog, still showing the same result.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByTestId("scan-complete-result")).toHaveText(result);
    await page.screenshot({ path: path.join(SHOTS, `${kind}-t${String(ms / 1000).padStart(2, "0")}s.png`) });
  };
  await page.getByTestId("scan-complete-dialog").evaluate((el) => (el as HTMLElement).scrollTo(0, 0));
  await shotAt(0);
  await shotAt(2000);
  await shotAt(10_000);

  // Keyboard: Tab stays inside the dialog; Escape closes it and it does not come back.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(3000); // the old timer was 1.5 s: it must not reopen
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
