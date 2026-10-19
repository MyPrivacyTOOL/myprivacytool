import { describe, expect, it } from "vitest";
import { PLAN_ROWS, formatMonthlyPrice } from "./plans";
import pageMeta from "@/data/pageMeta.json";

describe("plans (MPC-7502)", () => {
  it("formats cents as dollars", () => {
    expect(formatMonthlyPrice(0)).toBe("$0");
    expect(formatMonthlyPrice(799)).toBe("$7.99");
    expect(formatMonthlyPrice(4900)).toBe("$49");
    expect(formatMonthlyPrice(4999)).toBe("$49.99");
  });

  it("holds the approved tiers", () => {
    expect(PLAN_ROWS.map((p) => `${p.slug}:${p.monthly_price_cents}`)).toEqual(["free:0", "basic:799", "pro:1499", "executive:4999"]);
  });

  // The /pricing SEO description is still written by hand; this fails the build if it drifts from the table.
  it("quotes the same paid prices in the /pricing meta description", () => {
    const description: string = (pageMeta as Record<string, { description: string }>)["/pricing"].description;
    for (const p of PLAN_ROWS.filter((r) => r.monthly_price_cents > 0)) {
      expect(description).toContain(`${p.name} at ${formatMonthlyPrice(p.monthly_price_cents)}/month`);
    }
  });
});
