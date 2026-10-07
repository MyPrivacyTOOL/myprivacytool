import { test, expect } from "./fixtures";

// MPC-7506: proves the app emits the canonical GA4 `privacy_scan_completed` event once every hexagon is
// confirmed. Hermetic: the gtag.js network load is aborted by fixtures, but index.html's inline stub still
// pushes every gtag() call onto window.dataLayer, which is what we assert on.
test("completing the scan emits privacy_scan_completed exactly once", async ({ page, isMobile }) => {
  test.skip(isMobile, "slow full-scan flow; desktop project is enough");
  test.setTimeout(120_000);
  await page.goto("/");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 30_000 });

  const state = async () => {
    const [done, total] = ((await counter.textContent()) ?? "0/0").split("/").map(Number);
    return { done, total };
  };
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');

  for (let i = 0; i < 400; i++) {
    const { done, total } = await state();
    if (done >= total && total >= 46) break;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300); // next reveal wave still animating in
  }

  const events = await page.evaluate(() =>
    ((window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer || [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] === "event" && a[1] === "privacy_scan_completed"),
  );
  console.log("privacy_scan_completed dataLayer entries:", JSON.stringify(events));
  expect(events).toHaveLength(1);
  expect(events[0][2]).toMatchObject({ funnel_step: "all_hexagons_confirmed" });
  expect((events[0][2] as { hexagon_count: number }).hexagon_count).toBeGreaterThanOrEqual(46);
});
