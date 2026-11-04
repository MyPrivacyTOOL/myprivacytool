// CK-8493: the measured-aggregation reader that sits between the raw event ledger (MPC-7915) and a human decision (decisions.ts).
// It REUSES summarise / proposalFor / wilson from aggregate.ts (30 responders per kind, 95% Wilson, response rate beside every rate, first answer
// per person per window) and adds only what was missing: cohorts by tile kind and config version, withdrawn inputs, freshness, and warnings.
// Pure and read-only: no I/O, no write, nothing applied. A "proposal candidate" is a row for a human to review, never a recommendation.
// No live reader is connected here: live aggregation waits for the validated event pipeline (CK-8492) and the consent/retention gates.
import { summarise, proposalFor, MIN_RESPONDERS, Z_95, type Answer, type AnswerEvent, type GroupSummary, type Proposal, type ShownEvent } from './aggregate';

export const RULES_VERSION = 'mpc-7915-rules-v1';   // 30 responders per kind, 95% Wilson, first answer per person/hexagon/window

/** One row of the ledger as read (mpt_hexagon_events), with the fields the browser stamped when the tile was shown. */
export interface LedgerEvent {
  type: 'shown' | 'answer';
  personKey: string;
  hexagonId: string;
  source: string;
  scanWindow: string;
  /** Milliseconds since the epoch (created_at). */
  at: number;
  answer?: Answer;
  tileKind: string | null;
  confidenceAtDisplay: number | null;
  configVersion: number;
}

export type WarningCode =
  | 'below_minimum_sample'          // fewer than 30 responders for this kind: report-only
  | 'interval_contains_current'     // enough responders, but the answers cannot be told apart from the confidence in force
  | 'missing_shown_denominator'     // answers with no matching "shown": the response rate has no honest denominator
  | 'answers_without_shown'         // some answers had no "shown" row (denominator raised to responders)
  | 'cohort_mismatch'               // an answer's own kind/version differs from what was shown to that person
  | 'missing_tile_kind'             // kind unknown, so guess and checked-finding answers cannot be separated
  | 'mixed_confidence_display'      // more than one confidence was shown in this cohort
  | 'mixed_answer_kinds'            // guess answers and dispute answers in one cohort
  | 'current_confidence_unknown'
  | 'multiple_config_versions'      // this hexagon has data under more than one version: cohorts are never pooled
  | 'stale_data'
  | 'no_data'
  | 'window_exceeds_raw_retention'  // raw rows older than retention live only in rollups, which this reader does not read
  | 'withdrawn_inputs_excluded'
  | 'rollup_inputs_not_retractable';

export interface Warning { code: WarningCode; message: string; blocking: boolean }

export interface Cohort {
  key: string;
  hexagonId: string;
  source: string;
  tileKind: string | null;
  configVersion: number;
  /** The single confidence shown in this cohort, or null when none or several were shown. */
  confidenceShown: number | null;
  basis: 'accuracy' | 'dispute' | 'unknown';
  summary: GroupSummary;
  /** 'proposal_candidate' = a row a human may review. 'report_only' = counts only; nothing is recommended. */
  status: 'proposal_candidate' | 'report_only';
  proposal: Proposal | null;
  warnings: Warning[];
}

export interface MeasureOptions {
  now: number;
  windowStart: number;
  windowEnd: number;
  /** Person keys whose consent was withdrawn or whose rows must not count. Deleted rows are simply absent from the input. */
  withdrawn?: ReadonlySet<string>;
  /** Report setting, not a measurement rule: how old the newest event may be before the report is called stale. */
  maxAgeMs?: number;
  /** Raw rows are rolled up and deleted after about 90 days; a window starting earlier is only partly visible. */
  rawRetentionMs?: number;
}

export interface MeasurementReport {
  rulesVersion: string;
  minResponders: number;
  z: number;
  window: { start: number; end: number };
  generatedAt: number;
  /** Same inputs and options give the same digest: a repeated run is recognisably the same run. */
  inputDigest: string;
  freshness: { newestEventAt: number | null; ageMs: number | null; stale: boolean; maxAgeMs: number };
  totals: {
    eventsRead: number; eventsUsed: number; outOfWindow: number; withdrawnExcluded: number;
    duplicateShown: number; repeatedAnswers: number; answersWithoutShown: number; cohortMismatch: number; missingTileKind: number;
  };
  versionBoundaries: Array<{ hexagonId: string; source: string; configVersions: number[] }>;
  cohorts: Cohort[];
  warnings: Warning[];
}

export const DEFAULT_MAX_AGE_MS = 48 * 3600 * 1000;
export const DEFAULT_RAW_RETENTION_MS = 90 * 24 * 3600 * 1000;

const w = (code: WarningCode, message: string, blocking = false): Warning => ({ code, message, blocking });
const personWindow = (e: Pick<LedgerEvent, 'personKey' | 'hexagonId' | 'source' | 'scanWindow'>) => `${e.personKey}|${e.hexagonId}|${e.source}|${e.scanWindow}`;
const cohortKey = (hexagonId: string, source: string, tileKind: string | null, configVersion: number) => `${hexagonId}|${source}|${tileKind ?? '?'}|v${configVersion}`;

/** Small deterministic hash (cyrb53) over a canonical rendering of the inputs; not a security control. */
export function digestOf(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const canonical = (events: readonly LedgerEvent[]): string =>
  events.map((e) => [e.type, e.personKey, e.hexagonId, e.source, e.scanWindow, e.at, e.answer ?? '', e.tileKind ?? '', e.confidenceAtDisplay ?? '', e.configVersion].join('~')).sort().join('\n');

export function measure(input: readonly LedgerEvent[], opts: MeasureOptions): MeasurementReport {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const retention = opts.rawRetentionMs ?? DEFAULT_RAW_RETENTION_MS;
  const withdrawn = opts.withdrawn ?? new Set<string>();
  const reportWarnings: Warning[] = [];

  let outOfWindow = 0, withdrawnExcluded = 0;
  const used: LedgerEvent[] = [];
  for (const e of input) {
    if (withdrawn.has(e.personKey)) { withdrawnExcluded++; continue; }
    if (e.at < opts.windowStart || e.at >= opts.windowEnd) { outOfWindow++; continue; }
    used.push(e);
  }
  if (withdrawnExcluded > 0) reportWarnings.push(w('withdrawn_inputs_excluded', `${withdrawnExcluded} event(s) from withdrawn people were left out.`));
  if (opts.windowStart < opts.now - retention) {
    reportWarnings.push(w('window_exceeds_raw_retention', 'Part of this window is older than raw retention: those days exist only as rollup counts, which this reader does not include and which cannot be retracted per person.'));
    reportWarnings.push(w('rollup_inputs_not_retractable', 'Rollups carry no person key, so a later withdrawal cannot be removed from them.'));
  }

  // The first "shown" per person/hexagon/source/window defines what was shown to them (kind, confidence, version).
  const shownBy = new Map<string, LedgerEvent>();
  let duplicateShown = 0;
  for (const e of [...used].filter((x) => x.type === 'shown').sort((a, b) => a.at - b.at)) {
    const k = personWindow(e);
    if (shownBy.has(k)) duplicateShown++; else shownBy.set(k, e);
  }
  // The first answer per person/hexagon/source/window counts; later ones are kept in the ledger but not counted.
  const answerBy = new Map<string, LedgerEvent>();
  let repeatedAnswers = 0;
  for (const e of [...used].filter((x) => x.type === 'answer').sort((a, b) => a.at - b.at)) {
    const k = personWindow(e);
    if (answerBy.has(k)) repeatedAnswers++; else answerBy.set(k, e);
  }

  interface Acc { hexagonId: string; source: string; tileKind: string | null; configVersion: number; shown: ShownEvent[]; answers: AnswerEvent[]; confidences: Set<number>; withoutShown: number; mismatch: number }
  const cohorts = new Map<string, Acc>();
  const acc = (hexagonId: string, source: string, tileKind: string | null, configVersion: number): Acc => {
    const k = cohortKey(hexagonId, source, tileKind, configVersion);
    let a = cohorts.get(k);
    if (!a) { a = { hexagonId, source, tileKind, configVersion, shown: [], answers: [], confidences: new Set(), withoutShown: 0, mismatch: 0 }; cohorts.set(k, a); }
    return a;
  };
  let answersWithoutShown = 0, cohortMismatch = 0, missingTileKind = 0;
  for (const s of shownBy.values()) {
    if (s.tileKind === null) missingTileKind++;
    const a = acc(s.hexagonId, s.source, s.tileKind, s.configVersion);
    a.shown.push({ personKey: s.personKey, hexagonId: s.hexagonId, source: s.source, scanWindow: s.scanWindow });
    if (s.confidenceAtDisplay !== null) a.confidences.add(s.confidenceAtDisplay);
  }
  for (const r of answerBy.values()) {
    const s = shownBy.get(personWindow(r));
    // An answer belongs to the cohort of what was shown to that person; with no "shown" it falls back to its own stamp.
    const a = s ? acc(s.hexagonId, s.source, s.tileKind, s.configVersion) : acc(r.hexagonId, r.source, r.tileKind, r.configVersion);
    if (!s) { a.withoutShown++; answersWithoutShown++; if (r.tileKind === null) missingTileKind++; if (r.confidenceAtDisplay !== null) a.confidences.add(r.confidenceAtDisplay); }
    else if (s.tileKind !== r.tileKind || s.configVersion !== r.configVersion) { a.mismatch++; cohortMismatch++; }
    a.answers.push({ personKey: r.personKey, hexagonId: r.hexagonId, source: r.source, scanWindow: r.scanWindow, answer: r.answer as Answer, at: r.at });
  }

  const out: Cohort[] = [];
  const versions = new Map<string, Set<number>>();
  for (const a of cohorts.values()) {
    const vk = `${a.hexagonId}|${a.source}`;
    if (!versions.has(vk)) versions.set(vk, new Set());
    versions.get(vk)!.add(a.configVersion);
    const summary = summarise(a.shown, a.answers)[0];
    const warnings: Warning[] = [];
    const guessAnswers = summary.yesMe + summary.notMe, disputeAnswers = summary.disputed + summary.kept;
    const basis: Cohort['basis'] = guessAnswers > 0 && disputeAnswers === 0 ? 'accuracy' : disputeAnswers > 0 && guessAnswers === 0 ? 'dispute' : 'unknown';
    if (guessAnswers > 0 && disputeAnswers > 0) warnings.push(w('mixed_answer_kinds', 'Guess answers and dispute answers are mixed in one cohort; they are never pooled.', true));
    if (a.tileKind === null) warnings.push(w('missing_tile_kind', 'The kind of tile shown is unknown, so guess rejection and checked-finding disputes cannot be separated.', true));
    if (a.shown.length === 0) warnings.push(w('missing_shown_denominator', 'No "shown" events: the response rate has no honest denominator.', true));
    else if (a.withoutShown > 0) warnings.push(w('answers_without_shown', `${a.withoutShown} answer(s) had no matching "shown"; the denominator was raised to the responders.`));
    if (a.mismatch > 0) warnings.push(w('cohort_mismatch', `${a.mismatch} answer(s) were stamped with a different tile kind or version than was shown to that person.`));
    if (a.confidences.size > 1) warnings.push(w('mixed_confidence_display', 'More than one confidence was shown in this cohort.', true));
    const confidenceShown = a.confidences.size === 1 ? [...a.confidences][0] : null;
    if (confidenceShown === null && a.confidences.size === 0) warnings.push(w('current_confidence_unknown', 'No confidence-at-display was recorded, so the value in force is unknown.', true));
    if (!summary.enough) warnings.push(w('below_minimum_sample', `${summary.responders} of ${MIN_RESPONDERS} responders: report-only, nothing is proposed.`));
    let proposal: Proposal | null = null;
    const blocked = warnings.some((x) => x.blocking);
    if (summary.enough && !blocked && confidenceShown !== null) {
      proposal = proposalFor(summary, confidenceShown);
      if (!proposal) warnings.push(w('interval_contains_current', 'Enough responders, but the confidence in force is still inside the interval: indistinguishable from noise.'));
    }
    out.push({
      key: cohortKey(a.hexagonId, a.source, a.tileKind, a.configVersion), hexagonId: a.hexagonId, source: a.source, tileKind: a.tileKind,
      configVersion: a.configVersion, confidenceShown, basis, summary, status: proposal ? 'proposal_candidate' : 'report_only', proposal, warnings,
    });
  }
  out.sort((x, y) => x.key.localeCompare(y.key));

  const versionBoundaries = [...versions.entries()].map(([k, set]) => {
    const [hexagonId, source] = k.split('|');
    return { hexagonId, source, configVersions: [...set].sort((p, q) => p - q) };
  }).sort((p, q) => (p.hexagonId + p.source).localeCompare(q.hexagonId + q.source));
  for (const v of versionBoundaries) {
    if (v.configVersions.length > 1) {
      const msg = `${v.hexagonId}/${v.source} has data under config versions ${v.configVersions.join(', ')}; each version is reported separately and never pooled.`;
      reportWarnings.push(w('multiple_config_versions', msg));
      for (const c of out) if (c.hexagonId === v.hexagonId && c.source === v.source) c.warnings.push(w('multiple_config_versions', msg));
    }
  }

  const newest = used.length ? Math.max(...used.map((e) => e.at)) : null;
  const ageMs = newest === null ? null : opts.now - newest;
  const stale = newest === null || (ageMs as number) > maxAgeMs;
  if (used.length === 0) reportWarnings.push(w('no_data', 'No usable events in this window. Missing data is unknown, not "clear".'));
  else if (stale) reportWarnings.push(w('stale_data', `Newest event is ${(Math.round((ageMs as number) / 360000) / 10)} h old (limit ${maxAgeMs / 3600000} h): the pipeline or the job may have stopped.`));

  return {
    rulesVersion: RULES_VERSION, minResponders: MIN_RESPONDERS, z: Z_95,
    window: { start: opts.windowStart, end: opts.windowEnd }, generatedAt: opts.now,
    inputDigest: digestOf(canonical(input) + `|w${opts.windowStart}-${opts.windowEnd}|x${[...withdrawn].sort().join(',')}`),
    freshness: { newestEventAt: newest, ageMs, stale, maxAgeMs },
    totals: { eventsRead: input.length, eventsUsed: used.length, outOfWindow, withdrawnExcluded, duplicateShown, repeatedAnswers, answersWithoutShown, cohortMismatch, missingTileKind },
    versionBoundaries, cohorts: out, warnings: reportWarnings,
  };
}
