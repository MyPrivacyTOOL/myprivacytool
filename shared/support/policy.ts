import type { IdentityLevel } from "./types";

/**
 * Action policy. This is CONFIGURATION, not model instruction: the gateway reads it, the model cannot change it.
 * Nothing is approved in this repo. A tool runs only when its entry has `approvedPolicyVersion` set, which must come
 * from an accepted MPC-8530 decision record. Unlisted tools do not exist.
 */
export interface ToolPolicy {
  approvedPolicyVersion: string | null;
  requiredIdentity: IdentityLevel;
  maxCallsPerHour: number;
  maxCostUnitsPerDay: number;
  timeoutMs: number;
}
/**
 * Model-spend caps (MPC-8530 decision D-7, approved by Chris 2026-10-27). Amounts are micro-US-dollars (1e-6 USD) so they fit the
 * integer `cost_units` column. `estimatedMicroUsdPerCall` is what is reserved BEFORE each model call, because the true cost is only
 * known afterwards; a response that reports a higher `costMicroUsd` has the difference recorded. The day cap is a rolling 24 hours.
 * PLACEHOLDERS until two weeks of measured data: the numbers are not a forecast of real cost.
 */
export interface ModelBudget { maxCallsPerCase: number; maxMicroUsdPerCase: number; maxMicroUsdPerDay: number; estimatedMicroUsdPerCall: number }
export interface SupportPolicy { version: string; tools: Record<string, ToolPolicy>; maxToolCallsPerTurn: number; modelBudget: ModelBudget }

/** D-7: about US$0.05 per case, US$5 per day, 5 model calls per case. */
export const APPROVED_MODEL_BUDGET: ModelBudget = { maxCallsPerCase: 5, maxMicroUsdPerCase: 50_000, maxMicroUsdPerDay: 5_000_000, estimatedMicroUsdPerCall: 10_000 };

export const UNAPPROVED_POLICY_VERSION = "unapproved-0";

/** Shipped default: every tool disabled. */
export const DEFAULT_POLICY: SupportPolicy = { version: UNAPPROVED_POLICY_VERSION, maxToolCallsPerTurn: 3, tools: {}, modelBudget: APPROVED_MODEL_BUDGET };

/** Names that must stay disabled until an approved, identity-checked policy and tool implementation exist. */
export const SENSITIVE_ACTIONS = [
  "account_recovery", "report_resend", "grant_entitlement", "cancel_subscription", "refund", "export_data", "delete_data",
  "production_repair", "send_marketing", "start_scan", "charge",
] as const;
