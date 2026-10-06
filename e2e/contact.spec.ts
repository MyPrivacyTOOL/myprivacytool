// MPC-7300: /contact form end to end (built with VITE_HUBSPOT_CONTACT_FORM_ID=e2e-contact-form).
import { test, expect, consoleErrors } from "./fixtures";

const fill = async (page: import("@playwright/test").Page) => {
  await page.getByLabel("Name", { exact: true }).fill("Grace Hopper");
  await page.getByLabel("Email", { exact: true }).fill("grace@example.com");
  await page.getByLabel("Topic").selectOption("Business");
  await page.getByLabel("Message").fill("Can you support our team?");
  await page.getByRole("checkbox").check();
};

test.describe("/contact", () => {
  test("submits to HubSpot with the contact-page source tag and shows confirmation", async ({ page, net }) => {
    const errors = consoleErrors(page);
    await page.goto("/contact");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Contact");
    await fill(page);
    await page.getByRole("button", { name: /send message/i }).click();

    // MPC-7400: a successful submit redirects to /thank-you with the contact copy.
    await expect(page).toHaveURL(/\/thank-you\?source=contact/);
    await expect(page.getByRole("heading", { name: "Message sent." })).toBeVisible();
    expect(net.captured.hubspot).toHaveLength(1);
    expect(net.captured.hubspot[0].url).toContain("/submit/246502821/e2e-contact-form");
    const fields = Object.fromEntries(net.captured.hubspot[0].body.fields.map((f) => [f.name, f.value]));
    expect(fields).toMatchObject({
      firstname: "Grace", lastname: "Hopper", email: "grace@example.com", contact_topic: "Business",
      message: "Can you support our team?", source_tag: "contact-page", consent_source: "contact_page",
    });
    expect(errors).toEqual([]);
  });

  test("required fields and consent gate the submit", async ({ page, net }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page).not.toHaveURL(/thank-you/);
    await page.getByLabel("Name", { exact: true }).fill("A B");
    await page.getByLabel("Email", { exact: true }).fill("a@b.co");
    await page.getByLabel("Message").fill("hi");
    await page.getByRole("button", { name: /send message/i }).click(); // still no consent
    await expect(page).not.toHaveURL(/thank-you/);
    expect(net.captured.hubspot).toHaveLength(0);
  });

  test("shows HubSpot's error and lets the visitor retry", async ({ page, net }) => {
    net.mocks.hubspotStatus = 500;
    await page.goto("/contact");
    await fill(page);
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page.getByRole("alert")).toContainText("HubSpot rejected the submission");
    net.mocks.hubspotStatus = 200;
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page.getByText("Message sent")).toBeVisible();
    expect(net.captured.hubspot).toHaveLength(2);
  });

  test("lists the direct email contacts", async ({ page }) => {
    await page.goto("/contact");
    for (const a of ["privacy", "dpo", "legal", "accessibility"]) {
      await expect(page.locator(`a[href="mailto:${a}@myprivacytool.io"]`)).toBeVisible();
    }
  });
});
