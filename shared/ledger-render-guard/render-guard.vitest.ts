// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MPC-8737 — render guard: golden cases + property tests (fast-check).
 *
 * The properties are the honesty rules of design MPC-7898 criterion 7, stated as things that must hold for ANY input:
 *   an unknown / not_checked / failed / stale / malformed result never renders clean, "no exposures" or a score; the four classes stay
 *   separate; the progress line is three whole numbers that add up to the expected set.
 * golden.json is the same file the SQL twin (ledger.render_claim) is run against in supabase/tests/mpc-8737-golden.test.sql.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import golden from './golden.json';
import {
  classOf, confidenceBand, evalClaim, GUESS_BELOW, isCleanFamilyKey, renderClaim, renderProgress,
  type Class, type DataPointRow, type Source, type Status, type TypeInfo,
} from './index.ts';

const NOW = 1_800_000_000_000;
const RUNS = { numRuns: 1000 };

// ── generators ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sources = fc.constantFrom<Source>('taken', 'given', 'checked');
const statuses = fc.constantFrom<Status>('found', 'clear', 'not_checked', 'check_failed');
const typeInfo: fc.Arbitrary<TypeInfo> = fc.record({
  phraseKeyBase: fc.constantFrom('photo_public', 'email_breach', 'residence', 'category_broker'),
  cleanPhraseAllowed: fc.boolean(),
  maxAgeMs: fc.oneof({ weight: 3, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: fc.integer({ min: 1_000, max: 90 * 86_400_000 }) }),
});
/** A lawful row: honours H2 (no number on an unknown) and H10 (given tops out at 99). */
const confArb = fc.oneof({ weight: 3, arbitrary: fc.constantFrom(0, 39, 40, 79, 80, 94, 95, 99, 100) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 100 }) });
const ageArb = fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 1_000_000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 120 * 86_400_000 }) });
const ttlArb = fc.oneof({ weight: 4, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: fc.integer({ min: -86_400_000, max: 86_400_000 }) });
const lawfulRow = (i: number): fc.Arbitrary<DataPointRow> =>
  fc.record({ source: sources, status: statuses, conf: confArb, age: ageArb, ttl: ttlArb, answer: fc.constantFrom('confirmed', 'not_me', 'disputed', null), flag: fc.boolean() })
    .map(({ source, status, conf, age, ttl, answer, flag }) => {
      const known = status === 'found' || status === 'clear';
      const confidence = known ? (source === 'given' ? Math.min(conf, 99) : conf) : null;
      return {
        id: `dp${i}`, source, status, confidence,
        value: known ? (source === 'given' && answer ? { answer } : { public: flag }) : null,
        observedAt: NOW - age, expiresAt: ttl === null ? null : NOW + ttl,
      } as DataPointRow;
    });
const rowsArb = fc.integer({ min: 0, max: 6 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => lawfulRow(i))));
const newestChecked = (rows: DataPointRow[]) => rows.filter((r) => r.source !== 'given').reduce<DataPointRow | undefined>((b, r) => (!b || r.observedAt > b.observedAt ? r : b), undefined);
const expired = (r: DataPointRow, t: TypeInfo) => (r.expiresAt != null && r.expiresAt <= NOW) || (t.maxAgeMs != null && r.observedAt + t.maxAgeMs <= NOW);

// ── golden cases (shared with the SQL guard) ──────────────────────────────────────────────────────────────────────────────────
describe('golden cases', () => {
  const types = golden.types as Record<string, { base: string; clean: boolean; maxAgeSec: number | null }>;
  for (const [i, c] of (golden.cases as any[]).entries()) {
    it(`${String(i + 1).padStart(2, '0')} ${c.name}`, () => {
      const t = types[c.type];
      const info: TypeInfo = { phraseKeyBase: t.base, cleanPhraseAllowed: t.clean, maxAgeMs: t.maxAgeSec === null ? null : t.maxAgeSec * 1000 };
      const rows: DataPointRow[] = c.rows.map((r: any, k: number) => ({
        id: `g${k}`, source: r.source, status: r.status, confidence: r.confidence, value: r.value,
        observedAt: NOW + r.observedOffsetSec * 1000, expiresAt: r.expiresOffsetSec == null ? null : NOW + r.expiresOffsetSec * 1000,
      }));
      const out = renderClaim(info, rows, NOW);
      expect(out.phraseKey).toBe(`report.${c.expect.class}.${t.base}.${c.expect.variant}`);
      expect(out.class).toBe(c.expect.class);
      expect(out.action).toBe(c.expect.action);
      if ('bar' in c.expect) expect(out.bar).toBe(c.expect.bar);
      if (c.expect.class === 'unknown') expect(out.bar).toBeNull();
    });
  }
});

// ── properties ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('property: unknown never renders clean', () => {
  it('if the newest check is missing, not_checked, check_failed or stale, no clean / clear-in-source phrase and no verified class comes out of a CHECK', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const latest = newestChecked(rows);
      const checkIsUsable = !!latest && (latest.status === 'found' || latest.status === 'clear') && !expired(latest, t);
      const out = renderClaim(t, rows, NOW);
      if (!checkIsUsable) {
        expect(out.class).not.toBe('verified');
        expect(isCleanFamilyKey(out.phraseKey)).toBe(false);
      }
    }), RUNS);
  });

  it('the clean phrase appears only for a fresh, checked, clear, >= 80 row on a type that allows it', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const out = renderClaim(t, rows, NOW);
      if (out.phraseKey.endsWith('.clean')) {
        const latest = newestChecked(rows)!;
        expect(t.cleanPhraseAllowed).toBe(true);
        expect(latest.source).toBe('checked');
        expect(latest.status).toBe('clear');
        expect(latest.confidence!).toBeGreaterThanOrEqual(GUESS_BELOW);
        expect(expired(latest, t)).toBe(false);
        expect(out.class).toBe('verified');
      }
      if (isCleanFamilyKey(out.phraseKey)) expect(out.class).toBe('verified');
    }), RUNS);
  });

  it('a result that is unknown carries no bar, no value and no clean-sounding key; its action is retry, recheck or none', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const out = renderClaim(t, rows, NOW);
      if (out.class === 'unknown') {
        expect(out.bar).toBeNull();
        expect(out.phraseKey).toMatch(/^report\.unknown\.[a-z0-9_]+\.(not_checked|unavailable|stale)$/);
        expect(['retry', 'recheck', null]).toContain(out.action);
        expect(out.params).not.toHaveProperty('value');
      }
    }), RUNS);
  });

  it('every phrase key states its own class, so a translator cannot turn a guess into a fact without changing a key', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const out = renderClaim(t, rows, NOW);
      expect(out.phraseKey.startsWith(`report.${out.class}.`)).toBe(true);
      expect(out.phraseKey).not.toMatch(/\s/);
    }), RUNS);
  });
});

describe('property: provider timeouts, nulls and errors', () => {
  const garbage = fc.oneof(
    fc.constant(null), fc.constant(undefined), fc.constant({}), fc.constant('timeout'), fc.constant(NaN), fc.constant(42),
    fc.record({ id: fc.constant('x'), source: fc.constant('checked'), status: fc.constant('found'), confidence: fc.constantFrom(NaN, Infinity, -5, 500, null, undefined as any), value: fc.anything(), observedAt: fc.constantFrom(NaN, undefined as any, 'now' as any, NOW) }),
    fc.record({ id: fc.constant('y'), source: fc.constantFrom('guess', 'unknown', undefined as any), status: fc.constantFrom('clean', 'ok', 'found'), confidence: fc.integer({ min: 0, max: 100 }), value: fc.anything(), observedAt: fc.constant(NOW - 1000) }),
  );

  it('malformed rows, null rows, a null row list or a missing type: unknown, never clean, never a throw', () => {
    fc.assert(fc.property(fc.option(typeInfo, { nil: undefined }), fc.oneof(fc.array(garbage as fc.Arbitrary<any>, { maxLength: 6 }), fc.constant(null), fc.constant(undefined)), (t, rows) => {
      const out = renderClaim(t, rows as any, NOW);
      expect(out.class).not.toBe('verified');
      expect(isCleanFamilyKey(out.phraseKey)).toBe(false);
      expect(out.bar === null || (out.bar >= 1 && out.bar <= 5)).toBe(true);
    }), RUNS);
  });

  it('an exception inside evaluation is swallowed into unknown + retry (fail closed)', () => {
    const poison = new Proxy({}, { get() { throw new Error('provider exploded'); } }) as unknown as DataPointRow;
    const out = renderClaim({ phraseKeyBase: 'photo_public', cleanPhraseAllowed: true }, [poison], NOW);
    expect(out.class).toBe('unknown');
    expect(out.action).toBe('retry');
    expect(isCleanFamilyKey(out.phraseKey)).toBe(false);
    expect(renderClaim({ phraseKeyBase: 'x', cleanPhraseAllowed: true }, [], Number.NaN).class).toBe('unknown');
  });

  it('a failed check that arrives AFTER a good one always takes the good one away (a timeout never leaves an older "clean" standing)', () => {
    fc.assert(fc.property(typeInfo, fc.constantFrom<Status>('not_checked', 'check_failed'), fc.integer({ min: 1, max: 1_000_000 }), (t, failStatus, gap) => {
      const good: DataPointRow = { id: 'good', source: 'checked', status: 'clear', confidence: 100, value: { public: false }, observedAt: NOW - 10_000_000 };
      const bad: DataPointRow = { id: 'bad', source: 'checked', status: failStatus, confidence: null, value: null, observedAt: NOW - 10_000_000 + gap };
      const out = renderClaim({ ...t, maxAgeMs: null }, [good, bad], NOW);
      expect(out.class).toBe('unknown');
      expect(isCleanFamilyKey(out.phraseKey)).toBe(false);
    }), RUNS);
  });
});

describe('property: the four classes stay separate', () => {
  it('the user\'s own answer (given) alone is never Verified, whatever its confidence or age', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const givenOnly = rows.filter((r) => r.source === 'given');
      const out = renderClaim(t, givenOnly, NOW);
      expect(out.class).not.toBe('verified');
      expect(out.phraseKey).not.toMatch(/\.(found|clean|clear_in_source|observed|mismatch)$/);
    }), RUNS);
  });

  it('a check alone is never Self-attested; a self-attested result always traces to a given row', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const checkedOnly = rows.filter((r) => r.source !== 'given');
      expect(renderClaim(t, checkedOnly, NOW).class).not.toBe('self_attested');
      const out = renderClaim(t, rows, NOW);
      if (out.class === 'self_attested') expect(out.dataPointIds.some((id) => rows.find((r) => r.id === id)?.source === 'given')).toBe(true);
    }), RUNS);
  });

  it('the 80 boundary: 79 is a guess, 80 is not; below 80 is never Verified or Self-attested, 80+ is never Inferred', () => {
    fc.assert(fc.property(typeInfo, sources, fc.integer({ min: 0, max: 99 }), (t, source, conf) => {
      const row: DataPointRow = { id: 'r', source, status: 'found', confidence: conf, value: { public: true }, observedAt: NOW - 1000 };
      const cls: Class = classOf(row, { ...t, maxAgeMs: null }, NOW);
      expect(cls === 'inferred').toBe(conf < 80);
      if (conf < 80) expect(['verified', 'self_attested']).not.toContain(cls);
    }), RUNS);
  });

  it('every non-unknown result traces to at least one data point; a result with ids only names rows it was given', () => {
    fc.assert(fc.property(typeInfo, rowsArb, (t, rows) => {
      const out = renderClaim(t, rows, NOW);
      if (out.class !== 'unknown') expect(out.dataPointIds.length).toBeGreaterThan(0);
      for (const id of out.dataPointIds) expect(rows.some((r) => r.id === id)).toBe(true);
    }), RUNS);
  });

  it('bar follows the bands and never appears without a number', () => {
    expect([39, 40, 59, 60, 79, 80, 94, 95, 100].map(confidenceBand)).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(confidenceBand(null)).toBeNull();
    expect(confidenceBand(NaN)).toBeNull();
  });
});

describe('property: the progress line is never fractional', () => {
  const itemArb = fc.record({ type: typeInfo, rows: rowsArb });

  it('three whole non-negative numbers that add up to the expected set; the result has no score / ratio / percentage field', () => {
    fc.assert(fc.property(fc.array(itemArb, { minLength: 1, maxLength: 8 }), (items) => {
      const p = renderProgress('mirror', items, NOW);
      for (const n of [p.verified, p.selfAttestedFixes, p.notYetChecked]) { expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(0); }
      expect(p.verified + p.selfAttestedFixes + p.notYetChecked).toBe(items.length);
      expect(Object.keys(p).sort()).toEqual(['dataPointIds', 'notYetChecked', 'params', 'phraseKey', 'selfAttestedFixes', 'verified']);
      const json = JSON.stringify(p);
      expect(json).not.toMatch(/score|ratio|percent|fraction|%/i);
      expect(json).not.toMatch(/\d\.\d/);
    }), RUNS);
  });

  it('counts are exactly the tally of the per-claim classes; Inferred and Unknown both land in "not yet checked"', () => {
    fc.assert(fc.property(fc.array(itemArb, { minLength: 1, maxLength: 8 }), (items) => {
      const classes = items.map((i) => renderClaim(i.type, i.rows, NOW).class);
      const p = renderProgress('mirror', items, NOW);
      expect(p.verified).toBe(classes.filter((c) => c === 'verified').length);
      expect(p.selfAttestedFixes).toBe(classes.filter((c) => c === 'self_attested').length);
      expect(p.notYetChecked).toBe(classes.filter((c) => c === 'inferred' || c === 'unknown').length);
    }), RUNS);
  });

  it('an item with no data still counts (the expected set, not the answered set); an erroring item counts as not yet checked', () => {
    const t: TypeInfo = { phraseKeyBase: 'photo_public', cleanPhraseAllowed: false };
    const p = renderProgress('p', [{ type: t, rows: [] }, { type: t, rows: null as any }, { type: undefined, rows: [] }], NOW);
    expect(p).toMatchObject({ verified: 0, selfAttestedFixes: 0, notYetChecked: 3, phraseKey: 'report.progress.line' });
  });

  it('an empty or missing profile is "undefined", never a complete-looking line', () => {
    for (const items of [[], null, undefined]) {
      const p = renderProgress('whatsapp_audit_14', items as any, NOW);
      expect(p.phraseKey).toBe('report.progress.profile_undefined');
      expect(p.verified + p.selfAttestedFixes + p.notYetChecked).toBe(0);
    }
  });

  it('a progress line where every check failed or was skipped reads 0 verified, never "all clear"', () => {
    fc.assert(fc.property(fc.array(fc.tuple(typeInfo, fc.constantFrom<Status>('not_checked', 'check_failed')), { minLength: 1, maxLength: 8 }), (items) => {
      const p = renderProgress('p', items.map(([type, status]) => ({ type, rows: [{ id: 'f', source: 'checked', status, confidence: null, value: null, observedAt: NOW - 1 } as DataPointRow] })), NOW);
      expect(p.verified).toBe(0);
      expect(p.notYetChecked).toBe(items.length);
    }), RUNS);
  });
});

describe('evalClaim is deterministic and order-independent', () => {
  it('shuffling the input rows never changes the answer', () => {
    fc.assert(fc.property(typeInfo, rowsArb, fc.integer(), (t, rows, seed) => {
      const shuffled = [...rows].sort((a, b) => ((a.id.charCodeAt(2) * 31 + seed) % 7) - ((b.id.charCodeAt(2) * 31 + seed) % 7));
      // equal timestamps make the pick ambiguous by design; compare only when every observedAt is distinct
      if (new Set(rows.map((r) => r.observedAt)).size !== rows.length) return;
      expect(evalClaim(t, shuffled, NOW)).toEqual(evalClaim(t, rows, NOW));
    }), RUNS);
  });
});
