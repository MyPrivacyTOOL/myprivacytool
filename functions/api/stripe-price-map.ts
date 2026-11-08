// MPC-7833: the one place that says which paid plan maps to which Stripe product, amount and price-id variable.
// Decided 2026-11-08: USD, monthly billing only. No annual prices, no Business per-seat price. The family add-on
// ($5 per member per month) exists on the spine (F3, later) and is listed here only so its product can be created inactive.
// Price ids are not secrets; the Stripe secret key and webhook secret are, and never appear in this file.

export type PaidPlan = "basic" | "pro" | "executive";

export interface PlanPrice {
  productName: string;
  unitAmountCents: number;
  currency: "usd";
  interval: "month";
  /** Cloudflare Pages variable that holds the price id until checkout reads public.plans (MPC-7833 step 3). */
  priceVar: "STRIPE_PRICE_BASIC" | "STRIPE_PRICE_PRO" | "STRIPE_PRICE_EXECUTIVE";
}

export const PLAN_PRICES: Record<PaidPlan, PlanPrice> = {
  basic: { productName: "MyPrivacyTOOL Basic", unitAmountCents: 799, currency: "usd", interval: "month", priceVar: "STRIPE_PRICE_BASIC" },
  pro: { productName: "MyPrivacyTOOL Pro", unitAmountCents: 1499, currency: "usd", interval: "month", priceVar: "STRIPE_PRICE_PRO" },
  executive: { productName: "MyPrivacyTOOL Executive", unitAmountCents: 4999, currency: "usd", interval: "month", priceVar: "STRIPE_PRICE_EXECUTIVE" },
};

export const FAMILY_MEMBER_ADDON = { productName: "MyPrivacyTOOL Family member", unitAmountCents: 500, currency: "usd", interval: "month", active: false } as const;

const PRICE_ID = /^price_[A-Za-z0-9]+$/;

/** Returns the configured Stripe price id for a plan, or null if it is missing or malformed. */
export function priceIdFor(env: Record<string, string | undefined>, plan: PaidPlan): string | null {
  const v = (env[PLAN_PRICES[plan].priceVar] ?? "").trim();
  return PRICE_ID.test(v) ? v : null;
}

/** Reverse lookup for the webhook (MPC-9819): a subscription's price id -> plan slug, or null if unknown. */
export function planForPriceId(env: Record<string, string | undefined>, priceId: string): PaidPlan | null {
  for (const plan of Object.keys(PLAN_PRICES) as PaidPlan[]) if (priceIdFor(env, plan) === priceId) return plan;
  return null;
}
