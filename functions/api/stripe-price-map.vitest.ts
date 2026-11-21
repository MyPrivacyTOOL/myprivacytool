import { describe, expect, it } from "vitest";
import { FAMILY_MEMBER_ADDON, PLAN_PRICES, planForPriceId, priceIdFor } from "./stripe-price-map";

const env = { STRIPE_PRICE_BASIC: "price_b1", STRIPE_PRICE_PRO: "price_p1", STRIPE_PRICE_EXECUTIVE: "price_e1" };

describe("stripe price map", () => {
  it("matches the decided tiers: USD, monthly only", () => {
    expect(Object.entries(PLAN_PRICES).map(([k, v]) => [k, v.unitAmountCents])).toEqual([["basic", 799], ["pro", 1499], ["executive", 4999]]);
    for (const p of Object.values(PLAN_PRICES)) expect([p.currency, p.interval]).toEqual(["usd", "month"]);
    expect(Object.keys(PLAN_PRICES)).not.toContain("business");
  });
  it("family add-on is $5 a month and inactive", () => {
    expect(FAMILY_MEMBER_ADDON).toMatchObject({ unitAmountCents: 500, active: false });
  });
  it("resolves each plan to its price id", () => {
    expect(priceIdFor(env, "basic")).toBe("price_b1");
    expect(priceIdFor(env, "pro")).toBe("price_p1");
    expect(priceIdFor(env, "executive")).toBe("price_e1");
  });
  it("rejects missing or malformed ids", () => {
    expect(priceIdFor({}, "pro")).toBeNull();
    expect(priceIdFor({ STRIPE_PRICE_PRO: "prod_123" }, "pro")).toBeNull();
    expect(priceIdFor({ STRIPE_PRICE_PRO: " price_ok " }, "pro")).toBe("price_ok");
  });
  it("maps a price id back to a plan, and unknown ids to null", () => {
    expect(planForPriceId(env, "price_e1")).toBe("executive");
    expect(planForPriceId(env, "price_zzz")).toBeNull();
    expect(planForPriceId({}, "price_b1")).toBeNull();
  });
});
