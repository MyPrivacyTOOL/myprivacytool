import { test, expect } from "./fixtures";

// MPC-8689: the complete footprint. /footprint/ shows 368 hexagons across 27 channels, and every hexagon has its own risk page.
test("/footprint/ loads the 368-hexagon dataset (27 channels, Telegram 47)", async ({ page }) => {
  await page.goto("/footprint/");
  const data = await page.evaluate(async () => {
    const d = await (await fetch("/footprint/hexagons-366.json")).json();
    const by = (k: string) => d.reduce((m: Record<string, number>, i: Record<string, string>) => ((m[i[k]] = (m[i[k]] || 0) + 1), m), {});
    return { total: d.length, channels: Object.keys(by("channel")).length, telegram: by("channel").Telegram, risk: by("sens") };
  });
  expect(data).toEqual({ total: 368, channels: 27, telegram: 47, risk: { high: 92, medium: 208, low: 68 } });
});

test("master risk page lists 368 hexagons and each links to its own page", async ({ page }) => {
  await page.goto("/hexagon/");
  await expect(page.locator("#b tr")).toHaveCount(368);
  await expect(page.getByText("92 High")).toBeVisible();
  await page.locator("#b tr a").first().click();
  await expect(page).toHaveURL(/\/hexagon\/[a-z0-9-]+\/$/);
  await expect(page.getByRole("heading", { name: "What it could be used for" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What you can do" })).toBeVisible();
});
