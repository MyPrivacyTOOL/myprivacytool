import plansData from "@/data/plans.generated.json";

// MPC-7502: the plans come from the Supabase table public.plans, copied into src/data/plans.generated.json by scripts/sync-plans.mjs
// before each build. Change prices in Supabase, not here.
export interface PlanRow {
  slug: string;
  name: string;
  monthly_price_cents: number;
  scans_label: string;
  note: string | null;
}

export const PLAN_ROWS = plansData as PlanRow[];

// 799 -> "$7.99", 0 -> "$0", 4900 -> "$49"
export const formatMonthlyPrice = (cents: number): string => {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
};
