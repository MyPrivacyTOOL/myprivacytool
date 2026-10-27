import { describe, it, expect } from 'vitest';
import { measure, type LedgerEvent } from './measure';
import { cohortEvents, T0, DAY } from './fixtures';

const NOW = T0 + 10 * DAY;
const opts = (over = {}) => ({ now: NOW, windowStart: T0, windowEnd: NOW, ...over });
const guess = (over = {}) => cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, configVersion: 0, prefix: 'g', yes: 15, no: 45, silent: 40, at: T0 + DAY, ...over });
const checked = (over = {}) => cohortEvents({ hexagonId: 'cookies-status', tileKind: 'needs_fixing', confidence: 0.95, configVersion: 0, prefix: 'c', disputed: 6, kept: 54, silent: 40, at: T0 + DAY, ...over });

describe('measure: meaning is preserved', () => {
  it('reports denominators and response rate beside every rate, and offers a candidate only past 30 responders with the interval excluding the current value', () => {
    const r = measure(guess(), opts());
    const c = r.cohorts[0];
    expect(c.summary).toMatchObject({ shownPeople: 100, responders: 60, responseRate: 0.6, yesMe: 15, notMe: 45 });
    expect(c.basis).toBe('accuracy');
    expect(c.status).toBe('proposal_candidate');
    expect(c.proposal).toMatchObject({ proposed: 0.25, current: 0.95 });
    expect(c.proposal!.note).toMatch(/not everyone/);
  });
  it('below 30 responders is report-only, however lopsided; no proposal', () => {
    const r = measure(guess({ yes: 0, no: 29, silent: 5 }), opts());
    expect(r.cohorts[0].status).toBe('report_only');
    expect(r.cohorts[0].proposal).toBeNull();
    expect(r.cohorts[0].warnings.map((w) => w.code)).toContain('below_minimum_sample');
  });
  it('30 responders is the line: 30 can propose, 29 cannot', () => {
    expect(measure(guess({ yes: 0, no: 30, silent: 0 }), opts()).cohorts[0].status).toBe('proposal_candidate');
    expect(measure(guess({ yes: 0, no: 29, silent: 0 }), opts()).cohorts[0].status).toBe('report_only');
  });
  it('enough responders but the interval contains the current value: still report-only, said plainly', () => {
    const r = measure(guess({ yes: 55, no: 5, silent: 0, confidence: 0.9 }), opts());
    expect(r.cohorts[0].status).toBe('report_only');
    expect(r.cohorts[0].warnings.map((w) => w.code)).toContain('interval_contains_current');
  });
  it('guess rejection and checked-finding disputes are separate cohorts with separate bases, never pooled', () => {
    const r = measure([...guess(), ...checked()], opts());
    expect(r.cohorts.map((c) => [c.hexagonId, c.basis])).toEqual([['cookies-status', 'dispute'], ['location', 'accuracy']]);
    expect(r.cohorts.find((c) => c.basis === 'dispute')!.summary.accuracy).toBeNull();
  });
  it('two kinds under one hexagon are two cohorts, so one kind cannot hide the other below 30', () => {
    const a = guess({ tileKind: 'our_guess' });
    const b = cohortEvents({ hexagonId: 'location', tileKind: 'you_told_us', confidence: 0.95, configVersion: 0, prefix: 'k', disputed: 3, kept: 3, silent: 0, at: T0 + DAY });
    const r = measure([...a, ...b], opts());
    expect(r.cohorts).toHaveLength(2);
    expect(r.cohorts.find((c) => c.tileKind === 'you_told_us')!.status).toBe('report_only');
  });
});

describe('measure: inputs', () => {
  it('is idempotent: the same input, replayed or run again or reordered, gives the same report', () => {
    const ev = guess();
    const a = measure(ev, opts());
    expect(measure(ev, opts())).toEqual(a);
    expect(measure([...ev].reverse(), opts())).toEqual(a);
    const replay = measure([...ev, ...ev], opts());
    expect(replay.cohorts[0].summary).toEqual(a.cohorts[0].summary);
    expect(replay.totals.duplicateShown).toBe(100);
  });
  it('one vote per person: a later changed answer is kept in the ledger but not counted', () => {
    const ev = guess({ yes: 0, no: 40, silent: 0 });
    const extra: LedgerEvent = { ...ev.find((e) => e.type === 'answer')!, answer: 'yes_me', at: T0 + 5 * DAY };
    const r = measure([...ev, extra], opts());
    expect(r.cohorts[0].summary).toMatchObject({ notMe: 40, yesMe: 0 });
    expect(r.totals.repeatedAnswers).toBe(1);
  });
  it('the same person in a new scan window counts again; in the same window does not', () => {
    const a = guess({ yes: 0, no: 20, silent: 0 }), b = guess({ yes: 0, no: 20, silent: 0, scanWindow: 'w2' });
    expect(measure([...a, ...b], opts()).cohorts[0].summary.responders).toBe(40);
  });
  it('withdrawn people are excluded entirely (answers and denominators), and the exclusion is reported', () => {
    const ev = guess({ yes: 0, no: 40, silent: 10 });
    const withdrawn = new Set(ev.filter((e) => e.type === 'shown').slice(0, 20).map((e) => e.personKey));
    const r = measure(ev, opts({ withdrawn }));
    expect(r.totals.withdrawnExcluded).toBe(40);   // 20 people x (shown + answer)
    expect(r.cohorts[0].summary.shownPeople).toBe(50 - withdrawn.size);
    expect(r.cohorts[0].summary.responders).toBeLessThan(40);
    expect(r.warnings.map((w) => w.code)).toContain('withdrawn_inputs_excluded');
  });
  it('deleted rows are simply absent: the report is what is left, with no trace of them', () => {
    const ev = guess({ yes: 0, no: 40, silent: 0 });
    const kept = ev.filter((e) => !e.personKey.includes('0001'));
    expect(measure(kept, opts()).cohorts[0].summary.responders).toBe(39);
  });
  it('an answer with no "shown" has no honest denominator: flagged, and no proposal is offered', () => {
    const ev = guess({ yes: 0, no: 40, silent: 0 }).filter((e) => e.type === 'answer');
    const r = measure(ev, opts());
    expect(r.totals.answersWithoutShown).toBe(40);
    expect(r.cohorts[0].warnings.map((w) => w.code)).toContain('missing_shown_denominator');
    expect(r.cohorts[0].status).toBe('report_only');
    expect(r.cohorts[0].proposal).toBeNull();
  });
  it('some answers with no "shown" among many that have one: allowed but flagged, denominator raised to the responders', () => {
    const ev = guess({ yes: 15, no: 45, silent: 40 });
    const drop = ev.filter((e) => !(e.type === 'shown' && e.personKey.includes('0003')));
    const r = measure(drop, opts());
    expect(r.totals.answersWithoutShown).toBe(1);
    expect(r.cohorts[0].warnings.map((w) => w.code)).toContain('answers_without_shown');
    expect(r.cohorts[0].summary.shownPeople).toBe(99);
  });
  it('a cohort with no "shown" at all and unknown confidence cannot propose', () => {
    const ev = guess({ yes: 0, no: 40, silent: 0, confidence: null }).filter((e) => e.type === 'answer');
    const r = measure(ev, opts());
    expect(r.cohorts[0].status).toBe('report_only');
    expect(r.cohorts[0].warnings.map((w) => w.code)).toContain('current_confidence_unknown');
  });
  it('missing tile kind blocks a proposal because guess and dispute answers cannot be separated', () => {
    const r = measure(guess({ tileKind: null }), opts());
    expect(r.cohorts[0].status).toBe('report_only');
    expect(r.totals.missingTileKind).toBeGreaterThan(0);
  });
  it('mixed versions are never pooled; each version is its own cohort and the boundary is reported', () => {
    const r = measure([...guess(), ...guess({ configVersion: 1, confidence: 0.25, prefix: 'v1', yes: 20, no: 10, silent: 5 })], opts());
    expect(r.cohorts.map((c) => c.configVersion)).toEqual([0, 1]);
    expect(r.versionBoundaries).toEqual([{ hexagonId: 'location', source: 'web-scan', configVersions: [0, 1] }]);
    expect(r.warnings.map((w) => w.code)).toContain('multiple_config_versions');
  });
  it('mixed confidence displayed within one version blocks a proposal', () => {
    const r = measure([...guess(), ...guess({ confidence: 0.6, prefix: 'm', yes: 0, no: 5, silent: 0 })], opts());
    expect(r.cohorts[0].status).toBe('report_only');
    expect(r.cohorts[0].warnings.map((w) => w.code)).toContain('mixed_confidence_display');
  });
  it('an answer stamped differently from what was shown is counted against what was shown and flagged', () => {
    const ev = guess({ yes: 0, no: 35, silent: 0 });
    const tampered = ev.map((e) => (e.type === 'answer' && e.personKey.includes('0000') ? { ...e, configVersion: 7 } : e));
    const r = measure(tampered, opts());
    expect(r.totals.cohortMismatch).toBe(1);
    expect(r.cohorts).toHaveLength(1);
  });
  it('a cohort mixing guess answers and dispute answers is report-only', () => {
    const ev = [...guess({ yes: 20, no: 20, silent: 0 }), ...cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, configVersion: 0, prefix: 'z', disputed: 5, silent: 0, at: T0 + DAY })];
    const r = measure(ev, opts());
    expect(r.cohorts[0].basis).toBe('unknown');
    expect(r.cohorts[0].status).toBe('report_only');
  });
});

describe('measure: freshness and window', () => {
  it('stale data is called stale; an empty window is "no data", not clear', () => {
    expect(measure(guess(), opts({ now: NOW + 30 * DAY, windowEnd: NOW + 30 * DAY })).freshness.stale).toBe(true);
    const empty = measure([], opts());
    expect(empty.freshness.stale).toBe(true);
    expect(empty.warnings.map((w) => w.code)).toContain('no_data');
  });
  it('events outside the window are ignored and counted', () => {
    const r = measure(guess({ at: T0 - 5 * DAY }), opts());
    expect(r.totals.eventsUsed).toBe(0);
    expect(r.totals.outOfWindow).toBeGreaterThan(0);
  });
  it('a window that reaches past raw retention warns that rollups are not included or retractable', () => {
    const codes = measure(guess({ at: NOW - 1000 }), opts({ now: NOW + 200 * DAY, windowStart: T0, windowEnd: NOW + 200 * DAY })).warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['window_exceeds_raw_retention', 'rollup_inputs_not_retractable']));
  });
});
