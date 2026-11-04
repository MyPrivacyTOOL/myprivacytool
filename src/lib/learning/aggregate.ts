// MPC-7915 (design: https://app.notion.com/p/3fe28547eaa781bbb748c984b7601dd3): turns visitors' answers into a proposed confidence change.
// Pure functions, no I/O and nothing applied: a proposal is only a row for a human to approve (Chris, 2026-10-19: approver is Chris alone).
// Rules (all agreed 2026-10-19):
//   - silence is never an answer: only explicit answers are counted, and the response rate is reported beside every rate
//   - one vote per person per hexagon per scan window: the first answer counts, a later change is ignored here
//   - a rate is over responders, never over everyone who was shown the tile
//   - a minimum of 30 responders, and a 95% Wilson interval: a change is proposed only when the interval excludes the current value
//   - no finding value is ever in these events

export type Answer = 'yes_me' | 'not_me' | 'disputed' | 'kept';

export interface ShownEvent {
  personKey: string;
  hexagonId: string;
  source: string;
  scanWindow: string;
}

export interface AnswerEvent extends ShownEvent {
  answer: Answer;
  /** Milliseconds since the epoch: decides which of one person's answers is the first. */
  at: number;
}

export const MIN_RESPONDERS = 30;
export const Z_95 = 1.96;

export interface Interval { rate: number; low: number; high: number }

/** Wilson score interval for `successes` out of `n`. n = 0 gives rate 0 and the widest interval. */
export function wilson(successes: number, n: number, z: number = Z_95): Interval {
  if (n <= 0) return { rate: 0, low: 0, high: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const key = (e: ShownEvent) => `${e.personKey}|${e.hexagonId}|${e.source}|${e.scanWindow}`;
const groupKey = (e: Pick<ShownEvent, 'hexagonId' | 'source'>) => `${e.hexagonId}|${e.source}`;

/** One answer per person per hexagon per scan window: the earliest. Order of the input does not matter. */
export function firstAnswers(events: readonly AnswerEvent[]): AnswerEvent[] {
  const first = new Map<string, AnswerEvent>();
  for (const e of events) {
    const k = key(e);
    const seen = first.get(k);
    if (!seen || e.at < seen.at) first.set(k, e);
  }
  return [...first.values()];
}

export interface GroupSummary {
  hexagonId: string;
  source: string;
  /** Distinct people who were shown the tile (one per person per window). */
  shownPeople: number;
  /** Distinct people who gave an explicit answer. */
  responders: number;
  /** responders / shownPeople. Always reported with any rate below. */
  responseRate: number;
  yesMe: number;
  notMe: number;
  disputed: number;
  kept: number;
  /** For a guess: yes_me out of yes_me + not_me. Null when nobody answered a guess. */
  accuracy: Interval | null;
  /** For a confident finding: disputed out of disputed + kept. Null when nobody answered a dispute prompt. */
  disputeRate: Interval | null;
  /** True once there are at least MIN_RESPONDERS responders. Below that nothing is proposed. */
  enough: boolean;
}

export function summarise(shown: readonly ShownEvent[], answers: readonly AnswerEvent[]): GroupSummary[] {
  const shownByGroup = new Map<string, Set<string>>();
  const ids = new Map<string, { hexagonId: string; source: string }>();
  for (const s of shown) {
    const g = groupKey(s);
    ids.set(g, { hexagonId: s.hexagonId, source: s.source });
    if (!shownByGroup.has(g)) shownByGroup.set(g, new Set());
    shownByGroup.get(g)!.add(key(s));
  }
  const byGroup = new Map<string, AnswerEvent[]>();
  for (const a of firstAnswers(answers)) {
    const g = groupKey(a);
    ids.set(g, { hexagonId: a.hexagonId, source: a.source });
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(a);
  }
  const out: GroupSummary[] = [];
  for (const [g, id] of ids) {
    const list = byGroup.get(g) ?? [];
    const count = (a: Answer) => list.filter((e) => e.answer === a).length;
    const yesMe = count('yes_me'), notMe = count('not_me'), disputed = count('disputed'), kept = count('kept');
    const responders = list.length;
    // A person may be counted as shown only through an answer (the tile was clearly shown to them): never fewer than responders.
    const shownPeople = Math.max(shownByGroup.get(g)?.size ?? 0, responders);
    out.push({
      ...id,
      shownPeople,
      responders,
      responseRate: shownPeople > 0 ? responders / shownPeople : 0,
      yesMe, notMe, disputed, kept,
      accuracy: yesMe + notMe > 0 ? wilson(yesMe, yesMe + notMe) : null,
      disputeRate: disputed + kept > 0 ? wilson(disputed, disputed + kept) : null,
      enough: responders >= MIN_RESPONDERS,
    });
  }
  return out.sort((a, b) => (a.hexagonId + a.source).localeCompare(b.hexagonId + b.source));
}

export interface Proposal {
  hexagonId: string;
  source: string;
  basis: 'accuracy' | 'dispute';
  /** The confidence in force, 0..1. */
  current: number;
  /** What the answers suggest, 0..1: the observed rate, never applied without a human. */
  proposed: number;
  interval: { low: number; high: number };
  responders: number;
  responseRate: number;
  note: string;
}

export const RESPONSE_BIAS_NOTE = 'Only people who answered are counted, and they are not everyone. Read the response rate beside this.';

/**
 * A proposal for one group, or null. Null means "do nothing": too few responders, or the current value is still inside the interval,
 * so the answers cannot tell it apart from noise. `current` is the confidence in force for this hexagon (0..1).
 */
export function proposalFor(s: GroupSummary, current: number): Proposal | null {
  if (!s.enough) return null;
  // A guess is judged on how often "yes, it's me" is right; a confident finding on how often it is disputed (so confidence is 1 - rate).
  const basis: Proposal['basis'] = s.accuracy ? 'accuracy' : 'dispute';
  const iv = s.accuracy ?? s.disputeRate;
  if (!iv) return null;
  const observed = basis === 'accuracy' ? iv.rate : 1 - iv.rate;
  const low = basis === 'accuracy' ? iv.low : 1 - iv.high;
  const high = basis === 'accuracy' ? iv.high : 1 - iv.low;
  if (current >= low && current <= high) return null;
  return {
    hexagonId: s.hexagonId, source: s.source, basis, current,
    proposed: Math.round(observed * 100) / 100,
    interval: { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 },
    responders: s.responders, responseRate: Math.round(s.responseRate * 100) / 100, note: RESPONSE_BIAS_NOTE,
  };
}
