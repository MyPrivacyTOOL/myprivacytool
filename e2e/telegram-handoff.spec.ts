import { test, expect } from "./fixtures";

// MPC-8689: the web side of the Telegram-to-Web handoff, in a real browser. /api/footprint is mocked (the real one needs a one-time link and a database),
// so this proves what the page does with the answer: add the Telegram hexagons that ran to the footprint line, label them, and make no claim without a valid session.
// The 30 Telegram baseline hexagon ids (shared/hexagon-registry/channels.js TELEGRAM_HEXAGONS), written out so this spec does not import the registry.
const TG_IDS = ["tg.numeric_id", "tg.first_name", "tg.last_name", "tg.username", "tg.language", "tg.message_time", "tg.message_text", "tg.message_counter", "tg.update_counter", "tg.bio", "tg.birthday", "tg.photo_current", "tg.photo_history", "tg.photo_fingerprint", "tg.extra_usernames", "tg.premium", "tg.emoji_status", "tg.profile_colour", "tg.profile_background", "tg.gift_settings", "tg.business_intro", "tg.business_location", "tg.business_hours", "tg.personal_channel", "tg.channel_posts", "tg.forward_privacy", "tg.voice_restriction", "tg.phone_shared", "tg.location_shared", "tg.group_role"];
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const grid = "/?view=grid";

async function scanSettled(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("confirmation-counter")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("footprint-line").first()).toBeVisible({ timeout: 15_000 });
}

test("opened with ?handoff=1 and a valid session, the footprint line counts the Telegram part and says where it came from", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/footprint", (route) => { asked++; return route.fulfill(json(200, { channels: [{ channel: "telegram", checked_ids: TG_IDS, scan_at: "2026-10-31T10:00:00Z", scan_version: "telegram-baseline-1" }] })); });
  await page.goto(`${grid}&handoff=1`);
  await scanSettled(page);
  const line = page.getByTestId("footprint-line").first();
  await expect(line).toContainText(`Telegram ${TG_IDS.length} of 47`, { timeout: 15_000 });
  await expect(line).toContainText("Telegram part from your Telegram scan");
  await expect(line).toContainText(/of 368 footprint hexagons checked/);
  expect(asked).toBe(1);
  await expect(page.getByTestId("telegram-handoff-notice")).toContainText(`${TG_IDS.length} Telegram checks`);
});

test("without ?handoff=1 the page never asks for the Telegram result and makes no Telegram claim", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/footprint", (route) => { asked++; return route.fulfill(json(200, { channels: [{ channel: "telegram", checked_ids: TG_IDS }] })); });
  await page.goto(grid);
  await scanSettled(page);
  await expect(page.getByTestId("footprint-line").first()).not.toContainText("Telegram");
  await expect(page.getByTestId("telegram-handoff-notice")).toHaveCount(0);
  expect(asked).toBe(0);
});

test("with ?handoff=1 but no valid session (401), no Telegram claim is made", async ({ page }) => {
  await page.route("**/api/footprint", (route) => route.fulfill(json(401, { error: "no_session" })));
  await page.goto(`${grid}&handoff=1`);
  await scanSettled(page);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("telegram-handoff-notice")).toHaveCount(0);
  await expect(page.getByTestId("footprint-line").first()).not.toContainText("Telegram");
});

test("a wrong answer (ids that are not hexagons, values instead of ids) adds nothing", async ({ page }) => {
  await page.route("**/api/footprint", (route) => route.fulfill(json(200, { channels: [{ channel: "telegram", checked_ids: ["<script>", "not-a-hexagon", "Springfield, Exampleshire"] }, { channel: "web", checked_ids: ["location"] }] })));
  await page.goto(`${grid}&handoff=1`);
  await scanSettled(page);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("footprint-line").first()).not.toContainText("Telegram");
  await expect(page.getByTestId("telegram-handoff-notice")).toHaveCount(0);
});
