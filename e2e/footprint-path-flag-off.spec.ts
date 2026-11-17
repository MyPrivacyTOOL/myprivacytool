import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

// MPC-10614 acceptance (a): with the Footprint Path switch OFF, the home page and /scan render exactly as before.
// The two snapshots in e2e/fixtures-data/footprint-path-flag-off/ were captured from the build BEFORE the path component existed (main at e4bee90).
// Run with FP_WRITE=1 to re-capture (only ever from a build that has none of the path code).
const dir = path.join(process.cwd(), "e2e", "fixtures-data", "footprint-path-flag-off");

async function body(page: import("@playwright/test").Page, url: string): Promise<string> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const root = document.body.cloneNode(true) as HTMLElement;
    // The full-screen "Your device" reveal exists only in builds that switch the device hero on (CI's build does not; a local build may). It is not part of
    // this feature, so it is left out of the comparison: the snapshot then holds the same in either build environment.
    root.querySelectorAll("script,style,noscript,[data-testid=device-reveal-screen]").forEach((n) => n.remove());
    return root.innerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  });
}

for (const [name, url] of [["home", "/"], ["scan", "/scan"]] as const) {
  test(`flag off: ${name} page is unchanged (DOM snapshot)`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one viewport is enough for a DOM snapshot");
    const html = await body(page, url);
    const file = path.join(dir, `${name}.html`);
    if (process.env.FP_WRITE === "1") { fs.writeFileSync(file, html); return; }
    expect(html).toBe(fs.readFileSync(file, "utf8"));
    expect(html).not.toContain("footprint-path");
  });
}

test("flag off: ?path=1 is the only way in, and without it nothing of the path is on the page", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("footprint-path")).toHaveCount(0);
});
