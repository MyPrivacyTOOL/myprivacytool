import { test, expect } from "./fixtures";

// CK-7805: on a phone there is no hover, so a tap must keep a plain-language explanation on screen,
// and the "what a stranger could guess" card must appear once 8 hexagons are confirmed.
test("tap keeps an explanation visible and the stranger-guess card appears after 8 confirmations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 30_000 });

  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  const explanation = page.getByTestId("hexagon-explanation-text");
  // The page can still be shifting layout as images and IP data arrive, which can swallow the very first click.
  await expect(async () => {
    await pending.first().click();
    await expect(explanation).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  await expect(explanation).toBeVisible();
  const first = (await explanation.textContent()) ?? "";
  expect(first.length).toBeGreaterThan(10);

  await pending.first().click();
  await page.waitForTimeout(500);
  await expect(explanation).toBeVisible();
  expect(await explanation.textContent()).not.toBe(first);

  // Confirm up to 8 (later waves reveal as you go).
  for (let i = 0; i < 300; i++) {
    const done = Number(((await counter.textContent()) ?? "0/0").split("/")[0]);
    if (done >= 8) break;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300);
  }
  await expect(page.getByTestId("stranger-guess-card")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("stranger-guess-card")).toContainText("Guesses, not facts");
});
