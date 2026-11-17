import { test, expect } from "./fixtures";

// MPC-10614: the Footprint Path in a real browser at 390px, with the preview switch (?path=1). Sample data; nothing is sent anywhere.
test.use({ viewport: { width: 390, height: 844 } });

async function open(page: import("@playwright/test").Page, q: string) {
  await page.goto(`/${q}`);
  const ess = page.getByRole("button", { name: "Essential only" });
  if (await ess.count()) await ess.click();
  await expect(page.getByTestId("footprint-path")).toBeVisible();
}

test("?path=1 at 390px: one column, exact badge, no tile fill, no banned wording", async ({ page }) => {
  await open(page, "?path=1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId("path-badge")).toHaveText("4 things known about you · 3 guesses waiting");
  const fills = await page.getByTestId("footprint-path").locator("svg[data-outline] polygon").evaluateAll((els) => els.map((e) => e.getAttribute("fill")));
  expect(fills.length).toBeGreaterThan(0);
  expect(fills.every((f) => f === "none")).toBe(true);
  const txt = (await page.getByTestId("footprint-path").innerText()).toLowerCase();
  for (const w of ["detected", "verified", "safe", "clean", "hidden", "private", "scan complete", "checks done"]) expect(txt).not.toContain(w);
  expect(txt).not.toMatch(/\d+\s+of\s+\d+|\d\s*%/);
});

test("?path=1&test=1 shows five arrival prints, and the planned step buttons are disabled", async ({ page }) => {
  await open(page, "?path=1&test=1");
  await expect(page.getByTestId("path-behind").locator("[data-print]")).toHaveCount(5);
  await expect(page.getByTestId("btn-yes")).toBeDisabled();
});

test("without the switch the path is absent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("footprint-path")).toHaveCount(0);
});
