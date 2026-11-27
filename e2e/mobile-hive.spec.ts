import { test, expect } from "./fixtures";

// mobile_hive (MPC-9559): on a phone the test group gets readable hexagon tiles (the value and status line) and a header button.
// The experiment ships off, so these views are forced with ?ab_mobile_hive=<variant> (never counted in GA4).
// Regression this pins: the header button once sat beside the logo, HELP and the menu, made the header wider than the screen and pushed the
// menu button off screen. Unit tests cannot see that; only a real layout can.
const PHONE_WIDTHS = [320, 360, 412];

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "phone layout: the mobile project is the one under test");
});

for (const width of PHONE_WIDTHS) {
  test(`readable_tiles at ${width}px: header button shows, the menu button stays on screen, nothing scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?ab_mobile_hive=readable_tiles");
    const cta = page.getByTestId("header-phone-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/scan");

    const menu = page.getByRole("button", { name: "Open menu" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box, "menu button has a layout box").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);

    const ctaBox = await cta.boundingBox();
    expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("control: no header button, and the menu is still there", async ({ page }) => {
  await page.goto("/?ab_mobile_hive=control");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await expect(page.getByTestId("header-phone-cta")).toHaveCount(0);
});

test("readable_tiles shows the status line on the hexagon tiles; the control does not", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?ab_mobile_hive=control");
  await expect(page.getByRole("progressbar", { name: "Checked" })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('section[aria-labelledby^="pillar-"]')).toHaveCount(8);
  await expect(page.getByTestId("tile-line")).toHaveCount(0); // compact tiles: no value or status line

  await page.goto("/?ab_mobile_hive=readable_tiles");
  await expect(page.getByRole("progressbar", { name: "Checked" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("tile-line").first()).toBeVisible({ timeout: 15_000 });
});
