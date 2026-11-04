import type { CaseState } from "./types";

/** Explicit case state machine. Anything not listed is rejected. There is no state meaning "escalated to a person". */
const NEXT: Record<CaseState, CaseState[]> = {
  new: ["triage", "waiting_system", "blocked"],
  triage: ["diagnosing", "waiting_customer", "waiting_system", "resolved", "blocked"],
  diagnosing: ["action_running", "waiting_customer", "waiting_system", "resolved", "blocked"],
  action_running: ["diagnosing", "waiting_customer", "waiting_system", "resolved", "blocked"],
  waiting_customer: ["triage", "diagnosing", "waiting_system", "resolved", "closed", "blocked"],
  waiting_system: ["triage", "diagnosing", "waiting_customer", "resolved", "blocked"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["triage", "diagnosing", "waiting_customer", "waiting_system", "resolved", "blocked"],
  blocked: ["triage", "reopened", "resolved"],
};

export function canTransition(from: CaseState, to: CaseState): boolean { return NEXT[from].includes(to); }
export function assertTransition(from: CaseState, to: CaseState): void {
  if (!canTransition(from, to)) throw new Error(`illegal case transition ${from} -> ${to}`);
}
export const isOpen = (s: CaseState): boolean => s !== "closed";
