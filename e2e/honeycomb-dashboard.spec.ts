import { test, expect } from "./fixtures";

// The honeycomb dashboard is what the home page shows by default. Hermetic like the rest of the suite: gtag.js is blocked by
// fixtures, but index.html's inline stub still pushes every gtag() call onto window.dataLayer, which is what we assert on.
test("the home page shows the honeycomb dashboard by default, and ?view=grid shows the old grid", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByRole("progressbar", { name: "Secured" })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('section[aria-labelledby^="pillar-"]')).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Export report" })).toBeVisible();
  await expect(page.getByTestId("confirmation-counter")).toHaveCount(0);

  await page.goto("/?view=grid");
  await expect(page.getByTestId("confirmation-counter")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("progressbar", { name: "Secured" })).toHaveCount(0);
});

test("answering the last Is this you? guess emits privacy_scan_completed once, and scan_started once", async ({ page, isMobile }) => {
  test.skip(isMobile, "slow full-scan flow; desktop project is enough");
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByRole("progressbar", { name: "Secured" })).toBeVisible({ timeout: 45_000 });

  const guesses = page.locator('button[title="We think this is you. Tap to confirm."]');
  for (let i = 0; i < 60 && (await guesses.count()) > 0; i++) {
    await guesses.first().click();
    await page.getByRole("button", { name: /no, not me/i }).click();
  }
  await expect(guesses).toHaveCount(0);

  const events = await page.evaluate(() =>
    ((window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer || []).map((a) => Array.from(a)).filter((a) => a[0] === "event"),
  );
  expect(events.filter((a) => a[1] === "scan_started")).toHaveLength(1);
  const completed = events.filter((a) => a[1] === "privacy_scan_completed");
  expect(completed).toHaveLength(1);
  expect(completed[0][2]).toMatchObject({ funnel_step: "all_hexagons_confirmed" });
  expect((completed[0][2] as { hexagon_count: number }).hexagon_count).toBeGreaterThanOrEqual(46);
});
