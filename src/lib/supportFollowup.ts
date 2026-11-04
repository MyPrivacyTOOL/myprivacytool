// MPC-8529: pure helpers for the support follow-up watchdog and for honest outage wording.
// Built on the MPC-8528 case states (shared/support/states.ts). The retry/cost numbers are still PROPOSALS pending MPC-8530.
// The backoff, bound and transition table below mirror supabase/proposed/mpc_8529_support_followup.sql;
// supportFollowup.test.ts fails if they drift apart.

export const BACKOFF_MINUTES = [15, 60, 360] as const; // 15 min, 1 h, 6 h
export const MAX_ATTEMPTS = 3;

export type AttemptOutcome = "attempted" | "delivered" | "failed";
/** MPC-8528 case state. This module never invents a state of its own. */
export type CaseState =
  | "new" | "triage" | "diagnosing" | "action_running" | "waiting_customer" | "waiting_system" | "resolved" | "closed" | "reopened" | "blocked";
export type FollowupReason = "reply_delivery_failed" | "followup_exhausted" | null;

/** States in which follow-up never acts: finished, or exhausted and honestly reported as unresolved. */
export const TERMINAL_STATES: readonly CaseState[] = ["resolved", "closed", "blocked"];

export function backoffMinutes(failures: number): number {
  const i = Math.min(Math.max(failures, 1), BACKOFF_MINUTES.length) - 1;
  return BACKOFF_MINUTES[i];
}

/**
 * What happens to the case after an outbound attempt. Only `delivered` counts as delivered; `attempted` (no receipt) and `failed`
 * use up the bound. Exhaustion is `blocked` with reason `followup_exhausted`: MPC-8528 has no separate "exhausted" state.
 */
export function nextAfterAttempt(failuresSoFar: number, outcome: AttemptOutcome):
  { state: CaseState; reason: FollowupReason; failures: number; retryInMinutes: number | null; delivered: boolean } {
  if (outcome === "delivered") return { state: "waiting_customer", reason: null, failures: 0, retryInMinutes: null, delivered: true };
  const failures = failuresSoFar + 1;
  if (failures >= MAX_ATTEMPTS) return { state: "blocked", reason: "followup_exhausted", failures, retryInMinutes: null, delivered: false };
  return { state: "waiting_system", reason: "reply_delivery_failed", failures, retryInMinutes: backoffMinutes(failures), delivered: false };
}

/** Customer silence never closes a case; only a proposed resolution with a verified outcome resolves it. */
export function canResolve(state: CaseState, proposed: boolean, outcomeVerified: boolean): boolean {
  return !TERMINAL_STATES.includes(state) && proposed && outcomeVerified;
}

// ---- Honest outage wording -------------------------------------------------------------------------------------------
export type Dependency = "website" | "ai" | "backend" | "transport" | "scheduler";

export interface Availability {
  /** The path the visitor can use right now. */
  path: "faq_only" | "intake_saved" | "intake_unconfirmed" | "retry_later" | "degraded_followup";
  /** True only when the fallback shares none of the failed dependencies. Never claimed for fallbacks on the same host/database. */
  independent: boolean;
  message: string;
}

// Dependencies the current help/intake path shares. Today everything runs on the website host; the database also backs intake.
const SHARED_WITH_HELP: readonly Dependency[] = ["website"];
const SHARED_WITH_INTAKE: readonly Dependency[] = ["website", "backend"];

export function describeAvailability(failed: readonly Dependency[], intakeConfirmedSaved = false): Availability {
  const has = (d: Dependency) => failed.includes(d);
  if (has("website")) {
    return { path: "retry_later", independent: false,
      message: "This site is not responding, and any help page on the same host would not work either. Please try again shortly. Nothing you entered has been saved." };
  }
  if (has("backend")) {
    return { path: "retry_later", independent: false,
      message: "We could not save your request just now, so there is no case reference. Please try again later. Nothing has been sent." };
  }
  if (has("ai")) {
    return { path: intakeConfirmedSaved ? "intake_saved" : "faq_only", independent: false,
      message: intakeConfirmedSaved
        ? "The AI assistant is unavailable. Your request is saved and the case reference shown is real."
        : "The AI assistant is unavailable. The FAQ still works. Your request has not been saved." };
  }
  if (has("transport")) {
    return { path: "intake_unconfirmed", independent: false,
      message: "Your request is saved, but we could not confirm that our message to you was delivered. We will retry a limited number of times; check this page for the case status." };
  }
  if (has("scheduler")) {
    return { path: "degraded_followup", independent: false,
      message: "Your request is saved, but automatic follow-up is delayed. The promised update time may be missed." };
  }
  return { path: "faq_only", independent: false, message: "Help is available." };
}

/** True only if no failed dependency is shared with the fallback path (kept explicit so nobody labels a shared-host fallback independent). */
export function isIndependentFallback(failed: readonly Dependency[], sharedWith: readonly Dependency[]): boolean {
  return failed.length > 0 && !failed.some((d) => sharedWith.includes(d));
}

export { SHARED_WITH_HELP, SHARED_WITH_INTAKE };
