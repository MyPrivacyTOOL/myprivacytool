import { test, expect, type Page } from "./fixtures";

// MPC-7916: the honest tiles (flag off by default). ?hex_v2=1 turns the tiles on in one tab, ?hex_v2=2 adds the one-job-per-screen layout.
// A tap means "seen", not "confirmed"; no tile, hint or Alice line shows a percentage, a risk score or "click to confirm".
const FORBIDDEN = /data points about you|without asking|click to confirm|confidence|risk score|\d+\s?%/i;

// What Alice says aloud: capture the utterance handed to speechSynthesis (the browser's own voice is not available in CI).
async function captureSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    // speechSynthesis is a read-only accessor on window in a real browser, so it has to be redefined, not assigned.
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class { text: string; onend: (() => void) | null = null; constructor(t: string) { this.text = t; } },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { getVoices: () => [], cancel: () => {}, speak: (u: { text: string }) => { w.__spoken.push(u.text); } },
    });
  });
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("honest tiles: no percentage or score, a tap means seen, the hint says it confirms nothing", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?hex_v2=1");
  await expect(page.getByTestId("risk-profile")).toBeVisible({ timeout: 30_000 });
  // the old confirmation bar, counter and risk card are gone
  await expect(page.getByTestId("confirmation-progress")).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByTestId("risk-profile")).not.toContainText("%");

  const tiles = page.locator('[role="list"][aria-label="Detected data points"] [role="button"]');
  await expect(tiles.first()).toBeVisible();
  const first = (await tiles.first().getAttribute("aria-label")) ?? "";
  expect(first).not.toMatch(/%|Confidence|Tap to confirm/);

  // a tap shows the explanation and does not turn the tile into a "confirmed" one
  const explanation = page.getByTestId("hexagon-explanation-text");
  await expect(async () => {
    await tiles.first().click();
    await expect(explanation).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  expect(((await explanation.textContent()) ?? "").length).toBeGreaterThan(10);
  expect((await tiles.first().getAttribute("aria-label")) ?? "").not.toMatch(/Confirmed|%/);
  await expect(page.getByTestId("hexagon-explanation")).not.toContainText(FORBIDDEN);
  await expect(page.getByTestId("hexagon-explanation-hint")).toHaveCount(0);

  // every visible tile label is free of the forbidden words
  for (const label of await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))) {
    expect(label).not.toMatch(FORBIDDEN);
  }
});

test("honest tiles: Alice says what the tile says, with no score or 'click to confirm'", async ({ page }) => {
  test.setTimeout(120_000);
  await captureSpeech(page);
  await page.goto("/?hex_v2=1");
  await expect(page.getByTestId("risk-profile")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /voice ai/i }).click();
  const lines = await spoken(page);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/I look at what your browser tells every website/);
  expect(lines[0]).not.toMatch(FORBIDDEN);
  // the stored best score / scan count badge is not shown
  await expect(page.getByText(/Best:/)).toHaveCount(0);
});

test("honest tiles, one job per screen: Alice (inside the closed 'Ask Alice' box) keeps to the same words", async ({ page }) => {
  test.setTimeout(120_000);
  await captureSpeech(page);
  await page.goto("/?hex_v2=2");
  const details = page.getByTestId("voice-details");
  await expect(details).toBeVisible({ timeout: 30_000 });
  await details.locator("summary").click();
  await page.getByRole("button", { name: /voice ai/i }).click();
  const lines = await spoken(page);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toMatch(FORBIDDEN);
  await expect(page.getByText(/Best:/)).toHaveCount(0);
});

test("with the flag off the old screen is unchanged", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("confirmation-counter")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("risk-profile")).toHaveCount(0);
});
