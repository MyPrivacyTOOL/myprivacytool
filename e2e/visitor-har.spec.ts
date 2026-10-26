// MPC-8538: the scan with a real visitor lookup. ./fixtures aborts api.myprivacytool.io/whoami, so every
// other spec only ever sees the "Unknown" fallback, and the location guess ("You are probably in or near …")
// is never rendered. Here the production response is replayed from e2e/hars/ (see scripts/e2e/record-visitor-har.mjs).
import { test, expect, consoleErrors, WHOAMI, HK_GEO, type Sim } from "./net-sim";
import type { Page } from "@playwright/test";

/** The profile the scan built from whoami, read from the queued (never sent) gtag stub in index.html. */
async function deviceProfile(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((a) => Array.from(a)).some((a) => a[1] === "device_profile"),
  ), { timeout: 30_000 }).toBe(true);
  return page.evaluate(() => {
    const e = ((window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer).map((a) => Array.from(a)).find((a) => a[1] === "device_profile");
    return e![2] as { location_city: string; location_country: string; isp: string };
  });
}

/** Confirm 8 hexagons so the "What a stranger could guess" card appears (same loop as hexagon-tap-explain). */
async function strangerGuess(page: Page) {
  await page.goto("/?view=grid");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 30_000 });
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  for (let i = 0; i < 300; i++) {
    if (Number(((await counter.textContent()) ?? "0/0").split("/")[0]) >= 8) break;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300);
  }
  const card = page.getByTestId("stranger-guess-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}

test.describe("recorded production visitor", () => {
  test.use({ visitor: "recorded" });

  test("the scan uses the looked-up city, country and ISP", async ({ page }) => {
    const errors = consoleErrors(page);
    await page.goto("/?view=grid");
    expect(await deviceProfile(page)).toMatchObject({ location_city: "Ashburn", location_country: "United States", isp: "Amazon Data Services Northern Virginia" });
    expect(errors).toEqual([]);
  });

  test("the stranger-guess card names the visitor's city", async ({ page, isMobile }) => {
    test.skip(isMobile, "slow 8-tap flow; desktop project is enough");
    test.setTimeout(120_000);
    const card = await strangerGuess(page);
    await expect(card).toContainText("You are probably in or near Ashburn.");
  });

  test("outside Hong Kong, /HongKongSpam shows the override note", async ({ page }) => {
    await page.goto("/HongKongSpam");
    await expect(page.getByTestId("hk-nonhk-note")).toBeVisible();
  });
});

test.describe("Hong Kong visitor", () => {
  test.use({ visitor: "hk" });

  test("the scan and the location guess use Kwai Chung", async ({ page, isMobile }) => {
    test.skip(isMobile, "slow 8-tap flow; desktop project is enough");
    test.setTimeout(120_000);
    const card = await strangerGuess(page);
    expect(await deviceProfile(page)).toMatchObject({ location_city: "Kwai Chung", location_country: "Hong Kong" });
    await expect(card).toContainText("You are probably in or near Kwai Chung.");
  });

  test("/HongKongSpam treats the visitor as local (no override note)", async ({ page }) => {
    const geo = page.waitForResponse(HK_GEO);
    await page.goto("/HongKongSpam");
    expect(await (await geo).json()).toEqual({ country: "HK" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("hk-nonhk-note")).toHaveCount(0);
  });
});

test.describe("visitor lookup misbehaving", () => {
  test.use({ visitor: "recorded" });

  const cases: [string, (sim: Sim) => Promise<void>][] = [
    ["connection dropped", (sim) => sim.abort(WHOAMI)],
    ["Worker returns 503", (sim) => sim.json(WHOAMI, { error: "unavailable" }, 503)],
    ["Worker returns a non-object body", (sim) => sim.json(WHOAMI, "not-an-object")],
    ["Worker returns nulls", (sim) => sim.json(WHOAMI, { ip: null, city: null, region: null, country_name: null, org: null })],
  ];
  for (const [name, setup] of cases) {
    test(`${name}: the scan falls back to Unknown without errors`, async ({ page, sim }) => {
      const errors = consoleErrors(page);
      await setup(sim);
      await page.goto("/?view=grid");
      expect(await deviceProfile(page)).toMatchObject({ location_city: "Unknown", location_country: "Unknown" });
      await expect(page.getByTestId("confirmation-counter")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("hk-geo failing fails closed (treated as not Hong Kong)", async ({ page, sim }) => {
    await sim.abort(HK_GEO);
    await page.goto("/HongKongSpam");
    await expect(page.getByTestId("hk-nonhk-note")).toBeVisible();
  });

  test("a slow lookup (4 s) does not block the page, and the real values still arrive", async ({ page, sim }) => {
    await sim.delay(WHOAMI, 4000);
    const t0 = Date.now();
    await page.goto("/?view=grid");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(await deviceProfile(page)).toMatchObject({ location_city: "Ashburn" });
  });
});
