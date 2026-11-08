import { test, expect } from "./fixtures";

// MPC-9831 (F9 LIVE test): /footprint/ opened without a scan carries a clear "Sample data" marker; with a real saved scan the marker is gone and the values are the visitor's.
const SENTENCE = "Sample data — run your free scan to see your own";

test("cold /footprint/ shows the Sample data banner and marks every example value", async ({ page }) => {
  await page.goto("/footprint/");
  const banner = page.getByTestId("sample-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(SENTENCE);
  await expect(banner.getByRole("link", { name: "run your free scan" })).toHaveAttribute("href", "/scan");
  const revealed = page.locator("g.cell[data-sample='1']");
  expect(await revealed.count()).toBeGreaterThan(0);
  // no revealed cell with a value escapes the marker
  expect(await page.locator("g.cell:not(.s-none) .val:not(:empty)").count()).toBe(await page.locator("g.cell:not(.s-none)[data-sample='1']").count());
});

test("with a real saved scan the banner and markers go and the real value shows", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mpt_footprint_scan", JSON.stringify({ values: { location: { ex: "Wan Chai, Hong Kong", conf: 88 } } })));
  await page.goto("/footprint/");
  await expect(page.getByTestId("sample-banner")).toBeHidden();
  const loc = page.locator("g.cell", { has: page.locator(".lbl", { hasText: "LOCATION" }) });
  await expect(loc).not.toHaveAttribute("data-sample", "1");
  await expect(loc.locator(".val")).toHaveText("Wan Chai, Hong...");
});

test("a malformed saved scan is ignored and the page stays labelled sample", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mpt_footprint_scan", "{not json"));
  await page.goto("/footprint/");
  await expect(page.getByTestId("sample-banner")).toBeVisible();
});

// MPC-9898: the scan writes the visitor's values, so /footprint/ after a real scan in the same browser drops the Sample marker.
test("a completed scan on the home page writes mpt_footprint_scan and /footprint/ then shows real values", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("mpt_footprint_scan")), { timeout: 30_000 }).not.toBeNull();
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem("mpt_footprint_scan")))!);
  expect(Object.keys(saved.values).length).toBeGreaterThan(0);
  await page.goto("/footprint/");
  await expect(page.getByTestId("sample-banner")).toBeHidden();
});
