// MPC-7300: waitlist / report signup funnels (/start -> HubSpot, /newsletter -> Supabase).
import { test, expect, consoleErrors } from "./fixtures";

test.describe("/start signup (First Hexagon report waitlist)", () => {
  test("confirm -> email -> consent -> HubSpot submission -> queued", async ({ page, net }) => {
    const errors = consoleErrors(page);
    await page.goto("/start");
    await expect(page).toHaveTitle(/MyPrivacyTOOL/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your data is everywhere");

    await page.getByRole("button", { name: /yes, that's me/i }).click();
    await page.getByPlaceholder("your@email.com").fill("e2e-waitlist@example.com");
    const submit = page.getByRole("button", { name: /check my exposure/i });
    await page.getByRole("checkbox").check();
    await submit.click();

    // MPC-7400: a successful signup redirects to /thank-you with source-specific copy.
    await expect(page).toHaveURL(/\/thank-you\?source=start/);
    await expect(page.getByRole("heading", { name: "You're on the list." })).toBeVisible();
    expect(net.captured.hubspot).toHaveLength(1);
    const { url, body } = net.captured.hubspot[0];
    expect(url).toContain("/submit/246502821/22ee30ae-6cf9-419b-aa46-b656b0e7b1bf");
    const fields = Object.fromEntries(body.fields.map((f) => [f.name, f.value]));
    expect(fields).toMatchObject({ email: "e2e-waitlist@example.com", source_tag: "start-scan", consent_source: "start_page" });
    expect(fields.consent_given_at).toMatch(/^\d{13}$/);
    expect(body.context.pageUri).toContain("/start");
    expect(errors).toEqual([]);
  });

  test("the browser blocks submission until consent is ticked", async ({ page, net }) => {
    await page.goto("/start");
    await page.getByRole("button", { name: /yes, that's me/i }).click();
    await page.getByPlaceholder("your@email.com").fill("e2e@example.com");
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("button", { name: /check my exposure/i }).click();
    await expect(page).not.toHaveURL(/thank-you/);
    expect(net.captured.hubspot).toHaveLength(0);
  });

  test("shows the error and keeps the form usable when HubSpot fails", async ({ page, net }) => {
    net.mocks.hubspotStatus = 429;
    await page.goto("/start");
    await page.getByRole("button", { name: /yes, that's me/i }).click();
    await page.getByPlaceholder("your@email.com").fill("e2e@example.com");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /check my exposure/i }).click();
    await expect(page.getByRole("alert")).toContainText("HubSpot rejected the submission");
    await expect(page.getByRole("button", { name: /check my exposure/i })).toBeEnabled();
  });

  test('"Not me" sends the visitor to a fresh scan', async ({ page }) => {
    await page.goto("/start");
    await page.getByRole("button", { name: /not me/i }).click();
    await page.getByRole("main").getByRole("link", { name: /check my exposure/i }).click();
    await expect(page).toHaveURL(/\/scan$/);
  });
});

test.describe("/newsletter signup", () => {
  test("subscribes through Supabase with consent evidence", async ({ page, net }) => {
    await page.goto("/newsletter");
    await page.getByPlaceholder("your@email.com").fill("e2e-news@example.com");
    await page.getByRole("button", { name: /subscribe to privacy check/i }).click();
    await expect(page.getByRole("button", { name: /subscribe/i })).toHaveCount(0);
    expect(net.captured.supabase).toHaveLength(1);
    expect(net.captured.supabase[0].body).toMatchObject({ email: "e2e-news@example.com", consent_source: "newsletter_page" });
    expect(net.captured.supabase[0].headers.prefer).toBe("return=minimal");
  });

  test("an already-subscribed address still ends in the success state", async ({ page, net }) => {
    net.mocks.supabaseStatus = 409;
    await page.goto("/newsletter");
    await page.getByPlaceholder("your@email.com").fill("dupe@example.com");
    await page.getByRole("button", { name: /subscribe to privacy check/i }).click();
    await expect(page.getByRole("button", { name: /subscribe/i })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
