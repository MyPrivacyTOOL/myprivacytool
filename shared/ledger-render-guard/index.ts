/**
 * MPC-8737 — the render guard, application side (design MPC-7898 section 6.2).
 *
 * Every channel's report generator turns data points into words ONLY through this module (or its database twin, ledger.render_claim /
 * ledger.render_progress). Both implement one truth model and are held to it by the same golden cases (golden.json is run here and, as
 * SQL, in supabase/tests/mpc-8737-golden.test.sql).
 *
 * The rules this file exists to enforce, in the order a reader will check them:
 *   - Unknown, not_checked, a failed check, a stale row, a malformed row, an exception: NEVER clean, NEVER "no exposures", never a score.
 *   - The clean phrase family is reachable from exactly one place (renderClaim, the `clean` variant), and only for source = checked,
 *     status = clear, confidence >= 80, unexpired, on a type that allows it.
 *   - Verified / Self-attested / Inferred / Unknown are four separate classes; a user's own answer (given) is never Verified.
 *   - The progress line is three whole numbers. There is no ratio, percentage or score anywhere in its return type.
 *   - The guard returns phrase KEYS and typed params, never a sentence (the localization layer owns the words).
 */

export const GUESS_BELOW = 80;
export const GUARD_VERSION = 'ledger-guard-1';

export type Source = 'taken' | 'given' | 'checked';
export type Status = 'found' | 'clear' | 'not_checked' | 'check_failed';
export type Class = 'verified' | 'self_attested' | 'inferred' | 'unknown';
export type Action = 'confirm' | 'retry' | 'recheck' | null;

export interface DataPointRow {
  id: string;
  source: Source;
  status: Status;
  /** 0-100, null when status is not_checked / check_failed. */
  confidence: number | null;
  value: unknown;
  observedAt: number;            // ms since epoch
  expiresAt?: number | null;     // ms since epoch
  supersedesId?: string | null;
}

export interface TypeInfo {
  /** Registry phrase_key_base, e.g. "photo_public". */
  phraseKeyBase: string;
  /** Registry clean_phrase_allowed: only such a type may ever produce the clean phrase. */
  cleanPhraseAllowed: boolean;
  /** Registry max_age in ms (null = never stale by age). */
  maxAgeMs?: number | null;
}

export interface ClaimResult {
  class: Class;
  /** report.<class>.<base>.<variant> — the class is part of the key, so a translator cannot turn a guess into a fact. */
  phraseKey: string;
  params: Record<string, unknown>;
  /** 1-5 word+bar; null for unknown. */
  bar: number | null;
  action: Action;
  dataPointIds: string[];
}

export interface ProgressResult {
  verified: number;
  selfAttestedFixes: number;
  notYetChecked: number;
  phraseKey: string;
  params: { verified: number; fixes: number; not_yet_checked: number } | { profile: string } | { reason: string };
  dataPointIds: string[];
}

/** Word+bar bands (design 6.1; PROPOSED defaults awaiting Chris, same as ledger.confidence_band). */
export function confidenceBand(c: number | null): number | null {
  if (c === null || !Number.isFinite(c)) return null;
  return c < 40 ? 1 : c < 60 ? 2 : c < 80 ? 3 : c < 95 ? 4 : 5;
}

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const SOURCES: readonly string[] = ['taken', 'given', 'checked'];
const STATUSES: readonly string[] = ['found', 'clear', 'not_checked', 'check_failed'];

/** A row we are prepared to reason about. Anything else is treated as if the check never produced an answer. */
function wellFormed(r: DataPointRow | null | undefined): r is DataPointRow {
  return !!r && typeof r === 'object' && typeof r.id === 'string' && SOURCES.includes(r.source) && STATUSES.includes(r.status) && isFiniteNumber(r.observedAt)
    && (r.confidence === null || (isFiniteNumber(r.confidence) && r.confidence >= 0 && r.confidence <= 100))
    && (r.expiresAt === undefined || r.expiresAt === null || isFiniteNumber(r.expiresAt));
}

export function isExpired(r: DataPointRow, type: TypeInfo, now: number): boolean {
  return (r.expiresAt != null && r.expiresAt <= now) || (type.maxAgeMs != null && r.observedAt + type.maxAgeMs <= now);
}

/** The class of one row. unknown wins: no number, a skipped / failed check, or a stale row can never be anything else. */
export function classOf(r: DataPointRow, type: TypeInfo, now: number): Class {
  if (!wellFormed(r)) return 'unknown';
  if ((r.status !== 'found' && r.status !== 'clear') || r.confidence === null || isExpired(r, type, now)) return 'unknown';
  if (r.confidence < GUESS_BELOW) return 'inferred';
  if (r.source === 'checked' || r.source === 'taken') return 'verified';
  if (r.source === 'given') return 'self_attested';
  return 'unknown';
}

/** Same rule as ledger.values_disagree: a user's `answer` contradicts only when it is not_me / disputed; otherwise values must differ. */
export function valuesDisagree(given: unknown, other: unknown): boolean {
  if (given === null || given === undefined || other === null || other === undefined) return false;
  if (typeof given === 'object' && !Array.isArray(given) && 'answer' in (given as object)) return ['not_me', 'disputed'].includes(String((given as { answer: unknown }).answer));
  return JSON.stringify(given) !== JSON.stringify(other);
}

const RANK: Record<Class, number> = { verified: 3, self_attested: 2, inferred: 1, unknown: 0 };
const newest = (rows: DataPointRow[]): DataPointRow | undefined =>
  rows.reduce<DataPointRow | undefined>((best, r) => (!best || r.observedAt > best.observedAt ? r : best), undefined);

/** Drops rows that a correction supersedes, then keeps the newest checked/taken row and the newest given row (the ledger's "current" view). */
export function currentRows(rows: DataPointRow[]): { checked?: DataPointRow; given?: DataPointRow } {
  const good = rows.filter(wellFormed);
  const superseded = new Set(good.map((r) => r.supersedesId).filter((x): x is string => !!x));
  const live = good.filter((r) => !superseded.has(r.id));
  return { checked: newest(live.filter((r) => r.source !== 'given')), given: newest(live.filter((r) => r.source === 'given')) };
}

const key = (cls: Class, base: string, variant: string) => `report.${cls}.${base}.${variant}`;

function unknownResult(base: string, variant: string, action: Action, ids: string[] = [], params: Record<string, unknown> = {}): ClaimResult {
  return { class: 'unknown', phraseKey: key('unknown', base, variant), params, bar: null, action, dataPointIds: ids };
}

/** Pure evaluation. May throw on programmer error; renderClaim() is the fail-closed wrapper channels must use. */
export function evalClaim(type: TypeInfo | undefined, rows: DataPointRow[], now: number): ClaimResult {
  if (!type) return unknownResult('unregistered', 'not_checked', null);
  const base = type.phraseKeyBase;
  const { checked: c, given: g } = currentRows(rows);
  const cCls = c ? classOf(c, type, now) : 'unknown';
  const gCls = g ? classOf(g, type, now) : 'unknown';

  if (cCls === 'unknown' && gCls === 'unknown') {
    if (c && c.status === 'check_failed') return unknownResult(base, 'unavailable', 'retry', [c.id]);
    if ((c && isExpired(c, type, now)) || (g && isExpired(g, type, now))) return unknownResult(base, 'stale', 'recheck', [c?.id, g?.id].filter((x): x is string => !!x));
    return unknownResult(base, 'not_checked', null, c ? [c.id] : []);
  }

  let cls: Class; let variant: string; let pick: DataPointRow; let ids: string[]; let params: Record<string, unknown> = {};
  if (c && g && cCls !== 'unknown' && gCls !== 'unknown' && valuesDisagree(g.value, c.value)) {
    params = { told: g.value, checked: c.value };
    if (cCls === 'verified' && g.observedAt <= c.observedAt) { cls = 'verified'; variant = 'mismatch'; pick = c; ids = [c.id, g.id]; }
    else { cls = gCls; variant = 'told_stale_check'; pick = g; ids = [g.id, c.id]; }
  } else {
    const usePick = RANK[cCls] >= RANK[gCls] ? c! : g!;
    pick = usePick; cls = RANK[cCls] >= RANK[gCls] ? cCls : gCls; ids = [pick.id]; params = { value: pick.value };
    if (cls === 'verified') {
      variant = pick.source === 'taken' ? 'observed'
        : pick.status === 'clear' && type.cleanPhraseAllowed ? 'clean'      // H3: the only door to the clean family
        : pick.status === 'clear' ? 'clear_in_source' : 'found';
    } else if (cls === 'self_attested') {
      const a = pick.value && typeof pick.value === 'object' ? (pick.value as { answer?: unknown }).answer : undefined;
      variant = a === 'not_me' ? 'told_not_me' : a === 'disputed' ? 'told_disputed' : 'told';
    } else variant = 'guess';
  }
  const action: Action = cls === 'inferred' ? 'confirm' : variant === 'told_stale_check' ? 'recheck' : null;
  return { class: cls, phraseKey: key(cls, base, variant), params, bar: confidenceBand(pick.confidence), action, dataPointIds: ids };
}

/**
 * G2 fail closed. ANY exception, malformed input or missing type returns Unknown + retry. A caller must not catch around this and render
 * something else; there is nothing cleaner to fall back to.
 */
export function renderClaim(type: TypeInfo | undefined, rows: DataPointRow[] | null | undefined, now: number): ClaimResult {
  try {
    if (!Array.isArray(rows) || !isFiniteNumber(now)) return unknownResult('guard', 'unavailable', 'retry', [], { reason: 'guard_error' });
    return evalClaim(type, rows, now);
  } catch {
    return unknownResult('guard', 'unavailable', 'retry', [], { reason: 'guard_error' });
  }
}

export interface ProgressItem { type: TypeInfo | undefined; rows: DataPointRow[] }

/**
 * "X verified · Y fixes you told us about · Z not yet checked". Three whole numbers (G6); every expected item is counted (G7), so a missing
 * item is Z, never silence; an item that errors is Z; Inferred is Z (D2 / F11). A profile with no items is "undefined", never complete.
 */
export function renderProgress(profile: string, items: ProgressItem[] | null | undefined, now: number): ProgressResult {
  try {
    if (!Array.isArray(items) || items.length === 0 || !isFiniteNumber(now)) {
      return { verified: 0, selfAttestedFixes: 0, notYetChecked: 0, phraseKey: 'report.progress.profile_undefined', params: { profile }, dataPointIds: [] };
    }
    let v = 0; let s = 0; let n = 0; const ids: string[] = [];
    for (const it of items) {
      const r = renderClaim(it?.type, it?.rows, now);
      if (r.class === 'verified') v++; else if (r.class === 'self_attested') s++; else n++;
      ids.push(...r.dataPointIds);
    }
    return { verified: v, selfAttestedFixes: s, notYetChecked: n, phraseKey: 'report.progress.line', params: { verified: v, fixes: s, not_yet_checked: n }, dataPointIds: ids };
  } catch {
    return { verified: 0, selfAttestedFixes: 0, notYetChecked: 0, phraseKey: 'report.progress.unavailable', params: { reason: 'guard_error' }, dataPointIds: [] };
  }
}

/** Phrase keys that say or imply "all clear". Only the clean variant of a verified claim may be one (lint: no other key may match). */
export const CLEAN_FAMILY = /\.(clean|clear_in_source)$/;
export const isCleanFamilyKey = (k: string) => CLEAN_FAMILY.test(k);
