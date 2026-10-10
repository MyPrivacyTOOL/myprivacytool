// MPC-102: /enterprise demo request, plus full-page screenshots uploaded by CI (artifact "enterprise-screenshots").
import { test, expect, consoleErrors } from "./fixtures";

test.describe("/enterprise", () => {
  test("renders, submits to HubSpot with the enterprise-demo source tag and shows confirmation", async ({ page, net }, testInfo) => {
    const errors = consoleErrors(page);
    await page.goto("/enterprise");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Employee data exposure");
    await page.screenshot({ path: `e2e-screenshots/enterprise-${testInfo.project.name}.png`, fullPage: true });

    await page.getByPlaceholder("Work email").fill("ciso@example.com");
    await page.getByPlaceholder("Company name").fill("Example Corp");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request a demo" }).click();

    await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
    expect(net.captured.hubspot).toHaveLength(1);
    const fields = Object.fromEntries(net.captured.hubspot[0].body.fields.map((f) => [f.name, f.value]));
    expect(fields).toMatchObject({ email: "ciso@example.com", company: "Example Corp", source_tag: "enterprise-demo" });
    expect(errors).toEqual([]);
  });
});
