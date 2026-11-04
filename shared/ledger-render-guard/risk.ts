/**
 * MPC-8753 — the risk axis, application side (design MPC-7898 Amendment A3 + A3.9). The pure twin of ledger._risk_eval / ledger.render_progress_risk;
 * both are held to the same rules by the property tests in risk.vitest.ts and the SQL assertions in supabase/tests/mpc-8753-risk-axis.test.sql.
 *
 *   - Risk state is DERIVED, never stored: unknown (no row) -> educated -> accepted | removed, per claim and per SCAN (A3.9 D7: no reopen, a new scan starts at unknown).
 *   - The axis applies only to a FOUND claim that the person has not marked not_me. Not checked, failed, stale and clear are never risk and never in the score.
 *   - An education or decision covers a claim only for the same scan and the same value hash; a changed value (or consequence text version) voids it.
 *   - The score is a whole number: unaddressed_risk = unknown + educated. There is no ratio, percentage or float anywhere in the return type (G6).
 */
export type RiskState = 'not_applicable' | 'unknown' | 'educated' | 'accepted' | 'removed' | 'not_me';
export type NotApplicableReason = 'no_risk_axis' | 'not_checked' | 'clear';

export interface RiskClaim {
  /** Registry risk_applicable. */
  riskApplicable: boolean;
  /** Status of the claim's current checked/taken data point; null when there is none. */
  status: 'found' | 'clear' | 'not_checked' | 'check_failed' | null;
  expired: boolean;
  /** The person's latest identity answer for this claim is not_me / disputed. */
  notMe: boolean;
  /** Hash of the current found value. */
  valueHash: string | null;
  scanKey: string;
  /** Registry consequence_version (null = no approved text). */
  consequenceVersion: number | null;
  educations: { valueHash: string; scanKey: string; consequenceVersion: number | null; shownAt: number }[];
  decisions: { kind: 'accepted' | 'removed'; valueHash: string; scanKey: string; decidedAt: number }[];
}

export function riskState(c: RiskClaim): { state: RiskState; reason?: NotApplicableReason } {
  if (!c.riskApplicable) return { state: 'not_applicable', reason: 'no_risk_axis' };
  if (c.status === null || (c.status !== 'found' && c.status !== 'clear') || c.expired) return { state: 'not_applicable', reason: 'not_checked' };
  if (c.status === 'clear') return { state: 'not_applicable', reason: 'clear' };
  if (c.notMe) return { state: 'not_me' };
  const d = c.decisions.filter((x) => x.scanKey === c.scanKey && x.valueHash === c.valueHash).sort((a, b) => b.decidedAt - a.decidedAt)[0];
  if (d) return { state: d.kind };
  const e = c.educations.find((x) => x.scanKey === c.scanKey && x.valueHash === c.valueHash && x.consequenceVersion === c.consequenceVersion);
  return { state: e ? 'educated' : 'unknown' };
}

/** H12 in one function: an acceptance is legal only from `educated` (same claim, same scan, same value, current consequence text). */
export function canAccept(c: RiskClaim): boolean { return riskState(c).state === 'educated'; }

export interface RiskProgress {
  unaddressedUnknown: number;
  unaddressedEducated: number;
  /** The score: unknown + educated. */
  unaddressedRisk: number;
  accepted: number;
  removed: number;
  clear: number;
  notMe: number;
  notChecked: number;
  riskNotApplicable: number;
}

/** The risk buckets partition the profile: every expected item lands in exactly one (G7 extended). Errors fail closed into notChecked, never into accepted. */
export function riskProgress(items: RiskClaim[] | null | undefined): RiskProgress {
  const p: RiskProgress = { unaddressedUnknown: 0, unaddressedEducated: 0, unaddressedRisk: 0, accepted: 0, removed: 0, clear: 0, notMe: 0, notChecked: 0, riskNotApplicable: 0 };
  for (const it of items ?? []) {
    let r: ReturnType<typeof riskState>;
    try { r = riskState(it); } catch { p.notChecked++; continue; }
    switch (r.state) {
      case 'unknown': p.unaddressedUnknown++; break;
      case 'educated': p.unaddressedEducated++; break;
      case 'accepted': p.accepted++; break;
      case 'removed': p.removed++; break;
      case 'not_me': p.notMe++; break;
      default: if (r.reason === 'clear') p.clear++; else if (r.reason === 'no_risk_axis') p.riskNotApplicable++; else p.notChecked++;
    }
  }
  p.unaddressedRisk = p.unaddressedUnknown + p.unaddressedEducated;
  return p;
}
