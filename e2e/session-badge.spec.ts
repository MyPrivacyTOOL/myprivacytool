// MPC-6971: header "Connected as <email>" + Sign out, driven by the OAuth Worker's /v1/session (mocked here).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const WORKER = "https://myprivacytool-oauth-poc.myprivacytool.workers.dev";
const ORIGIN = "http://127.0.0.1:4173";
const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET, DELETE, OPTIONS" };

/** Fakes the Worker. `signedIn` flips to false after a DELETE, like the real cookie being cleared. */
async function mockWorker(page: Page, opts: { signedIn: boolean }) {
  const calls: string[] = [];
  let signedIn = opts.signedIn;
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    calls.push(`${req.method()} ${path}`);
    if (path === "/v1/session" && req.method() === "DELETE") {
      signedIn = false;
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    if (path === "/v1/session") {
      return signedIn
        ? route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { sub: "1", email: "ann@example.com", email_verified: true }, scopes: ["identity:read"], expires_at: new Date(Date.now() + 3_600_000).toISOString() }) })
        : route.fulfill({ status: 401, headers: cors, contentType: "application/json", body: JSON.stringify({ authenticated: false, error: "unauthenticated" }) });
    }
    return route.abort();
  });
  return calls;
}

test("a visitor who never signed in sees no badge and triggers no request to the Worker", async ({ page }) => {
  const calls = await mockWorker(page, { signedIn: false });
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByText("Connected as")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("after the sign-in redirect the header shows who is connected, and Sign out ends it", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop header; the mobile menu is covered below");
  const calls = await mockWorker(page, { signedIn: true });
  await page.goto("/?channel=google");
  await expect(page.getByText("Connected as")).toBeVisible();
  await expect(page.getByText("ann@example.com")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Connected as")).toHaveCount(0);
  expect(calls).toContain("DELETE /v1/session");

  // A reload must not show the badge and must not even ask the Worker again (the hint was cleared).
  const before = calls.length;
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByText("Connected as")).toHaveCount(0);
  expect(calls.length).toBe(before);
});

test("a failed sign-in redirect (?oauth_error=) shows no badge and asks nothing", async ({ page }) => {
  const calls = await mockWorker(page, { signedIn: true });
  await page.goto("/?channel=google&oauth_error=email_not_verified");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByText("Connected as")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("on a phone the badge is visible without opening the menu and fits the screen", async ({ page }) => {
  await mockWorker(page, { signedIn: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/?channel=google");
  await expect(page.getByText("ann@example.com")).toBeVisible();
  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  const box = await signOut.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
});
