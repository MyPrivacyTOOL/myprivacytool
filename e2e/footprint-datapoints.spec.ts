import { test, expect } from "./fixtures";

// MPC-11541: /footprint/ shows every published data-point row of the registry as a slab with a status badge, and states no total.
// The expected numbers are read from the generated manifest and data file, never typed here.
type Slab = { id: string; label: string; channel: string; badge: "planned" | "in_build" | "live"; val: string };

async function load(page: import("@playwright/test").Page) {
  await page.goto("/footprint/");
  return page.evaluate(async () => {
    const [data, manifest] = await Promise.all([fetch("/footprint/footprint-datapoints.json").then((r) => r.json()), fetch("/footprint/footprint-datapoints.manifest.json").then((r) => r.json())]);
    return { data: data as Slab[], manifest };
  });
}

test("the page draws one slab per published data point, matching the export", async ({ page }) => {
  const { data, manifest } = await load(page);
  expect(data.length).toBe(manifest.count);
  await expect.poll(() => page.locator("#grid g.cell").count()).toBe(manifest.count);
  // per-channel counts match the data file
  const want: Record<string, number> = {};
  for (const s of data) want[s.channel] = (want[s.channel] ?? 0) + 1;
  const got = await page.locator("#grid g.cell").evaluateAll((cells) => cells.reduce((m: Record<string, number>, c) => { const k = c.getAttribute("data-channel") ?? ""; m[k] = (m[k] ?? 0) + 1; return m; }, {}));
  expect(got).toEqual(want);
});

test("every slab carries a badge, and the badge counts match the export", async ({ page }) => {
  const { manifest } = await load(page);
  await expect.poll(() => page.locator("#grid g.cell").count()).toBe(manifest.count);
  expect(await page.locator("#grid g.cell:not([data-badge])").count()).toBe(0);
  for (const b of ["planned", "in_build", "live"] as const) {
    expect(await page.locator(`#grid g.cell[data-badge='${b}']`).count()).toBe(manifest.badges[b]);
  }
  // the scored sets are the live ones: 54 web, 26 Telegram, 7 email, 10 X
  expect(manifest.scored).toEqual({ web: 54, telegram: 26, email: 7, x: 10 });
  expect(manifest.badges.live).toBe(54 + 26 + 7 + 10);
});

test("no placeholder, control or dropped row is user-visible", async ({ page }) => {
  const { data, manifest } = await load(page);
  expect(data.some((s) => /deepseekblack/i.test(`${s.id} ${s.label}`))).toBe(false);
  expect(data.some((s) => /^(hex|ctl)-/i.test(s.id))).toBe(false);
  await expect.poll(() => page.locator("#grid g.cell").count()).toBe(manifest.count);
  const labels = await page.locator("#grid g.cell").evaluateAll((cells) => cells.map((c) => c.getAttribute("aria-label") ?? ""));
  expect(labels.some((l) => /deepseekblack/i.test(l))).toBe(false);
});

test("the page states no total anywhere in its copy", async ({ page }) => {
  const { manifest } = await load(page);
  await expect.poll(() => page.locator("#grid g.cell").count()).toBe(manifest.count);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(new RegExp(`\\b${manifest.count}\\b`));
  expect(text).not.toMatch(/\b36[68]\b/);
  expect(await page.locator("#grid").getAttribute("aria-label")).toBe("Data points");
});

test("a planned slab says it is not checked by MPT yet and offers no scan", async ({ page }) => {
  const { manifest } = await load(page);
  await expect.poll(() => page.locator("#grid g.cell").count()).toBe(manifest.count);
  await page.locator("#openCurtain").click();
  await page.locator("#mBoxes").click();
  const tile = page.locator(".tile", { has: page.locator(".chip.planned") }).first();
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page.getByTestId("panel-badge")).toHaveText("Status: Planned");
  await expect(page.locator("#panel")).toContainText(/not checked by mpt yet/i);
  await expect(page.locator("#panel").getByRole("button", { name: "Run deep scan" })).toHaveCount(0);
});

test("a live slab is badged Live in the by-pattern view", async ({ page }) => {
  await load(page);
  await expect.poll(() => page.locator("#grid g.cell").count()).toBeGreaterThan(54);
  await page.locator("#openCurtain").click();
  await page.locator("#mBoxes").click();
  const live = page.locator(".tile .chip.live");
  expect(await live.count()).toBeGreaterThan(0);
  await expect(live.first()).toHaveText("Live");
});
