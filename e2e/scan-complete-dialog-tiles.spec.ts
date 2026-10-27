import { test, expect, type Page } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

// MPC-7471-F1 follow-up: with the honest tiles on (?hex_v2=1) the scan-complete dialog still opens once, with the counts-only risk profile.
// Hermetic: fixtures.ts aborts every non-local request, so nothing is sent or saved. Screenshot timing: T0 = the dialog first visible.
const SHOTS = process.env.MPC_7471_SHOTS_DIR || path.join("test-results", "mpc-7471-f1-tiles");

async function finishScan(page: Page) {
  await page.goto("/?hex_v2=1&view=grid");
  await expect(page.getByTestId("risk-profile")).toBeVisible({ timeout: 30_000 });
  const tiles = page.locator('[role="list"][aria-label="Detected data points"] [role="button"]');
  const dialog = page.getByTestId("scan-complete-dialog");
  const guess = page.getByRole("alertdialog");
  for (let i = 0, n = 0; i < 1500; i++) {
    if (await dialog.count()) return;
    if (await guess.count()) { await guess.getByRole("button").first().click({ force: true }).catch(() => {}); continue; }
    const count = await tiles.count();
    if (count) { await tiles.nth(n % count).click({ force: true }).catch(() => {}); n++; }
    else await page.waitForTimeout(300);
    if (n % 12 === 0) await page.waitForTimeout(150); // let the next reveal wave animate in
  }
}

test("honest tiles: completion opens exactly one counts-only dialog that stays open", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const kind = testInfo.project.name;
  await finishScan(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const t0 = await page.evaluate(() => performance.now());
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAccessibleName("You finished your scan");

  // counts only: no score, percentage, ratio or band label inside the dialog
  const result = page.getByTestId("scan-complete-result");
  await expect(result).toContainText("Your risk profile");
  await expect(result).toContainText(/\d+ clear/);
  await expect(result).toContainText(/not checked yet/);
  const text = (await dialog.textContent()) ?? "";
  expect(text).not.toMatch(/\/100|exposure score|coverage|\bHigh\b|\bMedium\b|\bLow\b|\d+%|\d+ of \d+/);

  // same form and consent as the classic dialog
  await expect(page.getByRole("button", { name: /no thanks/i })).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const profile = ((await result.textContent()) ?? "").trim();

  const shotAt = async (ms: number) => {
    await page.waitForFunction(([start, wait]) => performance.now() - (start as number) >= (wait as number), [t0, ms] as const);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(result).toHaveText(profile);
    await page.screenshot({ path: path.join(SHOTS, `${kind}-t${String(ms / 1000).padStart(2, "0")}s.png`) });
  };
  await shotAt(0);
  await shotAt(2000);
  await shotAt(10_000);

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(3000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
