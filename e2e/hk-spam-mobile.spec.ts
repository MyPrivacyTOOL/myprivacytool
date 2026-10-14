// MPC-7446: /HongKongSpam at 360px wide, English and Traditional Chinese. Catches the layout problems seen on real
// phones: sideways scrolling, content wider than the screen, tiny tap targets, and the big button below the fold.
// ?hkpreview=1 shows the full internal view (6 menu keys in large type), the widest layout the page has.
import { test, expect, consoleErrors } from "./fixtures";

test.use({ viewport: { width: 360, height: 740 } });

const LANGS = [
  { lang: "en", dial: "Stop spam to this phone" },
  { lang: "zh", dial: "停止這部手機收到垃圾訊息" },
] as const;

for (const { lang, dial } of LANGS) {
  test.describe(`/HongKongSpam at 360px (${lang})`, () => {
    test("no sideways scroll, nothing wider than the screen, big button above the fold, 4 steps", async ({ page }) => {
      const errors = consoleErrors(page);
      await page.goto(`/HongKongSpam?hkpreview=1&lang=${lang}`);
      const button = page.getByTestId("hk-dial");
      await expect(button).toContainText(dial);

      const box = await button.boundingBox();
      expect(box, "dial button is rendered").not.toBeNull();
      expect(box!.y, "dial button starts inside the first screen").toBeLessThan(740);
      expect(box!.height, "dial button is a big target").toBeGreaterThanOrEqual(56);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(361);

      await expect(page.locator("ol > li")).toHaveCount(4);
      await expect(page.getByTestId("hk-keys").getByRole("listitem")).toHaveCount(6);

      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const offenders: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            offenders.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} "${(el.textContent ?? "").trim().slice(0, 30)}" left=${Math.round(r.left)} right=${Math.round(r.right)}`);
          }
        }
        return { vw, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 10) };
      });
      expect(overflow.scrollWidth, `page scrolls sideways: ${JSON.stringify(overflow.offenders)}`).toBeLessThanOrEqual(overflow.vw);
      expect(overflow.offenders, "elements wider than the screen").toEqual([]);
      expect(errors).toEqual([]);
    });

    test("buttons, fields and selects are comfortable tap targets", async ({ page }) => {
      await page.goto(`/HongKongSpam?hkpreview=1&lang=${lang}`);
      await expect(page.getByTestId("hk-dial")).toBeVisible();
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, select, input:not([type=checkbox]), textarea"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 40) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || el.id).trim().slice(0, 30)}" h=${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small, "tap targets under 40px tall").toEqual([]);
    });

    test("Done, spam log and opt-out sections stay inside the screen after use", async ({ page, net }) => {
      void net;
      await page.goto(`/HongKongSpam?hkpreview=1&lang=${lang}`);
      await page.getByTestId("hk-dial").evaluate((el) => el.addEventListener("click", (e) => e.preventDefault()));
      await page.locator("#hk-log-sender").fill("+852 5555 0000 a very long sender name that must wrap and not push the page wider");
      await page.locator("button", { hasText: lang === "en" ? "Add to log" : "加入記錄" }).click();
      await page.locator("#hk-sender-banks").check();
      await page.locator("button", { hasText: lang === "en" ? "Write my opt-out messages" : "撰寫退出通知" }).click();
      await expect(page.getByTestId("hk-optout-banks")).toBeVisible();
      const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      expect(scroll.sw).toBeLessThanOrEqual(scroll.vw);
    });
  });
}
