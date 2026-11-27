import { test, expect } from "./fixtures";

// MPC-8689: the complete footprint. /footprint/ shows 662 hexagons across 34 channels (owner decision 2026-11-26), and every hexagon has its own risk page.
test("/footprint/ loads the 662-hexagon dataset (34 channels, Telegram 50)", async ({ page }) => {
  await page.goto("/footprint/");
  const data = await page.evaluate(async () => {
    const d = await (await fetch("/footprint/hexagons-662.json")).json();
    const by = (k: string) => d.reduce((m: Record<string, number>, i: Record<string, string>) => ((m[i[k]] = (m[i[k]] || 0) + 1), m), {});
    return { total: d.length, channels: Object.keys(by("channel")).length, telegram: by("channel").Telegram, risk: by("sens") };
  });
  expect(data).toEqual({ total: 662, channels: 34, telegram: 50, risk: { high: 285, medium: 274, low: 103 } });
});

test("master risk page lists 662 hexagons and each links to its own page", async ({ page }) => {
  await page.goto("/hexagon/");
  await expect(page.locator("#b tr")).toHaveCount(662);
  await expect(page.getByText("285 High")).toBeVisible();
  await page.locator("#b tr a").first().click();
  await expect(page).toHaveURL(/\/hexagon\/[a-z0-9-]+\/$/);
  await expect(page.getByRole("heading", { name: "What it could be used for" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What you can do" })).toBeVisible();
});
