// CK-8493: the read-only review page, as text. Takes a measurement and the decisions already recorded; returns Markdown. Writes nothing.
// Missing data, staleness and insufficient evidence are printed first, because they change how every number below should be read.
import { type MeasurementReport } from './measure';
import { reduce, type DecisionEvent, type DecisionHeader, type DecisionState } from './decisions';

export interface DecisionRecord { header: DecisionHeader; events: readonly DecisionEvent[] }

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const when = (ms: number | null) => (ms === null ? 'none' : new Date(ms).toISOString());

export function dueChecks(records: readonly DecisionRecord[], now: number): Array<{ id: string; dueAt: number; overdue: boolean; versionToMeasure: number }> {
  const out: Array<{ id: string; dueAt: number; overdue: boolean; versionToMeasure: number }> = [];
  for (const r of records) {
    const st = reduce(r.header, r.events);
    if ((st.status === 'implemented' || st.status === 'rolled_back') && st.versionToMeasure !== null && st.outcomeChecks.length === 0) {
      out.push({ id: r.header.id, dueAt: r.header.nextOutcomeCheckDue, overdue: r.header.nextOutcomeCheckDue <= now, versionToMeasure: st.versionToMeasure });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

export function renderReview(report: MeasurementReport, records: readonly DecisionRecord[] = [], label = 'SYNTHETIC FIXTURE'): string {
  const L: string[] = [];
  const t = report.totals;
  L.push(`# Learning review (read-only) — ${label}`);
  L.push(`Rules ${report.rulesVersion}: ${report.minResponders} responders per kind, 95% Wilson interval. Below that, counts are shown and nothing is proposed. Reaching the minimum is not proof the answers are representative.`);
  L.push('');
  L.push('## Read first');
  L.push(`- Window: ${when(report.window.start)} to ${when(report.window.end)}; generated ${when(report.generatedAt)}; input digest ${report.inputDigest}`);
  L.push(`- Freshness: newest event ${when(report.freshness.newestEventAt)}${report.freshness.stale ? ' — **STALE or empty**' : ''} (report setting: ${report.freshness.maxAgeMs / 3600000} h)`);
  for (const x of report.warnings) L.push(`- WARNING ${x.code}: ${x.message}`);
  L.push(`- Events: ${t.eventsRead} read, ${t.eventsUsed} used, ${t.outOfWindow} outside window, ${t.withdrawnExcluded} withdrawn excluded, ${t.duplicateShown} repeated "shown", ${t.repeatedAnswers} later answers not counted, ${t.answersWithoutShown} answers with no "shown", ${t.cohortMismatch} cohort mismatches, ${t.missingTileKind} with no tile kind`);
  L.push('');
  L.push('## Tiles (one row per tile kind and config version; versions are never pooled)');
  L.push('| tile | kind | version | confidence shown | shown | responders | response rate | yes/not me | disputed/kept | status |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of report.cohorts) {
    const s = c.summary;
    L.push(`| ${c.hexagonId}/${c.source} | ${c.tileKind ?? '?'} | v${c.configVersion} | ${c.confidenceShown ?? 'unknown'} | ${s.shownPeople} | ${s.responders} | ${pct(s.responseRate)} | ${s.yesMe}/${s.notMe} | ${s.disputed}/${s.kept} | ${c.status === 'proposal_candidate' ? 'candidate for human review' : 'report only'} |`);
  }
  for (const c of report.cohorts) {
    for (const x of c.warnings) L.push(`- ${c.key}: ${x.code} — ${x.message}`);
    if (c.proposal) L.push(`- ${c.key}: answers suggest ${c.proposal.proposed} (95% interval ${c.proposal.interval.low}–${c.proposal.interval.high}) against ${c.proposal.current} shown; response rate ${pct(c.proposal.responseRate)}. ${c.proposal.note}`);
  }
  L.push('');
  L.push('## Version boundaries');
  for (const v of report.versionBoundaries) L.push(`- ${v.hexagonId}/${v.source}: config versions ${v.configVersions.join(', ')}`);
  L.push('');
  L.push('## Decisions and outcome checks');
  if (records.length === 0) L.push('- none recorded');
  for (const r of records) {
    const st: DecisionState = reduce(r.header, r.events);
    const h = r.header;
    L.push(`- ${h.id} (${h.target.hexagonId}/${h.target.source}, owner ${h.owner}): ${st.status}${st.decision ? ` / ${st.decision}` : ''}; hypothesis: ${h.hypothesis}`);
    L.push(`  - baseline v${h.baseline.configVersion}, ${h.baseline.responders} responders, response rate ${pct(h.baseline.responseRate)}; change ${h.proposedChange.from} → ${h.proposedChange.to} (bounds ${h.proposedChange.min}–${h.proposedChange.max}); guardrails: ${h.guardrails.map((g) => g.name).join(', ')}`);
    if (st.missingApprovals.length) L.push(`  - awaiting: ${st.missingApprovals.join('; ')}`);
    if (st.implementedConfigVersion !== null) L.push(`  - implemented as config version ${st.implementedConfigVersion}${st.rolledBackToVersion !== null ? `, rolled back to ${st.rolledBackToVersion}` : ''}`);
    for (const o of st.outcomeChecks) L.push(`  - outcome check v${o.configVersion}: ${o.result} (${o.responders} responders; not causal) — ${o.note}`);
  }
  const due = dueChecks(records, report.generatedAt);
  for (const d of due) L.push(`- outcome check ${d.overdue ? 'OVERDUE' : 'due'} for ${d.id}: ${when(d.dueAt)}, read config version ${d.versionToMeasure}`);
  L.push('');
  L.push('Scheduling: PENDING. This report is produced by a manual command only; no job is installed.');
  return L.join('\n');
}
