import type { CaseStore } from "./types";
import type { ToolDef } from "./gateway";

/** Port the real report-status reader implements (MPC-8530 decides what it may read). Not implemented here. */
export interface ReportStatusReader { statusFor(subjectId: string, tenantId: string): Promise<{ found: boolean; status?: string }> }

/**
 * Tool definitions shipped with the scaffold. Both are read-only and both are DISABLED by DEFAULT_POLICY.
 * Recovery, resend, entitlement, refund, export, deletion and repair have no implementation (see SENSITIVE_ACTIONS).
 */
export function buildTools(store: CaseStore, reports?: ReportStatusReader): Record<string, ToolDef> {
  return {
    get_case_status: {
      name: "get_case_status", sideEffect: "read", costUnits: 0,
      async run(ctx) {
        const c = await store.getCase(ctx.caseId);
        return { ok: !!c, detail: c ? `state=${c.state}` : "case not found" };
      },
    },
    diagnose_report_status: {
      name: "diagnose_report_status", sideEffect: "read", costUnits: 1,
      async run(ctx) {
        if (!reports || !ctx.subjectId || !ctx.tenantId) return { ok: false, detail: "report status source not configured" };
        const r = await reports.statusFor(ctx.subjectId, ctx.tenantId);
        return { ok: r.found, detail: r.found ? `report status=${r.status}` : "no report found for this account" };
      },
    },
  };
}
