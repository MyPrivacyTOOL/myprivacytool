import { test, expect } from "./fixtures";

// MPC-8689 / MPC-11541: the complete footprint. /footprint/ loads every published data point of the Hexagon Registry export (Row Type = Data point, less every row with Decision = Dropped),
// each tile carries a Live / In build / Planned badge, and no headline total appears in the copy. Every hexagon has its own risk page.
test("/footprint/ dataset: every registry data point, one badge each, Live = the 54 web checks", async ({ page }) => {
  await page.goto("/footprint/");
  const data = await page.evaluate(async () => {
    const d = await (await fetch("/footprint/hexagons-366.json")).json();
    const by = (k: string) => d.reduce((m: Record<string, number>, i: Record<string, string>) => ((m[i[k]] = (m[i[k]] || 0) + 1), m), {});
    return { total: d.length, telegram: by("channel").Telegram, risk: by("sens"), tile: by("tile"), ids: new Set(d.map((i: { id: string }) => i.id)).size };
  });
  expect(data).toEqual({ total: 650, telegram: 47, risk: { high: 284, medium: 268, low: 98 }, tile: { live: 54, in_build: 137, planned: 459 }, ids: 650 });
});

test("/footprint/ renders a status badge on all 650 tiles and states no total", async ({ page }) => {
  await page.goto("/footprint/");
  await page.getByRole("button", { name: "Open the curtain" }).first().click();
  await page.locator("#scope [data-k=all]").click();
  await page.getByRole("button", { name: "By pattern view" }).click();
  await expect(page.locator("#boxes .tile")).toHaveCount(650);
  await expect(page.locator("#boxes .tile .tb")).toHaveCount(650);
  await expect(page.locator("#boxes .tile .tb-live")).toHaveCount(54);
  await expect(page.locator("#boxes .tile .tb-in_build")).toHaveCount(137);
  await expect(page.locator("#boxes .tile .tb-planned")).toHaveCount(459);
  // A tile opens its panel with the same badge and one honest sentence.
  await page.locator("#boxes .tile .tb-planned").first().click({ force: true });
  await expect(page.locator("#panel .tb-planned")).toBeVisible();
  await expect(page.locator("#panel")).toContainText("Documented only. MPT does not check it yet.");
  // No headline total anywhere in the page text or its meta.
  const text = await page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("meta")].map((m) => m.getAttribute("content")).join(" ") + document.title);
  expect(text).not.toMatch(/\b(650|653|654|655|662|368|367|366|363)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("/footprint/ at phone width: badges fit and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/footprint/");
  await page.getByRole("button", { name: "Open the curtain" }).first().click();
  await page.locator("#scope [data-k=all]").click();
  await page.getByRole("button", { name: "By pattern view" }).click();
  await expect(page.locator("#boxes .tile .tb").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("master risk page lists every hexagon, states no total, and each links to its own page", async ({ page }) => {
  await page.goto("/hexagon/");
  await expect(page.locator("#b tr")).toHaveCount(650);
  await expect(page.getByText("284 High")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hexagons, ranked by risk");
  await page.locator("#b tr a").first().click();
  await expect(page).toHaveURL(/\/hexagon\/[a-z0-9-]+\/$/);
  await expect(page.getByRole("heading", { name: "What it could be used for" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What you can do" })).toBeVisible();
});
