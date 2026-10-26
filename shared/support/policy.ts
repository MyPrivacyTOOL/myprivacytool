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
export interface SupportPolicy { version: string; tools: Record<string, ToolPolicy>; maxToolCallsPerTurn: number }

export const UNAPPROVED_POLICY_VERSION = "unapproved-0";

/** Shipped default: every tool disabled. */
export const DEFAULT_POLICY: SupportPolicy = { version: UNAPPROVED_POLICY_VERSION, maxToolCallsPerTurn: 3, tools: {} };

/** Names that must stay disabled until an approved, identity-checked policy and tool implementation exist. */
export const SENSITIVE_ACTIONS = [
  "account_recovery", "report_resend", "grant_entitlement", "cancel_subscription", "refund", "export_data", "delete_data",
  "production_repair", "send_marketing", "start_scan", "charge",
] as const;
