// CK-8493: one SYNTHETIC trace for the manual review command: evidence -> proposal -> explicit review -> versioned change -> follow-up outcome.
// Every row is invented (fixtures.ts). It runs entirely in memory and touches no database, no Worker and no configuration.
import { measure } from './measure';
import { headerFromCohort, outcomeCheck, type ApprovalPolicy } from './decisions';
import { MemoryDecisionStore } from './decisionStore';
import { cohortEvents, T0, DAY } from './fixtures';

export const SYNTHETIC_POLICY: ApprovalPolicy = { primaryApprover: 'chris', secondApprovers: ['second-approver-synthetic'], version: 'synthetic-trace-policy' };

export function buildSyntheticTrace() {
  const now = T0 + 10 * DAY;
  const base = cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, configVersion: 0, prefix: 'g', yes: 15, no: 45, silent: 40, at: T0 + DAY });
  const report = measure(base, { now, windowStart: T0, windowEnd: now });
  const store = new MemoryDecisionStore(SYNTHETIC_POLICY);
  const steps: string[] = [`evidence: ${report.cohorts[0].summary.responders} of ${report.cohorts[0].summary.shownPeople} answered; ${report.cohorts[0].status}`];
  const header = headerFromCohort(report.cohorts[0], {
    id: 'synthetic-dec-1', now, owner: 'chris', hypothesis: 'SYNTHETIC: 0.95 overstates how often this guess is right', windowStart: T0, windowEnd: now,
    inputDigest: report.inputDigest, rulesVersion: report.rulesVersion, guardrails: [{ name: 'honesty', description: 'No stronger claim than the answers support' }],
    nextOutcomeCheckDue: now + 14 * DAY, policy: SYNTHETIC_POLICY,
  });
  store.create(header);
  steps.push(`proposal recorded: ${header.proposedChange.from} -> ${header.proposedChange.to}`);
  store.append(header.id, { kind: 'decided', at: now + 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC: interval excludes 0.95' });
  store.append(header.id, { kind: 'approved', at: now + 2, by: 'chris' });
  steps.push('explicit review: decided change; approved by chris');
  store.append(header.id, { kind: 'implemented', at: now + 3, by: 'chris', configVersion: 1 });
  steps.push('versioned change: config version 1 recorded (SYNTHETIC; no live configuration changed)');
  const end = now + 15 * DAY;
  const follow = cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.25, configVersion: 1, prefix: 'f', yes: 18, no: 42, silent: 50, at: end - 6 * 3600 * 1000 });
  const followReport = measure([...base, ...follow], { now: end, windowStart: now, windowEnd: end });
  const check = outcomeCheck(header, followReport.cohorts.find((c) => c.configVersion === 1), { start: now, end, inputDigest: followReport.inputDigest }, { honesty: true });
  store.append(header.id, { kind: 'outcome_checked', at: end, by: 'claude', check });
  steps.push(`follow-up outcome: ${check.result} (non-causal)`);
  return { report: followReport, store, steps };
}
