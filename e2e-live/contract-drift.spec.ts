// MPC-8538: does production still match what the hermetic suite replays from e2e/hars/?
// If a field is renamed or removed, or CORS changes, the replayed tests would keep passing while the real scan
// breaks. This fails first. Fix: update the app or the tests, then `npm run e2e:record-har`.
import fs from "node:fs";
import { test, expect } from "./guard";

type Har = { log: { entries: { request: { url: string }; response: { content: { text: string } } }[] } };
const har: Har = JSON.parse(fs.readFileSync("e2e/hars/visitor-recorded.har", "utf8"));
const recorded = (suffix: string) => JSON.parse(har.log.entries.find((e) => e.request.url.endsWith(suffix))!.response.content.text);
const shape = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? "null" : typeof v]));

test("whoami still has the fields and types the scan reads", async ({ page }) => {
  const res = page.waitForResponse((r) => r.url().startsWith("https://api.myprivacytool.io/whoami"));
  await page.goto("/");
  const live = await res;
  expect(live.status()).toBe(200);
  expect(live.headers()["access-control-allow-origin"]).toBe("https://www.myprivacytool.io");
  const body = await live.json();
  expect(shape(body)).toEqual(shape(recorded("/whoami")));
});

test("hk-geo still returns { country: string }", async ({ request }) => {
  const res = await request.get("/api/hk-geo");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(shape(body)).toEqual(shape(recorded("/api/hk-geo")));
  expect(body.country).toMatch(/^[A-Z]{2}$/);
});

for (const path of ["/", "/scan", "/start", "/contact", "/newsletter", "/enterprise", "/HongKongSpam", "/pricing"]) {
  test(`${path} renders in a real browser with no uncaught errors`, async ({ page, blockedWrites }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors).toEqual([]);
    expect(blockedWrites.filter((w) => !/google|analytics|clarity|facebook|hotjar/i.test(w))).toEqual([]);
  });
}
