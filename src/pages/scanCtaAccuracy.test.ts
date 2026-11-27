// MPC-9907: the free scan searches no broker or listing site (workers/scan-report/lib/brokerPanel.js), so no call to action may say it shows
// where a visitor's details are listed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("free scan calls to action", () => {
  it("the Hong Kong spam page says in both languages that the scan does not search for listings", () => {
    const t = read("src/data/hkSpamCopy.ts");
    expect(t).not.toMatch(/Run the free privacy scan to see where|看看在哪裏/);
    expect(t).toContain("It does not search for listings; our opt-out guides show how to remove them.");
    expect(t).toContain("掃描不會搜尋公開列出的資料");
  });
  it("the coming-soon page does not say the scan shows where data is listed", () => {
    expect(read("src/components/ComingSoonPage.tsx")).not.toMatch(/see where your (data|information) (is|may be) listed/i);
  });
});
