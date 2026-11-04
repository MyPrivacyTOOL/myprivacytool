// MPC-8538: conversion forms under network failure modes the HTTP-status mocks in ./fixtures can't express.
// A visitor on a train or a flaky café Wi-Fi must never lose what they typed, never be told it worked when it
// didn't, and never submit twice because the button stayed live while the request was in flight.
import { test, expect, consoleErrors, HUBSPOT, SUPABASE_SUBSCRIBERS } from "./net-sim";
import type { Page } from "@playwright/test";

const fillContact = async (page: Page) => {
  await page.getByLabel("Name", { exact: true }).fill("Grace Hopper");
  await page.getByLabel("Email", { exact: true }).fill("grace@example.com");
  await page.getByLabel("Topic").selectOption("Business");
  await page.getByLabel("Message").fill("Can you support our team?");
  await page.getByRole("checkbox").check();
};
const openWaitlist = async (page: Page) => {
  await page.goto("/start");
  await page.getByRole("button", { name: /join the list/i }).click();
  await page.getByPlaceholder("your@email.com").fill("e2e@example.com");
  await page.getByRole("checkbox").check();
};

test.describe("/contact under network failure", () => {
  test("a dropped connection shows an error, keeps the message, and a retry succeeds", async ({ page, sim, net }) => {
    const errors = consoleErrors(page);
    await sim.abort(HUBSPOT);
    await page.goto("/contact");
    await fillContact(page);
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).not.toHaveURL(/thank-you/);
    await expect(page.getByLabel("Message")).toHaveValue("Can you support our team?");
    await page.unroute(HUBSPOT);
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page).toHaveURL(/\/thank-you\?source=contact/);
    expect(net.captured.hubspot).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("while the request is in flight the button can't send a second copy", async ({ page, sim, net }) => {
    const gate = await sim.hang(HUBSPOT);
    const sent = sim.count(HUBSPOT);
    await page.goto("/contact");
    await fillContact(page);
    const send = page.getByRole("button", { name: /send message|sending/i });
    await send.click();
    await send.click({ force: true, timeout: 2000 }).catch(() => {});
    await send.click({ force: true, timeout: 2000 }).catch(() => {});
    gate.release();
    await expect(page).toHaveURL(/\/thank-you\?source=contact/);
    expect(sent()).toBe(1);
    expect(net.captured.hubspot).toHaveLength(1);
  });
});

test.describe("/start waitlist under network failure", () => {
  test("a timeout shows an error and the form stays usable", async ({ page, sim }) => {
    await sim.abort(HUBSPOT, "timedout");
    await openWaitlist(page);
    await page.getByRole("button", { name: /check my exposure/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByPlaceholder("your@email.com")).toHaveValue("e2e@example.com");
    await expect(page.getByRole("button", { name: /check my exposure/i })).toBeEnabled();
  });

  test("a slow HubSpot (3 s) still lands on the thank-you page exactly once", async ({ page, sim, net }) => {
    await sim.delay(HUBSPOT, 3000);
    await openWaitlist(page);
    const submit = page.getByRole("button", { name: /check my exposure/i });
    await submit.click();
    await submit.click({ force: true, timeout: 1000 }).catch(() => {});
    await expect(page).toHaveURL(/\/thank-you\?source=start/, { timeout: 15_000 });
    expect(net.captured.hubspot).toHaveLength(1);
  });
});

test.describe("/newsletter under network failure", () => {
  test("a dropped connection is reported and does not show the success state", async ({ page, sim, net }) => {
    await sim.abort(SUPABASE_SUBSCRIBERS);
    await page.goto("/newsletter");
    await page.getByPlaceholder("your@email.com").fill("e2e-news@example.com");
    await page.getByRole("button", { name: /subscribe to privacy check/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: /subscribe to privacy check/i })).toBeVisible();
    expect(net.captured.supabase).toHaveLength(0);
  });
});

// KNOWN BUG MPC-8539 (found by this suite): every route is a lazy chunk (src/App.tsx) and there is no error boundary or
// `vite:preloadError` handler. If a chunk can't load, React unmounts and the visitor gets a blank white page.
// The common real-world trigger is a deploy: a visitor who opened the site before a Cloudflare Pages release
// still holds the old chunk hashes; the next navigation asks for a file that no longer exists.
// These are marked test.fail() so CI stays green; when the app handles it, they will start "unexpectedly
// passing" and Playwright will tell you to remove the annotation.
test.describe("lazy route chunk unavailable (stale deploy / dropped connection)", () => {
  const STALE_CHUNK = /\/assets\/(ThankYou|Scan)-[\w-]+\.js$/;

  test("submitting /contact after a new deploy still shows a confirmation, not a blank page", async ({ page, sim, net }) => {
    test.fail(true, "MPC-8539: blank page, no chunk-load recovery (see comment above)");
    await page.goto("/contact");
    await fillContact(page);
    await sim.json(STALE_CHUNK, "gone", 404); // the old hashed file is gone after the deploy
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page).toHaveURL(/\/thank-you\?source=contact/);
    expect(net.captured.hubspot).toHaveLength(1); // the lead *was* sent ...
    await expect(page.locator("body")).not.toHaveText("", { timeout: 5000 }); // ... but the visitor must see that
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 5000 });
  });

  test("losing the connection, then following a link, keeps the page usable", async ({ page, sim }) => {
    test.fail(true, "MPC-8539: blank page, no chunk-load recovery (see comment above)");
    await page.goto("/start");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await sim.offline();
    await page.getByRole("button", { name: /not now/i }).click();
    await page.getByRole("main").getByRole("link", { name: /check my exposure/i }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 5000 });
  });
});
