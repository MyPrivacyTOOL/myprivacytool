import { buildDefectHandoff, type DefectHandoff, type DefectInput } from "../../src/lib/supportDefectHandoff";

// MPC-8529: sending a SANITISED defect report to the existing authorised engineering workflow.
// The real intake (a reviewed Notion task or GitHub issue) has not been named or approved, so no real implementation exists
// here. This is only the port and the safe calling rule; wiring a real sender is a separate, approved step.

/** Implemented later by an approved intake. It receives the already-sanitised payload only. */
export interface EngineeringIntake { submit(h: DefectHandoff): Promise<{ reference: string }> }

export type HandoffResult = { sent: true; reference: string; redactions: number } | { sent: false; reason: "intake_unavailable" | "not_configured"; redactions: number };

/**
 * Sanitises first, then submits. A failed or missing intake NEVER throws into the support flow and NEVER becomes a message to a
 * person: the case simply stays as it is, and the caller reports "not sent". No automatic production fix is possible: the payload
 * has no such field (autoFixAllowed is always false).
 */
export async function reportDefect(intake: EngineeringIntake | null, input: DefectInput): Promise<HandoffResult> {
  const handoff = buildDefectHandoff(input);
  if (!intake) return { sent: false, reason: "not_configured", redactions: handoff.redactions };
  try {
    const { reference } = await intake.submit(handoff);
    return { sent: true, reference, redactions: handoff.redactions };
  } catch {
    return { sent: false, reason: "intake_unavailable", redactions: handoff.redactions };
  }
}
