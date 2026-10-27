import { test, expect } from "./fixtures";

// MPC-8529: HELP stays honest when every backend is unreachable. The `net` fixture already aborts all non-local traffic, so
// this is the "AI/support backend/transport unavailable" boundary: HELP must open on every kind of route, say the assistant is
// unavailable, and never show a chat box, a case form, a case reference, or a promise of a human reply or response time.
// Mocked-network evidence only. It does not test a real support backend (MPC-8528 is not delivered).
const ROUTES = ["/", "/faq", "/contact", "/scan", "/report", "/privacy", "/terms", "/pricing", "/blog", "/journey", "/this-page-does-not-exist"];

for (const route of ROUTES) {
  test(`HELP is honest while all backends are down: ${route}`, async ({ page }) => {
    await page.goto(route);
    const help = page.getByRole("button", { name: "Help" });
    await expect(help).toBeVisible();
    await help.focus();
    await page.keyboard.press("Enter"); // keyboard-operable

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("help-ai-status")).toContainText(/don.t have an AI assistant/i);

    const text = (await panel.innerText()).toLowerCase();
    expect(text).not.toMatch(/case (reference|number|id)|ticket|we.?ve saved|your request (is|has been) saved|a (human|person|agent) will|within \d+ ?(hours?|minutes?|days?)/);
    await expect(panel.getByRole("textbox")).toHaveCount(0); // no chat box, no case form

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(help).toBeFocused(); // focus returns; page underneath is usable
  });
}

test("HELP does not leak the page URL or a report token into any request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1")) requests.push(r.url() + " " + (r.postData() ?? "")); });
  await page.goto("/report?token=SECRET-TOKEN-123&email=person@example.invalid");
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(requests.join("\n")).not.toMatch(/SECRET-TOKEN-123|person@example\.invalid/);
});
