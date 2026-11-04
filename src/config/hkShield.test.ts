import { describe, expect, it } from "vitest";
import { HK_SHIELD_ENABLED, HK_SHIELD_PLANS, HK_SHIELD_TARGETS, yearlySavingPercent } from "./hkShield";

describe("hkShield config (MPC-7647)", () => {
  it("keeps the approved launch prices", () => {
    expect(HK_SHIELD_PLANS.monthly.priceUsd).toBe(4.99);
    expect(HK_SHIELD_PLANS.yearly.priceUsd).toBe(39.99);
  });
  it("yearly saves about a third over twelve monthly payments", () => {
    expect(yearlySavingPercent()).toBe(33);
  });
  it("is off until the app ships", () => {
    expect(HK_SHIELD_ENABLED).toBe(false);
  });
  it("keeps the launch targets", () => {
    expect(HK_SHIELD_TARGETS).toEqual({ paidSubscribers: 100, maxMonthlyChurn: 0.05 });
  });
});
