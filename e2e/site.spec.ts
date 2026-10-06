// MPC-7300: the site shell and the routes the conversion funnels depend on.
import { test, expect, consoleErrors } from "./fixtures";

const ROUTES: [string, RegExp][] = [
  ["/", /MyPrivacyTOOL/i], ["/scan", /scan/i], ["/start", /MyPrivacyTOOL/i], ["/contact", /contact/i],
  ["/newsletter", /MyPrivacyTOOL|privacy check/i], ["/pricing", /pricing/i], ["/privacy", /privacy/i],
  ["/terms", /terms/i], ["/faq", /faq/i],
];

for (const [route, title] of ROUTES) {
  test(`${route} renders with its own title and no uncaught errors`, async ({ page }) => {
    const errors = consoleErrors(page);
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page).toHaveTitle(title);
    expect(errors).toEqual([]);
  });
}

test("unknown URLs render the 404 page inside the app shell", async ({ page }) => {
  await page.goto("/definitely-not-a-page");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByText(/404|not found/i).first()).toBeVisible();
});

test("legacy guide URLs redirect to their blog posts", async ({ page }) => {
  await page.goto("/guides/remove-from-google");
  await expect(page).toHaveURL(/\/blog\/remove-your-name-and-info-from-google$/);
});

test("sitemap.xml and robots are served", async ({ request }) => {
  const sm = await request.get("/sitemap.xml");
  expect(sm.status()).toBe(200);
  expect(await sm.text()).toContain("<urlset");
});
