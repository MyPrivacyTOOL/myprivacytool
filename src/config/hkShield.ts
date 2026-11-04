// HK Spam Shield paid-feature constants (MPC-7647).
// Prices are the approved launch prices. The single source of truth for web copy, the entitlement API and store listings.
// HK_SHIELD_ENABLED stays false until the Android app is published; nothing on the web links to a purchase before then.
export const HK_SHIELD_ENABLED = false;

export const HK_SHIELD_PLANS = {
  monthly: { id: "hk_shield_monthly", priceUsd: 4.99, period: "month" },
  yearly: { id: "hk_shield_yearly", priceUsd: 39.99, period: "year" },
} as const;

export type HkShieldPlanId = (typeof HK_SHIELD_PLANS)[keyof typeof HK_SHIELD_PLANS]["id"];

/** Launch success criteria from MPC-7647, measured 30 days after the Android release. */
export const HK_SHIELD_TARGETS = { paidSubscribers: 100, maxMonthlyChurn: 0.05 } as const;

/** Whole-percent saving of yearly over twelve months of monthly. 33 at the launch prices. */
export function yearlySavingPercent(): number {
  const twelveMonths = HK_SHIELD_PLANS.monthly.priceUsd * 12;
  return Math.round((1 - HK_SHIELD_PLANS.yearly.priceUsd / twelveMonths) * 100);
}
