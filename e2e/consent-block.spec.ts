// MPC-9888: a cold visitor sees the consent block and Scan me; nothing third-party runs before the click; the click records the consent and the
// WebRTC hexagon (Google STUN) only runs after it. Screenshots of both states go to test-results/mpc-9888-*.png.
import { test, expect } from "./fixtures";

test("cold arrival: block + Scan me, no STUN or Cloudflare before the click; after the click consent is recorded and STUN is used", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __ice: unknown[] }).__ice = [];
    const Real = window.RTCPeerConnection;
    const P = function (this: unknown, c?: RTCConfiguration) { (window as unknown as { __ice: unknown[] }).__ice.push(...(c?.iceServers ?? [])); return new Real(c); } as unknown as typeof RTCPeerConnection;
    P.prototype = Real.prototype; window.RTCPeerConnection = P;
  });
  const external: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) external.push(u.hostname + u.pathname); });
  await page.goto("/?cold=1");
  await expect(page.getByTestId("scan-consent-text")).toContainText("Pressing Scan me means you agree");
  await expect(page.getByTestId("scan-consent-text")).toContainText("7 days");
  await expect(page.getByTestId("scan-me")).toBeVisible();
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => (window as unknown as { __ice: unknown[] }).__ice.length)).toBe(0);
  expect(external.filter((h) => !/mpt-scan-report/.test(h)), "no outside host before the click").toEqual([]);
  expect(external.some((h) => /\/api\/consent/.test(h))).toBe(false);
  await page.screenshot({ path: "test-results/mpc-9888-before-click.png", fullPage: false });

  await page.getByTestId("scan-me").click();
  await expect(page.getByTestId("scan-me")).toHaveCount(0);
  await expect.poll(() => external.some((h) => /\/api\/consent/.test(h))).toBe(true);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __ice: { urls: string }[] }).__ice.map((s) => s.urls).join(","))).toContain("stun.l.google.com");
  await page.screenshot({ path: "test-results/mpc-9888-after-click.png", fullPage: false });
});
