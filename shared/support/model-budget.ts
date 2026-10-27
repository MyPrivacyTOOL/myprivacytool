import type { CaseStore } from "./types";
import type { ModelBudget } from "./policy";

/**
 * Spend guard for model calls (MPC-8530 D-7). The tool gateway caps TOOL calls only; this caps the MODEL, per case and per day.
 * Fails closed: an invalid budget, a store error or an exceeded cap all return `ok: false`, and the caller must not call the model.
 * Counters live in the case store (`usageSince`/`recordUsage`), so they survive restarts and are shared by every Worker instance.
 * Limitation: check-then-record is not atomic across concurrent requests, so a burst can overshoot a cap by about one call per
 * concurrent request. The edge rate limiter bounds that burst; a database-side atomic reserve would remove it.
 */
const caseKey = (caseId: string) => `model:case:${caseId}`;
const DAY_KEY = "model:day";

export type Reservation = { ok: true } | { ok: false; reason: "invalid_budget" | "case_calls" | "case_spend" | "day_spend" | "store_error" };

const valid = (b: ModelBudget) =>
  [b.maxCallsPerCase, b.maxMicroUsdPerCase, b.maxMicroUsdPerDay, b.estimatedMicroUsdPerCall].every((n) => Number.isInteger(n) && n > 0);

export async function reserveModelCall(store: CaseStore, budget: ModelBudget, caseId: string, now: Date): Promise<Reservation> {
  if (!budget || !valid(budget)) return { ok: false, reason: "invalid_budget" };
  try {
    const dayStart = new Date(now.getTime() - 86_400_000).toISOString();
    const forCase = await store.usageSince(caseKey(caseId), new Date(0).toISOString());
    if (forCase.calls >= budget.maxCallsPerCase) return { ok: false, reason: "case_calls" };
    if (forCase.costUnits + budget.estimatedMicroUsdPerCall > budget.maxMicroUsdPerCase) return { ok: false, reason: "case_spend" };
    const day = await store.usageSince(DAY_KEY, dayStart);
    if (day.costUnits + budget.estimatedMicroUsdPerCall > budget.maxMicroUsdPerDay) return { ok: false, reason: "day_spend" };
    const at = now.toISOString();
    await store.recordUsage(caseKey(caseId), budget.estimatedMicroUsdPerCall, at);
    await store.recordUsage(DAY_KEY, budget.estimatedMicroUsdPerCall, at);
    return { ok: true };
  } catch {
    return { ok: false, reason: "store_error" };
  }
}

/** Record spend above the reserved estimate once the provider reports the real cost. Never throws: the call already happened. */
export async function recordModelOverage(store: CaseStore, budget: ModelBudget, caseId: string, actualMicroUsd: number | undefined, now: Date): Promise<void> {
  if (!Number.isFinite(actualMicroUsd) || (actualMicroUsd as number) <= budget.estimatedMicroUsdPerCall) return;
  const extra = Math.min(Math.ceil((actualMicroUsd as number) - budget.estimatedMicroUsdPerCall), 2_000_000_000);
  const at = now.toISOString();
  try { await store.recordUsage(caseKey(caseId), extra, at); await store.recordUsage(DAY_KEY, extra, at); } catch { /* spend already incurred; the next reserve sees the stored totals */ }
}
