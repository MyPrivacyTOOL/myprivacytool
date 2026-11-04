import { test, expect } from "./fixtures";
import { HEXAGON_COUNT } from "../shared/hexagon-registry/registry.js";

// MPC-7471-F2: the summary card says how many hexagons are confirmed, checked and in the scan, and the total comes from the registry.
// Hermetic (fixtures.ts blocks the network), so the scan runs with no live lookups and some hexagons honestly show as not checked.
test("the summary line states confirmed, checked and the registry total, and fits the screen", async ({ page, isMobile }, info) => {
  await page.goto("/?view=grid");
  await expect(page.getByTestId("confirmation-counter")).toBeVisible({ timeout: 30_000 });
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  for (let i = 0; i < 8; i++) {
    if (await pending.count()) await pending.first().click({ force: true });
    await page.waitForTimeout(150);
  }

  const line = page.getByTestId("scan-counts-line").first();
  await expect(line).toBeVisible({ timeout: 15_000 });
  const m = (await line.textContent())!.match(/^(\d+) of (\d+) checked hexagons? confirmed, out of (up to )?(\d+) in this scan/);
  expect(m, "wording").not.toBeNull();
  const [confirmed, checked, , total] = [Number(m![1]), Number(m![2]), m![3], Number(m![4])];
  expect(total).toBe(HEXAGON_COUNT); // from the registry, not typed
  expect(confirmed).toBeLessThanOrEqual(checked);
  expect(checked).toBeLessThanOrEqual(total);
  expect(await page.locator("body").textContent()).not.toMatch(/\d+ data points confirmed/); // the old, ambiguous line is gone

  // phone width: nothing scrolls sideways
  const [scrollW, innerW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollW).toBeLessThanOrEqual(innerW);

  // reading order: the risk label comes before the counts line, the line before the indicator pills
  const order = await line.evaluate((el) => {
    const card = el.parentElement!;
    const kids = Array.from(card.children);
    return kids.findIndex((k) => k === el) > kids.findIndex((k) => /risk/i.test(k.textContent ?? "") && k !== el);
  });
  expect(order).toBe(true);
  await line.scrollIntoViewIfNeeded();
  await info.attach(`scan-counts-${isMobile ? "mobile" : "desktop"}`, { body: await page.screenshot(), contentType: "image/png" });
});
