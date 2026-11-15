// The full-screen device reveal. CI builds with VITE_DEVICE_HERO=false, so this spec opens it with ?view=device.
import { test, expect } from "./fixtures";

test("the reveal covers the whole screen, then one button hands over to the page", async ({ page }) => {
  await page.goto("/?view=device");

  const dialog = page.getByRole("dialog", { name: "Your device" });
  await expect(dialog).toBeVisible();

  // Fills the viewport and locks the page scroll behind it.
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  // A device we can be certain about, or the honest unknown path: either way there is one way forward.
  const next = dialog.getByRole("button", { name: /see everything we found|see what we can see/i });
  await expect(next).toBeVisible({ timeout: 10_000 });
  await next.click();

  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(page.locator("#how-it-works")).toBeVisible();
});

test("Escape closes the reveal", async ({ page }) => {
  await page.goto("/?view=device");
  const dialog = page.getByRole("dialog", { name: "Your device" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("without the switch the CI build shows no reveal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByRole("dialog", { name: "Your device" })).toHaveCount(0);
});
