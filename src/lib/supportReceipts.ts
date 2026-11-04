// MPC-8529: restricted, versioned, timestamped test receipts with expected vs actual outcomes.
// A receipt states its evidence class so mocked results are never read as real-channel results, and it carries no personal
// data: only check names, outcomes and counts. Write receipts to CI artifacts, not to broadly shared logs.

export type EvidenceClass = "mocked" | "isolated_integration" | "real_channel";

export interface ReceiptCheck {
  name: string;
  expected: string;
  actual: string;
  evidence: EvidenceClass;
}

export interface Receipt {
  schema: "mpt.support.receipt/1";
  task: string;
  runId: string;
  generatedAt: string;          // ISO timestamp
  commit: string | null;
  contractsProvisional: boolean; // true until MPC-8528 / MPC-8530 contracts replace the provisional ones
  checks: (ReceiptCheck & { pass: boolean })[];
  summary: { total: number; passed: number; failed: number; byEvidence: Record<EvidenceClass, number> };
  /** Highest evidence class actually present. A run with only mocked checks can never claim more. */
  strongestEvidence: EvidenceClass | "none";
}

const RANK: Record<EvidenceClass, number> = { mocked: 1, isolated_integration: 2, real_channel: 3 };
const PII = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b[A-Za-z0-9_-]{32,}\b/;

export function buildReceipt(opts: { task: string; runId: string; now: Date; commit?: string | null; contractsProvisional: boolean; checks: ReceiptCheck[] }): Receipt {
  for (const c of opts.checks) {
    if (PII.test(c.name + c.expected + c.actual)) throw new Error(`receipt check "${c.name.slice(0, 40)}" appears to contain personal data or a token`);
  }
  const checks = opts.checks.map((c) => ({ ...c, pass: c.expected === c.actual }));
  const byEvidence: Record<EvidenceClass, number> = { mocked: 0, isolated_integration: 0, real_channel: 0 };
  for (const c of checks) byEvidence[c.evidence] += 1;
  const strongest = checks.reduce<EvidenceClass | "none">((best, c) => (best === "none" || RANK[c.evidence] > RANK[best] ? c.evidence : best), "none");
  const passed = checks.filter((c) => c.pass).length;
  return {
    schema: "mpt.support.receipt/1",
    task: opts.task,
    runId: opts.runId,
    generatedAt: opts.now.toISOString(),
    commit: opts.commit ?? null,
    contractsProvisional: opts.contractsProvisional,
    checks,
    summary: { total: checks.length, passed, failed: checks.length - passed, byEvidence },
    strongestEvidence: strongest,
  };
}

/** A receipt may only be called "verified live" if it contains a passing real-channel check and no failures. */
export function isLiveVerified(r: Receipt): boolean {
  return r.summary.failed === 0 && r.checks.some((c) => c.evidence === "real_channel" && c.pass);
}
